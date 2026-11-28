import { AnimatePresence, motion } from "motion/react";
import { Loader2, X } from "lucide-react";
import type { ReactNode } from "react";
import type { Priority } from "../types";
import type { ReqStatus } from "./types";

export const inr0 = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
export const lakhs = (v: number) =>
  v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)} L` : inr0(v);

export function ago(iso: string | null): string {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const timeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";

const PRIO: Record<Priority, string> = {
  critical: "text-danger border-danger/40 bg-danger/10",
  high: "text-amber border-amber/40 bg-amber/10",
  standard: "text-dim border-line bg-white/[0.03]",
};
export function PrioPill({ p }: { p: Priority }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wider ${PRIO[p]}`}>
      {p === "critical" && <span className="w-1.5 h-1.5 rounded-full bg-danger pulse-dot text-danger" />}
      {p}
    </span>
  );
}

export const STATUS: Record<ReqStatus, { label: string; cls: string }> = {
  pending: { label: "Awaiting approval", cls: "text-amber bg-amber/10 border-amber/30" },
  approved: { label: "Ready to dispatch", cls: "text-cyan bg-cyan/10 border-cyan/30" },
  dispatched: { label: "On the way", cls: "text-violet bg-violet/10 border-violet/30" },
  delivered: { label: "Delivered", cls: "text-lime bg-lime/10 border-lime/30" },
  rejected: { label: "Rejected", cls: "text-danger bg-danger/10 border-danger/30" },
  cancelled: { label: "Cancelled", cls: "text-faint bg-white/[0.03] border-line" },
};
export function StatusPill({ s }: { s: ReqStatus }) {
  const x = STATUS[s];
  return <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${x.cls}`}>{x.label}</span>;
}

/** colour for days-of-cover relative to the reorder point */
export function coverTone(cover: number | null, reorder = 3): { bar: string; text: string; label: string } {
  if (cover === null) return { bar: "bg-white/10", text: "text-faint", label: "not stocked" };
  if (cover < 1) return { bar: "bg-danger", text: "text-danger", label: "runs out today" };
  if (cover < reorder) return { bar: "bg-amber", text: "text-amber", label: "below reorder point" };
  return { bar: "bg-lime", text: "text-lime", label: "healthy" };
}

export function CoverBar({ cover, target = 7, reorder = 3 }: { cover: number | null; target?: number; reorder?: number }) {
  const t = coverTone(cover, reorder);
  const pct = cover === null ? 0 : Math.min(100, (cover / target) * 100);
  return (
    <div className="relative h-1.5 rounded-full bg-white/[0.06] overflow-hidden w-full">
      <div className={`absolute inset-y-0 left-0 rounded-full ${t.bar}`} style={{ width: `${pct}%` }} />
      <div className="absolute inset-y-0 w-px bg-white/40" style={{ left: `${(reorder / target) * 100}%` }} title="Reorder point" />
    </div>
  );
}

export function Kpi({ icon: Icon, label, value, sub, tone = "text-ink", hint }: {
  icon: typeof X; label: string; value: ReactNode; sub?: ReactNode; tone?: string; hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.025] px-3.5 py-3 flex flex-col gap-1 min-w-0" title={hint}>
      <div className="flex items-center gap-1.5 label !text-[9px]"><Icon size={12} className="text-dim" />{label}</div>
      <div className={`num text-[22px] leading-tight ${tone}`}>{value}</div>
      {sub && <div className="text-[11px] text-faint truncate">{sub}</div>}
    </div>
  );
}

export function Spin({ on, children }: { on: boolean; children: ReactNode }) {
  return on ? <Loader2 size={14} className="animate-spin" /> : <>{children}</>;
}

export function Empty({ icon: Icon, title, text, action }: { icon: typeof X; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 gap-2">
      <div className="w-12 h-12 rounded-2xl grid place-items-center bg-cyan/10 text-cyan mb-1"><Icon size={22} /></div>
      <div className="font-semibold">{title}</div>
      <p className="text-sm text-dim max-w-sm">{text}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Drawer({ open, title, sub, onClose, children, footer }: {
  open: boolean; title: string; sub?: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="absolute inset-0 z-40 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            className="absolute right-0 top-0 bottom-0 z-50 w-[440px] max-w-full glass-strong rounded-l-2xl flex flex-col"
            initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.22 }}
            role="dialog" aria-label={title}
          >
            <div className="px-5 pt-5 pb-3 flex items-start gap-3 border-b border-line">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-lg leading-tight">{title}</div>
                {sub && <div className="text-xs text-dim mt-1">{sub}</div>}
              </div>
              <button className="btn !p-1.5" onClick={onClose} aria-label="Close"><X size={15} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="px-5 py-4 border-t border-line flex gap-2 justify-end">{footer}</div>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 mb-4">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </label>
  );
}
