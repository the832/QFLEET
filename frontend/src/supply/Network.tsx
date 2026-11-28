import { Building2, Plus, Warehouse } from "lucide-react";
import { useMemo, useState } from "react";
import { useSupply } from "./store";
import type { Location } from "./types";

interface Health { pct: number; low: number; crit: number; lines: number; open: number }

export function useHealth(): Map<number, Health> {
  const s = useSupply();
  return useMemo(() => {
    const h = new Map<number, Health>();
    const prods = new Map((s.stock?.products ?? []).map((p) => [p.id, p]));
    for (const c of s.stock?.cells ?? []) {
      if (c.daily_usage <= 0) continue;
      const x = h.get(c.location_id) ?? { pct: 0, low: 0, crit: 0, lines: 0, open: 0 };
      x.lines++;
      const cov = c.cover_days ?? 0;
      if (cov < c.reorder_days) {
        x.low++;
        if (prods.get(c.product_id)?.critical && cov < 1) x.crit++;
      }
      h.set(c.location_id, x);
    }
    for (const r of s.reqs) {
      if (!["pending", "approved", "dispatched"].includes(r.status)) continue;
      const x = h.get(r.location_id);
      if (x) x.open++;
    }
    for (const x of h.values()) x.pct = x.lines ? (100 * (x.lines - x.low)) / x.lines : 100;
    return h;
  }, [s.stock, s.reqs]);
}

const tone = (h?: Health) => (!h ? "#56607e" : h.crit ? "#ff4d6d" : h.pct < 70 ? "#ffc400" : "#8cff5c");

export function Network() {
  const s = useSupply();
  const health = useHealth();
  const [hover, setHover] = useState<number | null>(null);
  const locs = s.stock?.locations ?? [];
  const central = locs.find((l) => l.kind === "central");
  const branches = locs.filter((l) => l.kind !== "central");

  // equirectangular projection fitted to the network's bounding box
  const W = 620, H = 470, P = 40;
  const proj = useMemo(() => {
    if (!locs.length) return (_: Location) => [0, 0] as [number, number];
    const lat0 = locs.reduce((a, l) => a + l.lat, 0) / locs.length;
    const kx = Math.cos((lat0 * Math.PI) / 180);
    const xs = locs.map((l) => l.lng * kx), ys = locs.map((l) => l.lat);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const sc = Math.min((W - 2 * P) / (x1 - x0 || 1), (H - 2 * P) / (y1 - y0 || 1));
    const ox = (W - (x1 - x0) * sc) / 2, oy = (H - (y1 - y0) * sc) / 2;
    return (l: Location) => [ox + (l.lng * kx - x0) * sc, H - (oy + (l.lat - y0) * sc)] as [number, number];
  }, [locs]);

  if (!central) return <div className="h-full grid place-items-center text-dim text-sm">Loading network…</div>;
  const [cx, cy] = proj(central);

  return (
    <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-3 h-full min-h-0">
      <div className="rounded-2xl border border-line bg-[radial-gradient(ellipse_at_center,rgba(0,229,255,0.06),transparent_70%)] relative overflow-hidden">
        <div className="absolute left-4 top-3 label">Hub-and-spoke network · {s.overview?.org.city_name}</div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" role="img" aria-label="Map of the central store and its branches, coloured by stock health">
          <defs>
            <radialGradient id="hubGlow"><stop offset="0%" stopColor="#9d7bff" stopOpacity="0.55" /><stop offset="100%" stopColor="#9d7bff" stopOpacity="0" /></radialGradient>
          </defs>
          {branches.map((b) => {
            const [x, y] = proj(b);
            const h = health.get(b.id);
            const active = hover === b.id;
            return <line key={`l${b.id}`} x1={cx} y1={cy} x2={x} y2={y} stroke={tone(h)} strokeOpacity={active ? 0.8 : 0.22} strokeWidth={active ? 2 : 1} strokeDasharray={h?.open ? "4 4" : undefined}>
              {h?.open ? <animate attributeName="stroke-dashoffset" from="16" to="0" dur="1s" repeatCount="indefinite" /> : null}
            </line>;
          })}
          <circle cx={cx} cy={cy} r={46} fill="url(#hubGlow)" />
          <rect x={cx - 11} y={cy - 11} width={22} height={22} rx={6} fill="#9d7bff" />
          <text x={cx} y={cy + 30} textAnchor="middle" fontSize="11" fill="#d9ccff" fontWeight="600">Central store</text>
          {branches.map((b) => {
            const [x, y] = proj(b);
            const h = health.get(b.id);
            const active = hover === b.id;
            return (
              <g key={b.id} onMouseEnter={() => setHover(b.id)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}
                onClick={() => s.set({ role: "branch", branchId: b.id })}>
                {h?.crit ? <circle cx={x} cy={y} r={14} fill="#ff4d6d" opacity={0.18}><animate attributeName="r" values="9;17;9" dur="1.8s" repeatCount="indefinite" /></circle> : null}
                <circle cx={x} cy={y} r={active ? 9 : 7} fill={tone(h)} stroke="#03040a" strokeWidth={2} />
                <text x={x} y={y - 12} textAnchor="middle" fontSize={active ? 11.5 : 10} fill={active ? "#e8f1ff" : "#8a96b8"} fontWeight={active ? 600 : 400}>{b.area}</text>
              </g>
            );
          })}
        </svg>
        <div className="absolute left-4 bottom-3 flex gap-4 text-[11px] text-dim">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-lime" />healthy</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber" />running low</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-danger" />critical item out today</span>
          <span className="text-faint">dashed = delivery requested · click a branch to open its portal</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 min-h-0">
        <div className="flex items-center justify-between">
          <div className="label">{branches.length} registered sub-inventories</div>
          <button className="btn btn-active" onClick={() => s.set({ drawer: { kind: "branch" } })}><Plus size={14} /> Register branch</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 pr-1">
          <LocRow l={central} icon={Warehouse} sub="Holds network stock · ships every wave" />
          {[...branches].sort((a, b) => (health.get(a.id)?.pct ?? 100) - (health.get(b.id)?.pct ?? 100)).map((b) => {
            const h = health.get(b.id);
            return (
              <div key={b.id} onMouseEnter={() => setHover(b.id)} onMouseLeave={() => setHover(null)}>
                <LocRow l={b} icon={Building2} health={h} active={hover === b.id}
                  sub={h ? `${h.low} of ${h.lines} items low${h.open ? ` · ${h.open} open request${h.open > 1 ? "s" : ""}` : ""}` : "No usage profile yet"} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LocRow({ l, icon: Icon, sub, health, active }: { l: Location; icon: typeof Building2; sub: string; health?: Health; active?: boolean }) {
  const s = useSupply();
  return (
    <button onClick={() => l.kind !== "central" && s.set({ role: "branch", branchId: l.id })}
      className={`w-full text-left rounded-xl border px-3 py-2.5 flex items-center gap-3 transition-colors ${active ? "border-cyan/60 bg-cyan/[0.05]" : "border-line bg-white/[0.02] hover:border-cyan/40"}`}>
      <div className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: `${tone(health)}22`, color: l.kind === "central" ? "#9d7bff" : tone(health) }}>
        <Icon size={15} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium truncate">{l.name}</div>
        <div className="text-[11px] text-faint truncate">{l.kind_label} · {sub}</div>
      </div>
      {health && (
        <div className="w-16 text-right">
          <div className="num text-[13px]" style={{ color: tone(health) }}>{health.pct.toFixed(0)}%</div>
          <div className="text-[9.5px] text-faint">healthy</div>
        </div>
      )}
    </button>
  );
}
