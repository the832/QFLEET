import { motion } from "motion/react";
import { ArrowRight, Atom, Gauge, Route, Warehouse } from "lucide-react";
import { useEffect, useState } from "react";
import { LogoMark } from "./Logo";
import { QuantumField } from "./QuantumField";

const BOOT = [
  "QFLEET kernel v1.0 · team NONCHALANT",
  "Loading road graph (OSRM) ............ OK",
  "Compiling path-integral SQA engine ... OK",
  "Initialising 16 Trotter replicas ..... OK",
  "Linking Qiskit QAOA circuit lab ...... OK",
  "Calibrating D-Wave Ocean samplers .... OK",
  "Fleet command center ready.",
];

const FEATURES = [
  { icon: Atom, title: "Quantum-planned dispatch", text: "Simulated quantum annealing + QAOA, polished by classical search" },
  { icon: Warehouse, title: "Supply Network", text: "Branches request stock, the central store approves, QFleet delivers" },
  { icon: Route, title: "Live disruption response", text: "Breakdowns, urgent orders and gridlock re-planned in < 1 s" },
  { icon: Gauge, title: "Proven vs baselines", text: "Benchmarked against OR-Tools and legacy dispatch" },
];

export function Landing({ onEnter }: { onEnter: () => void }) {
  const [lines, setLines] = useState(0);
  useEffect(() => {
    if (lines >= BOOT.length) return;
    const id = setTimeout(() => setLines((l) => l + 1), lines === 0 ? 500 : 260);
    return () => clearTimeout(id);
  }, [lines]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Enter" && onEnter();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onEnter]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-void scanlines">
      <div className="absolute inset-0 grid-bg opacity-60" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 45%, rgba(0,229,255,0.12), transparent 70%), radial-gradient(40% 40% at 70% 70%, rgba(255,61,172,0.10), transparent 70%)",
        }}
      />
      <QuantumField />

      <div className="relative z-10 h-full flex flex-col">
        <header className="flex items-center justify-between px-8 pt-6">
          <div className="flex items-center gap-3">
            <LogoMark size={30} spin />
            <span className="font-display text-xs tracking-[0.35em] text-dim">TEAM NONCHALANT</span>
          </div>
          <div className="label">Problem #12 · Quantum Fleet Management Optimization</div>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <LogoMark size={96} spin />
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 24, letterSpacing: "0.6em" }}
            animate={{ opacity: 1, y: 0, letterSpacing: "0.22em" }}
            transition={{ duration: 1.3, delay: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="mt-6 font-display font-black text-6xl md:text-8xl grad-text"
            style={{ filter: "drop-shadow(0 0 40px rgba(0,229,255,0.35))" }}
          >
            QFLEET
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9 }}
            className="mt-4 text-lg md:text-xl text-dim max-w-2xl"
          >
            Quantum-native fleet intelligence. Allocate, sequence and re-route an entire delivery fleet with{" "}
            <span className="text-cyan">quantum annealing</span> and <span className="text-magenta">QAOA circuits</span>.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.2 }}
            className="relative mt-8 glass hud rounded-xl px-5 py-4 font-mono text-[12px] text-left w-full max-w-lg"
          >
            {BOOT.slice(0, lines).map((l, i) => (
              <div key={i} className={i === BOOT.length - 1 ? "text-lime" : "text-dim"}>
                <span className="text-cyan">›</span> {l.replace(" OK", "")}
                {l.endsWith("OK") && <span className="text-lime"> OK</span>}
              </div>
            ))}
            {lines < BOOT.length && <div className="caret text-dim">&nbsp;</div>}
          </motion.div>

          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: lines >= BOOT.length ? 1 : 0.35, y: 0 }}
            transition={{ delay: 1.4 }}
            onClick={onEnter}
            className="btn-quantum mt-8 !px-8 !py-4 !text-sm flex items-center gap-3"
          >
            ENTER COMMAND CENTER <ArrowRight size={18} />
          </motion.button>
          <div className="mt-3 text-[11px] text-faint">
            press <span className="num text-dim">Enter</span>
          </div>
        </main>

        <footer className="grid grid-cols-2 md:grid-cols-4 gap-3 px-8 pb-8">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.5 + i * 0.12 }}
              className="glass rounded-xl p-4"
            >
              <f.icon size={18} className="text-cyan" />
              <div className="mt-2 text-sm font-semibold">{f.title}</div>
              <div className="text-xs text-dim mt-1">{f.text}</div>
            </motion.div>
          ))}
        </footer>
      </div>
    </div>
  );
}
