import { motion } from "motion/react";
import { AlarmClock, Bot, CheckCheck, Clock, Gauge, Loader2, MapPinned, Plus, Siren, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { inv } from "./api";
import { TRIGGER_TEXT, useSupply } from "./store";
import type { Rules } from "./types";
import { ago, inr0 } from "./ui";

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${on ? "bg-cyan" : "bg-white/15"}`}>
      <motion.span layout transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow ${on ? "right-0.5" : "left-0.5"}`} />
    </button>
  );
}

const TRIGGER_BADGE: Record<string, { label: string; cls: string; icon: typeof Bot }> = {
  critical: { label: "Critical request", cls: "text-danger bg-danger/10 border-danger/30", icon: Siren },
  load: { label: "Load threshold", cls: "text-cyan bg-cyan/10 border-cyan/30", icon: Gauge },
  schedule: { label: "Scheduled", cls: "text-violet bg-violet/10 border-violet/30", icon: AlarmClock },
  manual: { label: "Manual", cls: "text-dim bg-white/5 border-line", icon: CheckCheck },
};
export function TriggerBadge({ t }: { t: string }) {
  const b = TRIGGER_BADGE[t] ?? TRIGGER_BADGE.manual;
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10.5px] font-semibold ${b.cls}`}><b.icon size={11} />{b.label}</span>;
}

export function Autopilot() {
  const s = useSupply();
  const a = s.auto;
  const o = s.orgId!;
  const [load, setLoad] = useState<number | null>(null);
  const [newTime, setNewTime] = useState("17:00");
  const [saving, setSaving] = useState(false);
  useEffect(() => { void s.pollAuto(); }, [o]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!a) return <div className="h-full grid place-items-center text-dim text-sm"><Loader2 size={16} className="animate-spin" /></div>;
  const r = a.rules;
  const save = async (patch: Partial<Rules>) => {
    setSaving(true);
    try {
      const st = await inv.saveRules(o, patch);
      useSupply.getState().set({ auto: st });
    } catch (e) {
      useStore.getState().toast("err", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const threshold = load ?? r.load_pct;
  const fill = Math.min(100, a.load_pct);

  return (
    <div className="flex flex-col gap-4 max-w-[1100px]">
      {/* master switch */}
      <section className={`rounded-2xl border p-5 flex items-center gap-5 transition-colors ${r.enabled ? "border-cyan/50 bg-gradient-to-r from-cyan/[0.09] to-violet/[0.05]" : "border-line bg-white/[0.02]"}`}>
        <div className={`w-14 h-14 rounded-2xl grid place-items-center ${r.enabled ? "bg-cyan text-void shadow-[0_0_30px_-4px_rgba(0,229,255,0.8)]" : "bg-white/[0.06] text-dim"}`}>
          {a.running && a.running !== "checking" ? <Loader2 size={26} className="animate-spin" /> : <Bot size={26} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-semibold">Autopilot dispatch {r.enabled ? <span className="text-cyan">is on</span> : <span className="text-dim">is off</span>}</div>
          <div className="text-[13px] text-dim mt-0.5">
            {a.running && a.running !== "checking"
              ? `Planning a wave right now · ${TRIGGER_TEXT[a.running] ?? a.running}`
              : r.enabled
                ? `QFleet approves and dispatches on its own using the rules below.${a.next_time ? ` Next scheduled wave ${a.next_time}.` : ""}`
                : "Waves leave only when someone presses Plan & dispatch. Turn this on and the central store runs itself."}
          </div>
        </div>
        {saving && <Loader2 size={15} className="animate-spin text-dim" />}
        <Toggle on={r.enabled} label="Autopilot dispatch" onChange={(v) => save({ enabled: v })} />
      </section>

      {/* live gauges */}
      <section className="grid grid-cols-4 gap-3">
        <div className="col-span-2 rounded-xl border border-line bg-white/[0.02] p-4">
          <div className="flex items-baseline justify-between">
            <span className="label">Approved load waiting</span>
            <span className="num text-[13px]"><span className={a.load_pct >= threshold ? "text-cyan" : "text-ink"}>{a.load_pct.toFixed(0)}%</span> <span className="text-faint">of fleet capacity</span></span>
          </div>
          <div className="relative h-3 rounded-full bg-white/[0.06] mt-3 overflow-hidden">
            <motion.div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cyan to-violet" animate={{ width: `${fill}%` }} />
            <div className="absolute inset-y-[-3px] w-0.5 bg-amber" style={{ left: `${threshold}%` }} title="Dispatch threshold" />
          </div>
          <div className="flex justify-between text-[11px] text-faint mt-1.5">
            <span>{a.approved_kg.toFixed(0)} kg in {a.approved} approved requests</span>
            <span className="text-amber">threshold {threshold}% · {(a.capacity_kg * threshold / 100).toFixed(0)} kg</span>
          </div>
        </div>
        <Mini icon={Siren} k="Critical waiting" v={a.critical_waiting ? "Yes" : "None"} tone={a.critical_waiting ? "text-danger" : "text-lime"} />
        <Mini icon={Clock} k="Awaiting approval" v={String(a.pending)} tone={a.pending ? "text-amber" : "text-ink"} sub={`now ${a.now} IST`} />
      </section>

      {/* rules */}
      <section className={`grid grid-cols-2 gap-3 transition-opacity ${r.enabled ? "" : "opacity-60"}`}>
        <Rule icon={CheckCheck} title="Approve requests automatically" on={r.auto_approve} onToggle={(v) => save({ auto_approve: v })}
          text="Central stock is allocated the moment a request arrives, most urgent first. Requests the central store can't fill wait as backorders." />
        <Rule icon={Siren} title="Send critical requests at once" on={r.on_critical} onToggle={(v) => save({ on_critical: v })}
          text="If an approved request is critical (a life-critical item about to run out), a wave leaves immediately." />
        <div className="rounded-xl border border-line bg-white/[0.02] p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2"><Gauge size={16} className="text-cyan" /><span className="font-semibold text-[14px]">Dispatch when the vans are worth filling</span></div>
          <p className="text-[12px] text-dim leading-snug">A wave leaves once approved load reaches this share of the fleet's capacity, so vans don't drive half-empty.</p>
          <div className="flex items-center gap-3">
            <input type="range" min={10} max={100} step={5} value={threshold} className="flex-1"
              onChange={(e) => setLoad(Number(e.target.value))}
              onPointerUp={() => load !== null && save({ load_pct: load }).then(() => setLoad(null))}
              onKeyUp={() => load !== null && save({ load_pct: load }).then(() => setLoad(null))} aria-label="Load threshold" />
            <span className="num text-xl text-cyan w-14 text-right">{threshold}%</span>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-white/[0.02] p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2"><AlarmClock size={16} className="text-violet" /><span className="font-semibold text-[14px]">Fixed daily waves</span></div>
          <p className="text-[12px] text-dim leading-snug">Whatever is approved leaves at these times (India time), like a morning and an afternoon run.</p>
          <div className="flex flex-wrap items-center gap-2">
            {r.times.map((t) => (
              <span key={t} className={`inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg border text-[13px] num ${t === a.next_time ? "border-violet/60 bg-violet/10 text-violet" : "border-line"}`}>
                {t}
                <button className="p-0.5 rounded hover:bg-white/10" aria-label={`Remove ${t}`} onClick={() => save({ times: r.times.filter((x) => x !== t) })}><X size={12} /></button>
              </span>
            ))}
            <input type="time" className="input !py-1 w-[132px] num" value={newTime} onChange={(e) => setNewTime(e.target.value)} aria-label="New wave time" />
            <button className="btn !py-1 !px-2" disabled={!newTime || r.times.includes(newTime) || r.times.length >= 6}
              onClick={() => save({ times: [...r.times, newTime] })}><Plus size={13} /> Add</button>
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button className="btn" disabled={!r.enabled || !!a.running} onClick={async () => { await inv.runRules(o); setTimeout(() => s.pollAuto(), 1200); }}>
          <Zap size={14} /> Check the rules now
        </button>
        <span className="text-[11.5px] text-faint">Rules are also checked after every request, approval and simulated day, and once a minute.</span>
      </div>

      {/* history */}
      <section className="rounded-2xl border border-line bg-white/[0.02] p-4">
        <div className="label mb-2">Waves the autopilot sent</div>
        {a.auto_waves.length === 0 ? (
          <div className="text-[12.5px] text-dim py-3">None yet. Turn the autopilot on and simulate a day on the Overview: it will approve and dispatch by itself.</div>
        ) : (
          <div className="flex flex-col divide-y divide-line/60">
            {a.auto_waves.map((w) => (
              <div key={w.id} className="flex items-center gap-3 py-2.5 text-[13px]">
                <span className="num font-semibold w-20">{w.code}</span>
                <TriggerBadge t={w.trigger} />
                <span className="text-faint">{ago(w.created_at)}</span>
                <span className="text-dim">{w.stops} drops · {w.vehicles_used} vans</span>
                <div className="flex-1" />
                <span className="num">{inr0(w.cost_inr)}</span>
                <span className="text-lime text-[12px]">−{inr0(w.saved_inr)} vs legacy</span>
                <button className="btn !py-1" onClick={() => s.watch(w.id)}><MapPinned size={13} /> Watch</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Rule({ icon: Icon, title, text, on, onToggle }: { icon: typeof Bot; title: string; text: string; on: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div className={`rounded-xl border p-4 flex gap-3 ${on ? "border-cyan/30 bg-cyan/[0.03]" : "border-line bg-white/[0.02]"}`}>
      <Icon size={16} className={on ? "text-cyan mt-0.5" : "text-dim mt-0.5"} />
      <div className="flex-1">
        <div className="font-semibold text-[14px]">{title}</div>
        <p className="text-[12px] text-dim leading-snug mt-1">{text}</p>
      </div>
      <Toggle on={on} onChange={onToggle} label={title} />
    </div>
  );
}

function Mini({ icon: Icon, k, v, tone, sub }: { icon: typeof Bot; k: string; v: string; tone: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-4">
      <div className="label flex items-center gap-1.5"><Icon size={12} />{k}</div>
      <div className={`num text-2xl mt-2 ${tone}`}>{v}</div>
      {sub && <div className="text-[11px] text-faint mt-0.5">{sub}</div>}
    </div>
  );
}
