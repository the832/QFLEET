"""QFleet API · Team Nonchalant."""
from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import optimizer
from .data import PRIORITIES, VEHICLE_TYPES, city_list, generate_scenario
from .qaoa import run_qaoa
from .scaling import run_scaling

def _warm_up():
    """Load the compiled annealing kernels once so the first user request is fast."""
    import numpy as np

    from .sqa import sa_solve, sqa_solve

    Q = np.triu(np.random.default_rng(0).normal(size=(12, 12)))
    sqa_solve(Q, sweeps=50, reads=2)
    sa_solve(Q, sweeps=50, reads=2)
    from .classical import warm_ortools_pool

    warm_ortools_pool()
    optimizer.warm_lns_pool()


threading.Thread(target=_warm_up, daemon=True).start()

app = FastAPI(title="QFleet · Quantum Fleet Optimizer", version="1.0.0")
# The UI is served from the same origin, so cross-origin access is off unless ALLOWED_ORIGINS lists sites.
# Split hosting (frontend on Vercel, API on Railway): list the frontend sites in ALLOWED_ORIGINS
# (comma-separated) and optionally ALLOWED_ORIGIN_REGEX for Vercel preview URLs, e.g.
#   ALLOWED_ORIGINS=https://qfleet.vercel.app   ALLOWED_ORIGIN_REGEX=https://qfleet-[a-z0-9-]+\.vercel\.app
_origins = [o.strip().rstrip("/") for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
_origin_re = os.environ.get("ALLOWED_ORIGIN_REGEX", "").strip() or None
if _origins or _origin_re:
    app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_origin_regex=_origin_re,
                       allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["authorization", "content-type"],
                       max_age=600)
app.add_middleware(GZipMiddleware, minimum_size=2000)

# QFleet Supply Network: inventory module on Neon Postgres (SQLite fallback)
from . import inventory  # noqa: E402
from .inv_api import router as inv_router  # noqa: E402

inventory.seed_if_empty()
app.include_router(inv_router)
from .db import keep_warm  # noqa: E402

keep_warm()
from .automation import start_scheduler  # noqa: E402

start_scheduler()


class ScenarioReq(BaseModel):
    city: str = "bengaluru"
    n_orders: int = Field(30, ge=4, le=60)
    n_vehicles: int = Field(5, ge=2, le=10)
    seed: int = 7


class OptimizeReq(BaseModel):
    scenario: dict[str, Any]
    solver: str = "quantum"
    trips: bool = True


class CompareReq(BaseModel):
    scenario: dict[str, Any]
    solvers: list[str] | None = None


class QaoaReq(BaseModel):
    scenario: dict[str, Any]
    route: dict[str, Any]
    n_stops: int = Field(3, ge=2, le=4)
    layers: int = Field(6, ge=1, le=8)


# ----------------------------------------------------------------------------- abuse guards
# The routing endpoints are open for the public demo but CPU-heavy: cap concurrency and problem size.
MAX_HEAVY = int(os.environ.get("QFLEET_MAX_CONCURRENT_SOLVES", "3"))
_heavy = threading.BoundedSemaphore(MAX_HEAVY)
MAX_ORDERS, MAX_VEHICLES = 80, 12


class _Slot:
    def __enter__(self):
        if not _heavy.acquire(timeout=20):
            raise HTTPException(429, "The optimiser is busy with other requests, please retry in a few seconds")

    def __exit__(self, *exc):
        _heavy.release()


def _check_size(scenario: dict) -> None:
    if not isinstance(scenario, dict):
        raise HTTPException(400, "scenario must be an object")
    n_o, n_v = len(scenario.get("orders") or []), len(scenario.get("vehicles") or [])
    if n_o > MAX_ORDERS or n_v > MAX_VEHICLES:
        raise HTTPException(413, f"Scenario too large: at most {MAX_ORDERS} orders and {MAX_VEHICLES} vehicles")


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/meta")
def meta():
    return {
        "cities": city_list(),
        "solvers": optimizer.SOLVERS,
        "vehicle_types": VEHICLE_TYPES,
        "priorities": {k: {"deadline": v[0]} for k, v in PRIORITIES.items()},
        "leap_enabled": "leap" in optimizer.SOLVERS,
    }


@app.post("/api/scenario")
def scenario(req: ScenarioReq):
    return generate_scenario(req.city, req.n_orders, req.n_vehicles, req.seed)


@app.post("/api/optimize")
def optimize(req: OptimizeReq):
    if req.solver not in optimizer.SOLVERS:
        raise HTTPException(400, f"Unknown solver {req.solver}")
    _check_size(req.scenario)
    with _Slot():
        return optimizer.solve(req.scenario, req.solver, with_trips=req.trips)


@app.post("/api/compare")
def compare(req: CompareReq):
    solvers = [s for s in (req.solvers or ["quantum", "ortools", "sa", "greedy"])
               if s in optimizer.SOLVERS]
    _check_size(req.scenario)
    with _Slot():
        return optimizer.compare(req.scenario, solvers)


@app.post("/api/qaoa")
def qaoa(req: QaoaReq):
    _check_size(req.scenario)
    prob = optimizer.build_problem(req.scenario)
    try:
        with _Slot():
            return run_qaoa(prob, req.route, req.n_stops, req.layers)
    except (ValueError, StopIteration, KeyError) as exc:
        raise HTTPException(400, f"QAOA needs a planned route with pending stops ({exc})")


class HardwareReq(BaseModel):
    scenario: dict[str, Any]
    route: dict[str, Any]
    n_stops: int = Field(2, ge=2, le=3)
    layers: int = Field(1, ge=1, le=4)
    mode: str = "fake"


@app.get("/api/qpu/status")
def qpu_status():
    from . import hardware
    return hardware.status()


@app.post("/api/qpu/run")
def qpu_run(req: HardwareReq, authorization: str | None = Header(default=None)):
    from . import hardware
    from .auth import AUTH_URL, current_user
    if req.mode not in ("fake", "ibm"):
        raise HTTPException(400, "mode must be fake or ibm")
    if req.mode == "ibm" and AUTH_URL:
        if current_user(authorization).get("guest"):  # real QPU time costs credits: signed-in users only
            raise HTTPException(401, "Sign in to run on real IBM quantum hardware")
    _check_size(req.scenario)
    prob = optimizer.build_problem(req.scenario)
    try:
        with _Slot():
            return hardware.submit(prob, req.route, req.n_stops, req.layers, req.mode)
    except (ValueError, StopIteration, KeyError) as exc:
        raise HTTPException(400, str(exc))


@app.get("/api/qpu/jobs/{jid}")
def qpu_job(jid: str):
    from . import hardware
    try:
        return hardware.get(jid)
    except KeyError:
        raise HTTPException(404, "Unknown job")


class ScalingReq(BaseModel):
    scenario: dict[str, Any]
    trials: int = Field(3, ge=1, le=6)


@app.post("/api/scaling")
def scaling(req: ScalingReq):
    _check_size(req.scenario)
    prob = optimizer.build_problem(req.scenario)
    with _Slot():
        return run_scaling(prob, trials=req.trials)


# Same-origin sign-in proxy: /neon-auth/* -> Neon Auth. The browser then only talks to our own domain, so
# networks whose DNS can't resolve *.neonauth.*.neon.tech still sign in, and the session cookie is first-party.
# On Vercel, frontend/vercel.json rewrites /neon-auth/* to this route on the Railway backend (a direct Vercel
# rewrite to Neon fails: Vercel adds x-forwarded-host, which Neon rejects).
_PROXY_DROP = {"host", "content-length", "connection", "accept-encoding", "transfer-encoding", "keep-alive"}
_PROXY_DROP_PREFIX = ("x-forwarded-", "forwarded", "x-real-ip", "x-vercel-", "x-railway-", "cf-", "x-envoy-", "via")
_PROXY_PASS = {"content-type", "set-cookie", "set-auth-jwt", "location", "cache-control"}


@app.api_route("/neon-auth/{path:path}", methods=["GET", "POST"])
async def neon_auth_proxy(path: str, request: Request):
    import httpx

    from .auth import AUTH_URL
    if not AUTH_URL:
        raise HTTPException(404, "Sign-in is not configured")
    # Neon rejects requests whose forwarding headers name another host (INVALID_HOSTNAME), and Vercel/Railway
    # edges add them, so strip every proxy/CDN header and present the request as coming straight from the browser.
    headers = {k: v for k, v in request.headers.items()
               if k.lower() not in _PROXY_DROP and not k.lower().startswith(_PROXY_DROP_PREFIX)}
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
        r = await client.request(request.method, f"{AUTH_URL}/{path}", params=request.query_params,
                                 content=await request.body(), headers=headers)
    out = Response(content=r.content, status_code=r.status_code)
    for k, v in r.headers.multi_items():
        if k.lower() in _PROXY_PASS:
            out.headers.append(k, v)
    return out


# Serve the built frontend (single-process deploy).
DIST = Path(os.environ.get("QFLEET_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        if path and f.is_file():
            return FileResponse(f)
        # never cache the HTML shell, so a rebuild is picked up on the next reload
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
