import { motion } from "motion/react";
import { Leaf, Clock3, IndianRupee, Route as RouteIcon, ShieldCheck, Truck, Gauge, Wrench, Zap, TrendingUp, Video, VideoOff } from "lucide-react";
import { useStore } from "../store";
import { clock, fmt, inr, pctDelta, rgba, vehicleState } from "../lib/sim";
import type { Metrics } from "../types";

const OPERATING_DAYS = 300;
const KG_CO2_PER_TREE_YEAR = 21;

export function lakh(v: number) {
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  return `₹${(v / 1e5).toFixed(1)} L`;
}

export function yearlyImpact(m?: Metrics, b?: Metrics) {
  if (!m || !b) return null;
  const rupees = (b.cost_inr - m.cost_inr) * OPERATING_DAYS;
  const co2t = ((b.co2_kg - m.co2_kg) * OPERATING_DAYS) / 1000;
  const trees = Math.round((co2t * 1000) / KG_CO2_PER_TREE_YEAR);
  const hours = (b.fleet_hours - m.fleet_hours) * OPERATING_DAYS;
  return { rupees, co2t, trees, hours };
}

function Delta({ v, invert = false }: { v: number | null; invert?: boolean }) {
  if (v === null || !Number.isFinite(v) || Math.abs(v) < 0.05) return null;
  const good = invert ? v > 0 : v < 0;
  return (
    <span className={`num text-[10px] font-semibold ${good ? "text-lime" : "text-danger"}`}>
      {v > 0 ? "▲" : "▼"} {Math.abs(v).toFixed(0)}%
    </span>
  );
}

const ACCENT: Record<string, string> = {
  cyan: "text-cyan",
  violet: "text-violet",
  magenta: "text-magenta",
  lime: "text-lime",
  amber: "text-amber",
};

function Kpi({
  icon: Icon,
  label,
  value,
  unit,
  delta,
  invert,
  accent = "cyan",
}: {
  icon: typeof Truck;
  label: string;
  value: string;
  unit?: string;
  delta?: number | null;
  invert?: boolean;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.025] p-3 relative overflow-hidden">
      <div className="flex items-center justify-between gap-1">
        <span className="label flex items-center gap-1.5 truncate">
          <Icon size={12} className={ACCENT[accent]} />
          {label}
        </span>
        <Delta v={delta ?? null} invert={invert} />
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <motion.span
          key={value}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="num text-[22px] font-semibold text-ink"
        >
          {value}
        </motion.span>
        {unit && <span className="text-[11px] text-dim">{unit}</span>}
      </div>
    </div>
  );
}

export function MissionPanel() {
  const mobileOpen = useStore((st) => st.mobileMetrics);
  const plan = useStore((s) => s.plan);
  const baseline = useStore((s) => s.baseline);
  const scenario = useStore((s) => s.scenario);
  const simTime = useStore((s) => s.simTime);
  const selected = useStore((s) => s.selectedVehicle);
  const set = useStore((s) => s.set);
  const breakdown = useStore((s) => s.breakdown);
  const busy = useStore((s) => s.busy);
  const planStart = useStore((s) => s.planStart);
  const follow = useStore((s) => s.follow);

  const m: Metrics | undefined = plan?.metrics;
  const b: Metrics | undefined = baseline?.metrics;
  const d = (k: keyof Metrics) => (m && b && plan?.solver !== "greedy" ? pctDelta(m[k] as number, b[k] as number) : null);

  const totalStops = plan?.routes.reduce((a, r) => a + r.stops.length, 0) ?? 0;
  const doneStops = plan?.routes.reduce((a, r) => a + r.stops.filter((s) => s.arrival <= simTime).length, 0) ?? 0;
  const deliveredBefore = scenario?.orders.filter((o) => o.status === "delivered").length ?? 0;
  const quantum = plan?.family === "quantum";

  return (
    <aside className={`absolute right-3 top-20 bottom-4 z-20 w-[330px] 2xl:w-[350px] flex flex-col gap-3 pointer-events-none overflow-y-auto overscroll-contain no-scrollbar max-md:left-2 max-md:right-2 max-md:w-auto max-md:top-[96px] max-md:bottom-[150px] max-md:z-[25] max-md:pointer-events-auto max-md:rounded-2xl max-md:bg-[#03040a]/92 max-md:backdrop-blur-md ${mobileOpen ? "" : "max-md:hidden"}`}>
      <div className="relative glass hud rounded-2xl p-4 pointer-events-auto shrink-0">
        <div className="flex items-center justify-between">
          <span className="label whitespace-nowrap">Mission metrics {planStart > 0 && <span className="text-amber">· from {clock(planStart)}</span>}</span>
          {plan && (
            <span
              className={`text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-md border whitespace-nowrap ${
                quantum ? "border-cyan/50 text-cyan bg-cyan/10 shadow-[0_0_14px_-3px_rgba(0,229,255,0.8)]" : "border-white/20 text-dim"
              }`}
            >
              {quantum && <Zap size={10} className="inline -mt-0.5 mr-1" />}
              {plan.solver_short.toUpperCase()}
            </span>
          )}
        </div>
        {!m ? (
          <div className="mt-4 text-sm text-dim leading-relaxed">
            {scenario ? (
              <>
                <span className="text-ink font-semibold">{scenario.orders.length} deliveries</span> waiting across{" "}
                {scenario.city_name} with <span className="text-ink font-semibold">{scenario.vehicles.length} vehicles</span>.
                <br />
                Press <span className="text-cyan font-semibold">OPTIMIZE FLEET</span> to run the quantum planner.
              </>
            ) : (
              "Loading operations…"
            )}
          </div>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Kpi icon={IndianRupee} label="Op. cost" value={inr(m.cost_inr)} delta={d("cost_inr")} />
              <Kpi icon={RouteIcon} label="Distance" value={fmt(m.distance_km, 1)} unit="km" delta={d("distance_km")} accent="violet" />
              <Kpi icon={Clock3} label="Turnaround" value={fmt(m.avg_turnaround_min, 0)} unit="min" delta={d("avg_turnaround_min")} accent="magenta" />
              <Kpi icon={ShieldCheck} label="On-time" value={fmt(m.on_time_pct, 0)} unit="%" delta={d("on_time_pct")} invert accent="lime" />
              <Kpi icon={Leaf} label="CO₂" value={fmt(m.co2_kg, 1)} unit="kg" delta={d("co2_kg")} accent="lime" />
              <Kpi icon={Gauge} label="Utilisation" value={fmt(m.avg_utilization_pct, 0)} unit="%" accent="amber" />
            </div>
            {b && plan?.solver !== "greedy" && (
              <div className="mt-2 text-[10px] text-faint">Δ vs legacy rule-based dispatch on the same orders</div>
            )}
            {(() => {
              const imp = plan?.solver !== "greedy" ? yearlyImpact(m, b) : null;
              if (!imp || imp.rupees <= 0) return null;
              return (
                <div className="mt-2 rounded-xl border border-lime/30 bg-lime/[0.05] px-3 py-2 flex items-center gap-3">
                  <TrendingUp size={16} className="text-lime shrink-0" />
                  <div className="min-w-0">
                    <div className="label !text-[9px] !text-lime/80">Projected yearly impact · {OPERATING_DAYS} days</div>
                    <div className="num text-[12px] text-ink mt-0.5 truncate">
                      {lakh(imp.rupees)} saved · {imp.co2t.toFixed(1)} t CO₂ · ≈{imp.trees.toLocaleString("en-IN")} trees
                    </div>
                  </div>
                </div>
              );
            })()}
            <div className="mt-3">
              <div className="flex justify-between text-[11px]">
                <span className="text-dim">Deliveries completed</span>
                <span className="num text-ink">
                  {deliveredBefore + doneStops}/{deliveredBefore + totalStops}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan to-lime transition-[width] duration-300"
                  style={{ width: `${((deliveredBefore + doneStops) / Math.max(1, deliveredBefore + totalStops)) * 100}%` }}
                />
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-dim">
                <span>
                  Fleet back by <span className="num text-ink">{clock(m.makespan_min)}</span>
                </span>
                <span>
                  solved in <span className="num text-cyan">{(plan!.solve_ms / 1000).toFixed(2)}s</span>
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="glass rounded-2xl p-3 flex-1 min-h-[250px] flex flex-col pointer-events-auto">
        <div className="flex items-center justify-between px-1">
          <span className="label">Fleet · {scenario?.vehicles.length ?? 0} vehicles</span>
          <span className="text-[10px] text-faint">click to focus</span>
        </div>
        <div className="mt-2 flex-1 overflow-y-auto pr-1 flex flex-col gap-1.5">
          {scenario?.vehicles.map((v) => {
            const r = plan?.routes.find((x) => x.vehicle_id === v.id);
            const broken = v.status === "breakdown";
            const state = broken ? "down" : r ? vehicleState(r, simTime) : "idle";
            const done = r ? r.stops.filter((s) => s.arrival <= simTime).length : 0;
            const n = r?.stops.length ?? 0;
            const sel = selected === v.id;
            const canBreak = !!plan && !broken && !!r && n - done > 0 && !busy;
            const stateColor =
              state === "down" ? "text-danger" : state === "driving" ? "text-cyan" : state === "servicing" ? "text-amber" : state === "returned" ? "text-lime" : "text-faint";
            return (
              <div
                key={v.id}
                onClick={() => set({ selectedVehicle: sel ? null : v.id })}
                className={`group rounded-xl border px-3 py-2 cursor-pointer transition-all ${
                  sel ? "border-cyan/60 bg-cyan/[0.07]" : "border-line hover:border-white/20 bg-white/[0.015]"
                } ${broken ? "!border-danger/50 !bg-danger/[0.06]" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: rgba(v.color), boxShadow: `0 0 10px ${rgba(v.color, 0.9)}` }} />
                  <span className="num text-[13px] font-semibold">{v.id}</span>
                  <span className="text-[11px] text-dim truncate">{v.label}</span>
                  <span className={`ml-auto text-[10px] font-bold tracking-wider uppercase ${stateColor}`}>{state}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(r?.utilization ?? 0) * 100}%`, background: rgba(v.color, 0.85) }} />
                  </div>
                  <span className="num text-[10px] text-dim w-[92px] text-right">
                    {r ? `${Math.round(r.load)}/${v.capacity}kg` : `0/${v.capacity}kg`}
                  </span>
                </div>
                <div className="mt-1 flex items-center text-[10px] text-dim gap-3">
                  <span className="num">
                    {done}/{n} stops
                  </span>
                  {r && n > 0 && <span className="num">{fmt(r.distance_km, 1)} km</span>}
                  {r && n > 0 && <span className="num">hub {clock(r.return_time)}</span>}
                  <span className="ml-auto flex gap-1 opacity-70 group-hover:opacity-100">
                    <button
                      className={`p-1 rounded hover:bg-white/10 ${sel && follow ? "text-cyan" : ""}`}
                      title="Follow with camera (F)"
                      disabled={!r || !n || broken}
                      onClick={(e) => {
                        e.stopPropagation();
                        const on = !(sel && follow);
                        set({ selectedVehicle: v.id, follow: on, playing: on ? true : useStore.getState().playing });
                      }}
                    >
                      {sel && follow ? <VideoOff size={12} /> : <Video size={12} />}
                    </button>
                    <button
                      className="p-1 rounded hover:bg-danger/20 text-danger disabled:opacity-25 disabled:hover:bg-transparent"
                      title={canBreak ? "Simulate breakdown now" : "Nothing left to deliver"}
                      disabled={!canBreak}
                      onClick={(e) => {
                        e.stopPropagation();
                        breakdown(v.id);
                      }}
                    >
                      <Wrench size={12} />
                    </button>
                  </span>
                </div>
                {sel && r && n > 0 && (
                  <div className="mt-2 pt-2 border-t border-line max-h-[170px] overflow-y-auto flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                    {r.stops.map((st, i) => {
                      const done = st.arrival <= simTime;
                      const next = !done && (i === 0 || r.stops[i - 1].arrival <= simTime);
                      return (
                        <div key={st.order_id} className={`flex items-center gap-2 text-[11px] ${done ? "opacity-45" : ""}`}>
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${done ? "bg-lime" : next ? "bg-cyan pulse-dot text-cyan" : "bg-white/25"}`}
                          />
                          <span className="num text-dim w-10">{clock(st.arrival)}</span>
                          <span className="truncate flex-1 text-ink/90">{st.customer}</span>
                          <span
                            className="text-[9px] font-bold uppercase"
                            style={{ color: st.priority === "critical" ? "#ff3d6e" : st.priority === "high" ? "#ffc400" : "#78c8ff" }}
                          >
                            {st.priority[0]}
                          </span>
                          {st.late_min > 0.5 && <span className="text-[9px] text-danger num">+{Math.round(st.late_min)}m</span>}
                        </div>
                      );
                    })}
                    <div className="flex justify-between text-[10px] text-faint num mt-1">
                      <span>₹{Math.round(r.cost)} · {r.co2.toFixed(1)} kg CO₂</span>
                      <span>{Math.round(r.duration_min)} min shift</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
