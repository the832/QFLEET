import { Bar, BarChart, CartesianGrid, Legend, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Eye, Leaf, Loader2, Sparkles, Timer, TreePine, Trophy, Wallet } from "lucide-react";
import { lakh, yearlyImpact } from "../components/MissionPanel";
import { useStore } from "../store";
import { fmt, inr } from "../lib/sim";
import type { Metrics, PlanResult } from "../types";

const ORDER = ["quantum", "ortools", "sa", "greedy", "leap"];
const COLORS: Record<string, string> = { quantum: "#00e5ff", ortools: "#ffc400", sa: "#9d7bff", greedy: "#ff3dac", leap: "#8cff5c" };
const tooltipStyle = {
  contentStyle: { background: "rgba(8,10,22,0.95)", border: "1px solid rgba(0,229,255,0.3)", borderRadius: 10, fontSize: 12 },
  labelStyle: { color: "#8a96b8" },
};

type Col = { key: keyof Metrics | "solve"; label: string; fmt: (v: number) => string; better: "low" | "high" };
const COLS: Col[] = [
  { key: "cost_inr", label: "Op. cost", fmt: inr, better: "low" },
  { key: "distance_km", label: "Distance", fmt: (v) => `${fmt(v, 1)} km`, better: "low" },
  { key: "co2_kg", label: "CO₂", fmt: (v) => `${fmt(v, 1)} kg`, better: "low" },
  { key: "avg_turnaround_min", label: "Avg turnaround", fmt: (v) => `${fmt(v, 0)} min`, better: "low" },
  { key: "makespan_min", label: "Fleet back (makespan)", fmt: (v) => `${fmt(v, 0)} min`, better: "low" },
  { key: "on_time_pct", label: "On-time", fmt: (v) => `${fmt(v, 0)}%`, better: "high" },
  { key: "avg_utilization_pct", label: "Utilisation", fmt: (v) => `${fmt(v, 0)}%`, better: "high" },
  { key: "vehicles_used", label: "Vehicles", fmt: (v) => `${v}`, better: "low" },
  { key: "solve", label: "Solve time", fmt: (v) => `${(v / 1000).toFixed(2)}s`, better: "low" },
];

const val = (p: PlanResult, k: Col["key"]) => (k === "solve" ? p.solve_ms : (p.metrics[k] as number));

export default function Benchmark() {
  const compare = useStore((s) => s.compare);
  const comparing = useStore((s) => s.comparing);
  const runCompare = useStore((s) => s.runCompare);
  const showPlan = useStore((s) => s.showPlan);
  const scenario = useStore((s) => s.scenario);
  const plan = useStore((s) => s.plan);
  const compareLabel = useStore((s) => s.compareLabel);

  if (!compare) {
    return (
      <div className="glass rounded-2xl h-full grid place-items-center">
        <div className="text-center max-w-md">
          <BarChart3 size={42} className="text-violet mx-auto" />
          <div className="font-display text-xl tracking-[0.14em] mt-4 grad-text font-black">BENCHMARK ARENA</div>
          <p className="text-dim text-sm mt-3">
            Run every optimiser on exactly the same orders, fleet and road network
            {plan ? " (the state your current plan started from)" : ""}: quantum hybrid, Google OR-Tools, thermal simulated annealing on the identical QUBO, and legacy rule-based dispatch.
          </p>
          <button className="btn-quantum mt-5 inline-flex items-center gap-2" disabled={comparing || !scenario} onClick={() => runCompare()}>
            {comparing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {comparing ? "RUNNING 4 SOLVERS…" : "RUN BENCHMARK"}
          </button>
        </div>
      </div>
    );
  }

  const keys = ORDER.filter((k) => compare[k]);
  const res = keys.map((k) => compare[k]);
  const q = compare.quantum?.metrics;
  const g = compare.greedy?.metrics;
  const o = compare.ortools?.metrics;
  const pct = (a?: number, b?: number) => (a !== undefined && b ? ((b - a) / b) * 100 : 0);

  const heroes = [
    { k: "Cost vs legacy", v: pct(q?.cost_inr, g?.cost_inr), unit: "% cheaper" },
    { k: "Turnaround vs legacy", v: pct(q?.avg_turnaround_min, g?.avg_turnaround_min), unit: "% faster" },
    { k: "CO₂ vs legacy", v: pct(q?.co2_kg, g?.co2_kg), unit: "% less" },
    { k: "Cost vs OR-Tools", v: pct(q?.cost_inr, o?.cost_inr), unit: "% cheaper" },
  ];

  // normalised bars (legacy = 100)
  const norm = ["cost_inr", "distance_km", "co2_kg", "avg_turnaround_min", "makespan_min"].map((k) => {
    const row: any = { metric: COLS.find((c) => c.key === k)!.label };
    for (const s of keys) row[s] = g ? ((compare[s].metrics as any)[k] / (g as any)[k]) * 100 : 0;
    return row;
  });

  // multi-objective radar (higher = better, 0..100)
  const radarKeys: { k: Col["key"]; label: string; better: "low" | "high" }[] = [
    { k: "cost_inr", label: "Cost", better: "low" },
    { k: "distance_km", label: "Distance", better: "low" },
    { k: "co2_kg", label: "Emissions", better: "low" },
    { k: "avg_turnaround_min", label: "Turnaround", better: "low" },
    { k: "makespan_min", label: "Makespan", better: "low" },
    { k: "on_time_pct", label: "SLA", better: "high" },
  ];
  const radar = radarKeys.map((rk) => {
    const vals = res.map((p) => val(p, rk.k));
    const lo = Math.min(...vals),
      hi = Math.max(...vals);
    const row: any = { axis: rk.label };
    res.forEach((p) => {
      const v = val(p, rk.k);
      const s = hi === lo ? 1 : rk.better === "low" ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo);
      row[p.solver] = 30 + 70 * s;
    });
    return row;
  });

  const qs = compare.quantum?.quantum;
  const ss = compare.sa?.quantum;
  const rawQ = qs?.stage2.reduce((a, s) => a + s.raw_cost, 0) ?? 0;
  const rawS = ss?.stage2.reduce((a, s) => a + s.raw_cost, 0) ?? 0;

  return (
    <div className="h-full overflow-y-auto pr-1 flex flex-col gap-3">
      <div className="glass rounded-2xl p-4 flex items-center gap-6">
        <div>
          <div className="font-display text-xl font-black tracking-[0.14em] grad-text">BENCHMARK ARENA</div>
          <div className="text-[12px] text-dim mt-1">
            <span className="text-amber">{compareLabel}</span> · {q?.orders_total} orders · identical fleet, road network and constraints
          </div>
        </div>
        <div className="flex-1 grid grid-cols-4 gap-2">
          {heroes.map((h) => (
            <div key={h.k} className="rounded-xl border border-line bg-white/[0.025] px-3 py-2">
              <div className="label !text-[9px]">{h.k}</div>
              {Math.abs(h.v) < 0.05 ? (
                <div className="num text-lg mt-1 text-lime" title="Both found the identical plan">Same best plan</div>
              ) : (
                <div className={`num text-2xl mt-0.5 ${h.v >= 0 ? "text-lime" : "text-amber"}`}>
                  {h.v >= 0 ? "−" : "+"}
                  {Math.abs(h.v).toFixed(Math.abs(h.v) < 10 ? 1 : 0)}
                  <span className="text-[11px] text-dim ml-1">{h.v >= 0 ? h.unit : h.unit.replace("cheaper", "costlier").replace("faster", "slower").replace("less", "more")}</span>
                </div>
              )}
            </div>
          ))}
        </div>
        <button className="btn" onClick={() => runCompare()} disabled={comparing} title="Benchmark the state the current plan started from">
          {comparing ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />} Re-run on current
        </button>
      </div>

      {(() => {
        const imp = yearlyImpact(q, g);
        if (!imp) return null;
        const items = [
          { icon: Wallet, k: "Operating cost saved / year", v: lakh(imp.rupees), c: "text-lime" },
          { icon: Leaf, k: "CO₂ avoided / year", v: `${imp.co2t.toFixed(1)} t`, c: "text-cyan" },
          { icon: TreePine, k: "Equivalent trees planted", v: `≈${imp.trees.toLocaleString("en-IN")}`, c: "text-lime" },
          { icon: Timer, k: "Fleet hours freed / year", v: `${Math.round(imp.hours).toLocaleString("en-IN")} h`, c: "text-amber" },
        ];
        return (
          <section className="glass rounded-2xl p-4">
            <div className="label">Business impact · quantum hybrid vs legacy, projected over 300 operating days for this fleet</div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {items.map((it) => (
                <div key={it.k} className="rounded-xl border border-line bg-white/[0.025] px-4 py-3 flex items-center gap-3">
                  <it.icon size={22} className={it.c} />
                  <div>
                    <div className={`num text-2xl ${it.c}`}>{it.v}</div>
                    <div className="text-[11px] text-dim">{it.k}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-faint">Assumes one shift per day like the simulated one; 1 tree absorbs ≈21 kg CO₂/year. Scales linearly with fleet size.</div>
          </section>
        );
      })()}

      <section className="glass rounded-2xl p-4">
        <div className="label">Head-to-head</div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-dim text-left">
                <th className="py-2 pr-3 font-semibold">Solver</th>
                {COLS.map((c) => (
                  <th key={c.key} className="py-2 px-2 font-semibold text-right whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {res.map((p) => (
                <tr key={p.solver} className={`border-t border-line ${p.solver === "quantum" ? "bg-cyan/[0.05]" : ""}`}>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[p.solver], boxShadow: `0 0 10px ${COLORS[p.solver]}` }} />
                      <span className="font-semibold">{p.solver_short}</span>
                    </div>
                    <div className="text-[10px] text-faint mt-0.5">{p.solver_label}</div>
                  </td>
                  {COLS.map((c) => {
                    const vals = res.map((x) => val(x, c.key));
                    const best = c.better === "low" ? Math.min(...vals) : Math.max(...vals);
                    const v = val(p, c.key);
                    const isBest = Math.abs(v - best) < 1e-6;
                    return (
                      <td key={c.key} className={`py-2.5 px-2 text-right num ${isBest ? "text-lime font-semibold" : "text-ink"}`}>
                        {isBest && <Trophy size={11} className="inline mr-1 -mt-0.5" />}
                        {c.fmt(v)}
                      </td>
                    );
                  })}
                  <td className="py-2.5 pl-2 text-right">
                    <button className="btn !py-1 !px-2 !text-[11px]" onClick={() => showPlan(p.solver)}>
                      <Eye size={12} /> Map
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-[1.4fr_1fr] gap-3">
        <section className="glass rounded-2xl p-4">
          <div className="label">Relative to legacy dispatch (= 100, lower is better)</div>
          <div className="h-[280px] mt-3">
            <ResponsiveContainer>
              <BarChart data={norm} barGap={2}>
                <CartesianGrid stroke="rgba(120,160,255,0.08)" vertical={false} />
                <XAxis dataKey="metric" stroke="#56607e" fontSize={11} />
                <YAxis stroke="#56607e" fontSize={10} domain={[0, "auto"]} />
                <Tooltip {...tooltipStyle} formatter={(v: any) => Number(v).toFixed(0)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {keys.map((k) => (
                  <Bar key={k} dataKey={k} name={compare[k].solver_short} fill={COLORS[k]} radius={[4, 4, 0, 0]} fillOpacity={k === "quantum" ? 1 : 0.7} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="glass rounded-2xl p-4">
          <div className="label">Multi-objective profile (outer = better)</div>
          <div className="h-[280px] mt-3">
            <ResponsiveContainer>
              <RadarChart data={radar} outerRadius="72%">
                <PolarGrid stroke="rgba(120,160,255,0.15)" />
                <PolarAngleAxis dataKey="axis" stroke="#8a96b8" fontSize={11} />
                {keys.map((k) => (
                  <Radar key={k} dataKey={k} name={compare[k].solver_short} stroke={COLORS[k]} fill={COLORS[k]} fillOpacity={k === "quantum" ? 0.25 : 0.04} strokeWidth={k === "quantum" ? 2.5 : 1.2} />
                ))}
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {qs && ss && (
        <section className="glass rounded-2xl p-4">
          <div className="label">Quantum tunnelling vs thermal annealing · same QUBO formulation</div>
          <div className="mt-3 grid grid-cols-4 gap-2">
            <div className="rounded-xl border border-cyan/40 bg-cyan/[0.06] px-3 py-2">
              <div className="label !text-[9px]">SQA raw route cost</div>
              <div className="num text-xl text-cyan">{fmt(rawQ, 0)} min</div>
            </div>
            <div className="rounded-xl border border-line px-3 py-2">
              <div className="label !text-[9px]">Thermal SA raw route cost</div>
              <div className="num text-xl text-violet">{fmt(rawS, 0)} min</div>
            </div>
            <div className="rounded-xl border border-line px-3 py-2">
              <div className="label !text-[9px]">SQA valid samples</div>
              <div className="num text-xl text-lime">{qs.valid_routes_pct.toFixed(0)}%</div>
            </div>
            <div className="rounded-xl border border-line px-3 py-2">
              <div className="label !text-[9px]">Thermal SA valid samples</div>
              <div className="num text-xl text-amber">{ss.valid_routes_pct.toFixed(0)}%</div>
            </div>
          </div>
          <p className="text-[12px] text-dim mt-3 leading-relaxed">
            Both annealers receive the same QUBO formulation, penalty weights and sweep budget.{" "}
            {rawQ <= rawS ? (
              <>
                Path-integral SQA returned <span className="text-cyan">{fmt(((rawS - rawQ) / (rawS || 1)) * 100, 0)}% lower-cost</span> raw route
                bit-strings before any classical post-processing: its coupled Trotter replicas tunnel through tall, thin penalty barriers that a
                single thermal walker has to climb over.
              </>
            ) : (
              <>On this instance thermal SA returned slightly cheaper raw samples; both are polished by the same classical refinement.</>
            )}{" "}
            Both raw plans then go through the same classical ₹-cost search, so final costs can end up close; this card isolates the
            annealer itself. OR-Tools is the industrial reference and optimises the same ₹ objective.
          </p>
        </section>
      )}
    </div>
  );
}
