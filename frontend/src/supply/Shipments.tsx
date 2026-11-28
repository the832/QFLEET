import { Atom, Check, Leaf, MapPinned, Route, Timer, Truck, Wallet } from "lucide-react";
import { useStore } from "../store";
import { inv } from "./api";
import { useSupply } from "./store";
import { TriggerBadge } from "./Autopilot";
import { ago, Empty, inr0, Spin } from "./ui";

export function Shipments() {
  const s = useSupply();
  const o = s.orgId!;
  const meta = useStore((x) => x.meta);
  if (!s.shipments.length)
    return (
      <Empty icon={Truck} title="No dispatch waves yet"
        text="Approve some requests, then press Plan & dispatch. QFleet plans every vehicle's route with quantum annealing and you can watch it on the live map."
        action={<button className="btn btn-active" onClick={() => s.set({ tab: "overview" })}>Go to the replenishment loop</button>} />
    );
  const total = s.shipments.reduce((a, x) => ({ cost: a.cost + x.cost_inr, legacy: a.legacy + x.legacy_cost_inr, co2: a.co2 + (x.legacy_co2_kg - x.co2_kg) }), { cost: 0, legacy: 0, co2: 0 });
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-lime/25 bg-lime/[0.04] px-4 py-3 flex items-center gap-6 flex-wrap">
        <div><div className="label">Logistics spend</div><div className="num text-xl">{inr0(total.cost)}</div></div>
        <div><div className="label">Legacy dispatch would cost</div><div className="num text-xl text-dim line-through decoration-danger/60">{inr0(total.legacy)}</div></div>
        <div><div className="label">Saved by QFleet</div><div className="num text-xl text-lime">{inr0(total.legacy - total.cost)} <span className="text-sm">({total.legacy ? (((total.legacy - total.cost) / total.legacy) * 100).toFixed(0) : 0}%)</span></div></div>
        <div><div className="label">CO₂ avoided</div><div className="num text-xl text-cyan">{total.co2.toFixed(1)} kg</div></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {s.shipments.map((sh) => {
          const pct = sh.legacy_cost_inr ? (sh.saved_inr / sh.legacy_cost_inr) * 100 : 0;
          const solver = meta?.solvers?.[sh.solver]?.short ?? sh.solver;
          return (
            <div key={sh.id} className="rounded-2xl border border-line bg-white/[0.02] p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl grid place-items-center bg-cyan/10 text-cyan"><Truck size={17} /></div>
                <div>
                  <div className="font-semibold num">{sh.code}</div>
                  <div className="text-[11px] text-faint">{ago(sh.created_at)} · {solver}{sh.qubits ? ` · ${sh.qubits} qubits` : ""} · solved in {(sh.solve_ms / 1000).toFixed(1)} s</div>
                </div>
                {sh.trigger !== "manual" && <span className="ml-auto"><TriggerBadge t={sh.trigger} /></span>}
                <span className={`${sh.trigger !== "manual" ? "" : "ml-auto "}px-2 py-0.5 rounded-full border text-[11px] font-semibold ${sh.status === "completed" ? "text-lime border-lime/30 bg-lime/10" : "text-violet border-violet/30 bg-violet/10"}`}>
                  {sh.status === "completed" ? "All delivered" : "On the way"}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <Stat icon={Wallet} k="Route cost" v={inr0(sh.cost_inr)} />
                <Stat icon={Atom} k="Saved vs legacy" v={`${pct.toFixed(0)}%`} tone="text-lime" />
                <Stat icon={Route} k="Distance" v={`${sh.distance_km.toFixed(0)} km`} />
                <Stat icon={Timer} k="On time" v={`${sh.on_time_pct.toFixed(0)}%`} tone={sh.on_time_pct >= 99 ? "text-lime" : "text-amber"} />
              </div>
              <div className="text-[11.5px] text-dim flex items-center gap-3">
                <span>{sh.stops} branch drops</span><span>{sh.vehicles_used} vehicles</span>
                <span className="flex items-center gap-1 text-cyan"><Leaf size={12} /> −{(sh.legacy_co2_kg - sh.co2_kg).toFixed(1)} kg CO₂</span>
              </div>
              <div className="flex gap-2">
                <button className="btn flex-1 justify-center" disabled={!!s.busy} onClick={() => s.watch(sh.id)}>
                  <Spin on={s.busy === "watch"}><MapPinned size={14} /></Spin> Watch on live map
                </button>
                {sh.status === "in_transit" && (
                  <button className="btn btn-active flex-1 justify-center" disabled={!!s.busy}
                    onClick={() => s.act("deliver", () => inv.deliver(o, sh.id)).then((r) => r && useStore.getState().toast("ok", `${r.delivered} deliveries received`))}>
                    <Spin on={s.busy === "deliver"}><Check size={14} /></Spin> Confirm all received
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, k, v, tone = "text-ink" }: { icon: typeof Truck; k: string; v: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-2.5 py-2">
      <div className="flex items-center gap-1 label !text-[8.5px]"><Icon size={11} />{k}</div>
      <div className={`num text-[15px] mt-0.5 ${tone}`}>{v}</div>
    </div>
  );
}
