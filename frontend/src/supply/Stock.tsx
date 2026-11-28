import { PackagePlus, Search, Warehouse } from "lucide-react";
import { useMemo, useState } from "react";
import { useSupply } from "./store";
import type { StockCell } from "./types";

function cellStyle(c: StockCell | undefined, central: boolean): { bg: string; fg: string } {
  if (!c || (!central && c.daily_usage <= 0)) return { bg: "transparent", fg: "#3a4260" };
  if (central) return { bg: "rgba(157,123,255,0.12)", fg: "#d9ccff" };
  const cov = c.cover_days ?? 0;
  if (cov < 1) return { bg: "rgba(255,77,109,0.28)", fg: "#ffd0d9" };
  if (cov < c.reorder_days) return { bg: "rgba(255,196,0,0.2)", fg: "#ffe9a3" };
  const t = Math.min(1, (cov - c.reorder_days) / Math.max(1, c.target_days - c.reorder_days));
  return { bg: `rgba(140,255,92,${0.08 + 0.14 * t})`, fg: "#d6ffc4" };
}

export function Stock() {
  const s = useSupply();
  const m = s.stock;
  const [q, setQ] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const idx = useMemo(() => {
    const map = new Map<string, StockCell>();
    for (const c of m?.cells ?? []) map.set(`${c.location_id}:${c.product_id}`, c);
    return map;
  }, [m]);
  if (!m) return <div className="h-full grid place-items-center text-dim text-sm">Loading stock…</div>;

  const t = q.trim().toLowerCase();
  const products = m.products.filter((p) => {
    if (t && !p.name.toLowerCase().includes(t) && !p.sku.toLowerCase().includes(t) && !p.category.toLowerCase().includes(t)) return false;
    if (!onlyLow) return true;
    return m.locations.some((l) => {
      const c = idx.get(`${l.id}:${p.id}`);
      return l.kind !== "central" && c && c.daily_usage > 0 && (c.cover_days ?? 0) < c.reorder_days;
    });
  });

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input !pl-7 w-56" placeholder="Search product or category" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-[12px] text-dim cursor-pointer select-none">
          <input type="checkbox" className="accent-cyan" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Only products running low
        </label>
        <div className="flex-1" />
        <div className="flex items-center gap-3 text-[11px] text-dim">
          <Legend c="rgba(255,77,109,0.5)" t="< 1 day" />
          <Legend c="rgba(255,196,0,0.45)" t="below reorder" />
          <Legend c="rgba(140,255,92,0.35)" t="healthy" />
          <Legend c="rgba(157,123,255,0.35)" t="central store" />
        </div>
        <button className="btn btn-active" onClick={() => s.set({ drawer: { kind: "receive" } })}><PackagePlus size={14} /> Receive stock</button>
      </div>
      <p className="text-[11.5px] text-faint -mt-1">Each cell shows units on the shelf and days of cover (units ÷ daily usage). Click any cell to edit counts, usage or reorder rules.</p>

      <div className="flex-1 min-h-0 overflow-auto rounded-2xl border border-line">
        <table className="text-[12px] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 bg-[#0b1024] text-left label !text-[9px] px-3 py-2 min-w-[210px] border-b border-line">Product</th>
              {m.locations.map((l) => (
                <th key={l.id} className={`sticky top-0 z-20 bg-[#0b1024] px-1.5 py-2 border-b border-line min-w-[74px] align-bottom ${l.kind === "central" ? "text-violet" : "text-dim"}`}
                  title={`${l.name} · ${l.kind_label}`}>
                  <div className="flex flex-col items-center gap-0.5">
                    {l.kind === "central" ? <Warehouse size={13} /> : <span className="num text-[9px] text-faint">{l.code}</span>}
                    <span className="text-[10.5px] font-semibold leading-tight text-center line-clamp-2 max-w-[72px]">{l.kind === "central" ? "Central" : l.area}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td className="sticky left-0 z-10 bg-[#090d1d] px-3 py-1.5 border-b border-line/60">
                  <div className="font-medium flex items-center gap-1.5">{p.critical && <span className="text-danger text-[9px]" title="Life-critical / perishable">●</span>}{p.name}</div>
                  <div className="text-[10.5px] text-faint">{p.sku} · {p.unit}</div>
                </td>
                {m.locations.map((l) => {
                  const c = idx.get(`${l.id}:${p.id}`);
                  const central = l.kind === "central";
                  const st = cellStyle(c, central);
                  const stocked = c && (central || c.daily_usage > 0);
                  return (
                    <td key={l.id} className="p-[3px] border-b border-line/60">
                      <button
                        disabled={!stocked}
                        onClick={() => s.set({ drawer: central ? { kind: "receive", productId: p.id } : { kind: "cell", locationId: l.id, productId: p.id } })}
                        className="w-full h-[42px] rounded-lg flex flex-col items-center justify-center transition-transform hover:scale-[1.06] hover:ring-1 hover:ring-cyan/60 disabled:hover:scale-100 disabled:hover:ring-0 disabled:cursor-default"
                        style={{ background: st.bg, color: st.fg }}
                        title={stocked ? `${l.name}\n${p.name}: ${c!.qty} on shelf${c!.cover_days !== null ? ` · ${c!.cover_days} days of cover` : ""}${c!.on_order ? ` · ${c!.on_order} on order` : ""}` : "Not stocked here"}
                      >
                        {stocked ? (
                          <>
                            <span className="num text-[12.5px] font-semibold leading-none">{c!.qty.toLocaleString("en-IN")}</span>
                            {!central && <span className="text-[9.5px] opacity-80 leading-none mt-1">{(c!.cover_days ?? 0).toFixed(1)}d{c!.on_order ? " ↻" : ""}</span>}
                          </>
                        ) : <span className="text-[10px]">·</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Legend({ c, t }: { c: string; t: string }) {
  return <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: c }} />{t}</span>;
}
