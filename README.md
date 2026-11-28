# QFleet — Quantum-Native Fleet Intelligence
**Team Nonchalant · Problem #12 · Quantum Technology-Based Fleet Management Optimization**

QFleet allocates, sequences and re-routes a whole delivery fleet using **quantum annealing** and
**gate-model QAOA**, then streams the plan onto a live 3D command center that reacts to breakdowns,
urgent orders and traffic in under a second.

---

## Run it

```bash
./start.sh          # builds the UI and serves everything on http://localhost:8787
./dev.sh            # hot-reload dev mode: UI on :5173, API on :8787
```

Requirements: `uv` (Python 3.13 env is created automatically) and Node ≥ 20.

**Deploy:** `docker build -t qfleet . && docker run --env-file backend/.env -p 8787:8787 qfleet`
(or `docker compose up --build`). Production hosting is set up as **frontend on Vercel** (`frontend/vercel.json`,
`VITE_API_URL`) and **backend on Railway** (`railway.json`, `ALLOWED_ORIGINS`): step-by-step guide in [DEPLOY.md](DEPLOY.md).
Optional: `export DWAVE_API_TOKEN=…` to unlock the **D-Wave Leap hybrid cloud** solver
(not exercised in our tests because it needs a Leap account).

Keyboard: `Enter` launch · `O` optimise · `D` autopilot demo · `Space` play/pause · `1–4` switch views ·
`5` Supply Network · `F` follow-cam on the selected vehicle · `Esc` cancel.

### Database and sign-in (Neon free tier)
Copy `backend/.env.example` to `backend/.env` and fill in:
* `DATABASE_URL`: Neon › Connect › connection string. Tables are created and two demo organisations are
  seeded on first start. Without it the app falls back to a local SQLite file.
* `NEON_AUTH_URL`: Neon › Settings › Better Auth › Auth URL. Turns on the sign-in screen (Neon Auth, built on
  Better Auth); the API then verifies every request's JWT against the project's JWKS (EdDSA).
  Sign-in offers **Continue with Google** (Neon Auth social login) and email + password.
  Leave it empty to run in open demo mode. Open the app on `http://localhost:8787` (Neon trusts any localhost port).
* Fresh demo data before presenting: `cd backend && .venv/bin/python -m app.reset_demo`, then restart the server.

---

## The product: QFleet Supply Network
Most organisations don't run "a fleet"; they run **a central store that keeps many sites stocked**.
QFleet turns the optimiser into that product:

```
 Branches use stock ─► low days-of-cover raises an indent ─► central store approves (critical first)
        ▲                                                              │
        └── branch confirms receipt, stock + ledger update ◄── QFleet plans the delivery wave (quantum)
```

* **Who it's for:** a hospital network supplying hospitals, PHCs, clinics and pharmacies (insulin, oxygen,
  IV fluids…), or a retail chain supplying neighbourhood stores (milk, bread, staples…). Both ship as
  templates; anyone can create their own organisation in any of the 5 cities.
* **Inventory drives urgency:** priority is computed from how soon a branch runs out (critical item < 1 day
  of cover → critical). That priority becomes the delivery deadline in the quantum QUBO, so the most urgent
  shelves are refilled first.
* **Fair rationing:** when the central shelf is short, approval allocates most-urgent first and part-fills the rest.
* **Two portals:** *Central* (overview, requests, stock matrix, network map, dispatch waves, ledger) and
  *Branch* (my shelf, my requests with ETA, confirm receipt).
* **Live:** dispatch opens the quantum annealing view, then the live map; each branch's stock is booked in
  the moment its van arrives. Every unit that moves is an append-only ledger row in Neon Postgres.
* **Measured:** first wave of the health network: ₹1,689 vs ₹2,617 for legacy dispatch (35% cheaper),
  100% on time; retail chain in Kolkata: 30% cheaper, 100% on time.

* **Roles:** whoever creates an organisation is its **main operator**. From *Team & roles* they invite
  teammates by email as another main operator or as a **branch operator** locked to one site; the invite
  activates the first time that email signs in. Branch operators only see their own shelf, raise their own
  requests and confirm their own deliveries; approval, dispatch, rules and the team stay with main operators
  (enforced by the API, not just hidden in the UI). Demo organisations are shared: everyone is a main operator.
* **Autopilot:** standing rules per organisation: auto-approve (critical first, unfillable requests wait as
  backorders), dispatch at once when a critical request is approved, dispatch when approved load reaches X% of
  fleet capacity, and fixed daily waves (IST). Checked after every request/approval/simulated day and once a
  minute; automatic waves are announced in the header with a *Watch on map* button.
* **Demo:** *Play demo* (or `D` on the Supply screen) runs a captioned 60-second story on live data:
  a day of usage → approvals → quantum-planned wave on the map with live receipts → restocked network →
  branch view → autopilot.

Data model: `organizations · locations (central + sub-inventories) · products · stock_levels (qty, daily usage,
reorder & target days) · requisitions + lines · shipments (plan JSON, cost vs legacy) · stock_movements (ledger)
· fleet_vehicles`. API under `/api/inv` (see `backend/app/inv_api.py`).

## Highlights
* **Autopilot demo** (`D` or the Demo button): a captioned 9-step walkthrough that drives the real app
  (plan → breakdown → urgent order → gridlock → Quantum Lab → benchmark). Use it to record your demo video.
* **3D command center**: animated trips on real roads, follow-cam, per-vehicle stop timelines, live event stream.
* **Business impact**: projected yearly ₹ savings, tonnes of CO₂, tree-equivalents and fleet-hours vs legacy dispatch.
* **Quantum Lab**: pipeline, annealing dynamics, Trotter replica viewer, QUBO heatmap, **scaling experiment**
  (quantum vs thermal annealing as problems grow) and the **QAOA circuit lab** (Qiskit).
* **Benchmark arena**: Q-Hybrid vs Google OR-Tools vs thermal SA vs legacy dispatch on identical inputs.

### Real quantum hardware (IBM Quantum)
Quantum Lab › *Real quantum hardware* sends the QAOA routing circuit (2 stops = 4 qubits, or 3 stops = 9)
to an IBM superconducting processor through Qiskit Runtime and scores the measurements: how often the chip
returns a valid route and the optimal one, versus the noiseless simulator and random guessing. Add
`IBM_QUANTUM_TOKEN` (and optionally `IBM_QUANTUM_INSTANCE`) to `backend/.env` to enable it; jobs are queued
at IBM and polled. Without a token the panel runs IBM's calibrated noise model of its 133-qubit Torino chip
locally. On that model the 4-qubit circuit returns the optimal route 17–18% of the time against 6.25% for
random guessing (≈3×), matching the ideal simulator; at 9 qubits noise erodes most of the advantage (1.3% vs
0.2% random), which is the honest state of today's hardware.

---

## How it maps to the problem statement

| Problem statement asks for | What QFleet does |
|---|---|
| Vehicle allocation | Stage 1 **capacitated allocation QUBO** solved by simulated quantum annealing |
| Route planning & scheduling | Stage 2 **per-vehicle sequencing QUBOs**, deadline-aware, on a real road network (OSRM) |
| Delivery priorities | Critical / high / standard SLAs with deadline-aware penalty terms |
| Fuel consumption & cost | Per-vehicle-type ₹/km and CO₂/km (EV van, CNG mini truck, diesel truck) + driver time |
| Coordination under disruption | Live breakdowns, urgent orders and gridlock zones re-planned from the vehicles' current positions |
| Reduce turnaround, improve utilisation | Turnaround, makespan and utilisation are first-class KPIs, benchmarked against baselines |

---

## Architecture

```
React + deck.gl + MapLibre (3D map, animated trips)  ──►  FastAPI
                                                          │
             OSRM road matrix ──► Stage 1  Allocation QUBO ──► SQA (path-integral, numba)
                                  Stage 2  Route QUBOs     ──► SQA per vehicle
                                  Hybrid   classical ₹-cost refinement + ruin-and-recreate search
                                  Lab      QAOA circuit (Qiskit) on statevector simulator
             Baselines: Google OR-Tools (GLS) · D-Wave neal thermal SA (same QUBO) · legacy dispatch
```

### Quantum engine
* **Simulated Quantum Annealing**: transverse-field Ising model mapped to 16 Suzuki–Trotter replicas
  (path-integral Monte Carlo). Γ is annealed 3 → 10⁻³ while the replica coupling
  J⊥ = −½ ln tanh(Γ/PT) grows, emulating quantum tunnelling. Compiled with numba, multi-read, multi-threaded.
* **Stage 1 QUBO**: x<sub>ov</sub> = order o on vehicle v; insertion cost to k-means seeds, one-hot penalty,
  capacity-aware loading term; candidate pruning (3 nearest seeds per order) keeps it well conditioned.
  Fleet size K is explored (minimum K … K+2) and the cheapest plan wins.
* **Stage 2 QUBO**: x<sub>ip</sub> = stop i at position p; permutation penalties, travel-time couplings,
  deadline-aware lateness term.
* **QAOA lab**: the same sequencing QUBO as a Qiskit circuit (H → RZZ/RZ cost layer → RX mixer, p layers),
  CVaR objective, COBYLA with restarts. Probabilities are cross-checked against
  `qiskit.quantum_info.Statevector` (max |Δp| ≈ 1e-16).

---

## Measured results (real road network, 5 runs per city)

Every solver is scored on the same ₹ objective: ₹/km of each vehicle type + ₹220/h driver time,
with lateness penalised. OR-Tools optimises that same objective (per-vehicle arc costs) and both get
the same ~2 s wall-clock budget.

| City | Q-Hybrid (median) | OR-Tools (2 s GLS) | Legacy | Q vs OR-Tools | Q vs legacy | On-time |
|---|---|---|---|---|---|---|
| Bengaluru (30 orders, 5 veh) | ₹3,124 | ₹3,124 | ₹5,935 | tie: same best plan | −47% | 100% |
| Mumbai (45 orders, 6 veh) | ₹3,615 | ₹3,714 | ₹6,237 | **−2.7%** | −42% | 100% |
| Guwahati (20 orders, 4 veh) | ₹1,844 | ₹1,844 | ₹2,934 | tie: same best plan | −37% | 100% |
| Kolkata (30 orders, 5 veh) | ₹2,684 | ₹2,730 | ₹4,476 | **−1.7%** | −40% | 100% |

* **Never costlier than OR-Tools** in 20 of 20 benchmark runs above, and in all 12 test scenarios across
  5 cities (cheaper in 7 by up to 3.9%, identical plan in 5).
* Where it ties (Bengaluru, Guwahati) both solvers find the same plan, and neither OR-Tools with 10 s nor
  our search with 15 s finds anything cheaper, so it is very likely the optimum.
* **37–47% cheaper than legacy dispatch**; Bengaluru: 42% less distance, 67% less CO₂, 30% faster turnaround.
* Q-Hybrid plans a full day in **≈1.9 s** (quantum stages ≈0.5 s, then three parallel ₹-cost searches
  seeded with the quantum plan); live re-plans after a disruption take **≈0.8 s**.
* The classical search improves the raw quantum plan by roughly 10–30%; thermal SA fed into the same
  search reaches similar final costs, so the end-to-end saving comes from the hybrid as a whole.
  The scaling experiment below isolates the annealers.
* Earlier versions of this README showed Q-Hybrid beating OR-Tools by 7–11%. That compared against
  OR-Tools optimising travel *time* while being scored in ₹; the table above uses the fair ₹ objective.
* **Scaling experiment** (Quantum Lab, Bengaluru sub-routes, same QUBO and sweep budget, raw output):
  SQA stays **0–4.5%** from the best-known tour from 25 to 169 qubits, while D-Wave `neal` thermal SA
  degrades from 0.3% to **27%**. Both produced 100% valid samples.
* QAOA (9 qubits): valid tours **~22%** vs 1.2% random (~19×); optimal tour amplified **~19×**;
  16 qubits: optimal amplified **~190×**
* Results vary by scenario. OR-Tools sometimes drives fewer km; the Benchmark view shows every
  number side by side.

---

## 3-minute demo script
Press `D` for the autopilot, or present it manually:

1. **Landing** → "Enter command center". One line: *fleet routing is NP-hard; we cast it as a quantum Hamiltonian.*
2. **Optimize Fleet** → the annealing overlay shows energy dropping as Γ → 0 and the Trotter replicas collapsing.
   Then the routes animate on real roads. Point at the KPI deltas vs legacy.
3. **Breakdown** a truck mid-route → re-planned from live positions in < 0.5 s. Then drop an **urgent order**
   and a **gridlock zone**. Point at the event stream.
4. **Quantum Lab** → the pipeline, the QUBO matrix and the replica viewer. **Run QAOA**: the most probable
   measurement is the optimal delivery order, verified against Qiskit.
5. **Quantum Lab → Scaling experiment** → the widening gap between quantum and thermal annealing as qubits grow.
6. **Benchmark** → the business-impact card (₹ lakh/year, tonnes CO₂), the head-to-head table and the radar. Close with: *honest numbers, quantum-ready architecture;
   set a D-Wave token and the same QUBOs run on real quantum hardware.*

### Likely judge questions
* **"Is this a real quantum computer?"** It's a physics-faithful simulation (path-integral SQA, exact
  statevector QAOA). The QUBOs are hardware-ready: `DWAVE_API_TOKEN` routes them to D-Wave Leap.
* **"Why hybrid?"** Today's QPUs are limited to hundreds of well-connected qubits. Decomposition (allocate →
  sequence) is how industrial quantum optimisation is done, and classical refinement is standard practice.
* **"Does it beat OR-Tools?"** It is never costlier in our tests: cheaper in 7 of 12 scenarios (up to 3.9%),
  the identical (very likely optimal) plan in the other 5, in the same ~2 s. Legacy dispatch: 37–47% cheaper.
  We show all of it.
