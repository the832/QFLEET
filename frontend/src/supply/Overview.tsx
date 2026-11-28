import { motion } from "motion/react";
import {
  AlertTriangle, ArrowRight, Atom, Boxes, CheckCircle2, ClipboardCheck, Leaf, PackageCheck, PackagePlus,
  ShieldCheck, Sun, Timer, Truck, Wallet,
} from "lucide-react";
import { useStore } from "../store";
import { useSupply } from "./store";
import { inv } from "./api";
import { ago, CoverBar, inr0, Kpi, lakhs, Spin } from "./ui";

const MOVE_TONE: Record<string, string> = {
  receipt: "text-lime", allocate: "text-cyan", deliver: "text-violet", consume: "text-dim", adjust: "text-amber", return: "text-amber",
};
const MOVE_LABEL: Record<string, string> = {
  receipt: "Received", allocate: "Picked", deliver: "Delivered", consume: "Used", adjust: "Counted", return: "Returned",
};

export function Overview() {
  const s = useSupply();
  const ov = s.overview;
  if (!ov) return <div className="h-full grid place-items-center text-dim text-sm">Loading network…</div>;
  const k = ov.kpis;
  const o = s.orgId!;
  const inTransit = s.shipments.filter((x) => x.status === "in_transit");

  // the next best action lights up, so a first-time user always knows what to press
  // with the autopilot on, approval and dispatch happen by themselves: point at receiving or a new day
  const next = s.auto?.rules.enabled ? (k.in_transit ? 3 : 0) : k.pending ? 1 : k.approved ? 2 : k.in_transit ? 3 : 0;
  const steps = [
    {
      icon: Sun, title: "Branches use stock", count: `${k.low_stock}`, unit: "items below reorder point",
      text: "Every branch burns stock each day. Low cover raises an indent automatically.",
      cta: "Simulate a day", busy: "day",
      run: () => s.act("day", () => inv.simulateDay(o)).then((r) => r && notify(`A day passed: ${r.units_used.toLocaleString("en-IN")} units used, ${r.new_requisitions} new indents`)),
    },
    {
      icon: ClipboardCheck, title: "Central approves", count: `${k.pending}`, unit: "requests awaiting approval",
      text: "Stock is allocated most-urgent first. Critical items win when the shelf is short.",
      cta: `Approve ${k.pending || "all"}`, busy: "approve", disabled: !k.pending,
      run: () => s.act("approve", () => inv.approve(o)).then((r) => r && notify(`${r.approved} approved${r.shortages.length ? ` · ${r.shortages.length} lines part-filled (short stock)` : ""}`)),
    },
    {
      icon: Atom, title: "QFleet plans the wave", count: `${k.approved}`, unit: "ready to dispatch",
      text: "Quantum annealing + ₹ search plan every van's route, deadlines from stock urgency.",
      cta: "Plan & dispatch", busy: "dispatch", disabled: !k.approved, quantum: true,
      run: () => s.dispatch(),
    },
    {
      icon: PackageCheck, title: "Branches receive", count: `${k.in_transit}`, unit: "deliveries on the way",
      text: "Receipt is confirmed at the branch; stock and the ledger update instantly.",
      cta: "Confirm all received", busy: "deliver", disabled: !inTransit.length,
      run: () => s.act("deliver", async () => {
        let n = 0;
        for (const sh of inTransit) n += (await inv.deliver(o, sh.id)).delivered;
        return n;
      }).then((n) => n !== undefined && notify(`${n} deliveries received at branches`)),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* the replenishment loop */}
      <section className="rounded-2xl border border-line bg-gradient-to-br from-cyan/[0.06] via-transparent to-magenta/[0.05] p-4">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="label">The replenishment loop</div>
            <div className="text-sm text-dim mt-0.5">
              {s.auto?.rules.enabled
                ? "Autopilot is on: approvals and dispatch happen by themselves. Simulate a day and watch."
                : "Run the whole network in four clicks. The highlighted step is what to do next."}
            </div>
          </div>
          {!s.auto?.rules.enabled && (
            <button className="text-[11.5px] text-cyan hover:underline" onClick={() => s.set({ tab: "autopilot" })}>Automate steps 2–3 →</button>
          )}
        </div>
        <div className="grid grid-cols-4 gap-3">
          {steps.map((st, i) => {
            const hot = i === next;
            return (
              <motion.div
                key={st.title}
                layout
                className={`relative rounded-xl p-3.5 flex flex-col gap-2 border transition-colors ${
                  hot ? "border-cyan/70 bg-cyan/[0.07] shadow-[0_0_32px_-10px_rgba(0,229,255,0.8)]" : "border-line bg-white/[0.02]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-7 h-7 rounded-lg grid place-items-center text-[12px] font-bold ${hot ? "bg-cyan text-void" : "bg-white/[0.06] text-dim"}`}>{i + 1}</span>
                  <st.icon size={16} className={hot ? "text-cyan" : "text-dim"} />
                  <span className="font-semibold text-[13px]">{st.title}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className={`num text-3xl ${hot ? "text-cyan" : "text-ink"}`}>{st.count}</span>
                  <span className="text-[11px] text-dim leading-tight">{st.unit}</span>
                </div>
                <p className="text-[11.5px] text-faint leading-snug flex-1">{st.text}</p>
                <button
                  className={st.quantum ? "btn-quantum !text-[11px] !py-2 justify-center inline-flex items-center gap-2" : `btn justify-center ${hot ? "btn-active" : ""}`}
                  disabled={!!s.busy || st.disabled}
                  onClick={st.run}
                >
                  <Spin on={s.busy === st.busy}>{st.quantum ? <Atom size={14} /> : <ArrowRight size={14} />}</Spin>
                  {s.busy === st.busy && st.quantum ? "ANNEALING…" : st.quantum ? st.cta.toUpperCase() : st.cta}
                </button>
                {i < 3 && <ArrowRight size={14} className="absolute -right-[11px] top-1/2 -translate-y-1/2 text-faint z-10" />}
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* KPIs */}
      <section className="grid grid-cols-6 gap-2.5">
        <Kpi icon={ShieldCheck} label="Service level" value={`${k.service_level_pct.toFixed(0)}%`}
          tone={k.service_level_pct >= 85 ? "text-lime" : k.service_level_pct >= 65 ? "text-amber" : "text-danger"}
          sub="branch items above reorder point" hint="Share of branch stock lines with at least the reorder-point days of cover" />
        <Kpi icon={AlertTriangle} label="Critical items low" value={k.critical_low} tone={k.critical_low ? "text-danger" : "text-lime"}
          sub={`${k.low_stock} items low in total`} />
        <Kpi icon={Boxes} label="Inventory value" value={lakhs(k.inventory_value_inr)} sub={`${k.skus} SKUs · ${k.branches} branches`} />
        <Kpi icon={Wallet} label="Saved by QFleet" value={inr0(k.saved_inr)} tone="text-lime"
          sub={k.shipments ? `vs legacy dispatch · ${k.shipments} waves` : "dispatch a wave to start"} />
        <Kpi icon={Leaf} label="CO₂ avoided" value={`${k.co2_saved_kg.toFixed(1)} kg`} tone="text-cyan" sub="vs legacy routes" />
        <Kpi icon={Timer} label="On-time delivery" value={k.on_time_pct === null ? "—" : `${k.on_time_pct.toFixed(0)}%`}
          tone="text-lime" sub={`${k.delivered} requests delivered`} />
      </section>

      <section className="grid grid-cols-[1.35fr_1fr] gap-3 min-h-0">
        {/* alerts */}
        <div className="rounded-2xl border border-line bg-white/[0.02] p-4 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <div className="label">Stock-out risk · most urgent first</div>
            <button className="text-[11px] text-cyan hover:underline" onClick={() => s.set({ tab: "stock" })}>Open stock matrix →</button>
          </div>
          {ov.alerts.length === 0 ? (
            <div className="flex items-center gap-2 text-lime text-sm py-6 justify-center"><CheckCircle2 size={16} /> Every branch is above its reorder point</div>
          ) : (
            <div className="flex flex-col divide-y divide-line/60 max-h-[310px] overflow-y-auto pr-1">
              {ov.alerts.slice(0, 18).map((a) => (
                <div key={`${a.location_id}-${a.product_id}`} className="grid grid-cols-[1fr_120px_86px] gap-3 items-center py-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate">
                      {a.critical && <span className="text-danger mr-1">●</span>}{a.product}
                    </div>
                    <div className="text-[11px] text-faint truncate">{a.location}</div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <CoverBar cover={a.cover_days} />
                    <span className={`text-[10.5px] ${a.cover_days < 1 ? "text-danger" : "text-amber"}`}>{a.cover_days.toFixed(1)} days left</span>
                  </div>
                  <div className="text-right text-[11px]">
                    {a.on_order ? <span className="text-violet">{a.on_order} on order</span> : <span className="text-faint">not ordered</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 min-w-0">
          {/* central store */}
          <div className="rounded-2xl border border-line bg-white/[0.02] p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="label">Central store watch</div>
              <button className="btn !py-1 !px-2 !text-[11px]" onClick={() => s.set({ drawer: { kind: "receive" } })}><PackagePlus size={13} /> Receive stock</button>
            </div>
            {ov.central_short.length === 0 ? (
              <div className="text-[12px] text-dim">Central shelves hold more than 5 days of network demand for every SKU.</div>
            ) : (
              ov.central_short.map((c) => (
                <div key={c.product_id} className="flex items-center gap-3 py-1.5">
                  <AlertTriangle size={14} className={c.critical ? "text-danger" : "text-amber"} />
                  <div className="flex-1 min-w-0 text-[13px] truncate">{c.product} <span className="text-faint">· {c.qty} left</span></div>
                  <span className={`num text-[12px] ${c.cover_days < 2 ? "text-danger" : "text-amber"}`}>{c.cover_days}d</span>
                  <button className="text-[11px] text-cyan hover:underline" onClick={() => s.set({ drawer: { kind: "receive", productId: c.product_id } })}>Restock</button>
                </div>
              ))
            )}
          </div>
          {/* activity */}
          <div className="rounded-2xl border border-line bg-white/[0.02] p-4 flex-1 min-h-0">
            <div className="flex items-center justify-between mb-2">
              <div className="label">Live ledger</div>
              <button className="text-[11px] text-cyan hover:underline" onClick={() => s.set({ tab: "ledger" })}>All movements →</button>
            </div>
            <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto pr-1">
              {ov.movements.length === 0 && <div className="text-[12px] text-dim">No movements yet.</div>}
              {ov.movements.map((m) => (
                <div key={m.id} className="flex items-center gap-2 text-[12px]">
                  <span className={`w-16 shrink-0 font-semibold ${MOVE_TONE[m.kind]}`}>{MOVE_LABEL[m.kind]}</span>
                  <span className="flex-1 min-w-0 truncate text-dim">{m.product} <span className="text-faint">· {m.location}</span></span>
                  <span className={`num ${m.delta > 0 ? "text-lime" : "text-dim"}`}>{m.delta > 0 ? "+" : ""}{m.delta}</span>
                  <span className="text-faint w-14 text-right shrink-0">{ago(m.at)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {ov.recent_shipments.length > 0 && (
        <section className="rounded-2xl border border-line bg-white/[0.02] p-4">
          <div className="label mb-2">Recent dispatch waves</div>
          <div className="grid grid-cols-3 gap-2.5">
            {ov.recent_shipments.slice(0, 3).map((sh) => (
              <button key={sh.id} onClick={() => s.watch(sh.id)}
                className="text-left rounded-xl border border-line hover:border-cyan/60 bg-white/[0.02] p-3 transition-colors group">
                <div className="flex items-center gap-2">
                  <Truck size={14} className="text-cyan" />
                  <span className="font-semibold text-[13px]">{sh.code}</span>
                  <span className="text-[11px] text-faint">{ago(sh.created_at)}</span>
                  <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wider ${sh.status === "completed" ? "text-lime" : "text-violet"}`}>{sh.status === "completed" ? "Delivered" : "On the way"}</span>
                </div>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="num text-lg">{inr0(sh.cost_inr)}</span>
                  <span className="text-[11px] text-lime">−{inr0(sh.saved_inr)} vs legacy</span>
                </div>
                <div className="text-[11px] text-faint mt-0.5">{sh.stops} stops · {sh.vehicles_used} vehicles · {sh.distance_km.toFixed(0)} km · <span className="text-cyan group-hover:underline">watch on map</span></div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function notify(text: string) {
  useStore.getState().toast("ok", text);
}
