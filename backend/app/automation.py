"""Autopilot dispatch: the central store's standing rules for when a delivery wave leaves.

Rules per organisation (stored as JSON on the organisation):
  enabled       master switch
  auto_approve  allocate central stock to new requests as soon as they arrive (critical first)
  on_critical   dispatch at once when an approved critical request is waiting
  load_pct      dispatch when approved load reaches this % of fleet capacity
  times         fixed daily waves, "HH:MM" India time

Rules are evaluated after every event that can change them (new request, approval, a simulated day,
saving the rules) and by a once-a-minute scheduler. A wave runs in a background thread so the request
that triggered it returns immediately; the browser polls /automation to see it land.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from . import inventory as inv
from .data import VEHICLE_TYPES
from .db import SessionLocal

IST = timezone(timedelta(hours=5, minutes=30))
DEFAULT_RULES = {"enabled": False, "auto_approve": True, "on_critical": True, "load_pct": 60, "times": ["09:00", "14:00"]}

_running: dict[int, str] = {}  # org id -> trigger of the wave being planned right now
_last_wave: dict[int, dict] = {}  # org id -> summary of the latest automatic wave
_guard = threading.Lock()


def rules_of(org: inv.Organization) -> dict:
    return {**DEFAULT_RULES, **(org.rules or {})}


def _approved_state(db, org_id: int) -> tuple[float, bool, int]:
    locs, prods = inv._maps(db, org_id)
    reqs = db.scalars(select(inv.Requisition).options(selectinload(inv.Requisition.lines))
                      .where(inv.Requisition.org_id == org_id, inv.Requisition.status == "approved")).all()
    kg = sum(ln.qty_approved * prods[ln.product_id].unit_weight_kg for r in reqs for ln in r.lines)
    return kg, any(r.priority == "critical" for r in reqs), len(reqs)


def _capacity(db, org_id: int) -> float:
    vs = db.scalars(select(inv.Vehicle).where(inv.Vehicle.org_id == org_id, inv.Vehicle.active)).all()
    return float(sum(VEHICLE_TYPES[v.type]["capacity"] for v in vs)) or 1.0


def _due_time(rules: dict, last: datetime | None, now_ist: datetime) -> str | None:
    """Return the HH:MM slot that is due (passed today and not yet served), if any."""
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    for hhmm in sorted(rules.get("times") or []):
        try:
            h, m = map(int, hhmm.split(":"))
        except ValueError:
            continue
        slot = now_ist.replace(hour=h, minute=m, second=0, microsecond=0)
        if slot <= now_ist and (last is None or last < slot) and now_ist - slot < timedelta(hours=2):
            return hhmm
    return None


def next_slot(rules: dict, now_ist: datetime) -> str | None:
    for hhmm in sorted(rules.get("times") or []):
        h, m = map(int, hhmm.split(":"))
        if now_ist.replace(hour=h, minute=m, second=0, microsecond=0) > now_ist:
            return hhmm
    return (sorted(rules.get("times") or []) or [None])[0]


def status(org_id: int) -> dict:
    with SessionLocal() as db:
        org = db.get(inv.Organization, org_id)
        rules = rules_of(org)
        kg, crit, n = _approved_state(db, org_id)
        cap = _capacity(db, org_id)
        pending = len(db.scalars(select(inv.Requisition.id).where(inv.Requisition.org_id == org_id,
                                                                  inv.Requisition.status == "pending")).all())
        latest = db.scalars(select(inv.Shipment).where(inv.Shipment.org_id == org_id)
                            .order_by(inv.Shipment.id.desc()).limit(1)).first()
        auto = db.scalars(select(inv.Shipment).where(inv.Shipment.org_id == org_id, inv.Shipment.trigger != "manual")
                          .order_by(inv.Shipment.id.desc()).limit(8)).all()
    now_ist = datetime.now(IST)
    return {
        "rules": rules,
        "approved_kg": round(kg, 1), "capacity_kg": cap, "load_pct": round(100 * kg / cap, 1),
        "approved": n, "critical_waiting": crit, "pending": pending,
        "next_time": next_slot(rules, now_ist), "now": now_ist.strftime("%H:%M"),
        "last_auto_at": inv._iso(org.last_auto_at),
        "running": _running.get(org_id),
        "latest_shipment_id": latest.id if latest else None,
        "auto_waves": [inv.ship_dict(s) for s in auto],
    }


def save_rules(org_id: int, patch: dict) -> dict:
    clean = {}
    if "enabled" in patch: clean["enabled"] = bool(patch["enabled"])
    if "auto_approve" in patch: clean["auto_approve"] = bool(patch["auto_approve"])
    if "on_critical" in patch: clean["on_critical"] = bool(patch["on_critical"])
    if "load_pct" in patch: clean["load_pct"] = max(10, min(100, int(patch["load_pct"])))
    if "times" in patch:
        ok = []
        for t in patch["times"] or []:
            try:
                h, m = map(int, str(t).split(":"))
                if 0 <= h < 24 and 0 <= m < 60:
                    ok.append(f"{h:02d}:{m:02d}")
            except ValueError:
                continue
        clean["times"] = sorted(set(ok))[:6]
    with SessionLocal.begin() as db:
        org = db.get(inv.Organization, org_id)
        org.rules = {**rules_of(org), **clean}
    kick(org_id, "rules")
    return status(org_id)


def decide(org_id: int) -> str | None:
    """Apply auto-approval, then return the trigger that should dispatch now (or None)."""
    with SessionLocal.begin() as db:
        org = db.get(inv.Organization, org_id)
        rules = rules_of(org)
        if not rules["enabled"]:
            return None
        if rules["auto_approve"]:
            inv.approve(db, org_id, backorder=True)
    with SessionLocal() as db:
        org = db.get(inv.Organization, org_id)
        kg, crit, n = _approved_state(db, org_id)
        if not n:
            return None
        if rules["on_critical"] and crit:
            return "critical"
        if 100 * kg / _capacity(db, org_id) >= rules["load_pct"]:
            return "load"
        if _due_time(rules, org.last_auto_at, datetime.now(IST)):
            return "schedule"
    return None


def evaluate(org_id: int) -> dict | None:
    with _guard:
        if org_id in _running:
            return None
        _running[org_id] = "checking"
    try:
        trigger = decide(org_id)
        if not trigger:
            return None
        _running[org_id] = trigger
        out = inv.dispatch(org_id, None, "quantum", trigger=trigger)
        with SessionLocal.begin() as db:
            db.get(inv.Organization, org_id).last_auto_at = inv.now()
        _last_wave[org_id] = {"code": out["code"], "trigger": trigger, "at": time.time()}
        return out
    except ValueError:
        return None
    finally:
        _running.pop(org_id, None)


def kick(org_id: int, reason: str = "") -> None:
    """Evaluate the rules in the background (never blocks the request that changed something)."""
    threading.Thread(target=lambda: _safe(evaluate, org_id), daemon=True, name=f"autopilot-{org_id}").start()


def _safe(fn, *a):
    try:
        return fn(*a)
    except Exception as exc:  # noqa: BLE001 - background work must never crash the server
        print(f"[autopilot] {fn.__name__}{a} failed: {exc}", flush=True)


def start_scheduler(interval_s: float = 60.0) -> None:
    def loop():
        while True:
            time.sleep(interval_s)
            try:
                with SessionLocal() as db:
                    ids = [o.id for o in db.scalars(select(inv.Organization)) if rules_of(o)["enabled"]]
            except Exception:  # noqa: BLE001
                continue
            for oid in ids:
                _safe(evaluate, oid)

    threading.Thread(target=loop, daemon=True, name="autopilot-scheduler").start()
