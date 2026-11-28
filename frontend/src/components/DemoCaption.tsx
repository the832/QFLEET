import { AnimatePresence, motion } from "motion/react";
import { Square } from "lucide-react";
import { useStore } from "../store";
import { stopDemo } from "../lib/demo";

export function DemoCaption() {
  const demo = useStore((s) => s.demo);
  const annealing = useStore((s) => !!s.anneal || s.annealPending);
  const slim = useStore((s) => s.view !== "command") && !annealing;
  return (
    <AnimatePresence>
      {demo && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className={`absolute left-1/2 -translate-x-1/2 z-[45] pointer-events-auto transition-all duration-500 ${
            annealing ? "top-[70px] scale-90 origin-top" : slim ? "bottom-1 scale-[0.8] origin-bottom" : "bottom-[104px]"
          }`}
        >
          <div className="glass-strong hud relative rounded-2xl px-6 py-4 min-w-[520px] max-w-[760px] text-center shadow-[0_0_60px_-10px_rgba(0,229,255,0.6)]">
            <div className="flex items-center justify-center gap-2 label !text-cyan">
              <span className="w-1.5 h-1.5 rounded-full bg-magenta pulse-dot text-magenta" /> autopilot · {demo.step}/{demo.total}
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={demo.caption} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                <div className="mt-1.5 text-xl font-semibold text-ink">{demo.caption}</div>
                {demo.sub && <div className="mt-1 text-[13px] text-dim">{demo.sub}</div>}
              </motion.div>
            </AnimatePresence>
            <div className="mt-3 flex items-center gap-1 justify-center">
              {Array.from({ length: demo.total }, (_, i) => (
                <span key={i} className={`h-1 rounded-full transition-all ${i < demo.step ? "w-6 bg-cyan" : "w-3 bg-white/15"}`} />
              ))}
            </div>
            <button className="absolute right-3 top-3 text-faint hover:text-ink flex items-center gap-1 text-[10px]" onClick={stopDemo} title="Stop demo (Esc)">
              <Square size={10} /> ESC
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
