import { useStore } from "../store";
import { positionAt } from "./sim";

/** Scripted, captioned walkthrough that drives the real app (for live pitches and demo videos). */

let runId = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const S = () => useStore.getState();

class Aborted extends Error {}

async function waitFor(cond: () => boolean, timeout = 30000, id = runId) {
  const t0 = performance.now();
  while (!cond()) {
    if (id !== runId) throw new Aborted();
    if (performance.now() - t0 > timeout) return;
    await sleep(120);
  }
}

async function hold(ms: number, id: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (id !== runId) throw new Aborted();
    await sleep(100);
  }
}

const settled = () => !S().busy && !S().anneal && !S().annealPending;

const STEPS = 9;

export function stopDemo() {
  runId++;
  useStore.setState({ demo: null });
}

export async function runDemo() {
  const id = ++runId;
  const cap = (step: number, caption: string, sub?: string) => {
    if (id !== runId) throw new Aborted();
    useStore.setState({ demo: { step, total: STEPS, caption, sub } });
  };
  try {
    const st = S();
    st.set({ view: "command", city: "bengaluru", nOrders: 30, nVehicles: 5, seed: 7, solver: "quantum", follow: false, selectedVehicle: null, mapMode: "none" });

    cap(1, "A morning in Bengaluru", "30 deliveries · 5 vehicles · critical medical, high and standard SLAs");
    await S().loadScenario();
    const morning = JSON.parse(JSON.stringify(S().scenario));
    await hold(3200, id);

    cap(2, "Encoding the fleet as a quantum Hamiltonian", "Allocation and sequencing become QUBOs: one qubit per decision");
    const opt = S().optimize();
    await hold(1500, id);
    await opt;
    cap(3, "Quantum annealing", "Transverse field Γ → 0 · 16 Trotter replicas tunnel to the ground state");
    await waitFor(settled, 30000, id);

    const m = S().plan?.metrics;
    const b = S().baseline?.metrics;
    const save = m && b ? Math.round(((b.cost_inr - m.cost_inr) / b.cost_inr) * 100) : 0;
    S().set({ speed: 4, playing: true });
    cap(4, `Fleet dispatched · ${save}% cheaper than legacy dispatch`, `${m?.on_time_pct.toFixed(0)}% on-time · ${m?.distance_km.toFixed(0)} km · solved in ${((S().plan?.solve_ms ?? 0) / 1000).toFixed(2)} s`);
    await hold(7000, id);

    // breakdown on the busiest vehicle still on the road
    const t = S().simTime;
    const victim = S()
      .plan?.routes.filter((r) => r.stops.some((s) => s.arrival > t + 5))
      .sort((a, b2) => b2.stops.filter((s) => s.arrival > t).length - a.stops.filter((s) => s.arrival > t).length)[0];
    if (victim) {
      cap(5, `Breakdown! ${victim.vehicle_id} is down mid-route`, "Undelivered parcels go back to the quantum allocator, live positions become new start states");
      await hold(1600, id);
      await S().breakdown(victim.vehicle_id);
      await waitFor(settled, 30000, id);
      S().set({ playing: true });
      await hold(4500, id);
    }

    cap(6, "Emergency: a hospital needs supplies in 75 minutes", "A critical order is injected and re-planned in under a second");
    await hold(1400, id);
    await S().addUrgent(77.5905, 12.9352);
    await waitFor(settled, 30000, id);
    S().set({ playing: true });
    await hold(4500, id);

    const busy = S()
      .plan?.routes.filter((r) => r.stops.length)
      .sort((a, b2) => b2.stops.length - a.stops.length)[0];
    if (busy) {
      const [lng, lat] = positionAt(busy, S().simTime + 18);
      cap(7, "Gridlock ahead", "Travel times ×3 inside the red zone: routes are re-sequenced around it");
      await hold(1400, id);
      await S().addTraffic(lng, lat);
      await waitFor(settled, 30000, id);
      S().set({ playing: true });
      await hold(5000, id);
    }

    cap(8, "Inside the quantum engine", "Annealing dynamics · Trotter replicas · QUBO Hamiltonian · Qiskit QAOA");
    S().set({ view: "lab", playing: false });
    await hold(7000, id);

    cap(9, "Benchmarked against Google OR-Tools and legacy dispatch", "Start-of-day plan · same orders, road network and constraints for every solver");
    S().set({ view: "bench" });
    await S().runCompare(morning, "Start-of-day plan · 30 orders");
    await hold(7500, id);

    S().set({ view: "command", playing: true });
    useStore.setState({ demo: { step: STEPS, total: STEPS, caption: "QFLEET · quantum-native fleet intelligence", sub: "Team Nonchalant" } });
    await hold(5000, id);
    useStore.setState({ demo: null });
  } catch (e) {
    if (!(e instanceof Aborted)) {
      useStore.setState({ demo: null });
      S().toast("err", `Demo stopped: ${(e as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Supply Network story: central store → branches, end to end on live data.
const SUPPLY_STEPS = 8;

export async function runSupplyDemo() {
  const { useSupply } = await import("../supply/store");
  const { inv } = await import("../supply/api");
  const id = ++runId;
  const U = () => useSupply.getState();
  const cap = (step: number, caption: string, sub?: string) => {
    if (id !== runId) throw new Aborted();
    useStore.setState({ demo: { step, total: SUPPLY_STEPS, caption, sub } });
  };
  const idle = () => !U().busy && !U().loading;
  try {
    const org = U().orgs.find((o) => o.sector === "healthcare" && o.shared) ?? U().orgs.find((o) => o.my_role === "admin");
    if (!org) throw new Error("no organisation to demo");
    S().set({ view: "supply", playing: false, solver: "quantum" });
    U().set({ role: "central", tab: "overview", drawer: null });
    if (U().orgId !== org.id) await U().selectOrg(org.id);
    const k0 = U().overview?.kpis;
    cap(1, `${org.name}: one central store, ${k0?.branches ?? "many"} sites`,
      `${org.sector_label} in ${org.city_name} · every hospital, clinic and pharmacy is a registered sub-inventory`);
    await hold(4200, id);

    cap(2, "Every site uses stock every day", "When a shelf drops below its reorder point, QFleet raises a request automatically");
    await U().act("day", () => inv.simulateDay(org.id));
    await waitFor(idle, 20000, id);
    await U().refresh(["overview", "reqs", "stock"]);
    await hold(3800, id);

    const pending = U().overview?.kpis.pending ?? 0;
    cap(3, `${pending} requests in · the central store approves`, "Stock is allocated most-urgent first; critical items win when the shelf is short");
    await hold(1500, id);
    if (pending) await U().act("approve", () => inv.approve(org.id));
    await waitFor(idle, 20000, id);
    await U().refresh(["overview", "reqs"]);
    await hold(2500, id);

    cap(4, "QFleet plans the delivery wave", "Stock urgency becomes the deadline in the QUBO · simulated quantum annealing finds the routes");
    await hold(1200, id);
    if ((U().overview?.kpis.approved ?? 0) > 0) await U().dispatch();
    else {
      const latest = U().shipments[0];
      if (latest) await U().watch(latest.id);
    }
    await waitFor(settled, 40000, id);

    const m = S().plan?.metrics;
    await waitFor(() => !!S().baseline, 8000, id);
    const save = S().baseline && m ? Math.round(((S().baseline!.metrics.cost_inr - m.cost_inr) / S().baseline!.metrics.cost_inr) * 100) : null;
    S().set({ speed: 12, playing: true });
    cap(5, `Vans on real roads${save !== null ? ` · ${save}% cheaper than legacy dispatch` : ""}`,
      `${m?.on_time_pct.toFixed(0) ?? 100}% on time · each branch's stock is booked in the moment its van arrives`);
    await hold(9000, id);
    S().set({ speed: 24 });
    await hold(5000, id);

    S().set({ view: "supply", playing: false });
    await U().refresh(["overview", "stock", "reqs", "shipments", "movements"]);
    const k = U().overview?.kpis;
    cap(6, `Shelves restocked · service level ${k ? k.service_level_pct.toFixed(0) : "–"}%`,
      `${k?.delivered ?? 0} requests delivered · ₹${(k?.saved_inr ?? 0).toLocaleString("en-IN")} saved vs legacy dispatch · every unit in the ledger`);
    await hold(5200, id);

    const br = U().stock?.locations.find((l) => l.kind === "hospital") ?? U().stock?.locations.find((l) => l.kind !== "central");
    U().set({ role: "branch", branchId: br?.id ?? null });
    cap(7, "The branch operator's view", `${br?.name ?? "A branch"}: their shelf in days of cover, their requests and the van's ETA`);
    await hold(5200, id);

    U().set({ role: "central", tab: "autopilot" });
    cap(8, "Set the rules once, the network runs itself", "Autopilot approves and dispatches on critical requests, a load threshold or fixed daily waves");
    await hold(6000, id);
    U().set({ tab: "overview" });
    useStore.setState({ demo: null });
  } catch (e) {
    if (!(e instanceof Aborted)) {
      useStore.setState({ demo: null });
      S().toast("err", `Demo stopped: ${(e as Error).message}`);
    }
  }
}
