import { useEffect, useMemo, useRef, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, Atom, CheckCircle2, Cpu, Database, FlaskConical, GitMerge, Loader2, Pause, Play, Route as RouteIcon, Sparkles, Truck, XCircle } from "lucide-react";
import { useStore } from "../store";
import { QuantumHardware } from "../components/QuantumHardware";
import { clock, fmt, rgba } from "../lib/sim";
import type { QaoaResult, QuantumTelemetry } from "../types";

const tooltipStyle = {
  contentStyle: { background: "rgba(8,10,22,0.95)", border: "1px solid rgba(0,229,255,0.3)", borderRadius: 10, fontSize: 12 },
  labelStyle: { color: "#8a96b8" },
};

function Card({ title, sub, children, className = "", right }: { title: string; sub?: string; children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <section className={`glass rounded-2xl p-4 ${className}`}>
      <div className="flex items-start justify-between gap-3 max-md:flex-col">
        <div>
          <div className="label">{title}</div>
          {sub && <div className="text-[12px] text-dim mt-1">{sub}</div>}
        </div>
        {right}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Stat({ k, v, accent = "text-cyan" }: { k: string; v: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.025] px-3 py-2">
      <div className="label !text-[9px]">{k}</div>
      <div className={`num text-lg mt-0.5 ${accent}`}>{v}</div>
    </div>
  );
}

/* ------------------------------------------------------------ pipeline */
function Pipeline({ q, nOrders, src }: { q: QuantumTelemetry; nOrders: number; src: string }) {
  const s2q = q.stage2.reduce((a, s) => a + s.n_vars, 0);
  const steps = [
    { icon: Database, title: "Road graph", text: `${src === "osrm" ? "OSRM road network" : "Geodesic model"} · ${nOrders + q.stage1.vehicles + 1}² travel-time matrix`, c: "text-dim" },
    { icon: Atom, title: "Quantum allocation", text: `${q.stage1.n_vars} qubits · capacitated assignment QUBO · SQA`, c: "text-cyan" },
    { icon: RouteIcon, title: "Quantum sequencing", text: `${q.stage2.length} route QUBOs · ${s2q} qubits · deadline-aware`, c: "text-magenta" },
    { icon: GitMerge, title: "Hybrid refinement", text: q.lns && q.stage1.inr_quantum
        ? `classical ruin-and-recreate on ₹ cost · ${q.lns.iterations.toLocaleString("en-IN")} moves · −${fmt(Math.max(0, (100 * (q.stage1.inr_quantum - q.lns.final_inr)) / q.stage1.inr_quantum), 1)}% vs raw quantum plan`
        : `classical relocate & 2-opt · −${fmt(q.stage1.refine_gain_pct ?? 0, 1)}% cost`, c: "text-violet" },
    { icon: Truck, title: "Dispatch", text: `${q.valid_routes_pct.toFixed(0)}% routes valid straight from the annealer`, c: "text-lime" },
  ];
  return (
    <div className="flex items-stretch gap-2 max-md:flex-col">
      {steps.map((s, i) => (
        <div key={s.title} className="flex items-center gap-2 flex-1 min-w-0 max-md:flex-col max-md:items-stretch">
          <div className="flex-1 rounded-xl border border-line bg-white/[0.025] p-3 h-full">
            <div className="flex items-center gap-2">
              <s.icon size={16} className={s.c} />
              <span className="text-[13px] font-semibold">{s.title}</span>
            </div>
            <div className="text-[11px] text-dim mt-1.5 leading-snug">{s.text}</div>
          </div>
          {i < steps.length - 1 && <ArrowRight size={16} className="text-faint shrink-0 max-md:rotate-90 max-md:self-center" />}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ replicas */
function ReplicaViewer({ q }: { q: QuantumTelemetry }) {
  const rep = q.stage1.replicas;
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!playing || !rep) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % rep.frames.length), 700);
    return () => clearInterval(id);
  }, [playing, rep]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !rep) return;
    const ctx = cv.getContext("2d")!;
    const { P, n } = rep;
    const W = cv.width,
      H = cv.height,
      cw = W / n,
      ch = H / P;
    ctx.clearRect(0, 0, W, H);
    const fr = rep.frames[frame];
    for (let k = 0; k < P; k++)
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = fr[k][i] > 0 ? "rgba(0,229,255,0.9)" : "rgba(255,61,172,0.18)";
        ctx.fillRect(i * cw + 0.4, k * ch + 0.4, Math.max(1, cw - 0.8), Math.max(1, ch - 0.8));
      }
  }, [frame, rep]);
  if (!rep) return <div className="text-dim text-sm">No replica telemetry for this solver.</div>;
  // agreement between replicas = how "classical" the state has become
  const fr = rep.frames[frame];
  let agree = 0;
  for (let i = 0; i < rep.n; i++) {
    let s = 0;
    for (let k = 0; k < rep.P; k++) s += fr[k][i];
    agree += Math.abs(s) / rep.P;
  }
  agree /= rep.n;
  const labels = ["superposition", "tunnelling", "tunnelling", "freezing", "freezing", "collapsed", "ground state"];
  return (
    <div>
      <canvas ref={ref} width={900} height={170} className="w-full h-[170px] rounded-lg bg-black/30" />
      <div className="mt-2 flex items-center gap-3">
        <button className="btn !p-2" onClick={() => setPlaying(!playing)}>
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <input type="range" min={0} max={rep.frames.length - 1} value={frame} onChange={(e) => { setPlaying(false); setFrame(+e.target.value); }} className="flex-1" />
        <span className="num text-[11px] text-dim w-36 text-right">
          t = {frame}/{rep.frames.length - 1} · {labels[Math.min(labels.length - 1, Math.round((frame / (rep.frames.length - 1)) * (labels.length - 1)))]}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-dim">
        Replica consensus
        <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-magenta to-cyan transition-all" style={{ width: `${agree * 100}%` }} />
        </div>
        <span className="num text-ink">{(agree * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ QUBO heatmap */
function QuboHeatmap({ q }: { q: QuantumTelemetry }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const qb = q.stage1.qubo;
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const n = qb.size;
    const c = cv.width / n;
    ctx.fillStyle = "#04050c";
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const v = qb.cells[i][j];
        if (!v) continue;
        const a = Math.min(1, Math.abs(v));
        ctx.fillStyle = v > 0 ? `rgba(255,61,172,${0.15 + a * 0.85})` : `rgba(0,229,255,${0.15 + a * 0.85})`;
        ctx.fillRect(j * c, i * c, Math.ceil(c), Math.ceil(c));
      }
  }, [qb]);
  return (
    <div className="flex gap-4 items-start max-md:flex-col">
      <canvas ref={ref} width={300} height={300} className="w-[230px] h-[230px] max-md:self-center rounded-lg border border-line" style={{ imageRendering: "pixelated" }} />
      <div className="text-[12px] text-dim leading-relaxed flex-1">
        <div className="text-ink font-semibold text-sm">Q matrix · {qb.n}×{qb.n}</div>
        <div className="num text-[11px] mt-1">{qb.nnz.toLocaleString()} non-zero couplings</div>
        <div className="mt-3 flex flex-col gap-1.5">
          <span><span className="text-magenta">■</span> positive = penalty / repulsion</span>
          <span><span className="text-cyan">■</span> negative = reward / attraction</span>
        </div>
        <div className="mt-3">
          Block structure = one-hot constraints per order; dense off-diagonal bands = capacity coupling between orders sharing a vehicle.
        </div>
        <div className="mt-3 num text-[11px]">
          {Object.entries(q.stage1.penalties).map(([k, v]) => (
            <span key={k} className="mr-3">
              {k}=<span className="text-ink">{v}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ QAOA */
function CircuitDiagram({ r }: { r: QaoaResult }) {
  const n = r.n_qubits;
  const rowH = n > 9 ? 16 : 22;
  const top = 14;
  const H = top + n * rowH + 10;
  const colW = 9;
  const gates = r.circuit.rzz;
  const x0 = 70;
  const xH = x0;
  const xZZ = xH + 34;
  const xRZ = xZZ + gates.length * colW + 14;
  const xRX = xRZ + 34;
  const W = xRX + 90;
  const maxA = Math.max(...gates.map((g) => Math.abs(g[2])), 1e-9);
  const y = (q: number) => top + q * rowH + rowH / 2;
  const m = Math.round(Math.sqrt(n));
  return (
    <div className="overflow-x-auto rounded-lg bg-black/30 border border-line">
      <svg width={W} height={H} className="block">
        {Array.from({ length: n }, (_, q) => (
          <g key={q}>
            <text x={8} y={y(q) + 4} fill="#56607e" fontSize={10} fontFamily="JetBrains Mono">
              q{q} <tspan fill="#8a96b8">x{Math.floor(q / m)},{q % m}</tspan>
            </text>
            <line x1={x0 - 6} x2={W - 50} y1={y(q)} y2={y(q)} stroke="rgba(120,160,255,0.25)" />
            <rect x={xH} y={y(q) - 8} width={18} height={16} rx={3} fill="rgba(157,123,255,0.25)" stroke="#9d7bff" />
            <text x={xH + 9} y={y(q) + 4} textAnchor="middle" fill="#e8f1ff" fontSize={10} fontFamily="JetBrains Mono">H</text>
            <rect x={xRZ} y={y(q) - 8} width={24} height={16} rx={3} fill="rgba(255,196,0,0.18)" stroke="#ffc400" />
            <text x={xRZ + 12} y={y(q) + 4} textAnchor="middle" fill="#ffc400" fontSize={9} fontFamily="JetBrains Mono">Rz</text>
            <rect x={xRX} y={y(q) - 8} width={24} height={16} rx={3} fill="rgba(140,255,92,0.15)" stroke="#8cff5c" />
            <text x={xRX + 12} y={y(q) + 4} textAnchor="middle" fill="#8cff5c" fontSize={9} fontFamily="JetBrains Mono">Rx</text>
            <path d={`M ${W - 44} ${y(q) - 6} h 14 v 12 h -14 z`} fill="none" stroke="#00e5ff" />
            <path d={`M ${W - 42} ${y(q) + 3} q 5 -8 10 0`} fill="none" stroke="#00e5ff" />
          </g>
        ))}
        {gates.map(([a, b, ang], i) => {
          const x = xZZ + i * colW + 4;
          const al = 0.35 + 0.65 * (Math.abs(ang) / maxA);
          const col = ang >= 0 ? `rgba(255,61,172,${al})` : `rgba(0,229,255,${al})`;
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={y(a)} y2={y(b)} stroke={col} strokeWidth={1.4} />
              <circle cx={x} cy={y(a)} r={2.6} fill={col} />
              <circle cx={x} cy={y(b)} r={2.6} fill={col} />
            </g>
          );
        })}
        <rect x={xZZ - 6} y={2} width={xRX + 30 - xZZ} height={H - 4} rx={8} fill="none" stroke="rgba(0,229,255,0.35)" strokeDasharray="4 4" />
        <text x={xRX + 34} y={12} fill="#00e5ff" fontSize={11} fontFamily="JetBrains Mono">× p={r.layers}</text>
        <text x={xZZ} y={H - 3} fill="#56607e" fontSize={9} fontFamily="JetBrains Mono">cost layer e^(−iγH_C): {gates.length} RZZ</text>
      </svg>
    </div>
  );
}

function TourGrid({ bits, m, stops }: { bits: number[]; m: number; stops: QaoaResult["stops"] }) {
  return (
    <div className="inline-grid gap-1" style={{ gridTemplateColumns: `90px repeat(${m}, 26px)` }}>
      <div />
      {Array.from({ length: m }, (_, p) => (
        <div key={p} className="text-[9px] text-faint text-center num">p{p + 1}</div>
      ))}
      {Array.from({ length: m }, (_, i) => (
        <div key={i} className="contents">
          <div className="text-[10px] text-dim truncate num">{stops[i]?.order_id}</div>
          {Array.from({ length: m }, (_, p) => {
            const on = bits[i * m + p] === 1;
            return (
              <div
                key={p}
                className={`h-[26px] rounded-md border ${on ? "bg-cyan/70 border-cyan shadow-[0_0_10px_rgba(0,229,255,0.8)]" : "border-line bg-white/[0.02]"}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function QaoaLab() {
  const plan = useStore((s) => s.lab?.plan ?? null);
  const qaoa = useStore((s) => s.qaoa);
  const busy = useStore((s) => s.qaoaBusy);
  const runQaoa = useStore((s) => s.runQaoa);
  const eligible = plan?.routes.filter((r) => r.stops.length >= 2) ?? [];
  const [veh, setVeh] = useState<string>("");
  const [nStops, setNStops] = useState(3);
  const [layers, setLayers] = useState(6);
  const eligibleKey = eligible.map((r) => r.vehicle_id).join(",");
  useEffect(() => {
    // keep the selection valid when the lab plan changes
    if (!eligible.some((r) => r.vehicle_id === veh)) setVeh(eligible[0]?.vehicle_id ?? "");
  }, [eligibleKey]);
  const r = qaoa;
  const m = r ? Math.round(Math.sqrt(r.n_qubits)) : 0;
  const best = r?.top_states.find((s) => s.optimal) ?? r?.top_states.find((s) => s.valid) ?? r?.top_states[0];
  const bars = r?.top_states.slice(0, 12).map((s, i) => ({ name: `#${i + 1}`, p: s.prob * 100, valid: s.valid, optimal: s.optimal, tour: s.tour?.join(" → ") ?? "invalid (constraint violated)" }));

  return (
    <Card
      title="QAOA circuit lab · gate-model quantum computing"
      sub="Takes the first stops of a planned route, encodes the sequencing QUBO into a Qiskit circuit and optimises the variational angles γ, β on an exact statevector simulator."
      right={
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input" value={veh} onChange={(e) => setVeh(e.target.value)} disabled={!eligible.length}>
            {!eligible.length && <option value="">no route with 2+ stops</option>}
            {eligible.map((r) => (
              <option key={r.vehicle_id} value={r.vehicle_id}>
                {r.vehicle_id} · {r.stops.length} stops
              </option>
            ))}
          </select>
          <select className="input" value={nStops} onChange={(e) => { const v = +e.target.value; setNStops(v); setLayers(v === 4 ? 4 : 6); }}>
            <option value={3}>3 stops · 9 qubits</option>
            <option value={4}>4 stops · 16 qubits</option>
          </select>
          <select className="input" value={layers} onChange={(e) => setLayers(+e.target.value)}>
            {[2, 3, 4, 5, 6, 7, 8].map((p) => (
              <option key={p} value={p}>
                p = {p}
              </option>
            ))}
          </select>
          <button className="btn-quantum flex items-center gap-2 whitespace-nowrap" disabled={busy || !veh} onClick={() => runQaoa(veh, nStops, layers)}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Cpu size={14} />} RUN QAOA
          </button>
        </div>
      }
    >
      {!r ? (
        <div className="text-sm text-dim py-6 text-center">
          {busy ? "Optimising circuit angles on the statevector simulator…" : "Pick a vehicle and run the circuit to see quantum amplitude amplification of the optimal delivery order."}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-6 max-md:grid-cols-2 gap-2">
            <Stat k="Qubits" v={r.n_qubits} />
            <Stat k="Hilbert space" v={r.hilbert_dim.toLocaleString()} />
            <Stat k="P(valid tour)" v={`${(r.p_valid * 100).toFixed(1)}%`} accent="text-lime" />
            <Stat k="Random guess" v={`${(r.random_p_valid * 100).toFixed(2)}%`} accent="text-dim" />
            <Stat k="Optimal amplified" v={`${r.amplification.toFixed(0)}×`} accent="text-magenta" />
            <Stat k="Shots · optimal" v={`${r.shots.optimal}/${r.shots.total}`} accent="text-amber" />
          </div>
          <CircuitDiagram r={r} />
          <div className="grid grid-cols-[1.3fr_1fr_auto] max-md:grid-cols-1 gap-4 items-start">
            <div>
              <div className="label mb-2">Measurement distribution · top states</div>
              <div className="h-[190px]">
                <ResponsiveContainer>
                  <BarChart data={bars}>
                    <CartesianGrid stroke="rgba(120,160,255,0.08)" vertical={false} />
                    <XAxis dataKey="name" stroke="#56607e" fontSize={10} />
                    <YAxis stroke="#56607e" fontSize={10} unit="%" />
                    <Tooltip {...tooltipStyle} formatter={(v: any, _n: any, p: any) => [`${Number(v).toFixed(2)}%`, p.payload.tour]} />
                    <Bar dataKey="p" radius={[4, 4, 0, 0]}>
                      {bars!.map((b, i) => (
                        <Cell key={i} fill={b.optimal ? "#8cff5c" : b.valid ? "#00e5ff" : "rgba(255,61,172,0.55)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="text-[11px] text-dim flex gap-4">
                <span><span className="text-lime">■</span> optimal tour</span>
                <span><span className="text-cyan">■</span> valid tour</span>
                <span><span className="text-magenta">■</span> violates constraints</span>
              </div>
            </div>
            <div>
              <div className="label mb-2">Variational optimisation (⟨H⟩ per iteration)</div>
              <div className="h-[190px]">
                <ResponsiveContainer>
                  <LineChart data={r.trace.map((v, i) => ({ i, v }))}>
                    <CartesianGrid stroke="rgba(120,160,255,0.08)" vertical={false} />
                    <XAxis dataKey="i" stroke="#56607e" fontSize={10} />
                    <YAxis stroke="#56607e" fontSize={10} domain={["auto", "auto"]} />
                    <Tooltip {...tooltipStyle} formatter={(v: any) => Number(v).toFixed(3)} />
                    <Line dataKey="v" stroke="#9d7bff" dot={false} strokeWidth={1.6} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="text-[11px] text-dim">
                COBYLA · {r.restarts} restarts · CVaR objective · {(r.ms / 1000).toFixed(1)}s
              </div>
            </div>
            <div>
              <div className="label mb-2">Optimal state |x⟩</div>
              {best && <TourGrid bits={best.bits} m={m} stops={r.stops} />}
              <div className="mt-2 text-[11px] text-dim max-w-[220px]">
                Optimal: <span className="text-ink num">{r.optimal_tour.join(" → ")}</span> ({fmt(r.optimal_minutes, 1)} min)
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-dim border-t border-line pt-3">
            {r.qiskit.max_prob_diff !== undefined && (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-lime" /> Verified against <span className="text-ink">qiskit.quantum_info.Statevector</span> (max |Δp| = {r.qiskit.max_prob_diff.toExponential(1)})
              </span>
            )}
            {r.qiskit.depth !== undefined && (
              <span className="num">
                transpiled: depth {r.qiskit.depth} · {r.qiskit.cx} CNOT · {r.qiskit.gates} gates
              </span>
            )}
            <span className="num">γ = [{r.gammas.map((g) => g.toFixed(2)).join(", ")}]</span>
            <span className="num">β = [{r.betas.map((g) => g.toFixed(2)).join(", ")}]</span>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ scaling */
function ScalingExperiment() {
  const scaling = useStore((s) => s.scaling);
  const busy = useStore((s) => s.scalingBusy);
  const run = useStore((s) => s.runScaling);
  const rows = scaling?.rows ?? [];
  const last = rows[rows.length - 1];
  return (
    <Card
      title="Scaling experiment · quantum tunnelling vs thermal annealing"
      sub="Random sub-routes from this city, growing in size. Same QUBO, same sweep budget, raw annealer output with no classical polish. Gap is measured against the best known tour (exact up to 8 stops)."
      right={
        <button className="btn-quantum flex items-center gap-2 whitespace-nowrap" disabled={busy} onClick={run}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />} {scaling ? "RE-RUN" : "RUN EXPERIMENT"}
        </button>
      }
    >
      {!scaling ? (
        <div className="text-sm text-dim py-6 text-center">
          {busy ? "Annealing sub-routes of 25 → 169 qubits with both methods…" : "Shows how solution quality holds up as the problem grows, which is the core argument for quantum optimisation."}
        </div>
      ) : (
        <div className="grid grid-cols-[1.6fr_1fr] max-md:grid-cols-1 gap-4 items-center">
          <div className="h-[240px]">
            <ResponsiveContainer>
              <LineChart data={rows}>
                <CartesianGrid stroke="rgba(120,160,255,0.08)" vertical={false} />
                <XAxis dataKey="qubits" stroke="#56607e" fontSize={10} label={{ value: "logical qubits", position: "insideBottom", offset: -2, fill: "#56607e", fontSize: 10 }} />
                <YAxis stroke="#56607e" fontSize={10} unit="%" />
                <Tooltip {...tooltipStyle} formatter={(v: any) => `${Number(v).toFixed(1)}%`} labelFormatter={(q: any) => `${q} qubits · ${Math.round(Math.sqrt(q))} stops`} />
                <Line dataKey="sa_gap_pct" name="Thermal SA gap" stroke="#9d7bff" strokeWidth={2} dot={{ r: 4 }} />
                <Line dataKey="sqa_gap_pct" name="Quantum SQA gap" stroke="#00e5ff" strokeWidth={3} dot={{ r: 5 }} style={{ filter: "drop-shadow(0 0 6px rgba(0,229,255,0.7))" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 max-md:grid-cols-1 gap-2">
              <Stat k={`SQA gap @ ${last?.qubits} qubits`} v={`${last?.sqa_gap_pct.toFixed(1)}%`} />
              <Stat k={`SA gap @ ${last?.qubits} qubits`} v={`${last?.sa_gap_pct.toFixed(1)}%`} accent="text-violet" />
              <Stat k="SQA valid samples" v={`${Math.round(rows.reduce((a, r) => a + r.sqa_valid_pct, 0) / rows.length)}%`} accent="text-lime" />
              <Stat k="SA valid samples" v={`${Math.round(rows.reduce((a, r) => a + r.sa_valid_pct, 0) / rows.length)}%`} accent="text-amber" />
            </div>
            <div className="text-[11px] text-dim leading-relaxed">
              <span className="text-cyan">━</span> quantum SQA &nbsp; <span className="text-violet">━</span> thermal SA (D-Wave neal). {scaling.trials} instances per size ·{" "}
              {(scaling.ms / 1000).toFixed(1)} s total. Lower is better. A widening gap means the quantum method scales better on this problem class.
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ view */
export default function QuantumLab() {
  const lab = useStore((s) => s.lab);
  const current = useStore((s) => s.plan);
  const plan = lab?.plan ?? current;
  const scenario = useStore((s) => s.scenario);
  const optimize = useStore((s) => s.optimize);
  const set = useStore((s) => s.set);
  const busy = useStore((s) => s.busy);
  const q = plan?.quantum;

  const annealData = useMemo(() => {
    const tr = q?.stage1.trace;
    if (!tr) return [];
    return tr.e_min.map((e, i) => ({ i, e, mean: tr.e_mean[i], g: tr.gamma[i], j: tr.j_perp[i] }));
  }, [q]);

  if (!q) {
    return (
      <div className="glass rounded-2xl h-full grid place-items-center">
        <div className="text-center max-w-md">
          <Atom size={42} className="text-cyan mx-auto spin-slow" />
          <div className="font-display text-xl tracking-[0.14em] mt-4 grad-text font-black">QUANTUM LAB</div>
          <p className="text-dim text-sm mt-3">
            {plan ? `The current plan was produced by ${plan.solver_short}. ` : ""}Run the quantum planner to inspect the Hamiltonian, the annealing dynamics and the QAOA circuit.
          </p>
          <button
            className="btn-quantum mt-5 inline-flex items-center gap-2"
            disabled={busy || !scenario}
            onClick={() => {
              set({ solver: "quantum", view: "command" });
              setTimeout(() => optimize(), 50);
            }}
          >
            <Sparkles size={15} /> RUN QUANTUM PLANNER
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto pr-1 flex flex-col gap-3">
      {lab && current && current !== lab.plan && (
        <div className="glass rounded-xl px-4 py-2 text-[12px] text-dim flex items-center gap-2 border-cyan/30">
          <Atom size={14} className="text-cyan shrink-0" />
          <span>
            Inspecting the quantum plan computed at <span className="num text-ink">{clock(lab.at)}</span> ({lab.plan.quantum?.total_qubits} qubits).
            {" "}The map currently shows {current.quantum ? `a smaller re-plan (${current.quantum.total_qubits} qubits)` : `the ${current.solver_short} plan`}.
          </span>
        </div>
      )}
      <div className="glass rounded-2xl p-4 flex items-center gap-6 max-md:flex-col max-md:items-stretch max-md:gap-3">
        <div>
          <div className="font-display text-xl font-black tracking-[0.14em] grad-text">QUANTUM LAB</div>
          <div className="text-[12px] text-dim mt-1">{plan!.solver_label}</div>
        </div>
        <div className="flex-1 grid grid-cols-5 max-md:grid-cols-2 gap-2">
          <Stat k="Total logical qubits" v={q.total_qubits} />
          <Stat k="Allocation QUBO" v={`${q.stage1.n_vars} vars`} accent="text-violet" />
          <Stat k="Valid annealer routes" v={`${q.valid_routes_pct.toFixed(0)}%`} accent="text-lime" />
          <Stat k="Fleet sizes explored" v={q.fleet_exploration.map((f) => f.k).join(" · ")} accent="text-amber" />
          <Stat k="Total solve time" v={`${(plan!.solve_ms / 1000).toFixed(2)}s`} accent="text-magenta" />
        </div>
      </div>

      <Card title="Hybrid quantum–classical pipeline">
        <Pipeline q={q} nOrders={plan!.metrics.orders_total} src={plan!.matrix_source} />
      </Card>

      <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
        <Card title="Annealing dynamics · stage 1" sub="Energy of the best Trotter replica falls as the transverse field Γ is switched off and replicas lock together (J⊥ rises).">
          <div className="h-[230px]">
            <ResponsiveContainer>
              <ComposedChart data={annealData}>
                <defs>
                  <linearGradient id="ea" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#00e5ff" stopOpacity={0.35} />
                    <stop offset="1" stopColor="#00e5ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(120,160,255,0.08)" vertical={false} />
                <XAxis dataKey="i" stroke="#56607e" fontSize={10} label={{ value: "sweep block", position: "insideBottom", offset: -2, fill: "#56607e", fontSize: 10 }} />
                <YAxis yAxisId="e" stroke="#56607e" fontSize={10} domain={["auto", "auto"]} tickFormatter={(v) => Number(v).toFixed(0)} />
                <YAxis yAxisId="g" orientation="right" stroke="#9d7bff" fontSize={10} />
                <Tooltip {...tooltipStyle} formatter={(v: any) => Number(v).toFixed(3)} />
                <Area yAxisId="e" dataKey="mean" stroke="rgba(255,61,172,0.7)" fill="transparent" strokeWidth={1.2} name="⟨E⟩ replicas" dot={false} />
                <Area yAxisId="e" dataKey="e" stroke="#00e5ff" fill="url(#ea)" strokeWidth={2} name="E min" dot={false} />
                <Line yAxisId="g" dataKey="g" stroke="#9d7bff" strokeDasharray="4 4" dot={false} name="Γ" />
                <Line yAxisId="g" dataKey="j" stroke="#ffc400" strokeDasharray="2 3" dot={false} name="J⊥" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 text-[11px] text-dim mt-1">
            <span><span className="text-cyan">━</span> best energy</span>
            <span><span className="text-magenta">━</span> mean over replicas</span>
            <span><span className="text-violet">┅</span> transverse field Γ</span>
            <span><span className="text-amber">┅</span> replica coupling J⊥</span>
          </div>
        </Card>
        <Card title="Trotter replicas · path-integral view" sub={`${q.stage1.trotter_slices} imaginary-time slices × ${q.stage1.replicas?.n ?? 0} qubits. Disagreement between rows is quantum fluctuation; consensus means the state has collapsed.`}>
          <ReplicaViewer q={q} />
        </Card>
      </div>

      <div className="grid grid-cols-[1.1fr_1fr] max-md:grid-cols-1 gap-3">
        <Card title="Problem Hamiltonian · allocation QUBO">
          <QuboHeatmap q={q} />
        </Card>
        <Card title="Formulation">
          <div className="font-mono text-[11.5px] leading-6 text-dim">
            <div className="text-ink">Stage 1 · capacitated allocation</div>
            <div>
              E = Σ c<sub>ov</sub> x<sub>ov</sub> + <span className="text-magenta">A</span> Σ<sub>o</sub>(1 − Σ<sub>v</sub> x<sub>ov</sub>)² + <span className="text-amber">C</span> Σ<sub>v</sub>((Σ q<sub>o</sub>x<sub>ov</sub> − f·cap<sub>v</sub>)/cap<sub>v</sub>)²
            </div>
            <div className="text-ink mt-2">Stage 2 · route sequencing</div>
            <div>
              E = <span className="text-magenta">A</span>[Σ<sub>i</sub>(1−Σ<sub>p</sub>x<sub>ip</sub>)² + Σ<sub>p</sub>(1−Σ<sub>i</sub>x<sub>ip</sub>)²] + Σ t<sub>ij</sub> x<sub>ip</sub>x<sub>j,p+1</sub> + Σ w<sub>i</sub>·max(0, η<sub>p</sub>−d<sub>i</sub>) x<sub>ip</sub>
            </div>
            <div className="text-ink mt-2">Quantum annealer</div>
            <div>
              H(s) = −Γ(s) Σ σ<sup>x</sup><sub>i</sub> + H<sub>QUBO</sub>(σ<sup>z</sup>) · Γ: 3 → 10⁻³ · J⊥ = −½ ln tanh(Γ/PT)
            </div>
            <div className="mt-3 text-[11px] text-faint font-sans">
              x = qubit (0/1). c = travel-time cost to cluster seed, q = parcel weight, t = road travel time, d = delivery deadline, η = ETA of position p, w = priority weight.
            </div>
          </div>
        </Card>
      </div>

      <Card title="Stage 2 · per-vehicle route QUBOs" sub="Raw annealer sample cost vs. after classical 2-opt polish. 'Valid' = the measured bit-string was a feasible permutation with no repair.">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] max-md:grid-cols-1 gap-2">
          {q.stage2.map((s) => {
            const route = plan!.routes.find((r) => r.vehicle_id === s.vehicle_id);
            return (
              <div key={s.vehicle_id} className="rounded-xl border border-line bg-white/[0.02] p-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: route ? rgba(route.color) : "#888" }} />
                  <span className="num font-semibold text-sm">{s.vehicle_id}</span>
                  <span className="text-[11px] text-dim">{s.stops} stops · {s.n_vars} qubits</span>
                  {s.valid ? <CheckCircle2 size={14} className="ml-auto text-lime" /> : <XCircle size={14} className="ml-auto text-amber" />}
                </div>
                {s.trace && (
                  <div className="h-[56px] mt-2">
                    <ResponsiveContainer>
                      <LineChart data={(() => { let best = Infinity; return s.trace!.e_min.map((e, i) => ({ i, e: (best = Math.min(best, e)) })).slice(Math.floor(s.trace!.e_min.length * 0.06)); })()}>
                        <YAxis hide domain={["auto", "auto"]} />
                        <Line dataKey="e" stroke={route ? rgba(route.color) : "#00e5ff"} dot={false} strokeWidth={1.5} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="flex justify-between text-[11px] num mt-1">
                  <span className="text-dim">raw {fmt(s.raw_cost, 1)}</span>
                  <span className="text-ink">final {fmt(s.final_cost, 1)} min</span>
                  <span className="text-faint">{s.ms.toFixed(0)}ms</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <ScalingExperiment />

      <QaoaLab />
      <QuantumHardware />
    </div>
  );
}
