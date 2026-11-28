import { AnimatePresence, motion } from "motion/react";
import { FastForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import type { PlanResult } from "../types";

const FIRST_DURATION = 3200; // full show for the first plan
const REPLAN_DURATION = 1700; // snappier for live disruption re-plans
const PHASES = [
  { at: 0, text: "Encoding fleet into QUBO Hamiltonian" },
  { at: 0.12, text: "Superposition · transverse field Γ high" },
  { at: 0.38, text: "Quantum tunnelling through energy barriers" },
  { at: 0.7, text: "Trotter replicas collapsing · Γ → 0" },
  { at: 0.9, text: "Measuring ground state · decoding routes" },
];

function SpinGrid({ plan, progress }: { plan: PlanResult | null; progress: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const rep = plan?.quantum?.stage1.replicas;
    const P = rep?.P ?? 16;
    const n = rep?.n ?? 120;
    const W = cv.width,
      H = cv.height;
    const cw = W / n,
      ch = H / P;
    ctx.clearRect(0, 0, W, H);
    let frame: number[][] | null = null;
    if (rep) {
      const fi = Math.min(rep.frames.length - 1, Math.floor(progress * rep.frames.length));
      frame = rep.frames[fi];
    }
    for (let k = 0; k < P; k++) {
      for (let i = 0; i < n; i++) {
        const s = frame ? frame[k][i] : Math.random() < 0.5 ? 1 : -1;
        const up = s > 0;
        ctx.fillStyle = up ? `rgba(0,229,255,${0.35 + 0.6 * progress})` : `rgba(255,61,172,${0.12 + 0.2 * (1 - progress)})`;
        ctx.fillRect(i * cw + 0.5, k * ch + 0.5, Math.max(1, cw - 1), Math.max(1, ch - 1));
      }
    }
  }, [plan, progress]);
  return <canvas ref={ref} width={720} height={144} className="w-full h-[144px] rounded-lg" />;
}

function EnergyCurve({ plan, progress }: { plan: PlanResult | null; progress: number }) {
  const tr = plan?.quantum?.stage1.trace;
  const W = 720,
    H = 150;
  if (!tr) {
    // indeterminate wave while waiting for the backend
    const pts = Array.from({ length: 90 }, (_, i) => {
      const x = (i / 89) * W;
      const y = H / 2 + Math.sin(i / 5 + progress * 30) * 26 * Math.sin(i / 17 + progress * 8);
      return `${x},${y}`;
    }).join(" ");
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[150px]">
        <polyline points={pts} fill="none" stroke="rgba(0,229,255,0.6)" strokeWidth="2" />
      </svg>
    );
  }
  const e = tr.e_min;
  const g = tr.gamma;
  const lo = Math.min(...e),
    hi = Math.max(...e);
  const n = Math.max(2, Math.floor(e.length * progress));
  const toY = (v: number) => H - 10 - ((v - lo) / (hi - lo || 1)) * (H - 20);
  const ePts = e.slice(0, n).map((v, i) => `${(i / (e.length - 1)) * W},${toY(v)}`).join(" ");
  const gmax = Math.max(...g);
  const gPts = g.slice(0, n).map((v, i) => `${(i / (g.length - 1)) * W},${H - 10 - (v / gmax) * (H - 20)}`).join(" ");
  const last = ePts.split(" ").pop()!.split(",");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[150px]">
      <defs>
        <linearGradient id="eg" x1="0" x2="1">
          <stop offset="0" stopColor="#ff3dac" />
          <stop offset="1" stopColor="#00e5ff" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="rgba(120,160,255,0.08)" />
      ))}
      <polyline points={gPts} fill="none" stroke="rgba(157,123,255,0.55)" strokeWidth="1.5" strokeDasharray="4 4" />
      <polyline points={ePts} fill="none" stroke="url(#eg)" strokeWidth="2.5" style={{ filter: "drop-shadow(0 0 6px rgba(0,229,255,0.8))" }} />
      <circle cx={+last[0]} cy={+last[1]} r="5" fill="#00e5ff" style={{ filter: "drop-shadow(0 0 8px #00e5ff)" }} />
    </svg>
  );
}

export function AnnealOverlay() {
  const anneal = useStore((s) => s.anneal);
  const pending = useStore((s) => s.annealPending);
  const finish = useStore((s) => s.finishAnneal);
  const replans = useStore((s) => s.replans);
  const DURATION = replans > 0 ? REPLAN_DURATION : FIRST_DURATION;
  const [progress, setProgress] = useState(0);
  const [wait, setWait] = useState(0);
  const show = !!anneal || pending;

  useEffect(() => {
    if (!pending) return;
    let raf = 0;
    const t0 = performance.now();
    const loop = (t: number) => {
      setWait((t - t0) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [pending]);

  useEffect(() => {
    if (!anneal) return;
    setProgress(0);
    let raf = 0;
    const loop = (t: number) => {
      // rAF timestamps can precede startedAt by a frame: clamp to [0, 1]
      const p = Math.max(0, Math.min(1, (t - anneal.startedAt) / DURATION));
      setProgress(p);
      if (p >= 1) {
        setTimeout(finish, 350);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [anneal, finish, DURATION]);

  const plan = anneal?.plan ?? null;
  const q = plan?.quantum;
  const p = anneal ? progress : (wait % 1.6) / 1.6;
  const tr = q?.stage1.trace;
  const idx = tr ? Math.min(tr.gamma.length - 1, Math.floor(progress * (tr.gamma.length - 1))) : 0;
  const phase = (anneal && [...PHASES].reverse().find((ph) => progress >= ph.at)) || PHASES[0];

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 0.35 }}
          className="absolute inset-0 z-40 flex items-center justify-center bg-void/55 backdrop-blur-[3px]"
        >
          <motion.div
            initial={{ y: 20, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            className="glass-strong hud rounded-3xl p-6 w-[min(820px,92vw)] relative overflow-hidden scanlines"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="label text-cyan">Quantum processing unit · simulated</div>
                <div className="font-display text-2xl font-black tracking-[0.14em] grad-text mt-1">QUANTUM ANNEALING</div>
              </div>
              {anneal && (
                <button className="btn !text-xs" onClick={finish}>
                  <FastForward size={13} /> Skip
                </button>
              )}
            </div>
            <div className="mt-2 text-sm text-ink flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan pulse-dot text-cyan" />
              {phase.text}
              {!anneal && <span className="num text-dim">· {wait.toFixed(1)}s</span>}
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2">
              {[
                ["Logical qubits", q ? q.total_qubits : "—"],
                ["Trotter slices", q?.stage1.trotter_slices ?? 16],
                ["Transverse field Γ", tr ? tr.gamma[idx].toFixed(3) : "3.000"],
                ["Replica coupling J⊥", tr ? tr.j_perp[idx].toFixed(3) : "0.000"],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-xl border border-line bg-white/[0.03] px-3 py-2">
                  <div className="label !text-[9px]">{k}</div>
                  <div className="num text-lg text-cyan mt-0.5">{v}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-line bg-black/30 p-3">
              <div className="flex justify-between label !text-[9px]">
                <span>System energy ⟨H⟩ (ground-state search)</span>
                <span className="text-violet">— Γ schedule</span>
              </div>
              <EnergyCurve plan={plan} progress={p} />
            </div>
            <div className="mt-3 rounded-xl border border-line bg-black/30 p-3">
              <div className="flex justify-between label !text-[9px]">
                <span>Qubit spin states across Trotter replicas</span>
                <span>
                  <span className="text-cyan">■ |1⟩</span> <span className="text-magenta ml-2">■ |0⟩</span>
                </span>
              </div>
              <div className="mt-2">
                <SpinGrid plan={plan} progress={p} />
              </div>
            </div>
            <div className="mt-3 h-1 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-magenta via-violet to-cyan"
                style={{ width: `${(anneal ? progress : Math.min(0.95, wait / 4)) * 100}%` }}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
