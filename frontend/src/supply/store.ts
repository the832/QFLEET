import { create } from "zustand";
import { authEnabled, currentUser, initAuth, signIn, signOut, signUp, type AuthUser } from "../lib/auth";
import { useStore } from "../store";
import { inv } from "./api";
import type { AutoStatus, InvStatus, Movement, Org, Overview, Requisition, Shipment, StockMatrix, Templates } from "./types";

export type Tab = "overview" | "requests" | "stock" | "network" | "shipments" | "ledger" | "autopilot" | "team";
export type Role = "central" | "branch";

interface SupplyState {
  booted: boolean;
  status: InvStatus | null;
  user: AuthUser | null;
  needsSignIn: boolean;
  orgs: Org[];
  orgId: number | null;
  role: Role;
  branchId: number | null;
  tab: Tab;
  overview: Overview | null;
  stock: StockMatrix | null;
  reqs: Requisition[];
  shipments: Shipment[];
  movements: Movement[];
  templates: Templates | null;
  /** autopilot status (main operator only), polled while the Supply view is open */
  auto: AutoStatus | null;
  /** latest automatic wave to announce in the header */
  autoBanner: { id: number; code: string; trigger: string; saved: number } | null;
  loading: boolean;
  /** label of the action in flight (disables buttons, shows spinners) */
  busy: string | null;
  drawer: null | { kind: "request"; locationId?: number } | { kind: "branch" } | { kind: "org" } | { kind: "cell"; locationId: number; productId: number } | { kind: "receive"; productId?: number };

  set: (p: Partial<SupplyState>) => void;
  boot: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  loadOrgs: () => Promise<void>;
  selectOrg: (id: number) => Promise<void>;
  refresh: (parts?: ("overview" | "stock" | "reqs" | "shipments" | "movements")[]) => Promise<void>;
  act: <T>(label: string, fn: () => Promise<T>, after?: ("overview" | "stock" | "reqs" | "shipments" | "movements")[]) => Promise<T | undefined>;
  dispatch: (ids?: number[]) => Promise<void>;
  watch: (shipmentId: number) => Promise<void>;
  /** the signed-in user's role in the current organisation */
  myRole: () => "admin" | "branch";
  pollAuto: () => Promise<void>;
}

const toast = (kind: "ok" | "warn" | "err" | "quantum", text: string) => useStore.getState().toast(kind, text);
const ORG_KEY = "qfleet.org";
let booting = false;

export const useSupply = create<SupplyState>((set, get) => ({
  booted: false,
  status: null,
  user: null,
  needsSignIn: false,
  orgs: [],
  orgId: null,
  role: "central",
  branchId: null,
  tab: "overview",
  overview: null,
  stock: null,
  reqs: [],
  shipments: [],
  movements: [],
  templates: null,
  auto: null,
  autoBanner: null,
  loading: false,
  busy: null,
  drawer: null,

  set: (p) => set(p as SupplyState),

  boot: async () => {
    if (booting) return;
    booting = true;
    try {
      const status = await inv.status();
      initAuth(status.auth ? status.auth_url : null);
      const user = status.auth ? await currentUser() : null;
      set({ status, user, needsSignIn: status.auth && !user, booted: true });
      if (!status.auth || user) await get().loadOrgs();
    } catch (e) {
      set({ booted: true });
      toast("err", `Supply network offline: ${(e as Error).message}`);
    }
  },

  signIn: async (email, password) => {
    const user = await signIn(email, password);
    set({ user, needsSignIn: !user });
    if (user) {
      toast("ok", `Signed in as ${user.email ?? user.name}`);
      await get().loadOrgs();
    }
  },

  signUp: async (name, email, password) => {
    const user = await signUp(name, email, password);
    set({ user, needsSignIn: !user });
    if (user) {
      toast("ok", `Welcome to QFleet, ${user.name ?? user.email}`);
      await get().loadOrgs();
    }
  },

  signOut: async () => {
    await signOut();
    set({ user: null, needsSignIn: authEnabled(), orgs: [], orgId: null, overview: null, stock: null, reqs: [], shipments: [], movements: [] });
  },

  loadOrgs: async () => {
    try {
      const [orgs, templates] = await Promise.all([inv.orgs(), inv.templates()]);
      set({ orgs, templates });
      let saved: number | null = null;
      try {
        saved = Number(localStorage.getItem(ORG_KEY)) || null;
      } catch {
        /* storage unavailable */
      }
      const pick = orgs.find((o) => o.id === saved) ?? orgs[0];
      if (pick) await get().selectOrg(pick.id);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) set({ needsSignIn: true, user: null });
      else toast("err", `Could not load organisations: ${(e as Error).message}`);
    }
  },

  selectOrg: async (id) => {
    try {
      localStorage.setItem(ORG_KEY, String(id));
    } catch {
      /* storage unavailable */
    }
    const org = get().orgs.find((o) => o.id === id);
    const branchOnly = org?.my_role === "branch";
    set({
      orgId: id, overview: null, stock: null, reqs: [], shipments: [], movements: [], auto: null, autoBanner: null,
      branchId: branchOnly ? org!.my_location_id : null, role: branchOnly ? "branch" : "central", loading: true,
      tab: branchOnly ? "overview" : get().tab === "team" || get().tab === "autopilot" ? get().tab : "overview",
    });
    await get().refresh(["overview", "stock", "reqs", "shipments", "movements"]);
    if (!branchOnly) {
      const first = get().stock?.locations.find((l) => l.kind !== "central");
      set({ branchId: first?.id ?? null });
      void get().pollAuto();
    }
    set({ loading: false });
  },

  refresh: async (parts = ["overview", "reqs", "shipments"]) => {
    const o = get().orgId;
    if (!o) return;
    const jobs: Promise<void>[] = [];
    if (parts.includes("overview") && get().myRole() === "admin") jobs.push(inv.overview(o).then((overview) => set({ overview })));
    if (parts.includes("stock")) jobs.push(inv.stock(o).then((stock) => set({ stock })));
    if (parts.includes("reqs")) jobs.push(inv.requisitions(o).then((reqs) => set({ reqs })));
    if (parts.includes("shipments")) jobs.push(inv.shipments(o).then((shipments) => set({ shipments })));
    if (parts.includes("movements")) jobs.push(inv.movements(o).then((movements) => set({ movements })));
    try {
      await Promise.all(jobs);
    } catch (e) {
      toast("err", `Refresh failed: ${(e as Error).message}`);
    }
  },

  act: async (label, fn, after = ["overview", "stock", "reqs", "shipments", "movements"]) => {
    if (get().busy) return undefined;
    set({ busy: label });
    try {
      const out = await fn();
      // return as soon as the server confirms; fresh numbers stream in right after
      set({ busy: null });
      if (after.length) void get().refresh(after);
      return out;
    } catch (e) {
      set({ busy: null });
      toast("err", (e as Error).message);
      return undefined;
    }
  },

  dispatch: async (ids) => {
    const o = get().orgId;
    if (!o) return;
    const solver = useStore.getState().solver === "leap" ? "quantum" : useStore.getState().solver;
    const ship = await get().act("dispatch", () => inv.dispatch(o, ids, solver));
    if (!ship) return;
    const saved = ship.legacy_cost_inr - ship.cost_inr;
    toast(
      "quantum",
      `${ship.code}: ${ship.dispatched} deliveries planned · ₹${Math.round(saved).toLocaleString("en-IN")} cheaper than legacy dispatch`,
    );
    if (ship.held_back) toast("warn", `${ship.held_back} requests held back: over fleet capacity today`);
    if (ship.scenario && ship.plan) useStore.getState().watchPlan(ship.scenario, ship.plan, `${ship.code} dispatched`);
  },

  watch: async (sid) => {
    const o = get().orgId;
    if (!o) return;
    const ship = await get().act("watch", () => inv.shipment(o, sid), []);
    if (ship?.scenario && ship.plan) useStore.getState().watchPlan(ship.scenario, ship.plan, `${ship.code} on the live map`);
  },

  myRole: () => get().orgs.find((o) => o.id === get().orgId)?.my_role ?? "admin",

  pollAuto: async () => {
    const o = get().orgId;
    if (!o || get().myRole() !== "admin") return;
    try {
      const prev = get().auto;
      const auto = await inv.automation(o);
      if (get().orgId !== o) return;
      set({ auto });
      // a wave the autopilot sent since we last looked: announce it and pull fresh numbers
      const newest = auto.auto_waves[0];
      if (prev && newest && auto.latest_shipment_id !== prev.latest_shipment_id && newest.id === auto.latest_shipment_id) {
        set({ autoBanner: { id: newest.id, code: newest.code, trigger: newest.trigger, saved: newest.saved_inr } });
        toast("quantum", `Autopilot dispatched ${newest.code} · ${TRIGGER_TEXT[newest.trigger] ?? newest.trigger}`);
        void get().refresh(["overview", "stock", "reqs", "shipments", "movements"]);
      } else if (prev && (prev.pending !== auto.pending || prev.approved !== auto.approved)) {
        void get().refresh(["overview", "reqs"]);
      }
    } catch {
      /* transient: next poll retries */
    }
  },
}));

export const TRIGGER_TEXT: Record<string, string> = {
  manual: "dispatched by hand",
  critical: "a critical request was waiting",
  load: "approved load reached the threshold",
  schedule: "scheduled wave",
};

// poll the autopilot every 5 s while the Supply Network is on screen
setInterval(() => {
  if (typeof document !== "undefined" && document.hidden) return;
  if (useStore.getState().view !== "supply") return;
  void useSupply.getState().pollAuto();
}, 5000);

// ---------------------------------------------------------------------------
// Live receipt: while a Supply Network dispatch plays on the map, each branch's
// request is confirmed the moment its van has dropped everything there, so stock
// levels and the ledger in Neon move in step with the simulation.
const confirmed = new Set<string>();
let lastCheck = 0;
useStore.subscribe((st) => {
  const src = (st.scenario as unknown as { source?: { kind: string; org_id: number; shipment_id?: number } })?.source;
  if (!st.plan || !src || src.kind !== "inventory" || !src.shipment_id) return;
  const t = performance.now();
  if (t - lastCheck < 700) return;
  lastCheck = t;
  const sup = useSupply.getState();
  if (sup.orgId !== src.org_id || sup.busy) return;
  const total = new Map<string, number>();
  const arrived = new Map<string, number>();
  for (const r of st.plan.routes)
    for (const stop of r.stops) {
      const code = stop.order_id.split("/")[0];
      total.set(code, (total.get(code) ?? 0) + 1);
      if (stop.arrival <= st.simTime) arrived.set(code, (arrived.get(code) ?? 0) + 1);
    }
  const key = (c: string) => `${src.shipment_id}:${c}`;
  const ready = [...total].filter(([c, n]) => arrived.get(c) === n && !confirmed.has(key(c))).map(([c]) => c);
  if (!ready.length) return;
  ready.forEach((c) => confirmed.add(key(c)));
  const reqs = sup.reqs.filter((r) => ready.includes(r.code) && r.status === "dispatched");
  if (!reqs.length) return;
  inv.deliver(src.org_id, src.shipment_id, reqs.map((r) => r.id))
    .then(() => {
      for (const r of reqs) {
        useStore.getState().log({ t: st.simTime, kind: "info", title: `${r.code} received`, detail: `${r.location} · ${r.lines.length} products booked into stock` });
      }
      toast("ok", reqs.length === 1 ? `${reqs[0].code} received at ${reqs[0].location} · stock updated` : `${reqs.length} branches received their stock`);
      return useSupply.getState().refresh(["overview", "stock", "reqs", "shipments", "movements"]);
    })
    .catch(() => ready.forEach((c) => confirmed.delete(key(c))));
});
