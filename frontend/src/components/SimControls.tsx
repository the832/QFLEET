import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { useStore } from "../store";
import { clock, planEnd } from "../lib/sim";

const SPEEDS = [2, 4, 6, 12, 24];

/** Drives the simulation clock while playing. */
export function useSimLoop() {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const st = useStore.getState();
      if (st.playing && st.plan && !st.anneal) {
        const end = planEnd(st.plan) + 3;
        const t = st.simTime + dt * st.speed;
        if (t >= end) st.set({ simTime: end, playing: false });
        else st.set({ simTime: t });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}

export function SimControls() {
  const plan = useStore((s) => s.plan);
  const simTime = useStore((s) => s.simTime);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const planStart = useStore((s) => s.planStart);
  const set = useStore((s) => s.set);
  const end = planEnd(plan) + 3;
  const disabled = !plan;
  const pct = plan ? ((simTime - planStart) / Math.max(1, end - planStart)) * 100 : 0;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 glass hud rounded-2xl px-4 py-3 flex items-center gap-4 w-[min(620px,calc(100vw-790px))] min-w-[380px] max-[1180px]:left-[calc(50%-150px)]">
      <button
        className={`w-11 h-11 rounded-full flex items-center justify-center border transition-all ${
          playing ? "border-magenta/60 bg-magenta/15 text-magenta" : "border-cyan/60 bg-cyan/15 text-cyan"
        } disabled:opacity-40`}
        disabled={disabled}
        onClick={() => {
          if (!playing && simTime >= end - 0.01) set({ simTime: planStart });
          set({ playing: !playing });
        }}
        title="Play / pause (Space)"
      >
        {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
      </button>
      <div className="flex flex-col items-start leading-none">
        <span className="num text-2xl font-semibold glow-cyan">{clock(simTime)}</span>
        <span className="label mt-1">sim clock</span>
      </div>
      <div className="flex-1 flex flex-col gap-1.5">
        <input
          type="range"
          className="w-full"
          min={planStart}
          max={end}
          step={0.5}
          value={Math.min(simTime, end)}
          disabled={disabled}
          onChange={(e) => set({ simTime: +e.target.value, playing: false })}
        />
        <div className="flex justify-between text-[10px] num text-faint">
          <span>{clock(planStart)}</span>
          <span className="text-dim">{plan ? `${pct.toFixed(0)}% of plan` : "no plan yet"}</span>
          <span>{clock(end)}</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {SPEEDS.map((sp) => (
          <button
            key={sp}
            onClick={() => set({ speed: sp })}
            className={`num text-[11px] px-2 py-1 rounded-md border ${
              speed === sp ? "border-cyan/60 text-cyan bg-cyan/10" : "border-transparent text-dim hover:text-ink"
            }`}
            title={`${sp} simulated minutes per second`}
          >
            {sp}×
          </button>
        ))}
      </div>
      <button className="btn !p-2" disabled={disabled} onClick={() => set({ simTime: planStart, playing: false })} title="Rewind">
        <RotateCcw size={14} />
      </button>
    </div>
  );
}
