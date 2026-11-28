"""QFleet Supply Network: hub-and-spoke inventory with quantum-planned replenishment.

An organisation runs one central store and many registered sub-inventories (hospitals,
clinics, stores...). Sub-inventories consume stock; when days-of-cover falls below the
reorder point an indent (requisition) is raised automatically. The central store approves
it (critical items first when stock is short), QFleet plans the delivery wave, and the
receiving branch confirms the delivery, which moves the stock. Every change is a row in
the stock ledger.
"""
from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func, select
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship, selectinload

from .data import CITIES, PRIORITIES, ROUTE_PALETTE, VEHICLE_TYPES, jitter
from .db import Base, SessionLocal, engine


def now() -> datetime:
    return datetime.now(timezone.utc)


# ----------------------------------------------------------------------------- models
class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    sector: Mapped[str] = mapped_column(String(32))  # healthcare | retail
    city: Mapped[str] = mapped_column(String(32))
    tagline: Mapped[str] = mapped_column(String(200), default="")
    owner_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)  # None = shared demo org
    owner_email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    rules: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # automatic dispatch rules
    last_auto_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Membership(Base):
    """Who may operate an organisation: the main operator (admin) or a branch operator tied to one site."""
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("org_id", "email"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    email: Mapped[str] = mapped_column(String(200), index=True)  # lower-case; invites match on sign-in
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    role: Mapped[str] = mapped_column(String(16))  # admin | branch
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="invited")  # invited | active
    invited_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Location(Base):
    __tablename__ = "locations"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    code: Mapped[str] = mapped_column(String(24))
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(32))  # central | hospital | phc | clinic | pharmacy | store | darkstore
    area: Mapped[str] = mapped_column(String(80), default="")
    lng: Mapped[float] = mapped_column(Float)
    lat: Mapped[float] = mapped_column(Float)
    contact: Mapped[str] = mapped_column(String(120), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    @property
    def is_central(self) -> bool:
        return self.kind == "central"


class Product(Base):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    sku: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(48))
    unit: Mapped[str] = mapped_column(String(48))
    unit_weight_kg: Mapped[float] = mapped_column(Float)
    unit_cost_inr: Mapped[float] = mapped_column(Float)
    critical: Mapped[bool] = mapped_column(Boolean, default=False)  # life-critical / perishable


class StockLevel(Base):
    __tablename__ = "stock_levels"
    __table_args__ = (UniqueConstraint("location_id", "product_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    qty: Mapped[int] = mapped_column(Integer, default=0)
    daily_usage: Mapped[float] = mapped_column(Float, default=0.0)
    reorder_days: Mapped[float] = mapped_column(Float, default=3.0)  # reorder point, in days of cover
    target_days: Mapped[float] = mapped_column(Float, default=7.0)  # order up to this cover


class Vehicle(Base):
    __tablename__ = "fleet_vehicles"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    code: Mapped[str] = mapped_column(String(16))
    type: Mapped[str] = mapped_column(String(24))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Shipment(Base):
    __tablename__ = "shipments"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    code: Mapped[str] = mapped_column(String(24), default="")
    status: Mapped[str] = mapped_column(String(16), default="in_transit")  # in_transit | completed
    solver: Mapped[str] = mapped_column(String(16))
    trigger: Mapped[str] = mapped_column(String(16), default="manual")  # manual | load | critical | schedule
    cost_inr: Mapped[float] = mapped_column(Float, default=0)
    legacy_cost_inr: Mapped[float] = mapped_column(Float, default=0)
    distance_km: Mapped[float] = mapped_column(Float, default=0)
    co2_kg: Mapped[float] = mapped_column(Float, default=0)
    legacy_co2_kg: Mapped[float] = mapped_column(Float, default=0)
    on_time_pct: Mapped[float] = mapped_column(Float, default=0)
    vehicles_used: Mapped[int] = mapped_column(Integer, default=0)
    solve_ms: Mapped[float] = mapped_column(Float, default=0)
    qubits: Mapped[int] = mapped_column(Integer, default=0)
    n_stops: Mapped[int] = mapped_column(Integer, default=0)
    # full plans are large (road geometry); load them only when a wave is opened on the map
    scenario: Mapped[dict] = mapped_column(JSON, deferred=True)
    plan: Mapped[dict] = mapped_column(JSON, deferred=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Requisition(Base):
    __tablename__ = "requisitions"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    code: Mapped[str] = mapped_column(String(24), default="")
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"), index=True)
    priority: Mapped[str] = mapped_column(String(16), default="standard")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    # pending -> approved -> dispatched -> delivered ; or rejected / cancelled
    source: Mapped[str] = mapped_column(String(16), default="manual")  # manual | auto
    note: Mapped[str] = mapped_column(Text, default="")
    shipment_id: Mapped[int | None] = mapped_column(ForeignKey("shipments.id"), nullable=True)
    eta_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    late_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lines: Mapped[list["RequisitionLine"]] = relationship(back_populates="req", cascade="all, delete-orphan")


class RequisitionLine(Base):
    __tablename__ = "requisition_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    requisition_id: Mapped[int] = mapped_column(ForeignKey("requisitions.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    qty_requested: Mapped[int] = mapped_column(Integer)
    qty_approved: Mapped[int] = mapped_column(Integer, default=0)
    req: Mapped[Requisition] = relationship(back_populates="lines")


class StockMovement(Base):
    __tablename__ = "stock_movements"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    delta: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(16))  # receipt | allocate | deliver | consume | adjust | return
    ref: Mapped[str] = mapped_column(String(40), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


# ----------------------------------------------------------------------------- templates
# product: (sku, name, category, unit, kg per unit, ₹ per unit, critical, base daily usage per branch)
TEMPLATES: dict[str, dict[str, Any]] = {
    "healthcare": {
        "label": "Health network",
        "central": "Central Medical Store",
        "tagline": "Medicines and critical supplies for every facility, on time",
        "kinds": [("hospital", "Hospital", 2.2), ("phc", "Primary Health Centre", 1.0),
                  ("clinic", "Clinic", 0.6), ("pharmacy", "Pharmacy", 0.8)],
        "skip": {"pharmacy": {"MED-OXY", "MED-BLD"}, "clinic": {"MED-BLD"}},
        "products": [
            ("MED-INS", "Insulin vials", "Cold chain", "pack of 10", 0.6, 1800, True, 2.0),
            ("MED-OXY", "Oxygen cylinder (B-type)", "Respiratory", "cylinder", 16.0, 1200, True, 1.2),
            ("MED-IVF", "IV fluids 500 ml", "Fluids", "case of 20", 11.0, 1100, True, 1.5),
            ("MED-BLD", "Blood bag kit", "Transfusion", "kit", 1.2, 650, True, 1.5),
            ("MED-ABX", "Amoxicillin 500 mg", "Medicines", "box of 100", 0.9, 420, False, 2.0),
            ("MED-PCM", "Paracetamol 500 mg", "Medicines", "box of 100", 0.8, 180, False, 3.0),
            ("MED-ORS", "ORS sachets", "Medicines", "carton of 100", 3.5, 600, False, 1.0),
            ("MED-GLV", "Nitrile gloves", "PPE", "carton of 1,000", 6.0, 2400, False, 0.6),
            ("MED-N95", "N95 masks", "PPE", "carton of 200", 3.0, 3000, False, 0.5),
            ("MED-SYR", "Syringes 5 ml", "Consumables", "box of 500", 4.0, 1500, False, 0.6),
            ("MED-BND", "Bandage rolls", "Consumables", "carton of 50", 4.5, 900, False, 0.6),
            ("MED-SAN", "Hand sanitiser", "Hygiene", "5 L can", 5.5, 1100, False, 0.8),
        ],
    },
    "retail": {
        "label": "Retail chain",
        "usage_scale": 0.42,
        "central": "Distribution Centre",
        "tagline": "Fresh shelves in every neighbourhood store, every morning",
        "kinds": [("store", "Supermarket", 1.8), ("darkstore", "Dark Store", 1.2), ("kiosk", "Express Store", 0.6)],
        "skip": {},
        "products": [
            ("GRC-MLK", "Milk 1 L", "Dairy (perishable)", "crate of 12", 12.5, 660, True, 3.0),
            ("GRC-BRD", "Bread loaves", "Bakery (perishable)", "crate of 20", 8.0, 800, True, 2.0),
            ("GRC-EGG", "Eggs", "Dairy (perishable)", "tray of 30", 2.0, 210, True, 3.0),
            ("GRC-RIC", "Rice", "Staples", "25 kg bag", 25.0, 1350, False, 0.8),
            ("GRC-ATA", "Wheat atta", "Staples", "10 kg bag", 10.0, 450, False, 1.0),
            ("GRC-OIL", "Mustard oil", "Staples", "15 L tin", 14.0, 2300, False, 0.4),
            ("GRC-SUG", "Sugar", "Staples", "5 kg pack", 5.1, 230, False, 1.0),
            ("GRC-DAL", "Toor dal", "Staples", "5 kg pack", 5.1, 750, False, 0.8),
            ("GRC-TEA", "Tea", "Beverages", "carton of 10 × 1 kg", 10.5, 4200, False, 0.3),
            ("GRC-BIS", "Biscuits", "Snacks", "carton of 48", 5.0, 480, False, 1.0),
            ("GRC-WAT", "Bottled water", "Beverages", "case of 12 × 1 L", 12.5, 240, False, 1.5),
            ("GRC-DET", "Detergent", "Home care", "carton of 4 × 1 kg", 4.2, 520, False, 0.5),
        ],
    },
}

KIND_LABEL = {k: lbl for t in TEMPLATES.values() for k, lbl, _ in t["kinds"]}
KIND_LABEL["central"] = "Central store"
KIND_MULT = {k: m for t in TEMPLATES.values() for k, _, m in t["kinds"]}
PRIO_RANK = {"critical": 0, "high": 1, "standard": 2}


def _code(prefix: str, n: int) -> str:
    return f"{prefix}-{n:04d}"


# ----------------------------------------------------------------------------- serialisers
def loc_dict(l: Location) -> dict:
    return {"id": l.id, "code": l.code, "name": l.name, "kind": l.kind, "kind_label": KIND_LABEL.get(l.kind, l.kind),
            "area": l.area, "lng": l.lng, "lat": l.lat, "contact": l.contact, "active": l.active,
            "created_at": l.created_at.isoformat() if l.created_at else None}


def prod_dict(p: Product) -> dict:
    return {"id": p.id, "sku": p.sku, "name": p.name, "category": p.category, "unit": p.unit,
            "unit_weight_kg": p.unit_weight_kg, "unit_cost_inr": p.unit_cost_inr, "critical": p.critical}


def _iso(d: datetime | None) -> str | None:
    if d is None:
        return None
    if d.tzinfo is None:  # SQLite drops tzinfo
        d = d.replace(tzinfo=timezone.utc)
    return d.isoformat()


def req_dict(r: Requisition, locs: dict[int, Location], prods: dict[int, Product]) -> dict:
    lines = []
    w = 0.0
    val = 0.0
    for ln in r.lines:
        p = prods[ln.product_id]
        q = ln.qty_approved if r.status not in ("pending", "rejected") else ln.qty_requested
        w += q * p.unit_weight_kg
        val += q * p.unit_cost_inr
        lines.append({"id": ln.id, "product_id": p.id, "sku": p.sku, "name": p.name, "unit": p.unit,
                      "critical": p.critical, "qty_requested": ln.qty_requested, "qty_approved": ln.qty_approved})
    loc = locs.get(r.location_id)
    eta = None
    if r.dispatched_at is not None and r.eta_min is not None:
        eta = _iso((r.dispatched_at if r.dispatched_at.tzinfo else r.dispatched_at.replace(tzinfo=timezone.utc))
                   + timedelta(minutes=r.eta_min))
    return {"id": r.id, "code": r.code, "location_id": r.location_id, "location": loc.name if loc else "?",
            "location_kind": loc.kind if loc else "", "area": loc.area if loc else "",
            "priority": r.priority, "status": r.status, "source": r.source, "note": r.note,
            "shipment_id": r.shipment_id, "eta_min": r.eta_min, "eta": eta, "late_min": r.late_min,
            "weight_kg": round(w, 1), "value_inr": round(val), "lines": lines,
            "created_at": _iso(r.created_at), "approved_at": _iso(r.approved_at),
            "dispatched_at": _iso(r.dispatched_at), "delivered_at": _iso(r.delivered_at)}


def ship_dict(s: Shipment, full: bool = False) -> dict:
    d = {"id": s.id, "code": s.code, "status": s.status, "solver": s.solver, "trigger": s.trigger or "manual", "cost_inr": s.cost_inr,
         "legacy_cost_inr": s.legacy_cost_inr, "saved_inr": round(s.legacy_cost_inr - s.cost_inr, 2),
         "distance_km": s.distance_km, "co2_kg": s.co2_kg, "legacy_co2_kg": s.legacy_co2_kg,
         "on_time_pct": s.on_time_pct, "vehicles_used": s.vehicles_used, "solve_ms": s.solve_ms, "qubits": s.qubits,
         "stops": s.n_stops,
         "created_at": _iso(s.created_at), "completed_at": _iso(s.completed_at)}
    if full:
        d["scenario"] = s.scenario
        d["plan"] = s.plan
    return d


# ----------------------------------------------------------------------------- org creation
def create_org(db: Session, name: str, sector: str, city: str, n_branches: int = 12, seed: int = 3,
               tagline: str | None = None, owner: dict | None = None) -> Organization:
    t = TEMPLATES[sector]
    c = CITIES[city]
    rng = random.Random(seed)
    org = Organization(name=name, sector=sector, city=city, tagline=tagline or t["tagline"],
                       owner_id=None if not owner or owner.get("demo") else owner["id"],
                       owner_email=None if not owner else owner.get("email"))
    db.add(org)
    db.flush()
    central = Location(org_id=org.id, code="CEN-01", name=f"{t['central']} · {c['depot']['name'].replace('Q-Hub ', '')}",
                       kind="central", area=c["depot"]["name"].replace("Q-Hub ", ""),
                       lng=c["depot"]["lng"], lat=c["depot"]["lat"], contact="Control room")
    db.add(central)
    prods = []
    for sku, pname, cat, unit, kg, inr, crit, _ in t["products"]:
        p = Product(org_id=org.id, sku=sku, name=pname, category=cat, unit=unit, unit_weight_kg=kg,
                    unit_cost_inr=inr, critical=crit)
        db.add(p)
        prods.append(p)
    db.flush()
    # fleet: same mix as the routing demo
    cycle = ["ev_van", "diesel_truck", "cng_mini", "ev_van", "cng_mini", "diesel_truck"]
    for i in range(5):
        db.add(Vehicle(org_id=org.id, code=f"QX-{i + 1:02d}", type=cycle[i]))
    # branches spread over distinct localities
    locs = list(c["localities"])
    rng.shuffle(locs)
    kinds = t["kinds"]
    branches = []
    for i in range(min(n_branches, len(locs))):
        area, lng, lat = locs[i]
        kind, klabel, _ = kinds[0] if i < 3 else kinds[rng.randrange(len(kinds))]
        jl, jt = jitter(lng, lat, rng, 0.35)
        b = Location(org_id=org.id, code=f"BR-{i + 1:02d}", name=f"{klabel} · {area}", kind=kind, area=area,
                     lng=jl, lat=jt, contact=f"{klabel} store-keeper")
        db.add(b)
        branches.append(b)
    db.flush()
    _init_stock(db, org, central, branches, prods, rng)
    db.flush()
    auto_indent(db, org.id)
    return org


def _usage_for(sector: str, kind: str, sku: str, base: float, rng: random.Random) -> float:
    if sku in TEMPLATES[sector]["skip"].get(kind, set()):
        return 0.0
    scale = TEMPLATES[sector].get("usage_scale", 1.0)
    return round(base * scale * KIND_MULT.get(kind, 1.0) * rng.uniform(0.75, 1.3), 2)


def _init_stock(db: Session, org: Organization, central: Location, branches: list[Location],
                prods: list[Product], rng: random.Random) -> None:
    t = TEMPLATES[org.sector]
    base = {row[0]: row[7] for row in t["products"]}
    network_use = {p.id: 0.0 for p in prods}
    for b in branches:
        for p in prods:
            u = _usage_for(org.sector, b.kind, p.sku, base[p.sku], rng)
            network_use[p.id] += u
            if u <= 0:
                continue
            cover = rng.choice([0.4, 0.9, 1.6, 2.4, 3.5, 4.5, 5.5, 6.5])  # a realistic mix: some branches running low
            db.add(StockLevel(location_id=b.id, product_id=p.id, qty=max(0, round(u * cover)), daily_usage=u))
    for i, p in enumerate(prods):
        # central holds ~3 weeks of network demand; one critical item is deliberately short
        days = 1.5 if (p.critical and i == 0) else rng.uniform(14, 24)
        db.add(StockLevel(location_id=central.id, product_id=p.id, qty=round(network_use[p.id] * days),
                          daily_usage=0.0, reorder_days=0, target_days=0))


def migrate() -> None:
    """Create new tables and add columns that newer versions introduced, without touching data."""
    from sqlalchemy import inspect, text

    Base.metadata.create_all(engine)
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                ddl = col.type.compile(dialect=engine.dialect)
                conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN {col.name} {ddl}'))


def seed_if_empty() -> None:
    migrate()
    with SessionLocal.begin() as db:
        if db.scalar(select(func.count(Organization.id))):
            return
        create_org(db, "CityCare Health Network", "healthcare", "bengaluru", n_branches=12, seed=5)
        create_org(db, "FreshMart Neighbourhood Stores", "retail", "kolkata", n_branches=10, seed=9)


# ----------------------------------------------------------------------------- queries
def _maps(db: Session, org_id: int) -> tuple[dict[int, Location], dict[int, Product]]:
    locs = {l.id: l for l in db.scalars(select(Location).where(Location.org_id == org_id))}
    prods = {p.id: p for p in db.scalars(select(Product).where(Product.org_id == org_id))}
    return locs, prods


def central_of(db: Session, org_id: int) -> Location:
    return db.scalars(select(Location).where(Location.org_id == org_id, Location.kind == "central")).one()


def _stock_cache(db: Session, loc_ids: list[int]) -> dict[tuple[int, int], StockLevel]:
    rows = db.scalars(select(StockLevel).where(StockLevel.location_id.in_(loc_ids))) if loc_ids else []
    return {(s.location_id, s.product_id): s for s in rows}


def _stock(db: Session, loc_id: int, prod_id: int, cache: dict | None = None) -> StockLevel:
    if cache is not None and (loc_id, prod_id) in cache:
        return cache[(loc_id, prod_id)]
    s = db.scalars(select(StockLevel).where(StockLevel.location_id == loc_id, StockLevel.product_id == prod_id)).first()
    if s is None:
        s = StockLevel(location_id=loc_id, product_id=prod_id, qty=0, daily_usage=0.0)
        db.add(s)
        db.flush()
        if cache is not None:
            cache[(loc_id, prod_id)] = s
    return s


def _move(db: Session, org_id: int, loc_id: int, prod_id: int, delta: int, kind: str, ref: str = "") -> None:
    if delta:
        db.add(StockMovement(org_id=org_id, location_id=loc_id, product_id=prod_id, delta=delta, kind=kind, ref=ref))


def _open_qty(db: Session, org_id: int) -> dict[tuple[int, int], int]:
    """Quantity already on order (pending / approved / dispatched) per (location, product)."""
    out: dict[tuple[int, int], int] = {}
    rows = db.execute(
        select(Requisition.location_id, RequisitionLine.product_id, Requisition.status,
               RequisitionLine.qty_requested, RequisitionLine.qty_approved)
        .join(RequisitionLine, RequisitionLine.requisition_id == Requisition.id)
        .where(Requisition.org_id == org_id, Requisition.status.in_(["pending", "approved", "dispatched"])))
    for loc, prod, st, qr, qa in rows:
        out[(loc, prod)] = out.get((loc, prod), 0) + (qr if st == "pending" else qa)
    return out


def _priority_for(lines: list[tuple[Product, StockLevel]]) -> str:
    """Urgency comes from the inventory itself: how soon a branch runs out of what."""
    worst = "standard"
    for p, s in lines:
        cover = s.qty / s.daily_usage if s.daily_usage > 0 else 99
        if p.critical and cover < 1.0:
            return "critical"
        if (p.critical and cover < 2.0) or cover < 0.5:
            worst = "high"
    return worst


# ----------------------------------------------------------------------------- workflows
def auto_indent(db: Session, org_id: int) -> list[Requisition]:
    """Raise one requisition per branch for everything below its reorder point."""
    locs, prods = _maps(db, org_id)
    open_q = _open_qty(db, org_id)
    by_loc: dict[int, list[StockLevel]] = {}
    for s in _stock_cache(db, list(locs)).values():
        by_loc.setdefault(s.location_id, []).append(s)
    created = []
    for loc in locs.values():
        if loc.is_central or not loc.active:
            continue
        need: list[tuple[Product, StockLevel, int]] = []
        for s in by_loc.get(loc.id, []):
            if s.daily_usage <= 0:
                continue
            on_order = open_q.get((loc.id, s.product_id), 0)
            if s.qty + on_order < s.daily_usage * s.reorder_days:
                q = math.ceil(s.daily_usage * s.target_days - s.qty - on_order)
                if q > 0:
                    need.append((prods[s.product_id], s, q))
        if not need:
            continue
        prio = _priority_for([(p, s) for p, s, _ in need])
        r = Requisition(org_id=org_id, location_id=loc.id, priority=prio, source="auto",
                        note="Auto-indent: stock below reorder point")
        r.lines = [RequisitionLine(product_id=p.id, qty_requested=q) for p, _, q in need]
        db.add(r)
        db.flush()
        r.code = _code("REQ", r.id)
        created.append(r)
    return created


def create_requisition(db: Session, org_id: int, location_id: int, lines: list[dict], priority: str | None,
                       note: str = "") -> Requisition:
    locs, prods = _maps(db, org_id)
    loc = locs.get(location_id)
    if loc is None or loc.is_central:
        raise ValueError("Requests are raised by a registered sub-inventory")
    clean = [(prods[int(l["product_id"])], int(l["qty"])) for l in lines
             if int(l.get("qty", 0)) > 0 and int(l["product_id"]) in prods]
    if not clean:
        raise ValueError("Add at least one product with a quantity")
    if priority not in PRIO_RANK:
        cache = _stock_cache(db, [location_id])
        stock = [(p, _stock(db, location_id, p.id, cache)) for p, _ in clean]
        priority = _priority_for(stock)
    r = Requisition(org_id=org_id, location_id=location_id, priority=priority, source="manual", note=note)
    r.lines = [RequisitionLine(product_id=p.id, qty_requested=q) for p, q in clean]
    db.add(r)
    db.flush()
    r.code = _code("REQ", r.id)
    return r


def approve(db: Session, org_id: int, req_ids: list[int] | None = None, backorder: bool = False) -> dict:
    """Allocate central stock to pending requisitions, most urgent first (partial fills if short)."""
    q = select(Requisition).options(selectinload(Requisition.lines)).where(Requisition.org_id == org_id, Requisition.status == "pending")
    if req_ids:
        q = q.where(Requisition.id.in_(req_ids))
    reqs = sorted(db.scalars(q), key=lambda r: (PRIO_RANK.get(r.priority, 3), r.created_at))
    central = central_of(db, org_id)
    cache = _stock_cache(db, [central.id])
    approved, short = 0, []
    for r in reqs:
        if backorder and all(_stock(db, central.id, ln.product_id, cache).qty <= 0 for ln in r.lines):
            continue  # autopilot: nothing to send yet, keep it pending until the central shelf is refilled
        any_qty = False
        for ln in r.lines:
            s = _stock(db, central.id, ln.product_id, cache)
            give = max(0, min(ln.qty_requested, s.qty))
            ln.qty_approved = give
            if give < ln.qty_requested:
                short.append({"req": r.code, "product_id": ln.product_id, "short": ln.qty_requested - give})
            if give:
                s.qty -= give
                _move(db, org_id, central.id, ln.product_id, -give, "allocate", r.code)
                any_qty = True
        r.status = "approved" if any_qty else "rejected"
        if not any_qty:
            r.note = (r.note + " · " if r.note else "") + "Rejected: central store out of stock"
        r.approved_at = now()
        approved += any_qty
    return {"approved": approved, "shortages": short}


def reject(db: Session, org_id: int, rid: int, reason: str = "") -> None:
    r = db.get(Requisition, rid)
    if not r or r.org_id != org_id:
        raise ValueError("Requisition not found")
    if r.status == "approved":  # return allocated stock to the central shelf
        central = central_of(db, org_id)
        for ln in r.lines:
            if ln.qty_approved:
                _stock(db, central.id, ln.product_id).qty += ln.qty_approved
                _move(db, org_id, central.id, ln.product_id, ln.qty_approved, "return", r.code)
    elif r.status != "pending":
        raise ValueError(f"A {r.status} requisition can't be rejected")
    r.status = "rejected"
    r.note = (r.note + " · " if r.note else "") + (reason or "Rejected by central store")


def build_dispatch_scenario(db: Session, org: Organization, reqs: list[Requisition]) -> dict:
    locs, prods = _maps(db, org.id)
    central = central_of(db, org.id)
    c = CITIES[org.city]
    vehicles = []
    for i, v in enumerate(db.scalars(select(Vehicle).where(Vehicle.org_id == org.id, Vehicle.active)).all()):
        vt = VEHICLE_TYPES[v.type]
        vehicles.append({"id": v.code, "type": v.type, "label": vt["label"], "capacity": vt["capacity"],
                         "cost_per_km": vt["cost_per_km"], "co2_per_km": vt["co2_per_km"],
                         "color": ROUTE_PALETTE[i % len(ROUTE_PALETTE)], "status": "active",
                         "start": {"lng": central.lng, "lat": central.lat}, "start_time": 0})
    chunk = 0.85 * min(v["capacity"] for v in vehicles)
    orders = []
    for r in reqs:
        loc = locs[r.location_id]
        w = sum(ln.qty_approved * prods[ln.product_id].unit_weight_kg for ln in r.lines)
        parts = max(1, math.ceil(w / chunk))
        for k in range(parts):
            dem = max(5, math.ceil(w / parts))
            orders.append({
                "id": r.code if parts == 1 else f"{r.code}/{k + 1}",
                "customer": loc.name, "area": loc.area, "lng": loc.lng, "lat": loc.lat,
                "demand": dem, "priority": r.priority, "deadline": PRIORITIES[r.priority][0],
                "service": int(min(15, 4 + dem / 60)), "status": "pending",
            })
    return {"city": org.city, "city_name": c["name"], "center": c["center"], "zoom": c["zoom"],
            "depot": {"name": central.name, "lng": central.lng, "lat": central.lat}, "shift_start": 9 * 60,
            "vehicles": vehicles, "orders": orders, "traffic_zones": [], "seed": 0,
            "source": {"kind": "inventory", "org_id": org.id, "org": org.name}}


_dispatch_locks: dict[int, "threading.Lock"] = {}


def dispatch(org_id: int, req_ids: list[int] | None, solver: str = "quantum", trigger: str = "manual") -> dict:
    """Plan and record a delivery wave. One wave at a time per organisation (manual or autopilot).
    The optimiser runs with no database transaction open: a serverless Postgres connection left
    idle for seconds mid-transaction can be dropped."""
    import threading

    lock = _dispatch_locks.setdefault(org_id, threading.Lock())
    with lock:
        return _dispatch(org_id, req_ids, solver, trigger)


def _dispatch(org_id: int, req_ids: list[int] | None, solver: str, trigger: str) -> dict:
    from . import optimizer

    # 1 · short read: what to ship
    with SessionLocal() as db:
        org = db.get(Organization, org_id)
        q = select(Requisition).options(selectinload(Requisition.lines)).where(
            Requisition.org_id == org_id, Requisition.status == "approved")
        if req_ids:
            q = q.where(Requisition.id.in_(req_ids))
        reqs = list(db.scalars(q))
        if not reqs:
            raise ValueError("No approved requisitions to dispatch")
        scenario = build_dispatch_scenario(db, org, reqs)
        ids = [r.id for r in reqs]

    # 2 · plan (quantum or another solver) and the legacy baseline on the same world
    plan = optimizer.solve(scenario, solver)
    legacy = optimizer.solve(scenario, "greedy", with_trips=False)

    # 3 · short write: record the wave and move the requests that were planned
    with SessionLocal.begin() as db:
        return _record_dispatch(db, org_id, ids, scenario, plan, legacy, solver, trigger)


def _record_dispatch(db: Session, org_id: int, ids: list[int], scenario: dict, plan: dict, legacy: dict,
                     solver: str, trigger: str = "manual") -> dict:
    m, lm = plan["metrics"], legacy["metrics"]
    ship = Shipment(org_id=org_id, solver=solver, trigger=trigger, cost_inr=m["cost_inr"], legacy_cost_inr=lm["cost_inr"],
                    distance_km=m["distance_km"], co2_kg=m["co2_kg"], legacy_co2_kg=lm["co2_kg"],
                    on_time_pct=m["on_time_pct"], vehicles_used=m["vehicles_used"], solve_ms=plan.get("solve_ms", 0),
                    qubits=(plan.get("quantum") or {}).get("total_qubits", 0), scenario=scenario, plan=plan,
                    n_stops=len(scenario["orders"]))
    db.add(ship)
    db.flush()
    ship.code = _code("SHP", ship.id)
    # the live map uses this to confirm each branch's receipt as its van arrives
    scenario = {**scenario, "source": {**scenario["source"], "shipment_id": ship.id, "shipment": ship.code}}
    ship.scenario = scenario
    unassigned = set(plan.get("unassigned", []))
    arrival: dict[str, tuple[float, float]] = {}
    for route in plan["routes"]:
        for st in route["stops"]:
            base = st["order_id"].split("/")[0]
            a, late = arrival.get(base, (0.0, 0.0))
            arrival[base] = (max(a, st["arrival"]), max(late, st["late_min"]))
    # re-read: only requests still approved (another user may have acted meanwhile)
    reqs = list(db.scalars(select(Requisition).where(Requisition.id.in_(ids), Requisition.status == "approved")))
    t = now()
    sent = 0
    for r in reqs:
        if r.code in arrival and not any(o.split("/")[0] == r.code for o in unassigned):
            r.status, r.shipment_id, r.dispatched_at = "dispatched", ship.id, t
            r.eta_min, r.late_min = arrival[r.code]
            sent += 1
    out = ship_dict(ship, full=True)
    out["dispatched"] = sent
    out["held_back"] = len(ids) - sent
    return out


def deliver(db: Session, org_id: int, shipment_id: int, req_ids: list[int] | None = None) -> dict:
    ship = db.get(Shipment, shipment_id)
    if not ship or ship.org_id != org_id:
        raise ValueError("Shipment not found")
    q = select(Requisition).options(selectinload(Requisition.lines)).where(Requisition.shipment_id == shipment_id, Requisition.status == "dispatched")
    if req_ids:
        q = q.where(Requisition.id.in_(req_ids))
    n = 0
    reqs = list(db.scalars(q))
    cache = _stock_cache(db, list({r.location_id for r in reqs}))
    for r in reqs:
        for ln in r.lines:
            if ln.qty_approved:
                _stock(db, r.location_id, ln.product_id, cache).qty += ln.qty_approved
                _move(db, org_id, r.location_id, ln.product_id, ln.qty_approved, "deliver", r.code)
        r.status, r.delivered_at = "delivered", now()
        n += 1
    db.flush()
    left = db.scalar(select(func.count(Requisition.id)).where(Requisition.shipment_id == shipment_id,
                                                              Requisition.status == "dispatched"))
    if not left:
        ship.status, ship.completed_at = "completed", now()
    return {"delivered": n, "shipment_status": ship.status}


def receive(db: Session, org_id: int, product_id: int, qty: int, ref: str = "") -> None:
    central = central_of(db, org_id)
    s = _stock(db, central.id, product_id)
    s.qty += qty
    _move(db, org_id, central.id, product_id, qty, "receipt", ref or "Purchase receipt")


def adjust(db: Session, org_id: int, location_id: int, product_id: int, qty: int | None = None,
           daily_usage: float | None = None, reorder_days: float | None = None, target_days: float | None = None) -> None:
    s = _stock(db, location_id, product_id)
    if qty is not None and qty != s.qty:
        _move(db, org_id, location_id, product_id, qty - s.qty, "adjust", "Stock count")
        s.qty = qty
    if daily_usage is not None:
        s.daily_usage = daily_usage
    if reorder_days is not None:
        s.reorder_days = reorder_days
    if target_days is not None:
        s.target_days = max(target_days, s.reorder_days + 1)


def simulate_day(db: Session, org_id: int, seed: int | None = None) -> dict:
    """Branches consume a day of stock (random around their usage rate), then auto-indent runs."""
    rng = random.Random(seed)
    locs, _ = _maps(db, org_id)
    used = 0
    stockouts = 0
    by_loc: dict[int, list[StockLevel]] = {}
    for s in _stock_cache(db, list(locs)).values():
        by_loc.setdefault(s.location_id, []).append(s)
    for loc in locs.values():
        if loc.is_central or not loc.active:
            continue
        for s in by_loc.get(loc.id, []):
            if s.daily_usage <= 0:
                continue
            want = max(0, round(rng.gauss(s.daily_usage, s.daily_usage * 0.3)))
            take = min(want, s.qty)
            if want > s.qty:
                stockouts += 1
            if take:
                s.qty -= take
                _move(db, org_id, loc.id, s.product_id, -take, "consume", "Daily usage")
                used += take
    db.flush()
    new = auto_indent(db, org_id)
    return {"units_used": used, "stockouts": stockouts, "new_requisitions": len(new)}


def register_branch(db: Session, org_id: int, name: str, kind: str, area: str, lng: float | None, lat: float | None,
                    contact: str = "", seed_usage: bool = True) -> Location:
    org = db.get(Organization, org_id)
    c = CITIES[org.city]
    if lng is None or lat is None:
        match = next((x for x in c["localities"] if x[0].lower() == area.lower()), None)
        if match is None:
            raise ValueError("Pick a known area or give coordinates")
        lng, lat = jitter(match[1], match[2], random.Random(), 0.3)
    n = db.scalar(select(func.count(Location.id)).where(Location.org_id == org_id))
    loc = Location(org_id=org_id, code=f"BR-{n:02d}", name=name, kind=kind, area=area, lng=lng, lat=lat, contact=contact)
    db.add(loc)
    db.flush()
    if seed_usage:  # start with a typical usage profile for its kind and an empty shelf
        t = TEMPLATES[org.sector]
        base = {row[0]: row[7] for row in t["products"]}
        rng = random.Random(loc.id)
        for p in db.scalars(select(Product).where(Product.org_id == org_id)):
            u = _usage_for(org.sector, kind, p.sku, base.get(p.sku, 0.5), rng)
            if u > 0:
                db.add(StockLevel(location_id=loc.id, product_id=p.id, qty=0, daily_usage=u))
    return loc


def overview(db: Session, org_id: int) -> dict:
    org = db.get(Organization, org_id)
    locs, prods = _maps(db, org_id)
    central = next(l for l in locs.values() if l.is_central)
    stocks = list(db.scalars(select(StockLevel).where(StockLevel.location_id.in_(list(locs)))))
    open_q = _open_qty(db, org_id)
    value = sum(s.qty * prods[s.product_id].unit_cost_inr for s in stocks)
    alerts = []
    branch_slots = 0
    healthy = 0
    for s in stocks:
        loc = locs[s.location_id]
        if loc.is_central or s.daily_usage <= 0 or not loc.active:
            continue
        branch_slots += 1
        cover = s.qty / s.daily_usage
        if cover >= s.reorder_days:
            healthy += 1
        if cover < s.reorder_days:
            p = prods[s.product_id]
            alerts.append({"location_id": loc.id, "location": loc.name, "product_id": p.id, "product": p.name,
                           "sku": p.sku, "critical": p.critical, "qty": s.qty, "cover_days": round(cover, 2),
                           "on_order": open_q.get((loc.id, p.id), 0)})
    alerts.sort(key=lambda a: (not a["critical"], a["cover_days"]))
    central_short = []
    for s in stocks:
        if s.location_id != central.id:
            continue
        net = sum(x.daily_usage for x in stocks if x.product_id == s.product_id and x.location_id != central.id)
        if net > 0 and s.qty / net < 5:
            p = prods[s.product_id]
            central_short.append({"product_id": p.id, "product": p.name, "sku": p.sku, "qty": s.qty,
                                  "cover_days": round(s.qty / net, 1), "critical": p.critical})
    counts = dict(db.execute(select(Requisition.status, func.count(Requisition.id))
                             .where(Requisition.org_id == org_id).group_by(Requisition.status)).all())
    ships = list(db.scalars(select(Shipment).where(Shipment.org_id == org_id).order_by(Shipment.id.desc())))
    delivered = db.scalars(select(Requisition.late_min).where(Requisition.org_id == org_id, Requisition.status == "delivered")).all()
    on_time = [x for x in delivered if (x or 0) <= 0.5]
    moves = db.scalars(select(StockMovement).where(StockMovement.org_id == org_id)
                       .order_by(StockMovement.id.desc()).limit(14)).all()
    return {
        "org": org_dict(org),
        "kpis": {
            "branches": sum(1 for l in locs.values() if not l.is_central and l.active),
            "skus": len(prods),
            "inventory_value_inr": round(value),
            "service_level_pct": round(100 * healthy / branch_slots, 1) if branch_slots else 100.0,
            "low_stock": len(alerts),
            "critical_low": sum(1 for a in alerts if a["critical"]),
            "pending": counts.get("pending", 0), "approved": counts.get("approved", 0),
            "in_transit": counts.get("dispatched", 0), "delivered": counts.get("delivered", 0),
            "shipments": len(ships),
            "saved_inr": round(sum(s.legacy_cost_inr - s.cost_inr for s in ships)),
            "spent_inr": round(sum(s.cost_inr for s in ships)),
            "co2_saved_kg": round(sum(s.legacy_co2_kg - s.co2_kg for s in ships), 1),
            "on_time_pct": round(100 * len(on_time) / len(delivered), 1) if delivered else None,
        },
        "alerts": alerts[:40],
        "central_short": sorted(central_short, key=lambda x: x["cover_days"]),
        "movements": [{"id": m.id, "kind": m.kind, "delta": m.delta, "ref": m.ref,
                       "location": locs[m.location_id].name if m.location_id in locs else "?",
                       "product": prods[m.product_id].name if m.product_id in prods else "?",
                       "at": _iso(m.created_at)} for m in moves],
        "recent_shipments": [ship_dict(s) for s in ships[:5]],
    }


def org_dict(o: Organization) -> dict:
    return {"id": o.id, "name": o.name, "shared": o.owner_id is None, "sector": o.sector, "sector_label": TEMPLATES[o.sector]["label"],
            "city": o.city, "city_name": CITIES[o.city]["name"], "tagline": o.tagline,
            "center": CITIES[o.city]["center"], "zoom": CITIES[o.city]["zoom"]}


def stock_matrix(db: Session, org_id: int) -> dict:
    locs, prods = _maps(db, org_id)
    open_q = _open_qty(db, org_id)
    cells = []
    for s in db.scalars(select(StockLevel).where(StockLevel.location_id.in_(list(locs)))):
        cover = s.qty / s.daily_usage if s.daily_usage > 0 else None
        cells.append({"location_id": s.location_id, "product_id": s.product_id, "qty": s.qty,
                      "daily_usage": s.daily_usage, "reorder_days": s.reorder_days, "target_days": s.target_days,
                      "cover_days": round(cover, 2) if cover is not None else None,
                      "on_order": open_q.get((s.location_id, s.product_id), 0)})
    ordered = sorted(locs.values(), key=lambda l: (not l.is_central, l.code))
    return {"locations": [loc_dict(l) for l in ordered], "products": [prod_dict(p) for p in prods.values()],
            "cells": cells}
