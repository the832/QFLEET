import { AnimatePresence, motion } from "motion/react";
import { Atom, Bot, Check, ChevronDown, ClipboardList, Plus, Search, User, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { inv } from "./api";
import { useSupply } from "./store";
import type { ReqStatus, Requisition } from "./types";
import { ago, Empty, inr0, PrioPill, Spin, STATUS, StatusPill, timeOf } from "./ui";

const FILTERS: (ReqStatus | "all" | "open")[] = ["open", "pending", "approved", "dispatched", "delivered", "rejected", "all"];
const FLABEL: Record<string, string> = { open: "Open", all: "All", ...Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v.label])) };
const PRANK = { critical: 0, high: 1, standard: 2 };

export function Requests({ locationId }: { locationId?: number }) {
  const s = useSupply();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("open");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const o = s.orgId!;
  const branchView = locationId !== undefined;

  const base = useMemo(() => s.reqs.filter((r) => !branchView || r.location_id === locationId), [s.reqs, branchView, locationId]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: base.length, open: 0 };
    for (const r of base) {
      c[r.status] = (c[r.status] ?? 0) + 1;
      if (["pending", "approved", "dispatched"].includes(r.status)) c.open++;
    }
    return c;
  }, [base]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return base
      .filter((r) => filter === "all" || (filter === "open" ? ["pending", "approved", "dispatched"].includes(r.status) : r.status === filter))
      .filter((r) => !t || r.code.toLowerCase().includes(t) || r.location.toLowerCase().includes(t) || r.lines.some((l) => l.name.toLowerCase().includes(t)))
      .sort((a, b) => PRANK[a.priority] - PRANK[b.priority] || (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }, [base, filter, q]);

  const selected = rows.filter((r) => sel.has(r.id));
  const selPending = selected.filter((r) => r.status === "pending").map((r) => r.id);
  const selApproved = selected.filter((r) => r.status === "approved").map((r) => r.id);
  const toggle = (id: number) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectable = (r: Requisition) => r.status === "pending" || r.status === "approved";

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl border border-line bg-white/[0.02]">
          {FILTERS.filter((f) => !branchView || ["open", "dispatched", "delivered", "all"].includes(f)).map((f) => (
            <button key={f} onClick={() => { setFilter(f); setSel(new Set()); }}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${filter === f ? "bg-cyan/15 text-cyan" : "text-dim hover:text-ink"}`}>
              {FLABEL[f]} <span className="num text-[10px] opacity-70 ml-0.5">{counts[f] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input className={`input !pl-7 ${branchView ? "w-40" : "w-56"}`} placeholder={branchView ? "Search" : "Search code, branch or product"} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex-1" />
        {!branchView && (
          <button className="btn" disabled={!!s.busy} onClick={() => s.act("indent", () => inv.autoIndent(o)).then((r) => r && useStore.getState().toast("ok", r.created ? `${r.created} new auto-indents raised` : "No branch is below its reorder point"))}>
            <Spin on={s.busy === "indent"}><Bot size={14} /></Spin> Run auto-indent
          </button>
        )}
        {!branchView && <button className="btn btn-active" onClick={() => s.set({ drawer: { kind: "request", locationId } })}><Plus size={14} /> New request</button>}
      </div>

      <div className="flex-1 min-h-0 overflow-auto rounded-2xl border border-line">
        {rows.length === 0 ? (
          <Empty icon={ClipboardList} title="Nothing here" text={filter === "open" ? "No open requests. Simulate a day on the overview, or raise a request." : "No requests match this filter."} />
        ) : (
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-[#0b1024]">
              <tr className="text-left label !text-[9px]">
                <th className="py-2.5 pl-3 w-8">
                  {!branchView && (
                    <input type="checkbox" aria-label="Select all" className="accent-cyan"
                      checked={rows.filter(selectable).length > 0 && rows.filter(selectable).every((r) => sel.has(r.id))}
                      onChange={(e) => setSel(e.target.checked ? new Set(rows.filter(selectable).map((r) => r.id)) : new Set())} />
                  )}
                </th>
                <th className="py-2.5 pr-3 font-semibold">Request</th>
                {!branchView && <th className="py-2.5 pr-3 font-semibold">Branch</th>}
                <th className="py-2.5 pr-3 font-semibold">Priority</th>
                <th className="py-2.5 pr-3 font-semibold">Items</th>
                <th className="py-2.5 pr-3 font-semibold text-right">Load</th>
                <th className="py-2.5 pr-3 font-semibold text-right">Value</th>
                <th className="py-2.5 pr-3 font-semibold">Status</th>
                <th className="py-2.5 pr-3 font-semibold">ETA</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <ReqRow key={r.id} r={r} branchView={branchView} open={open === r.id} onOpen={() => setOpen(open === r.id ? null : r.id)}
                  selected={sel.has(r.id)} onSelect={selectable(r) && !branchView ? () => toggle(r.id) : undefined} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AnimatePresence>
        {selected.length > 0 && (
          <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
            className="glass-strong rounded-xl px-4 py-2.5 flex items-center gap-3 self-center shadow-[0_0_40px_-10px_rgba(0,229,255,0.6)]">
            <span className="text-sm"><b className="num">{selected.length}</b> selected · {selected.reduce((a, r) => a + r.weight_kg, 0).toFixed(0)} kg</span>
            <button className="btn" disabled={!selPending.length || !!s.busy}
              onClick={() => s.act("approve", () => inv.approve(o, selPending)).then(() => setSel(new Set()))}>
              <Spin on={s.busy === "approve"}><Check size={14} /></Spin> Approve {selPending.length || ""}
            </button>
            <button className="btn-quantum !py-2 !text-[11px] inline-flex items-center gap-2" disabled={!selApproved.length || !!s.busy}
              onClick={() => s.dispatch(selApproved).then(() => setSel(new Set()))}>
              <Spin on={s.busy === "dispatch"}><Atom size={14} /></Spin> DISPATCH {selApproved.length || ""}
            </button>
            <button className="btn !px-2" onClick={() => setSel(new Set())} aria-label="Clear selection"><X size={14} /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReqRow({ r, open, onOpen, selected, onSelect, branchView }: {
  r: Requisition; open: boolean; onOpen: () => void; selected: boolean; onSelect?: () => void; branchView: boolean;
}) {
  const s = useSupply();
  const o = s.orgId!;
  const crit = r.lines.filter((l) => l.critical).length;
  return (
    <>
      <tr className={`border-t border-line/70 hover:bg-white/[0.025] cursor-pointer ${selected ? "bg-cyan/[0.06]" : ""}`} onClick={onOpen}>
        <td className="pl-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          {onSelect && <input type="checkbox" className="accent-cyan" checked={selected} onChange={onSelect} aria-label={`Select ${r.code}`} />}
        </td>
        <td className="pr-3 py-2.5">
          <div className="font-semibold num text-[12.5px] flex items-center gap-1.5">
            {r.code}
            <span title={r.source === "auto" ? "Raised automatically from stock levels" : "Raised by branch staff"}>
              {r.source === "auto" ? <Bot size={12} className="text-cyan" /> : <User size={12} className="text-dim" />}
            </span>
          </div>
          <div className="text-[11px] text-faint">{ago(r.created_at)}</div>
        </td>
        {!branchView && (
          <td className="pr-3 py-2.5 max-w-[220px]">
            <div className="truncate">{r.location}</div>
            <div className="text-[11px] text-faint truncate">{r.area}</div>
          </td>
        )}
        <td className="pr-3 py-2.5"><PrioPill p={r.priority} /></td>
        <td className="pr-3 py-2.5 text-dim">{r.lines.length} {r.lines.length === 1 ? "SKU" : "SKUs"}{crit ? <span className="text-danger"> · {crit} critical</span> : ""}</td>
        <td className="pr-3 py-2.5 text-right num">{r.weight_kg.toFixed(0)} kg</td>
        <td className="pr-3 py-2.5 text-right num text-dim">{inr0(r.value_inr)}</td>
        <td className="pr-3 py-2.5"><StatusPill s={r.status} /></td>
        <td className="pr-3 py-2.5 text-[12px]">
          {r.status === "dispatched" ? (
            <span className={r.late_min && r.late_min > 0.5 ? "text-amber" : "text-violet"}>{timeOf(r.eta)}</span>
          ) : r.status === "delivered" ? (
            <span className="text-lime">{timeOf(r.delivered_at)}</span>
          ) : <span className="text-faint">—</span>}
        </td>
        <td className="pr-2"><ChevronDown size={14} className={`text-faint transition-transform ${open ? "rotate-180" : ""}`} /></td>
      </tr>
      {open && (
        <tr className="bg-white/[0.015]">
          <td />
          <td colSpan={branchView ? 8 : 9} className="pb-4 pr-4">
            <div className="grid grid-cols-[1fr_auto] gap-6 pt-1">
              <div>
                <table className="w-full text-[12px]">
                  <thead><tr className="label !text-[9px] text-left"><th className="py-1">Product</th><th className="py-1 text-right">Requested</th><th className="py-1 text-right">Allocated</th></tr></thead>
                  <tbody>
                    {r.lines.map((l) => (
                      <tr key={l.id} className="border-t border-line/50">
                        <td className="py-1.5">{l.critical && <span className="text-danger mr-1">●</span>}{l.name} <span className="text-faint">· {l.unit}</span></td>
                        <td className="py-1.5 text-right num">{l.qty_requested}</td>
                        <td className={`py-1.5 text-right num ${r.status !== "pending" && l.qty_approved < l.qty_requested ? "text-amber" : ""}`}>
                          {r.status === "pending" ? "—" : l.qty_approved}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {r.note && <div className="text-[11.5px] text-faint mt-2">{r.note}</div>}
              </div>
              <div className="flex flex-col gap-2 min-w-[190px]">
                <Timeline r={r} />
                {!branchView && r.status === "pending" && (
                  <div className="flex gap-2 mt-1">
                    <button className="btn flex-1 justify-center" disabled={!!s.busy} onClick={() => s.act("approve", () => inv.approve(o, [r.id]))}><Check size={13} /> Approve</button>
                    <button className="btn !px-2.5" disabled={!!s.busy} title="Reject" onClick={() => s.act("reject", () => inv.reject(o, r.id))}><X size={13} /></button>
                  </div>
                )}
                {!branchView && r.status === "approved" && (
                  <button className="btn-quantum !py-2 !text-[11px] inline-flex items-center justify-center gap-2" disabled={!!s.busy} onClick={() => s.dispatch([r.id])}><Atom size={13} /> DISPATCH NOW</button>
                )}
                {r.status === "dispatched" && r.shipment_id && (
                  <div className="flex gap-2 mt-1">
                    <button className="btn flex-1 justify-center" disabled={!!s.busy} onClick={() => s.act("deliver", () => inv.deliver(o, r.shipment_id!, [r.id]))}><Check size={13} /> Confirm receipt</button>
                    <button className="btn" onClick={() => s.watch(r.shipment_id!)}>Track</button>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Timeline({ r }: { r: Requisition }) {
  const steps: [string, string | null][] = [
    ["Requested", r.created_at], ["Approved", r.approved_at], ["Dispatched", r.dispatched_at], ["Delivered", r.delivered_at],
  ];
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map(([label, at], i) => (
        <li key={label} className="flex items-center gap-2 text-[11.5px]">
          <span className={`w-2 h-2 rounded-full ${at ? "bg-cyan" : "bg-white/10"}`} />
          <span className={at ? "text-ink" : "text-faint"}>{label}</span>
          <span className="ml-auto text-faint">{at ? timeOf(at) : i === 3 && r.eta ? `ETA ${timeOf(r.eta)}` : ""}</span>
        </li>
      ))}
    </ol>
  );
}
