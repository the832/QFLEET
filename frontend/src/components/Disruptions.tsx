import { AnimatePresence, motion } from "motion/react";
import { Activity, AlertTriangle, Atom, BarChart3, CircleDot, Info, RotateCcw, Siren, TrafficCone, Wrench, X } from "lucide-react";
import { useStore } from "../store";
import { clock } from "../lib/sim";
import type { FleetEvent } from "../types";

export function DisruptionDock() {
  const plan = useStore((s) => s.plan);
  const mode = useStore((s) => s.mapMode);
  const selected = useStore((s) => s.selectedVehicle);
  const busy = useStore((s) => s.busy);
  const set = useStore((s) => s.set);
  const breakdown = useStore((s) => s.breakdown);
  const resetDay = useStore((s) => s.resetDay);
  const scenario = useStore((s) => s.scenario);

  const simTime = useStore((s) => s.simTime);
  // a breakdown only matters for a vehicle that still has parcels on board
  const remaining = (id: string) => plan?.routes.find((r) => r.vehicle_id === id)?.stops.filter((s) => s.arrival > simTime).length ?? 0;
  const active = (id: string) => scenario?.vehicles.find((v) => v.id === id)?.status === "active";
  const target =
    (selected && active(selected) && remaining(selected) > 0 ? selected : undefined) ??
    plan?.routes
      .filter((r) => active(r.vehicle_id) && remaining(r.vehicle_id) > 0)
      .sort((a, b) => remaining(b.vehicle_id) - remaining(a.vehicle_id))[0]?.vehicle_id;

  return (
    <div className="absolute left-[76px] top-20 z-20 glass rounded-2xl p-3 w-[236px] max-md:left-2 max-md:top-[58px] max-md:w-[172px] max-md:p-2">
      <div className="label flex items-center gap-1.5">
        <Siren size={12} className="text-magenta" /> Disruption simulator
      </div>
      <div className="mt-2.5 flex flex-col gap-1.5">
        <button
          className="btn justify-start !text-[12px]"
          disabled={!plan || busy || !target}
          onClick={() => target && breakdown(target)}
          title={target ? `Break down ${target} now: its undelivered parcels are re-allocated` : "No vehicle has deliveries left: optimise or rewind first"}
        >
          <Wrench size={14} className="text-danger" /> Breakdown {target && <span className="num text-dim ml-auto">{target}</span>}
        </button>
        <button
          className={`btn justify-start !text-[12px] ${mode === "urgent" ? "btn-active" : ""}`}
          disabled={busy}
          onClick={() => set({ mapMode: mode === "urgent" ? "none" : "urgent" })}
        >
          <AlertTriangle size={14} className="text-amber" /> Urgent order
        </button>
        <button
          className={`btn justify-start !text-[12px] ${mode === "traffic" ? "btn-active" : ""}`}
          disabled={busy}
          onClick={() => set({ mapMode: mode === "traffic" ? "none" : "traffic" })}
        >
          <TrafficCone size={14} className="text-danger" /> Traffic gridlock
        </button>
        <button className="btn justify-start !text-[12px]" disabled={busy} onClick={resetDay}>
          <RotateCcw size={14} className="text-dim" /> Reset day
        </button>
      </div>
      <AnimatePresence>
        {mode !== "none" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2.5 text-[11px] rounded-lg border border-amber/40 bg-amber/10 text-amber px-2.5 py-2 flex items-start gap-2"
          >
            <CircleDot size={13} className="mt-0.5 shrink-0" />
            <span>
              Click anywhere on the map to {mode === "urgent" ? "drop a critical delivery" : "create a gridlock zone"}.
            </span>
            <button className="ml-auto" onClick={() => set({ mapMode: "none" })}>
              <X size={12} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const EV_ICON: Record<FleetEvent["kind"], { icon: typeof Info; cls: string }> = {
  plan: { icon: Atom, cls: "text-cyan" },
  breakdown: { icon: Wrench, cls: "text-danger" },
  urgent: { icon: AlertTriangle, cls: "text-amber" },
  traffic: { icon: TrafficCone, cls: "text-danger" },
  info: { icon: Info, cls: "text-dim" },
  compare: { icon: BarChart3, cls: "text-violet" },
};

export function EventFeed() {
  const events = useStore((s) => s.events);
  return (
    <div className="absolute left-[76px] bottom-4 z-20 glass rounded-2xl p-3 w-[300px] max-h-[34vh] hidden min-[1180px]:flex flex-col">
      <div className="label flex items-center gap-1.5">
        <Activity size={12} className="text-lime" /> Ops event stream
      </div>
      <div className="mt-2 overflow-y-auto flex flex-col gap-2 pr-1">
        <AnimatePresence initial={false}>
          {events.map((e) => {
            const I = EV_ICON[e.kind];
            return (
              <motion.div
                key={e.id}
                layout
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex gap-2 text-[11px]"
              >
                <I.icon size={13} className={`${I.cls} mt-0.5 shrink-0`} />
                <div className="min-w-0">
                  <div className="flex gap-2">
                    <span className="num text-faint">{clock(e.t)}</span>
                    <span className="text-ink font-semibold truncate">{e.title}</span>
                  </div>
                  <div className="text-dim leading-snug">{e.detail}</div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {!events.length && <div className="text-[11px] text-faint">Waiting for operations…</div>}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const annealing = useStore((s) => !!s.anneal || s.annealPending);
  if (annealing) return null; // the quantum overlay owns the screen; toasts stay queued until it closes
  const cls = {
    ok: "border-lime/40 text-lime",
    warn: "border-amber/50 text-amber",
    err: "border-danger/60 text-danger",
    quantum: "border-cyan/60 text-cyan shadow-[0_0_30px_-6px_rgba(0,229,255,0.8)]",
  };
  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center pointer-events-none max-md:top-[56px] max-md:w-[calc(100vw-16px)]">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            className={`glass-strong rounded-xl px-4 py-2 text-[12px] font-semibold border ${cls[t.kind]}`}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
