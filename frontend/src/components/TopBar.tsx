import { Dices, Loader2, MapPinned, Sparkles, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Wordmark } from "./Logo";

const SOLVER_ORDER = ["quantum", "ortools", "sa", "greedy", "leap"];

export function TopBar() {
  const s = useStore();
  const solvers = s.meta?.solvers ?? {
    quantum: { short: "Quantum SQA", label: "", family: "quantum" },
    ortools: { short: "OR-Tools", label: "", family: "classical" },
    sa: { short: "Thermal SA", label: "", family: "classical" },
    greedy: { short: "Legacy", label: "", family: "baseline" },
  };
  const keys = SOLVER_ORDER.filter((k) => k in solvers);
  const src = s.plan?.matrix_source;

  return (
    <header className="absolute top-0 inset-x-0 z-30 h-16 px-4 flex items-center gap-3 glass border-x-0 border-t-0">
      <Wordmark compact />
      <div className="h-8 w-px bg-line mx-1" />

      {s.view === "supply" ? (
        <div className="flex items-center gap-2 text-[12px] text-dim">
          <span className="font-semibold text-ink">Supply Network</span>
          <span className="hidden xl:inline">· hub-and-spoke replenishment, every delivery wave planned by quantum annealing</span>
        </div>
      ) : (
      <div className="flex items-center gap-2">
        <MapPinned size={15} className="text-cyan" />
        <select
          className="input !py-1.5"
          value={s.city}
          onChange={(e) => {
            s.set({ city: e.target.value });
            setTimeout(() => useStore.getState().loadScenario(), 0);
          }}
        >
          {(s.meta?.cities ?? [{ key: "bengaluru", name: "Bengaluru" }]).map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
        <NumField label="Orders" title="Number of delivery orders (4–60) · Enter to generate" min={4} max={60} width="w-16"
          value={s.nOrders} onCommit={(v, go) => { s.set({ nOrders: v }); if (go) setTimeout(() => useStore.getState().loadScenario(), 0); }} />
        <NumField label="Fleet" title="Number of vehicles (2–10) · Enter to generate" min={2} max={10} width="w-14"
          value={s.nVehicles} onCommit={(v, go) => { s.set({ nVehicles: v }); if (go) setTimeout(() => useStore.getState().loadScenario(), 0); }} />
        <button
          className="btn !px-2.5"
          disabled={s.busy}
          title="New random operations"
          onClick={() => {
            s.set({ seed: Math.floor(Math.random() * 9999) });
            setTimeout(() => useStore.getState().loadScenario(), 0);
          }}
        >
          <Dices size={15} />
        </button>
        <button className="btn" onClick={() => s.loadScenario()} disabled={s.busy}>
          Generate
        </button>
      </div>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-1 p-1 rounded-xl border border-line bg-white/[0.02]">
        {keys.map((k) => (
          <button
            key={k}
            disabled={s.busy}
            title={s.plan ? `Re-plan the same orders with ${solvers[k].short}` : `Use ${solvers[k].short} for the next optimisation`}
            onClick={() => {
              const st = useStore.getState();
              if (k === st.solver || st.busy) return;
              st.set({ solver: k });
              if (st.plan && !st.demo) {
                // re-plan the same world the current plan started from, so solvers are comparable
                st.set({ simTime: st.planStart, playing: false });
                st.optimize(`Switched to ${solvers[k].short}`);
              }
            }}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
              s.solver === k
                ? solvers[k].family === "quantum"
                  ? "bg-gradient-to-r from-cyan/25 to-magenta/25 text-ink shadow-[0_0_18px_-4px_rgba(0,229,255,0.8)] border border-cyan/50"
                  : "bg-white/10 text-ink border border-white/20"
                : "text-dim hover:text-ink border border-transparent"
            }`}
          >
            {solvers[k].family === "quantum" && <Sparkles size={11} className="inline mr-1 -mt-0.5 text-cyan" />}
            {solvers[k].short}
          </button>
        ))}
      </div>

      {s.view !== "supply" && (
      <button className="btn-quantum flex items-center gap-2 whitespace-nowrap" onClick={() => s.optimize()} disabled={s.busy || !s.scenario}>
        {s.busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        {s.plan ? "RE-OPTIMIZE" : "OPTIMIZE FLEET"}
      </button>
      )}

      <div
        className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider px-2 py-1.5 rounded-md border border-line whitespace-nowrap"
        title={src === "osrm" ? "Live road network distances (OSRM)" : "Geodesic distance model"}
      >
        {src === "haversine" ? <WifiOff size={12} className="text-amber" /> : <Wifi size={12} className="text-lime" />}
        <span className="text-dim hidden 2xl:inline">{src === "haversine" ? "GEO MODEL" : "ROAD NETWORK"}</span>
      </div>
    </header>
  );
}

function NumField({ label, title, min, max, width, value, onCommit }: {
  label: string; title: string; min: number; max: number; width: string; value: number;
  onCommit: (v: number, generate: boolean) => void;
}) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(value)), [value]);
  const commit = (generate: boolean) => {
    const n = Math.round(Number(txt));
    const v = Number.isFinite(n) && txt.trim() !== "" ? Math.max(min, Math.min(max, n)) : value;
    setTxt(String(v));
    if (v !== value || generate) onCommit(v, generate);
  };
  return (
    <label className="flex items-center gap-1.5 text-xs text-dim" title={title}>
      <span className="hidden 2xl:inline">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        className={`input ${width} num !py-1.5`}
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => commit(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit(true);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setTxt(String(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}
