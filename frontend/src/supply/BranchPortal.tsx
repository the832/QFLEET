import { AlertTriangle, Building2, CheckCircle2, Clock, PackageCheck, Plus, Truck } from "lucide-react";
import { useMemo } from "react";
import { inv } from "./api";
import { useHealth } from "./Network";
import { Requests } from "./Requests";
import { useSupply } from "./store";
import { CoverBar, coverTone, timeOf } from "./ui";

export function BranchPortal() {
  const s = useSupply();
  const health = useHealth();
  const loc = s.stock?.locations.find((l) => l.id === s.branchId);
  const rows = useMemo(() => {
    if (!s.stock || !loc) return [];
    const prods = new Map(s.stock.products.map((p) => [p.id, p]));
    return s.stock.cells
      .filter((c) => c.location_id === loc.id && c.daily_usage > 0)
      .map((c) => ({ c, p: prods.get(c.product_id)! }))
      .sort((a, b) => (a.c.cover_days ?? 0) - (b.c.cover_days ?? 0));
  }, [s.stock, loc]);
  if (!loc) return <div className="h-full grid place-items-center text-dim text-sm">Pick a branch on the left.</div>;

  const h = health.get(loc.id);
  const incoming = s.reqs.filter((r) => r.location_id === loc.id && r.status === "dispatched");
  const low = rows.filter(({ c }) => (c.cover_days ?? 0) < c.reorder_days);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-line bg-gradient-to-r from-violet/[0.08] to-transparent p-4 flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl grid place-items-center bg-violet/15 text-violet"><Building2 size={22} /></div>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-semibold truncate">{loc.name}</div>
          <div className="text-[12px] text-dim">{loc.kind_label} · {loc.area} · {loc.code} · branch portal (what staff at this site see)</div>
        </div>
        <div className="text-right">
          <div className="num text-2xl" style={{ color: !h ? undefined : h.crit ? "#ff4d6d" : h.pct < 70 ? "#ffc400" : "#8cff5c" }}>{h ? `${h.pct.toFixed(0)}%` : "—"}</div>
          <div className="text-[11px] text-faint">items healthy</div>
        </div>
        <button className="btn btn-active" onClick={() => s.set({ drawer: { kind: "request", locationId: loc.id } })}><Plus size={14} /> Request stock</button>
      </div>

      {incoming.length > 0 && (
        <div className="rounded-2xl border border-violet/30 bg-violet/[0.05] p-3.5 flex flex-col gap-2">
          <div className="label !text-violet flex items-center gap-1.5"><Truck size={13} /> Deliveries on the way</div>
          {incoming.map((r) => (
            <div key={r.id} className="flex items-center gap-3 text-[13px]">
              <span className="num font-semibold">{r.code}</span>
              <span className="text-dim">{r.lines.length} products · {r.weight_kg.toFixed(0)} kg</span>
              <span className="flex items-center gap-1 text-violet"><Clock size={13} /> ETA {timeOf(r.eta)}</span>
              <div className="flex-1" />
              <button className="btn !py-1" onClick={() => s.watch(r.shipment_id!)}>Track van</button>
              <button className="btn btn-active !py-1" disabled={!!s.busy} onClick={() => s.act("deliver", () => inv.deliver(s.orgId!, r.shipment_id!, [r.id]))}>
                <PackageCheck size={14} /> Confirm receipt
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-3">
        <div className="rounded-2xl border border-line bg-white/[0.02] p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="label">My shelf · days of cover</div>
            <span className={`text-[11px] flex items-center gap-1 ${low.length ? "text-amber" : "text-lime"}`}>
              {low.length ? <><AlertTriangle size={12} /> {low.length} below reorder point</> : <><CheckCircle2 size={12} /> all healthy</>}
            </span>
          </div>
          <div className="flex flex-col gap-2.5 max-h-[460px] overflow-y-auto pr-1">
            {rows.map(({ c, p }) => {
              const t = coverTone(c.cover_days, c.reorder_days);
              return (
                <button key={p.id} className="text-left group" onClick={() => s.set({ drawer: { kind: "cell", locationId: loc.id, productId: p.id } })}>
                  <div className="flex items-baseline gap-2 text-[12.5px]">
                    <span className="font-medium truncate flex-1 group-hover:text-cyan">{p.critical && <span className="text-danger mr-1">●</span>}{p.name}</span>
                    <span className="num text-dim">{c.qty}</span>
                    <span className={`num w-12 text-right ${t.text}`}>{(c.cover_days ?? 0).toFixed(1)}d</span>
                  </div>
                  <div className="mt-1"><CoverBar cover={c.cover_days} target={c.target_days} reorder={c.reorder_days} /></div>
                  {c.on_order > 0 && <div className="text-[10.5px] text-violet mt-0.5">{c.on_order} on order</div>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-white/[0.02] p-3 min-h-[360px] flex flex-col">
          <div className="label mb-2 px-1">My requests</div>
          <div className="flex-1 min-h-0"><Requests locationId={loc.id} /></div>
        </div>
      </div>
    </div>
  );
}
