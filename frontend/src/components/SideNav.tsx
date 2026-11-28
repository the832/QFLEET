import { Atom, BarChart3, CalendarClock, Clapperboard, Radar, Square, Warehouse } from "lucide-react";
import { runDemo, runSupplyDemo, stopDemo } from "../lib/demo";
import { useStore, type View } from "../store";

const ITEMS: { key: View; icon: typeof Radar; label: string; hot: string }[] = [
  { key: "supply", icon: Warehouse, label: "Supply Network", hot: "5" },
  { key: "command", icon: Radar, label: "Command", hot: "1" },
  { key: "lab", icon: Atom, label: "Quantum Lab", hot: "2" },
  { key: "bench", icon: BarChart3, label: "Benchmark", hot: "3" },
  { key: "schedule", icon: CalendarClock, label: "Schedule", hot: "4" },
];

export function SideNav() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const demo = useStore((s) => s.demo);
  return (
    <nav className="absolute left-3 top-20 z-30 glass rounded-2xl p-1.5 flex flex-col gap-1 max-md:top-auto max-md:bottom-2 max-md:left-2 max-md:right-2 max-md:flex-row max-md:justify-between max-md:p-1">
      {ITEMS.map((it) => {
        const active = view === it.key;
        return (
          <button
            key={it.key}
            onClick={() => setView(it.key)}
            title={`${it.label} (${it.hot})`}
            className={`group relative w-12 h-12 max-md:w-auto max-md:flex-1 max-md:min-w-0 rounded-xl flex flex-col items-center justify-center transition-all ${
              active ? "bg-cyan/15 text-cyan shadow-[0_0_22px_-6px_rgba(0,229,255,0.9)]" : "text-dim hover:text-ink hover:bg-white/5"
            }`}
          >
            <it.icon size={19} />
            <span className="text-[8px] mt-0.5 font-semibold tracking-wide">{it.label.split(" ")[0]}</span>
            {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-cyan max-md:left-3 max-md:right-3 max-md:top-auto max-md:bottom-0.5 max-md:w-auto max-md:h-[3px]" />}
          </button>
        );
      })}
      <div className="h-px bg-line mx-2 my-1 max-md:hidden" />
      <button
        onClick={() => (demo ? stopDemo() : view === "supply" ? runSupplyDemo() : runDemo())}
        title={demo ? "Stop autopilot demo (Esc)" : "Autopilot demo (D)"}
        className={`w-12 h-12 max-md:w-auto max-md:flex-1 max-md:min-w-0 rounded-xl flex flex-col items-center justify-center transition-all ${
          demo ? "bg-magenta/20 text-magenta shadow-[0_0_22px_-6px_rgba(255,61,172,0.9)]" : "text-magenta/80 hover:text-magenta hover:bg-magenta/10"
        }`}
      >
        {demo ? <Square size={17} /> : <Clapperboard size={19} />}
        <span className="text-[8px] mt-0.5 font-semibold tracking-wide">{demo ? "Stop" : "Demo"}</span>
      </button>
    </nav>
  );
}
