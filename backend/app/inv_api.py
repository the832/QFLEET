"""REST API for QFleet Supply Network (mounted at /api/inv).

Access model
  * Demo organisations (no owner) are shared playgrounds: every signed-in user acts as main operator.
  * In your own organisation the creator is the main operator (admin). Teammates are invited by email:
      - admin   another main operator (approve, dispatch, rules, team)
      - branch  a branch operator locked to one site: sees only that site, raises its requests and
                confirms its deliveries
    An invite activates the first time that email signs in.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import selectinload

from . import automation
from . import inventory as inv
from .auth import current_user
from .db import DB_HOST, DB_KIND, SessionLocal

router = APIRouter(prefix="/api/inv", tags=["inventory"])


# ----------------------------------------------------------------------------- access control
@dataclass
class Ctx:
    user: dict
    oid: int
    role: str  # admin | branch
    location_id: int | None
    shared: bool

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


_cache: dict[tuple[int, str], tuple[Ctx, float]] = {}
CACHE_S = 30.0


def _email(user: dict) -> str:
    return (user.get("email") or "").strip().lower()


def _resolve(db, oid: int, user: dict) -> Ctx:
    org = db.get(inv.Organization, oid)
    if not org:
        raise HTTPException(404, "Organisation not found")
    if org.owner_id is None:
        return Ctx(user, oid, "admin", None, True)
    if org.owner_id == user["id"]:
        return Ctx(user, oid, "admin", None, False)
    m = db.scalars(select(inv.Membership).where(
        inv.Membership.org_id == oid,
        or_(inv.Membership.user_id == user["id"], func.lower(inv.Membership.email) == _email(user)))).first()
    if not m or not _email(user) and m.user_id != user["id"]:
        raise HTTPException(404, "Organisation not found")
    return Ctx(user, oid, m.role, m.location_id, False)


def access(oid: int, user: dict = Depends(current_user)) -> Ctx:
    key = (oid, user["id"])
    hit = _cache.get(key)
    if hit and time.time() - hit[1] < CACHE_S:
        return hit[0]
    with SessionLocal() as db:
        ctx = _resolve(db, oid, user)
    _cache[key] = (ctx, time.time())
    return ctx


def _forget(oid: int) -> None:
    for k in [k for k in _cache if k[0] == oid]:
        _cache.pop(k, None)


def admin_only(ctx: Ctx, what: str) -> None:
    if not ctx.is_admin:
        raise HTTPException(403, f"Only the main operator can {what}")


def _run(fn):
    """Run fn(db) in one transaction; turn ValueError into a 400. If the serverless database drops
    the connection, the transaction rolled back as a whole, so it is safe to retry once."""
    for attempt in (1, 2):
        try:
            with SessionLocal.begin() as db:
                return fn(db)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        except OperationalError:
            if attempt == 2:
                raise HTTPException(503, "Database connection dropped, please retry")


def _activate_invites(db, user: dict) -> None:
    """First sign-in of an invited email turns its invites into active memberships."""
    email = _email(user)
    if not email or user.get("demo"):
        return
    for m in db.scalars(select(inv.Membership).where(func.lower(inv.Membership.email) == email,
                                                     inv.Membership.user_id.is_(None))):
        m.user_id, m.status, m.joined_at = user["id"], "active", inv.now()
        m.name = m.name or user.get("name")


# ----------------------------------------------------------------------------- session / orgs
@router.get("/status")
def status():
    from .auth import AUTH_URL
    with SessionLocal() as db:
        n = db.scalar(select(func.count(inv.Organization.id)))
    return {"db": DB_KIND, "host": DB_HOST, "organizations": n, "auth": bool(AUTH_URL), "auth_url": AUTH_URL or None}


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return user


@router.get("/orgs")
def orgs(user: dict = Depends(current_user)):
    with SessionLocal.begin() as db:
        _activate_invites(db, user)
    with SessionLocal() as db:
        out = []
        mine: dict[int, inv.Membership] = {}
        if not user.get("demo"):
            for m in db.scalars(select(inv.Membership).where(inv.Membership.user_id == user["id"])):
                mine[m.org_id] = m
        q = select(inv.Organization).order_by(inv.Organization.id)
        locs = {l.id: l for l in db.scalars(select(inv.Location).where(
            inv.Location.id.in_([m.location_id for m in mine.values() if m.location_id])))} if mine else {}
        for o in db.scalars(q):
            if o.owner_id is None:
                role, loc = "admin", None
            elif not user.get("demo") and o.owner_id == user["id"]:
                role, loc = "admin", None
            elif o.id in mine:
                role, loc = mine[o.id].role, mine[o.id].location_id
            else:
                continue
            d = inv.org_dict(o)
            d.update(my_role=role, my_location_id=loc, my_location=locs[loc].name if loc in locs else None,
                     owner=o.owner_id is not None and o.owner_id == user["id"])
            out.append(d)
        return out


@router.get("/templates")
def templates():
    from .data import CITIES
    return {"sectors": {k: {"label": v["label"], "central": v["central"], "tagline": v["tagline"],
                            "kinds": [{"key": a, "label": b} for a, b, _ in v["kinds"]],
                            "products": len(v["products"])} for k, v in inv.TEMPLATES.items()},
            "cities": [{"key": k, "name": v["name"], "areas": [a[0] for a in v["localities"]]} for k, v in CITIES.items()]}


class OrgReq(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    sector: str = "healthcare"
    city: str = "bengaluru"
    branches: int = Field(10, ge=3, le=18)


@router.post("/orgs")
def create_org(req: OrgReq, user: dict = Depends(current_user)):
    from .data import CITIES
    if req.sector not in inv.TEMPLATES or req.city not in CITIES:
        raise HTTPException(400, "Unknown sector or city")
    out = _run(lambda db: inv.org_dict(inv.create_org(db, req.name, req.sector, req.city, req.branches,
                                                      seed=sum(map(ord, req.name)) % 1000, owner=user)))
    out.update(my_role="admin", my_location_id=None, my_location=None, owner=not user.get("demo"))
    return out


@router.get("/orgs/{oid}/access")
def my_access(ctx: Ctx = Depends(access)):
    return {"role": ctx.role, "location_id": ctx.location_id, "shared": ctx.shared}


# ----------------------------------------------------------------------------- team
@router.get("/orgs/{oid}/members")
def members(oid: int, ctx: Ctx = Depends(access)):
    admin_only(ctx, "manage the team")
    with SessionLocal() as db:
        org = db.get(inv.Organization, oid)
        locs, _ = inv._maps(db, oid)
        rows = db.scalars(select(inv.Membership).where(inv.Membership.org_id == oid).order_by(inv.Membership.id)).all()
        out = []
        if org.owner_id:
            out.append({"id": None, "email": org.owner_email, "name": None, "role": "owner", "status": "active",
                        "location_id": None, "location": None, "joined_at": inv._iso(org.created_at)})
        for m in rows:
            out.append({"id": m.id, "email": m.email, "name": m.name, "role": m.role, "status": m.status,
                        "location_id": m.location_id, "location": locs[m.location_id].name if m.location_id in locs else None,
                        "invited_by": m.invited_by, "created_at": inv._iso(m.created_at), "joined_at": inv._iso(m.joined_at)})
        return {"shared": org.owner_id is None, "members": out}


class InviteReq(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    role: str = "branch"
    location_id: int | None = None


@router.post("/orgs/{oid}/members")
def invite(oid: int, req: InviteReq, ctx: Ctx = Depends(access)):
    admin_only(ctx, "invite teammates")
    if ctx.shared:
        raise HTTPException(400, "Demo organisations are shared. Create your own organisation to invite a team.")
    email = req.email.strip().lower()
    if "@" not in email or req.role not in ("admin", "branch"):
        raise HTTPException(400, "Enter an email address and a role")

    def go(db):
        locs, _ = inv._maps(db, oid)
        if req.role == "branch" and (req.location_id not in locs or locs[req.location_id].is_central):
            raise ValueError("Pick the branch this operator runs")
        org = db.get(inv.Organization, oid)
        if org.owner_email and org.owner_email.lower() == email:
            raise ValueError("That is the owner's own account")
        m = db.scalars(select(inv.Membership).where(inv.Membership.org_id == oid, inv.Membership.email == email)).first()
        if m is None:
            m = inv.Membership(org_id=oid, email=email, status="invited", invited_by=_email(ctx.user) or None)
            db.add(m)
        m.role, m.location_id = req.role, (req.location_id if req.role == "branch" else None)
        db.flush()
        return {"id": m.id, "email": m.email, "role": m.role, "status": m.status}
    out = _run(go)
    _forget(oid)
    return out


@router.post("/orgs/{oid}/members/{mid}/remove")
def remove_member(oid: int, mid: int, ctx: Ctx = Depends(access)):
    admin_only(ctx, "manage the team")

    def go(db):
        m = db.get(inv.Membership, mid)
        if not m or m.org_id != oid:
            raise ValueError("Member not found")
        db.delete(m)
        return {"ok": True}
    out = _run(go)
    _forget(oid)
    return out


# ----------------------------------------------------------------------------- automation
@router.get("/orgs/{oid}/automation")
def automation_status(oid: int, ctx: Ctx = Depends(access)):
    admin_only(ctx, "see the autopilot")
    return automation.status(oid)


class RulesReq(BaseModel):
    enabled: bool | None = None
    auto_approve: bool | None = None
    on_critical: bool | None = None
    load_pct: int | None = Field(None, ge=10, le=100)
    times: list[str] | None = None


@router.post("/orgs/{oid}/automation")
def automation_save(oid: int, req: RulesReq, ctx: Ctx = Depends(access)):
    admin_only(ctx, "change the autopilot")
    return automation.save_rules(oid, req.model_dump(exclude_none=True))


@router.post("/orgs/{oid}/automation/run")
def automation_run(oid: int, ctx: Ctx = Depends(access)):
    admin_only(ctx, "run the autopilot")
    automation.kick(oid, "manual")
    return {"ok": True}


# ----------------------------------------------------------------------------- reads
@router.get("/orgs/{oid}/overview")
def overview(oid: int, ctx: Ctx = Depends(access)):
    admin_only(ctx, "see the whole network")
    with SessionLocal() as db:
        return inv.overview(db, oid)


@router.get("/orgs/{oid}/stock")
def stock(oid: int, ctx: Ctx = Depends(access)):
    with SessionLocal() as db:
        m = inv.stock_matrix(db, oid)
    if not ctx.is_admin:
        m["locations"] = [l for l in m["locations"] if l["id"] == ctx.location_id]
        m["cells"] = [c for c in m["cells"] if c["location_id"] == ctx.location_id]
    return m


@router.get("/orgs/{oid}/requisitions")
def requisitions(oid: int, status: str | None = None, location_id: int | None = None, ctx: Ctx = Depends(access)):
    if not ctx.is_admin:
        location_id = ctx.location_id
    with SessionLocal() as db:
        locs, prods = inv._maps(db, oid)
        q = select(inv.Requisition).options(selectinload(inv.Requisition.lines)).where(inv.Requisition.org_id == oid)
        if status:
            q = q.where(inv.Requisition.status.in_(status.split(",")))
        if location_id:
            q = q.where(inv.Requisition.location_id == location_id)
        rows = db.scalars(q.order_by(inv.Requisition.id.desc()).limit(300)).all()
        return [inv.req_dict(r, locs, prods) for r in rows]


def _branch_ships(db, ctx: Ctx) -> set[int]:
    return set(db.scalars(select(inv.Requisition.shipment_id).where(
        inv.Requisition.org_id == ctx.oid, inv.Requisition.location_id == ctx.location_id,
        inv.Requisition.shipment_id.is_not(None))).all())


@router.get("/orgs/{oid}/shipments")
def shipments(oid: int, ctx: Ctx = Depends(access)):
    with SessionLocal() as db:
        q = select(inv.Shipment).where(inv.Shipment.org_id == oid)
        if not ctx.is_admin:
            q = q.where(inv.Shipment.id.in_(_branch_ships(db, ctx) or {-1}))
        rows = db.scalars(q.order_by(inv.Shipment.id.desc()).limit(100)).all()
        return [inv.ship_dict(s) for s in rows]


@router.get("/orgs/{oid}/shipments/{sid}")
def shipment(oid: int, sid: int, ctx: Ctx = Depends(access)):
    with SessionLocal() as db:
        s = db.get(inv.Shipment, sid)
        if not s or s.org_id != oid or (not ctx.is_admin and sid not in _branch_ships(db, ctx)):
            raise HTTPException(404, "Shipment not found")
        return inv.ship_dict(s, full=True)


@router.get("/orgs/{oid}/movements")
def movements(oid: int, limit: int = 100, ctx: Ctx = Depends(access)):
    with SessionLocal() as db:
        locs, prods = inv._maps(db, oid)
        q = select(inv.StockMovement).where(inv.StockMovement.org_id == oid)
        if not ctx.is_admin:
            q = q.where(inv.StockMovement.location_id == ctx.location_id)
        rows = db.scalars(q.order_by(inv.StockMovement.id.desc()).limit(min(limit, 500))).all()
        return [{"id": m.id, "kind": m.kind, "delta": m.delta, "ref": m.ref,
                 "location": locs[m.location_id].name if m.location_id in locs else "?",
                 "product": prods[m.product_id].name if m.product_id in prods else "?",
                 "sku": prods[m.product_id].sku if m.product_id in prods else "",
                 "at": inv._iso(m.created_at)} for m in rows]


# ----------------------------------------------------------------------------- writes
class BranchReq(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    kind: str
    area: str = ""
    lng: float | None = None
    lat: float | None = None
    contact: str = ""


@router.post("/orgs/{oid}/locations")
def register_branch(oid: int, req: BranchReq, ctx: Ctx = Depends(access)):
    admin_only(ctx, "register branches")
    return _run(lambda db: inv.loc_dict(inv.register_branch(db, oid, req.name, req.kind, req.area, req.lng, req.lat, req.contact)))


class ReceiveReq(BaseModel):
    product_id: int
    qty: int = Field(gt=0, le=1_000_000)
    ref: str = ""


@router.post("/orgs/{oid}/receive")
def receive(oid: int, req: ReceiveReq, ctx: Ctx = Depends(access)):
    admin_only(ctx, "receive stock at the central store")
    out = _run(lambda db: inv.receive(db, oid, req.product_id, req.qty, req.ref) or {"ok": True})
    automation.kick(oid, "receipt")
    return out


class AdjustReq(BaseModel):
    location_id: int
    product_id: int
    qty: int | None = Field(None, ge=0)
    daily_usage: float | None = Field(None, ge=0)
    reorder_days: float | None = Field(None, ge=0)
    target_days: float | None = Field(None, ge=0)


@router.post("/orgs/{oid}/adjust")
def adjust(oid: int, req: AdjustReq, ctx: Ctx = Depends(access)):
    if not ctx.is_admin:
        if req.location_id != ctx.location_id:
            raise HTTPException(403, "Branch operators can only count their own shelf")
        req.daily_usage = req.reorder_days = req.target_days = None  # rules stay with the main operator
    return _run(lambda db: inv.adjust(db, oid, req.location_id, req.product_id, req.qty, req.daily_usage,
                                      req.reorder_days, req.target_days) or {"ok": True})


class NewReq(BaseModel):
    location_id: int
    lines: list[dict[str, Any]]
    priority: str | None = None
    note: str = ""


@router.post("/orgs/{oid}/requisitions")
def new_requisition(oid: int, req: NewReq, ctx: Ctx = Depends(access)):
    if not ctx.is_admin and req.location_id != ctx.location_id:
        raise HTTPException(403, "Branch operators can only request stock for their own branch")

    def go(db):
        r = inv.create_requisition(db, oid, req.location_id, req.lines, req.priority, req.note)
        locs, prods = inv._maps(db, oid)
        return inv.req_dict(r, locs, prods)
    out = _run(go)
    automation.kick(oid, "request")
    return out


class IdsReq(BaseModel):
    ids: list[int] | None = None
    solver: str = "quantum"
    reason: str = ""


@router.post("/orgs/{oid}/approve")
def approve(oid: int, req: IdsReq, ctx: Ctx = Depends(access)):
    admin_only(ctx, "approve requests")
    out = _run(lambda db: inv.approve(db, oid, req.ids))
    automation.kick(oid, "approve")
    return out


@router.post("/orgs/{oid}/requisitions/{rid}/reject")
def reject(oid: int, rid: int, req: IdsReq, ctx: Ctx = Depends(access)):
    admin_only(ctx, "reject requests")
    return _run(lambda db: inv.reject(db, oid, rid, req.reason) or {"ok": True})


@router.post("/orgs/{oid}/auto-indent")
def auto_indent(oid: int, ctx: Ctx = Depends(access)):
    admin_only(ctx, "run auto-indent")
    out = _run(lambda db: {"created": len(inv.auto_indent(db, oid))})
    automation.kick(oid, "indent")
    return out


@router.post("/orgs/{oid}/simulate-day")
def simulate_day(oid: int, ctx: Ctx = Depends(access)):
    admin_only(ctx, "simulate a day")
    out = _run(lambda db: inv.simulate_day(db, oid))
    automation.kick(oid, "day")
    return out


@router.post("/orgs/{oid}/dispatch")
def dispatch(oid: int, req: IdsReq, ctx: Ctx = Depends(access)):
    admin_only(ctx, "dispatch deliveries")
    from . import optimizer
    if req.solver not in optimizer.SOLVERS:
        raise HTTPException(400, f"Unknown solver {req.solver}")
    try:
        return inv.dispatch(oid, req.ids, req.solver)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/orgs/{oid}/shipments/{sid}/deliver")
def deliver(oid: int, sid: int, req: IdsReq, ctx: Ctx = Depends(access)):
    ids = req.ids
    if not ctx.is_admin:
        with SessionLocal() as db:
            own = set(db.scalars(select(inv.Requisition.id).where(
                inv.Requisition.shipment_id == sid, inv.Requisition.location_id == ctx.location_id)).all())
        ids = [i for i in (ids or own) if i in own]
        if not ids:
            raise HTTPException(403, "Nothing in this delivery is addressed to your branch")
    return _run(lambda db: inv.deliver(db, oid, sid, ids))
