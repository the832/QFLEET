import { CheckCircle2, Cpu, ExternalLink, Loader2, Server, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../lib/apiBase";
import { getToken } from "../lib/auth";
import { useStore } from "../store";

interface QpuJob {
  id: string;
  mode: "ibm" | "fake";
  status: string;
  backend?: string;
  n_qubits: number;
  layers: number;
  stops: { order_id: string; customer: string }[];
  optimal_tour: string[];
  circuit?: { depth: number; two_qubit_gates: number; gates: number };
  ibm_job_id?: string | null;
  error?: string;
  created: number;
  finished?: number;
  result?: {
    shots: number;
    p_valid: number; p_optimal: number;
    ideal_p_valid: number; ideal_p_optimal: number;
    random_p_valid: number; random_p_optimal: number;
    amplification: number;
    top: { state: number; bits: string; count: number; prob: number; ideal_prob: number; valid: boolean; optimal: boolean; tour: string[] | null; minutes: number | null }[];
  };
}

async function json<T>(r: Promise<Response>): Promise<T> {
  const res = await r;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail ?? `${res.status}`);
  return body as T;
}

const STEPS = ["PREPARING", "QUEUED", "RUNNING", "DONE"];

/** Send the QAOA routing circuit to an IBM quantum computer (or IBM's noisy model of one). */
export function QuantumHardware() {
  const lab = useStore((s) => s.lab);
  const routes = lab?.plan.routes.filter((r) => r.stops.length >= 2) ?? [];
  const [veh, setVeh] = useState("");
  const [nStops, setNStops] = useState(2);
  const [layers, setLayers] = useState(1);
  const [ibm, setIbm] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"fake" | "ibm">("fake");
  const [job, setJob] = useState<QpuJob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    json<{ ibm_enabled: boolean }>(fetch(apiUrl("/api/qpu/status"))).then((s) => { setIbm(s.ibm_enabled); if (s.ibm_enabled) setMode("ibm"); }).catch(() => setIbm(false));
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, []);
  useEffect(() => { if (!routes.some((r) => r.vehicle_id === veh)) setVeh(routes[0]?.vehicle_id ?? ""); }, [routes.map((r) => r.vehicle_id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (!lab) return;
    setErr(null);
    setJob(null);
    const route = lab.plan.routes.find((r) => r.vehicle_id === veh);
    try {
      const token = await getToken();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (token) headers.authorization = `Bearer ${token}`;
      const j = await json<QpuJob>(fetch(apiUrl("/api/qpu/run"), {
        method: "POST", headers,
        body: JSON.stringify({ scenario: lab.scenario, route, n_stops: nStops, layers, mode }),
      }));
      setJob(j);
      if (timer.current) window.clearInterval(timer.current);
      timer.current = window.setInterval(async () => {
        try {
          const cur = await json<QpuJob>(fetch(apiUrl(`/api/qpu/jobs/${j.id}`)));
          setJob(cur);
          if (cur.status === "DONE" || cur.status === "ERROR") window.clearInterval(timer.current!);
        } catch { /* keep polling */ }
      }, 2000);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const r = job?.result;
  const active = job && job.status !== "DONE" && job.status !== "ERROR";
  const stepIdx = job ? Math.max(0, STEPS.indexOf(job.status === "VALIDATING" ? "QUEUED" : job.status)) : -1;

  return (
    <section className="glass rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="max-w-[640px]">
          <div className="label flex items-center gap-2"><Server size={12} className="text-cyan" /> Real quantum hardware · IBM Quantum</div>
          <div className="text-[12px] text-dim mt-1">
            The same QAOA routing circuit, compiled for an IBM superconducting chip and measured {"2,048"} times. Then we check how often the chip
            returns a valid route and the optimal one, against the noiseless simulator and random guessing.
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex p-1 rounded-xl border border-line">
            <button onClick={() => setMode("ibm")} disabled={!ibm}
              title={ibm ? "Run on a real IBM Quantum processor (queued at IBM)" : "Add IBM_QUANTUM_TOKEN to backend/.env to enable"}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold ${mode === "ibm" ? "bg-cyan/15 text-cyan" : "text-dim"} disabled:opacity-40`}>Real IBM QPU</button>
            <button onClick={() => setMode("fake")} title="IBM's calibrated noise model of its 133-qubit Torino chip, run locally"
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold ${mode === "fake" ? "bg-cyan/15 text-cyan" : "text-dim"}`}>IBM Torino noise model</button>
          </div>
          <select className="input" value={veh} onChange={(e) => setVeh(e.target.value)} disabled={!routes.length} aria-label="Route">
            {!routes.length && <option value="">plan a route first</option>}
            {routes.map((x) => <option key={x.vehicle_id} value={x.vehicle_id}>{x.vehicle_id} · {x.stops.length} stops</option>)}
          </select>
          <select className="input" value={nStops} onChange={(e) => setNStops(+e.target.value)} aria-label="Stops">
            <option value={2}>2 stops · 4 qubits</option>
            <option value={3}>3 stops · 9 qubits</option>
          </select>
          <select className="input" value={layers} onChange={(e) => setLayers(+e.target.value)} aria-label="Layers">
            {[1, 2].map((p) => <option key={p} value={p}>p = {p}</option>)}
          </select>
          <button className="btn-quantum flex items-center gap-2 whitespace-nowrap" disabled={!!active || !veh} onClick={run}>
            {active ? <Loader2 size={14} className="animate-spin" /> : <Cpu size={14} />} {mode === "ibm" ? "RUN ON IBM QPU" : "RUN ON DEVICE MODEL"}
          </button>
        </div>
      </div>

      {ibm === false && (
        <div className="mt-3 text-[11.5px] text-faint">
          Real hardware is off: create a free IBM Quantum account, then add <span className="num text-dim">IBM_QUANTUM_TOKEN</span> (and optionally <span className="num text-dim">IBM_QUANTUM_INSTANCE</span>) to backend/.env and restart. The device model below uses IBM's published noise data for a real chip.
        </div>
      )}
      {err && <div className="mt-3 text-[12px] text-danger">{err}</div>}

      {job && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-center gap-2 flex-wrap text-[12px]">
            {STEPS.map((st, i) => {
              const done = job.status === "DONE" || i < stepIdx;
              const cur = i === stepIdx && job.status !== "DONE" && job.status !== "ERROR";
              return (
                <span key={st} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border ${done ? "border-lime/40 text-lime" : cur ? "border-cyan/60 text-cyan" : "border-line text-faint"}`}>
                  {done ? <CheckCircle2 size={12} /> : cur ? <Loader2 size={12} className="animate-spin" /> : <span className="w-3" />}
                  {st === "QUEUED" ? (job.mode === "ibm" ? "Queued at IBM" : "Compiled") : st.charAt(0) + st.slice(1).toLowerCase()}
                </span>
              );
            })}
            {job.status === "ERROR" && <span className="flex items-center gap-1 text-danger"><XCircle size={13} /> {job.error}</span>}
            <span className="text-faint ml-auto num">
              {job.backend ?? "…"}{job.circuit ? ` · depth ${job.circuit.depth} · ${job.circuit.two_qubit_gates} two-qubit gates` : ""}
              {job.ibm_job_id ? ` · job ${job.ibm_job_id}` : ""}
            </span>
          </div>
          {job.mode === "ibm" && active && (
            <div className="text-[11.5px] text-dim">Real QPUs are shared: IBM's queue can take minutes. This panel keeps polling; you can keep using the app.</div>
          )}

          {r && (
            <>
              <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4">
                <Compare title="Returns a valid route" hwLabel={job.mode === "ibm" ? "IBM quantum chip" : "IBM device model"} hw={r.p_valid} ideal={r.ideal_p_valid} rnd={r.random_p_valid} />
                <Compare title="Returns the optimal route" hwLabel={job.mode === "ibm" ? "IBM quantum chip" : "IBM device model"} hw={r.p_optimal} ideal={r.ideal_p_optimal} rnd={r.random_p_optimal}
                  note={`${(r.p_optimal / r.random_p_optimal).toFixed(1)}× more often than random guessing`} />
              </div>
              <div>
                <div className="label mb-2">Most frequent measurements on {job.backend}</div>
                <div className="grid grid-cols-[90px_1fr_70px_70px] gap-x-3 gap-y-1 text-[12px] items-center">
                  <span className="label !text-[9px]">qubits</span><span className="label !text-[9px]">meaning</span>
                  <span className="label !text-[9px] text-right">{job.mode === "ibm" ? "chip" : "model"}</span><span className="label !text-[9px] text-right">ideal</span>
                  {r.top.slice(0, 6).map((t) => (
                    <div key={t.state} className="contents">
                      <span className="num text-dim">{t.bits}</span>
                      <span className={t.optimal ? "text-lime" : t.valid ? "text-cyan" : "text-faint"}>
                        {t.tour ? `${t.tour.join(" → ")}${t.optimal ? " · optimal" : ""}` : "breaks a route rule"}
                      </span>
                      <span className="num text-right">{(t.prob * 100).toFixed(1)}%</span>
                      <span className="num text-right text-faint">{(t.ideal_prob * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="text-[11px] text-faint flex items-center gap-1.5">
                <ExternalLink size={11} /> {job.mode === "ibm"
                  ? "Measured on real superconducting qubits; the gap to the ideal simulator is hardware noise."
                  : "IBM Torino noise model (gate errors, readout errors, decoherence from IBM's calibration data). Switch to Real IBM QPU once a token is added."}
                {job.finished && ` · ${((job.finished - job.created)).toFixed(0)} s end to end`}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Compare({ title, hwLabel, hw, ideal, rnd, note }: { title: string; hwLabel: string; hw: number; ideal: number; rnd: number; note?: string }) {
  const max = Math.max(hw, ideal, rnd, 0.01);
  const row = (k: string, v: number, cls: string) => (
    <div className="grid grid-cols-[120px_1fr_56px] items-center gap-2 text-[12px]">
      <span className="text-dim">{k}</span>
      <div className="h-2.5 rounded-full bg-white/[0.05] overflow-hidden"><div className={`h-full rounded-full ${cls}`} style={{ width: `${(v / max) * 100}%` }} /></div>
      <span className="num text-right">{(v * 100).toFixed(1)}%</span>
    </div>
  );
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-3 flex flex-col gap-2">
      <div className="label">{title}</div>
      {row(hwLabel, hw, "bg-gradient-to-r from-cyan to-magenta")}
      {row("Ideal simulator", ideal, "bg-violet/70")}
      {row("Random guess", rnd, "bg-white/25")}
      {note && <div className="text-[11.5px] text-lime">{note}</div>}
    </div>
  );
}
