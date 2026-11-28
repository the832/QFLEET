import { Minus, Plus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { inv } from "./api";
import { useSupply } from "./store";
import { CoverBar, Drawer, Field, inr0, Spin } from "./ui";

const toast = (t: string) => useStore.getState().toast("ok", t);

export function Drawers() {
  const d = useSupply((s) => s.drawer);
  const close = () => useSupply.getState().set({ drawer: null });
  return (
    <>
      <RequestDrawer open={d?.kind === "request"} locationId={d?.kind === "request" ? d.locationId : undefined} onClose={close} />
      <BranchDrawer open={d?.kind === "branch"} onClose={close} />
      <OrgDrawer open={d?.kind === "org"} onClose={close} />
      <CellDrawer open={d?.kind === "cell"} ids={d?.kind === "cell" ? [d.locationId, d.productId] : null} onClose={close} />
      <ReceiveDrawer open={d?.kind === "receive"} productId={d?.kind === "receive" ? d.productId : undefined} onClose={close} />
    </>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" className="btn !p-1" onClick={() => onChange(Math.max(0, value - 1))} aria-label="Less"><Minus size={12} /></button>
      <input className="input !py-1 w-16 text-center num" inputMode="numeric" value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(99999, Number(e.target.value.replace(/\D/g, "")) || 0)))} />
      <button type="button" className="btn !p-1" onClick={() => onChange(value + 1)} aria-label="More"><Plus size={12} /></button>
    </div>
  );
}

function RequestDrawer({ open, locationId, onClose }: { open: boolean; locationId?: number; onClose: () => void }) {
  const s = useSupply();
  const branches = (s.stock?.locations ?? []).filter((l) => l.kind !== "central");
  const [loc, setLoc] = useState<number | null>(null);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [prio, setPrio] = useState<string>("auto");
  const [note, setNote] = useState("");

  const lid = loc ?? locationId ?? branches[0]?.id ?? null;
  const rows = useMemo(() => {
    if (!s.stock || lid === null) return [];
    const cells = new Map(s.stock.cells.filter((c) => c.location_id === lid).map((c) => [c.product_id, c]));
    return s.stock.products.map((p) => {
      const c = cells.get(p.id);
      const suggest = c && c.daily_usage > 0 ? Math.max(0, Math.ceil(c.daily_usage * c.target_days - c.qty - c.on_order)) : 0;
      return { p, c, suggest };
    }).filter((r) => r.c && r.c.daily_usage > 0).sort((a, b) => (a.c!.cover_days ?? 0) - (b.c!.cover_days ?? 0));
  }, [s.stock, lid]);

  useEffect(() => { if (open) { setLoc(locationId ?? null); setQty({}); setPrio("auto"); setNote(""); } }, [open, locationId]);

  const lines = Object.entries(qty).filter(([, q]) => q > 0).map(([pid, q]) => ({ product_id: Number(pid), qty: q }));
  const weight = lines.reduce((a, l) => a + l.qty * (s.stock?.products.find((p) => p.id === l.product_id)?.unit_weight_kg ?? 0), 0);
  const value = lines.reduce((a, l) => a + l.qty * (s.stock?.products.find((p) => p.id === l.product_id)?.unit_cost_inr ?? 0), 0);

  return (
    <Drawer open={open} onClose={onClose} title="Raise a stock request" sub="Quantities default to nothing; tap Suggest to top up to the target cover."
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-active" disabled={!lines.length || lid === null || !!s.busy}
          onClick={() => s.act("request", () => inv.createRequisition(s.orgId!, { location_id: lid!, lines, priority: prio === "auto" ? null : prio, note }))
            .then((r) => { if (r) { toast(`${r.code} raised · priority ${r.priority}`); onClose(); } })}>
          <Spin on={s.busy === "request"}><Plus size={14} /></Spin> Submit {lines.length ? `${lines.length} items · ${weight.toFixed(0)} kg` : ""}
        </button>
      </>}>
      <Field label="Requesting branch">
        <select className="input" value={lid ?? ""} disabled={locationId !== undefined && s.role === "branch"} onChange={(e) => { setLoc(Number(e.target.value)); setQty({}); }}>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </Field>
      <div className="flex items-center justify-between mb-2">
        <span className="label">Products</span>
        <button className="text-[11.5px] text-cyan hover:underline flex items-center gap-1"
          onClick={() => setQty(Object.fromEntries(rows.filter((r) => r.suggest > 0).map((r) => [r.p.id, r.suggest])))}>
          <Sparkles size={12} /> Suggest from stock levels
        </button>
      </div>
      <div className="flex flex-col gap-2 mb-4">
        {rows.map(({ p, c, suggest }) => (
          <div key={p.id} className={`rounded-lg border px-3 py-2 ${qty[p.id] ? "border-cyan/50 bg-cyan/[0.04]" : "border-line"}`}>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-medium truncate">{p.critical && <span className="text-danger mr-1">●</span>}{p.name}</div>
                <div className="text-[10.5px] text-faint">{c!.qty} on shelf · {(c!.cover_days ?? 0).toFixed(1)} days{suggest ? ` · suggest ${suggest}` : ""}</div>
              </div>
              <Stepper value={qty[p.id] ?? 0} onChange={(v) => setQty({ ...qty, [p.id]: v })} />
            </div>
            <div className="mt-1.5"><CoverBar cover={c!.cover_days} target={c!.target_days} reorder={c!.reorder_days} /></div>
          </div>
        ))}
      </div>
      <Field label="Priority" hint="Auto sets urgency from how soon this branch runs out of each item.">
        <div className="flex gap-1 p-1 rounded-xl border border-line">
          {["auto", "critical", "high", "standard"].map((p) => (
            <button key={p} type="button" onClick={() => setPrio(p)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize ${prio === p ? "bg-cyan/15 text-cyan" : "text-dim"}`}>{p}</button>
          ))}
        </div>
      </Field>
      <Field label="Note for the central store">
        <textarea className="input min-h-[60px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
      </Field>
      {lines.length > 0 && <div className="text-[12px] text-dim">Load {weight.toFixed(0)} kg · value {inr0(value)}</div>}
    </Drawer>
  );
}

function BranchDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSupply();
  const org = s.overview?.org;
  const sector = org ? s.templates?.sectors[org.sector] : undefined;
  const areas = s.templates?.cities.find((c) => c.key === org?.city)?.areas ?? [];
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [area, setArea] = useState("");
  const [contact, setContact] = useState("");
  useEffect(() => { if (open) { setKind(sector?.kinds[0]?.key ?? ""); setArea(areas[0] ?? ""); setName(""); setContact(""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = sector?.kinds.find((k) => k.key === kind)?.label ?? "";
  const finalName = name.trim() || (label && area ? `${label} · ${area}` : "");
  return (
    <Drawer open={open} onClose={onClose} title="Register a sub-inventory" sub={`A new ${sector?.label.toLowerCase() ?? ""} site in ${org?.city_name ?? ""} that can request stock from the central store.`}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-active" disabled={!finalName || !kind || !area || !!s.busy}
          onClick={() => s.act("branch", () => inv.registerBranch(s.orgId!, { name: finalName, kind, area, contact }))
            .then((l) => { if (l) { toast(`${l.name} registered (${l.code})`); onClose(); } })}>
          <Spin on={s.busy === "branch"}><Plus size={14} /></Spin> Register
        </button>
      </>}>
      <Field label="Type of site">
        <div className="grid grid-cols-2 gap-1.5">
          {sector?.kinds.map((k) => (
            <button key={k.key} type="button" onClick={() => setKind(k.key)}
              className={`py-2 rounded-lg border text-[12.5px] font-medium ${kind === k.key ? "border-cyan/60 bg-cyan/10 text-cyan" : "border-line text-dim"}`}>{k.label}</button>
          ))}
        </div>
      </Field>
      <Field label="Area" hint="Placed on the real road network of this neighbourhood.">
        <select className="input" value={area} onChange={(e) => setArea(e.target.value)}>
          {areas.map((a) => <option key={a}>{a}</option>)}
        </select>
      </Field>
      <Field label="Name" hint="Leave empty to use the suggested name.">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={label && area ? `${label} · ${area}` : ""} />
      </Field>
      <Field label="Contact">
        <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Store-keeper or phone (optional)" />
      </Field>
      <p className="text-[11.5px] text-faint">The site starts with an empty shelf and a typical usage profile for its type, so the next auto-indent will stock it.</p>
    </Drawer>
  );
}

function OrgDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSupply();
  const t = s.templates;
  const [name, setName] = useState("");
  const [sector, setSector] = useState("healthcare");
  const [city, setCity] = useState("kolkata");
  const [n, setN] = useState(10);
  useEffect(() => { if (open) { setName(""); } }, [open]);
  return (
    <Drawer open={open} onClose={onClose} title="Create your organisation" sub="Start from a template: a central store, branches across the city, a product catalogue and a 5-vehicle fleet."
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-active" disabled={name.trim().length < 2 || !!s.busy}
          onClick={async () => {
            const org = await s.act("org", () => inv.createOrg({ name: name.trim(), sector, city, branches: n }), []);
            if (org) {
              const orgs = await inv.orgs();
              s.set({ orgs });
              await s.selectOrg(org.id);
              toast(`${org.name} is ready`);
              onClose();
            }
          }}>
          <Spin on={s.busy === "org"}><Plus size={14} /></Spin> Create
        </button>
      </>}>
      <Field label="Organisation name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sunrise Hospitals" autoFocus />
      </Field>
      <Field label="Sector template">
        <div className="flex flex-col gap-1.5">
          {t && Object.entries(t.sectors).map(([k, v]) => (
            <button key={k} type="button" onClick={() => setSector(k)}
              className={`text-left rounded-lg border px-3 py-2 ${sector === k ? "border-cyan/60 bg-cyan/10" : "border-line"}`}>
              <div className={`text-[13px] font-semibold ${sector === k ? "text-cyan" : ""}`}>{v.label}</div>
              <div className="text-[11px] text-faint">{v.tagline} · {v.products} SKUs · {v.kinds.map((x) => x.label).join(", ")}</div>
            </button>
          ))}
        </div>
      </Field>
      <Field label="City">
        <select className="input" value={city} onChange={(e) => setCity(e.target.value)}>
          {t?.cities.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
        </select>
      </Field>
      <Field label={`Branches: ${n}`}>
        <input type="range" min={3} max={18} value={n} onChange={(e) => setN(Number(e.target.value))} />
      </Field>
    </Drawer>
  );
}

function CellDrawer({ open, ids, onClose }: { open: boolean; ids: [number, number] | null; onClose: () => void }) {
  const s = useSupply();
  const c = ids ? s.stock?.cells.find((x) => x.location_id === ids[0] && x.product_id === ids[1]) : undefined;
  const loc = ids ? s.stock?.locations.find((l) => l.id === ids[0]) : undefined;
  const p = ids ? s.stock?.products.find((x) => x.id === ids[1]) : undefined;
  const [qty, setQty] = useState(0);
  const [usage, setUsage] = useState(0);
  const [reorder, setReorder] = useState(3);
  const [target, setTarget] = useState(7);
  useEffect(() => { if (open && c) { setQty(c.qty); setUsage(c.daily_usage); setReorder(c.reorder_days); setTarget(c.target_days); } }, [open, c?.location_id, c?.product_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const cover = usage > 0 ? qty / usage : null;
  return (
    <Drawer open={open && !!c} onClose={onClose} title={p?.name ?? ""} sub={`${loc?.name ?? ""} · ${p?.sku ?? ""} · ${p?.unit ?? ""}`}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-active" disabled={!!s.busy}
          onClick={() => s.act("adjust", () => inv.adjust(s.orgId!, { location_id: ids![0], product_id: ids![1], qty, daily_usage: usage, reorder_days: reorder, target_days: target }))
            .then((r) => { if (r) { toast("Stock rule saved"); onClose(); } })}>
          <Spin on={s.busy === "adjust"}><Sparkles size={14} /></Spin> Save
        </button>
      </>}>
      <div className="rounded-xl border border-line p-3 mb-4">
        <div className="flex items-baseline gap-2"><span className="num text-3xl">{cover === null ? "—" : cover.toFixed(1)}</span><span className="text-dim text-sm">days of cover</span></div>
        <div className="mt-2"><CoverBar cover={cover} target={target} reorder={reorder} /></div>
        <div className="text-[11px] text-faint mt-2">Auto-indent triggers below {reorder} days and orders up to {target} days ({Math.ceil(usage * target)} units).</div>
      </div>
      <Field label="Units on shelf (stock count)" hint="Changing this records a count correction in the ledger."><Stepper value={qty} onChange={setQty} /></Field>
      <Field label={`Daily usage: ${usage.toFixed(1)} units / day`}>
        <input type="range" min={0} max={Math.max(10, Math.ceil(usage * 3))} step={0.1} value={usage} onChange={(e) => setUsage(Number(e.target.value))} />
      </Field>
      <Field label={`Reorder point: ${reorder} days`}><input type="range" min={0.5} max={10} step={0.5} value={reorder} onChange={(e) => setReorder(Number(e.target.value))} /></Field>
      <Field label={`Order up to: ${target} days`}><input type="range" min={reorder + 1} max={21} step={0.5} value={Math.max(target, reorder + 1)} onChange={(e) => setTarget(Number(e.target.value))} /></Field>
    </Drawer>
  );
}

function ReceiveDrawer({ open, productId, onClose }: { open: boolean; productId?: number; onClose: () => void }) {
  const s = useSupply();
  const prods = s.stock?.products ?? [];
  const [pid, setPid] = useState<number | null>(null);
  const [qty, setQty] = useState(0);
  const p = prods.find((x) => x.id === (pid ?? productId ?? prods[0]?.id));
  const central = s.stock?.locations.find((l) => l.kind === "central");
  const onShelf = s.stock?.cells.find((c) => c.location_id === central?.id && c.product_id === p?.id)?.qty ?? 0;
  const network = (s.stock?.cells ?? []).filter((c) => c.product_id === p?.id && c.location_id !== central?.id).reduce((a, c) => a + c.daily_usage, 0);
  const suggest = Math.max(0, Math.ceil(network * 21 - onShelf));
  useEffect(() => { if (open) { setPid(productId ?? null); setQty(0); } }, [open, productId]);
  return (
    <Drawer open={open} onClose={onClose} title="Receive stock at the central store" sub="Record a purchase or supplier delivery."
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-active" disabled={!p || qty <= 0 || !!s.busy}
          onClick={() => s.act("receive", () => inv.receive(s.orgId!, p!.id, qty)).then((r) => { if (r) { toast(`${qty} × ${p!.name} received`); onClose(); } })}>
          <Spin on={s.busy === "receive"}><Plus size={14} /></Spin> Receive {qty || ""}
        </button>
      </>}>
      <Field label="Product">
        <select className="input" value={p?.id ?? ""} onChange={(e) => { setPid(Number(e.target.value)); setQty(0); }}>
          {prods.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.unit}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="rounded-lg bg-white/[0.03] p-3"><div className="label !text-[9px]">On central shelf</div><div className="num text-xl">{onShelf.toLocaleString("en-IN")}</div></div>
        <div className="rounded-lg bg-white/[0.03] p-3"><div className="label !text-[9px]">Network uses / day</div><div className="num text-xl">{network.toFixed(1)}</div></div>
      </div>
      <Field label="Quantity received">
        <Stepper value={qty} onChange={setQty} />
      </Field>
      {suggest > 0 && (
        <button className="text-[12px] text-cyan hover:underline flex items-center gap-1" onClick={() => setQty(suggest)}>
          <Sparkles size={12} /> Suggest {suggest.toLocaleString("en-IN")} (tops the central store up to 3 weeks of network demand)
        </button>
      )}
    </Drawer>
  );
}
