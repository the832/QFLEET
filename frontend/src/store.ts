import { create } from "zustand";
import { api } from "./lib/api";
import { clock, cutTrail, planEnd, positionAt } from "./lib/sim";
import type {
  FleetEvent,
  Meta,
  Order,
  PlanResult,
  QaoaResult,
  ScalingResult,
  Scenario,
  TrailSegment,
} from "./types";

export type View = "supply" | "command" | "lab" | "bench" | "schedule";
export type MapMode = "none" | "urgent" | "traffic";

interface Toast {
  id: string;
  kind: "ok" | "warn" | "err" | "quantum";
  text: string;
}

interface State {
  entered: boolean;
  view: View;
  meta: Meta | null;
  city: string;
  nOrders: number;
  nVehicles: number;
  seed: number;
  solver: string;

  scenario: Scenario | null;
  plan: PlanResult | null;
  baseline: PlanResult | null; // legacy plan on the same state, for deltas
  planStart: number;
  history: TrailSegment[];
  compare: Record<string, PlanResult> | null;
  compareLabel: string;
  /** the world (and its clock) the benchmark was run on */
  compareSrc: { scenario: Scenario; at: number } | null;
  qaoa: QaoaResult | null;
  /** quantum plan shown in the Quantum Lab, with the world it was computed from */
  lab: { plan: PlanResult; scenario: Scenario; at: number } | null;
  scaling: ScalingResult | null;
  scalingBusy: boolean;
  follow: boolean;
  /** bumped to make the map fly back to the city overview */
  recenter: number;
  demo: { step: number; total: number; caption: string; sub?: string } | null;

  simTime: number;
  playing: boolean;
  speed: number;

  busy: boolean;
  busyLabel: string;
  comparing: boolean;
  qaoaBusy: boolean;
  anneal: { plan: PlanResult; startedAt: number } | null;
  annealPending: boolean;
  arcFlash: number;

  mapMode: MapMode;
  selectedVehicle: string | null;
  events: FleetEvent[];
  toasts: Toast[];
  replans: number;
  /** phones: whether the mission-metrics sheet is open over the map */
  mobileMetrics: boolean;

  enter: () => void;
  setView: (v: View) => void;
  set: (p: Partial<State>) => void;
  init: () => Promise<void>;
  loadScenario: () => Promise<void>;
  optimize: (reason?: string) => Promise<void>;
  breakdown: (vehicleId: string) => Promise<void>;
  addUrgent: (lng: number, lat: number) => Promise<void>;
  addTraffic: (lng: number, lat: number) => Promise<void>;
  runCompare: (override?: Scenario, label?: string) => Promise<void>;
  showPlan: (solver: string) => void;
  runQaoa: (vehicleId: string, nStops: number, layers: number) => Promise<void>;
  runScaling: () => Promise<void>;
  resetDay: () => void;
  /** show a plan computed elsewhere (e.g. a Supply Network dispatch) on the live map */
  watchPlan: (scenario: Scenario, plan: PlanResult, title: string) => void;
  toast: (kind: Toast["kind"], text: string) => void;
  log: (e: Omit<FleetEvent, "id">) => void;
  finishAnneal: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 9);

/** Freeze the world at time t: delivered orders, vehicle positions, clocks. */
function snapshot(scenario: Scenario, plan: PlanResult | null, t: number): Scenario {
  const sc: Scenario = JSON.parse(JSON.stringify(scenario));
  if (!plan || t <= 0) return sc;
  const delivered = new Set<string>();
  for (const r of plan.routes) for (const s of r.stops) if (s.arrival <= t) delivered.add(s.order_id);
  sc.orders = sc.orders.map((o) => (delivered.has(o.id) ? { ...o, status: "delivered" } : o));
  sc.vehicles = sc.vehicles.map((v) => {
    if (v.status !== "active") return v;
    const r = plan.routes.find((x) => x.vehicle_id === v.id);
    if (!r || !r.stops.length || t >= r.return_time) {
      const home = r && r.stops.length ? sc.depot : v.start;
      return { ...v, start: { lng: home.lng, lat: home.lat }, start_time: t };
    }
    const [lng, lat] = positionAt(r, t);
    return { ...v, start: { lng, lat }, start_time: t };
  });
  return sc;
}

export const useStore = create<State>((set, get) => ({
  entered: false,
  view: "supply",
  meta: null,
  city: "bengaluru",
  nOrders: 30,
  nVehicles: 5,
  seed: 7,
  solver: "quantum",

  scenario: null,
  plan: null,
  baseline: null,
  planStart: 0,
  history: [],
  compare: null,
  compareLabel: "",
  compareSrc: null,
  qaoa: null,
  lab: null,
  scaling: null,
  scalingBusy: false,
  follow: false,
  recenter: 0,
  demo: null,

  simTime: 0,
  playing: false,
  speed: 6,

  busy: false,
  busyLabel: "",
  comparing: false,
  qaoaBusy: false,
  anneal: null,
  annealPending: false,
  arcFlash: 0,

  mapMode: "none",
  selectedVehicle: null,
  events: [],
  toasts: [],
  replans: 0,
  mobileMetrics: false,

  enter: () => set({ entered: true }),
  setView: (view) => set({ view }),
  set: (p) => set(p as State),

  toast: (kind, text) => {
    const id = uid();
    set({ toasts: [...get().toasts, { id, kind, text }].slice(-4) });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 4200);
  },
  log: (e) => set({ events: [{ ...e, id: uid() }, ...get().events].slice(0, 60) }),

  init: async () => {
    try {
      const meta = await api.meta();
      set({ meta });
    } catch {
      get().toast("err", "Backend offline — start the API on :8787");
    }
    await get().loadScenario();
  },

  loadScenario: async () => {
    const { city, nOrders, nVehicles, seed } = get();
    set({ busy: true, busyLabel: "Generating operations…" });
    try {
      const scenario = await api.scenario(city, nOrders, nVehicles, seed);
      set({
        scenario,
        plan: null,
        baseline: null,
        compare: null,
        qaoa: null,
        lab: null,
        history: [],
        simTime: 0,
        planStart: 0,
        playing: false,
        selectedVehicle: null,
        follow: false,
        recenter: get().recenter + 1,
        scaling: null,
        replans: 0,
        events: [],
      });
      get().log({
        t: 0,
        kind: "info",
        title: `${scenario.city_name} operations loaded`,
        detail: `${scenario.orders.length} orders · ${scenario.vehicles.length} vehicles · hub ${scenario.depot.name}`,
      });
    } catch (e) {
      get().toast("err", `Could not load scenario: ${(e as Error).message}`);
    } finally {
      set({ busy: false });
    }
  },

  optimize: async (reason) => {
    const st = get();
    if (!st.scenario || st.busy) return;
    const t = st.plan ? st.simTime : 0;
    const scenario = snapshot(st.scenario, st.plan, t);
    const pending = scenario.orders.filter((o) => o.status !== "delivered").length;
    if (!pending) {
      get().toast("ok", "All deliveries completed — nothing left to optimise");
      return;
    }
    const quantum = st.solver === "quantum" || st.solver === "leap";
    set({
      busy: true,
      playing: false,
      busyLabel: quantum ? "Annealing quantum state…" : "Optimising…",
      annealPending: quantum,
    });
    const t0 = performance.now();
    try {
      const [plan, baseline] = await Promise.all([
        api.optimize(scenario, st.solver),
        api.optimize(scenario, "greedy").catch(() => null),
      ]);
      // the Lab keeps the latest quantum plan that is big enough to be worth inspecting
      const prevLab = get().lab;
      const labWorthy =
        !!plan.quantum &&
        (!prevLab || plan.quantum.total_qubits >= Math.min(25, prevLab.plan.quantum?.total_qubits ?? 0));
      const lab = labWorthy ? { plan, scenario, at: t } : prevLab;
      const history = st.plan
        ? [...st.history, ...st.plan.routes.map((r) => cutTrail(r, t)).filter((x): x is TrailSegment => !!x)]
        : [];
      set({
        scenario,
        plan,
        baseline,
        history,
        planStart: t,
        simTime: t,
        compare: null,
        lab,
        qaoa: labWorthy ? null : st.qaoa,
        arcFlash: performance.now(),
        replans: st.plan ? st.replans + 1 : 0,
        anneal: quantum ? { plan, startedAt: performance.now() } : null,
        playing: !quantum, // quantum plans start playing when the anneal overlay closes
        annealPending: false,
      });
      const wall = (performance.now() - t0) / 1000;
      const m = plan.metrics;
      get().log({
        t,
        kind: "plan",
        title: reason ?? `${plan.solver_short} plan computed`,
        detail: `${m.served} stops · ${m.vehicles_used} vehicles · ${m.distance_km.toFixed(1)} km · solved in ${(plan.solve_ms / 1000).toFixed(2)}s${plan.quantum ? ` · ${plan.quantum.total_qubits} qubits` : ""}`,
      });
      if (!quantum) get().toast("ok", `Plan ready in ${wall.toFixed(1)}s`);
      if (plan.unassigned.length)
        get().toast("warn", `${plan.unassigned.length} orders exceed fleet capacity`);
    } catch (e) {
      set({ annealPending: false });
      get().toast("err", `Optimisation failed: ${(e as Error).message}`);
    } finally {
      set({ busy: false });
    }
  },

  finishAnneal: () => {
    const { anneal } = get();
    if (!anneal) return;
    const q = anneal.plan.quantum;
    set({ anneal: null, playing: true, arcFlash: performance.now() });
    if (q)
      get().toast(
        "quantum",
        `Quantum plan: ${q.total_qubits} qubits annealed in ${(anneal.plan.solve_ms / 1000).toFixed(2)}s`,
      );
  },

  breakdown: async (vehicleId) => {
    const st = get();
    if (!st.scenario || !st.plan) return;
    const t = st.simTime;
    const r = st.plan.routes.find((x) => x.vehicle_id === vehicleId);
    const left = r ? r.stops.filter((s) => s.arrival > t).length : 0;
    const pos = r ? positionAt(r, t) : null;
    const scenario: Scenario = {
      ...st.scenario,
      vehicles: st.scenario.vehicles.map((v) =>
        v.id === vehicleId
          ? { ...v, status: "breakdown", start: pos ? { lng: pos[0], lat: pos[1] } : v.start }
          : v,
      ),
    };
    set({ scenario });
    get().log({
      t,
      kind: "breakdown",
      title: `${vehicleId} breakdown at ${clock(t)}`,
      detail: `${left} undelivered orders released back to the quantum allocator`,
    });
    get().toast("warn", `${vehicleId} is down — re-optimising fleet`);
    await get().optimize(`Fleet re-planned around ${vehicleId}`);
  },

  addUrgent: async (lng, lat) => {
    const st = get();
    if (!st.scenario) return;
    const t = st.plan ? st.simTime : 0;
    const n = st.scenario.orders.length + 1;
    const order: Order = {
      id: `URG-${String(n).padStart(3, "0")}`,
      customer: "Emergency · Medical supplies",
      area: "Pinned location",
      lng,
      lat,
      demand: 35,
      priority: "critical",
      deadline: Math.round(t + 75),
      service: 4,
      status: "pending",
      urgent_injected: true,
    };
    set({ scenario: { ...st.scenario, orders: [...st.scenario.orders, order] }, mapMode: "none" });
    get().log({
      t,
      kind: "urgent",
      title: `Urgent order ${order.id} injected`,
      detail: `Critical delivery due by ${clock(order.deadline)} — dynamic re-allocation`,
    });
    if (st.plan) await get().optimize(`Re-planned for urgent ${order.id}`);
    else get().toast("ok", `Urgent ${order.id} added: press OPTIMIZE to plan it`);
  },

  addTraffic: async (lng, lat) => {
    const st = get();
    if (!st.scenario) return;
    const t = st.plan ? st.simTime : 0;
    const zone = { id: uid(), lng, lat, radius_km: 2.2, factor: 3.0 };
    set({
      scenario: { ...st.scenario, traffic_zones: [...st.scenario.traffic_zones, zone] },
      mapMode: "none",
    });
    get().log({
      t,
      kind: "traffic",
      title: `Gridlock detected at ${clock(t)}`,
      detail: `Travel times ×3 within 2.2 km — routes re-sequenced around the jam`,
    });
    if (st.plan) await get().optimize("Re-planned around traffic gridlock");
    else get().toast("ok", "Gridlock zone added: the next optimisation will route around it");
  },

  runCompare: async (override, label) => {
    const st = get();
    if (!st.scenario || st.comparing) return;
    // st.scenario is the frozen world the current plan was computed from
    const t = override ? 0 : st.planStart;
    const scenario = override ?? st.scenario;
    set({ comparing: true });
    try {
      const res = await api.compare(scenario);
      set({
        compare: res.results,
        compareSrc: { scenario, at: t },
        compareLabel:
          label ??
          (t > 0
            ? `State at ${clock(t)} · ${scenario.orders.filter((o) => o.status !== "delivered").length} open orders`
            : "Start-of-day plan"),
      });
      const q = res.results.quantum?.metrics;
      const g = res.results.greedy?.metrics;
      if (q && g)
        get().log({
          t,
          kind: "compare",
          title: "Benchmark complete",
          detail: `Quantum hybrid vs legacy: ${(((g.cost_inr - q.cost_inr) / g.cost_inr) * 100).toFixed(0)}% cheaper, ${(((g.makespan_min - q.makespan_min) / g.makespan_min) * 100).toFixed(0)}% faster turnaround`,
        });
    } catch (e) {
      get().toast("err", `Benchmark failed: ${(e as Error).message}`);
    } finally {
      set({ comparing: false });
    }
  },

  showPlan: (solver) => {
    const st = get();
    const p = st.compare?.[solver];
    const src = st.compareSrc;
    if (!p || !src) return;
    // load the exact world the benchmark ran on, so the map and KPIs line up
    set({
      plan: p,
      solver: p.solver,
      scenario: src.scenario,
      baseline: st.compare?.greedy ?? null,
      planStart: src.at,
      simTime: src.at,
      history: src.at === st.planStart ? st.history : [],
      lab: p.quantum ? { plan: p, scenario: src.scenario, at: src.at } : st.lab,
      selectedVehicle: null,
      follow: false,
      view: "command",
      playing: true,
      arcFlash: performance.now(),
    });
    get().toast("ok", `Showing the ${p.solver_short} plan on the map`);
  },

  runQaoa: async (vehicleId, nStops, layers) => {
    const st = get();
    const src = st.lab;
    const route = src?.plan.routes.find((r) => r.vehicle_id === vehicleId);
    if (!src || !route) {
      get().toast("warn", "Pick a vehicle with at least 2 planned stops");
      return;
    }
    set({ qaoaBusy: true });
    try {
      const res = await api.qaoa(src.scenario, route, nStops, layers);
      set({ qaoa: res });
    } catch (e) {
      get().toast("err", `QAOA failed: ${(e as Error).message}`);
    } finally {
      set({ qaoaBusy: false });
    }
  },

  runScaling: async () => {
    const st = get();
    if (!st.scenario || st.scalingBusy) return;
    set({ scalingBusy: true });
    try {
      set({ scaling: await api.scaling(st.scenario, 3) });
    } catch (e) {
      get().toast("err", `Scaling experiment failed: ${(e as Error).message}`);
    } finally {
      set({ scalingBusy: false });
    }
  },

  resetDay: () => {
    get().loadScenario();
  },

  watchPlan: (scenario, plan, title) => {
    const quantum = !!plan.quantum;
    set({
      city: scenario.city,
      scenario,
      plan,
      baseline: null,
      history: [],
      planStart: 0,
      simTime: 0,
      compare: null,
      qaoa: null,
      lab: quantum ? { plan, scenario, at: 0 } : get().lab,
      solver: plan.solver,
      selectedVehicle: null,
      follow: false,
      recenter: get().recenter + 1,
      replans: 0,
      events: [],
      view: "command",
      arcFlash: performance.now(),
      anneal: quantum ? { plan, startedAt: performance.now() } : null,
      playing: !quantum,
    });
    const m = plan.metrics;
    get().log({
      t: 0,
      kind: "plan",
      title,
      detail: `${m.served} branch deliveries · ${m.vehicles_used} vehicles · ${m.distance_km.toFixed(1)} km${plan.quantum ? ` · ${plan.quantum.total_qubits} qubits` : ""}`,
    });
    // legacy plan on the same world, so the mission panel can show the savings
    api.optimize(scenario, "greedy").then((b) => { if (get().plan === plan) set({ baseline: b }); }).catch(() => {});
  },
}));

export const selectPlanEnd = (s: State) => planEnd(s.plan);
