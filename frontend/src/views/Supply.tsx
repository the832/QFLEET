import {
  Bot, Boxes, Building2, ChevronDown, ClipboardList, Clapperboard, HeartPulse, LayoutDashboard, Loader2, LogOut, MapPinned,
  Network as NetIcon, Plus, RefreshCw, ScrollText, ShoppingBasket, Truck, UserRound, Users, Warehouse, X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { runSupplyDemo } from "../lib/demo";
import { Autopilot } from "../supply/Autopilot";
import { Team } from "../supply/Team";
import { useEffect, useRef, useState } from "react";
import { BranchPortal } from "../supply/BranchPortal";
import { Drawers } from "../supply/Drawers";
import { Ledger } from "../supply/Ledger";
import { Network } from "../supply/Network";
import { Overview } from "../supply/Overview";
import { Requests } from "../supply/Requests";
import { Shipments } from "../supply/Shipments";
import { Stock } from "../supply/Stock";
import { TRIGGER_TEXT, useSupply, type Tab } from "../supply/store";

const TABS: { key: Tab; label: string; icon: typeof Boxes; desc: string }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, desc: "Run the replenishment loop and see network health" },
  { key: "requests", label: "Requests", icon: ClipboardList, desc: "Indents from branches: approve, reject, dispatch" },
  { key: "stock", label: "Stock", icon: Boxes, desc: "Every product at every location, by days of cover" },
  { key: "network", label: "Network", icon: NetIcon, desc: "Central store and registered sub-inventories" },
  { key: "shipments", label: "Dispatch waves", icon: Truck, desc: "Quantum-planned deliveries and their savings" },
  { key: "ledger", label: "Ledger", icon: ScrollText, desc: "Audit trail of every stock movement" },
  { key: "autopilot", label: "Autopilot", icon: Bot, desc: "Standing rules: approve and dispatch without a click" },
  { key: "team", label: "Team & roles", icon: Users, desc: "Main operators and branch operators" },
];

export default function Supply() {
  const s = useSupply();
  useEffect(() => {
    if (!s.booted) s.boot();
  }, [s.booted]); // eslint-disable-line react-hooks/exhaustive-deps

  const org = s.orgs.find((o) => o.id === s.orgId);
  const k = s.overview?.kpis;
  const branches = (s.stock?.locations ?? []).filter((l) => l.kind !== "central");
  const badge: Partial<Record<Tab, number>> = { requests: k ? k.pending + k.approved : 0, stock: k?.critical_low, shipments: k?.in_transit };
  const tab = TABS.find((t) => t.key === s.tab)!;
  const isBranchUser = org?.my_role === "branch";
  const auto = s.auto;

  if (!s.booted || (s.loading && !s.overview && !s.stock)) {
    return <div className="solid-panel rounded-2xl h-full grid place-items-center text-dim text-sm"><span className="flex items-center gap-2"><RefreshCw size={15} className="animate-spin" /> Connecting to your supply network…</span></div>;
  }
  if (!org) {
    return (
      <div className="solid-panel rounded-2xl h-full grid place-items-center relative">
        <div className="text-center max-w-sm">
          <Warehouse size={40} className="text-cyan mx-auto" />
          <div className="font-display text-lg tracking-[0.14em] mt-3 grad-text font-black">SUPPLY NETWORK</div>
          <p className="text-dim text-sm mt-2">Create your organisation to start: a central store, registered branches and a fleet.</p>
          <button className="btn btn-active mt-4" onClick={() => s.set({ drawer: { kind: "org" } })}><Plus size={14} /> Create organisation</button>
        </div>
        <Drawers />
      </div>
    );
  }

  return (
    <div className="solid-panel rounded-2xl h-full flex overflow-hidden relative">
      {/* left rail */}
      <aside className="w-[232px] shrink-0 border-r border-line flex flex-col p-3 gap-3 bg-black/10">
        <OrgSwitcher />
        {isBranchUser ? (
          <div className="rounded-xl border border-violet/30 bg-violet/[0.06] px-3 py-2">
            <div className="label !text-violet !text-[9px]">Branch operator</div>
            <div className="text-[12.5px] font-medium mt-0.5 leading-snug">{org.my_location}</div>
          </div>
        ) : (
          <div className="flex p-1 rounded-xl border border-line bg-white/[0.02]" role="tablist" aria-label="Who is using QFleet">
            {(["central", "branch"] as const).map((r) => (
              <button key={r} role="tab" aria-selected={s.role === r} onClick={() => s.set({ role: r })}
                title={r === "branch" ? "Preview what a branch operator sees" : "Central store control"}
                className={`flex-1 py-1.5 rounded-lg text-[11.5px] font-semibold flex items-center justify-center gap-1.5 ${s.role === r ? "bg-cyan/15 text-cyan" : "text-dim hover:text-ink"}`}>
                {r === "central" ? <Warehouse size={13} /> : <Building2 size={13} />}{r === "central" ? "Central" : "Branch view"}
              </button>
            ))}
          </div>
        )}

        {s.role === "central" ? (
          <nav className="flex flex-col gap-0.5">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => s.set({ tab: t.key })} title={t.desc}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors ${s.tab === t.key ? "bg-cyan/12 text-ink shadow-[inset_2px_0_0_#00e5ff]" : "text-dim hover:text-ink hover:bg-white/[0.04]"}`}>
                <t.icon size={15} className={s.tab === t.key ? "text-cyan" : ""} />
                <span className="flex-1 text-left">{t.label}</span>
                {!!badge[t.key] && <span className={`num text-[10px] px-1.5 rounded-full ${t.key === "stock" ? "bg-danger/20 text-danger" : "bg-cyan/15 text-cyan"}`}>{badge[t.key]}</span>}
                {t.key === "autopilot" && auto && (
                  <span className={`text-[9.5px] font-bold uppercase tracking-wider ${auto.rules.enabled ? "text-cyan" : "text-faint"}`}>{auto.rules.enabled ? "on" : "off"}</span>
                )}
              </button>
            ))}
          </nav>
        ) : (
          <div className="flex flex-col gap-1.5 min-h-0">
            {!isBranchUser && (
              <>
                <div className="label px-1">Previewing branch</div>
                <select className="input" value={s.branchId ?? ""} onChange={(e) => s.set({ branchId: Number(e.target.value) })}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </>
            )}
            <p className="text-[11px] text-faint px-1 leading-snug">
              {isBranchUser
                ? "You see your own shelf, raise requests for your branch and confirm deliveries when the van arrives."
                : "This is what a branch operator sees after accepting an invite: only their own shelf, requests and deliveries."}
            </p>
          </div>
        )}

        <div className="flex-1" />
        <UserChip />
      </aside>

      {/* main */}
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="px-5 pt-4 pb-3 flex items-center gap-3 border-b border-line">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">{s.role === "central" ? tab.label : "Branch portal"}</h1>
              {s.role === "central" && <span className="text-[11px] text-faint hidden xl:inline">· {tab.desc}</span>}
            </div>
            <div className="text-[12px] text-dim truncate">{org.name} · {org.sector_label} · {org.city_name}</div>
          </div>
          <div className="flex-1" />
          {!isBranchUser && auto && (
            <button onClick={() => s.set({ role: "central", tab: "autopilot" })}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-[12px] font-semibold transition-colors ${
                auto.running && auto.running !== "checking" ? "border-cyan/60 bg-cyan/10 text-cyan" : auto.rules.enabled ? "border-cyan/40 text-cyan hover:bg-cyan/10" : "border-line text-dim hover:text-ink"}`}>
              {auto.running && auto.running !== "checking" ? <Loader2 size={13} className="animate-spin" /> : <Bot size={13} />}
              {auto.running && auto.running !== "checking" ? "Autopilot planning a wave…" : auto.rules.enabled ? `Autopilot on${auto.next_time ? ` · next ${auto.next_time}` : ""}` : "Autopilot off"}
            </button>
          )}
          {!isBranchUser && (
            <button className="btn" title="Play the 60-second Supply Network story (Esc stops)" onClick={() => runSupplyDemo()}>
              <Clapperboard size={14} /> Play demo
            </button>
          )}
          <button className="btn !px-2.5" title="Refresh from the database" disabled={!!s.busy} onClick={() => s.refresh(["overview", "stock", "reqs", "shipments", "movements"])}>
            <RefreshCw size={14} />
          </button>
        </header>
        <AnimatePresence>
          {s.autoBanner && !isBranchUser && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="mx-5 mt-3 rounded-xl border border-cyan/40 bg-gradient-to-r from-cyan/[0.12] to-violet/[0.06] px-4 py-2.5 flex items-center gap-3">
                <Bot size={16} className="text-cyan" />
                <span className="text-[13px]"><b>Autopilot dispatched {s.autoBanner.code}</b> <span className="text-dim">because {TRIGGER_TEXT[s.autoBanner.trigger] ?? s.autoBanner.trigger}</span>
                  {s.autoBanner.saved > 0 && <span className="text-lime"> · ₹{Math.round(s.autoBanner.saved).toLocaleString("en-IN")} cheaper than legacy</span>}</span>
                <div className="flex-1" />
                <button className="btn !py-1" onClick={() => { const id = s.autoBanner!.id; s.set({ autoBanner: null }); void s.watch(id); }}><MapPinned size={13} /> Watch on map</button>
                <button className="btn !p-1" aria-label="Dismiss" onClick={() => s.set({ autoBanner: null })}><X size={13} /></button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {s.role === "branch" ? <BranchPortal /> : (
            <>
              {s.tab === "overview" && <Overview />}
              {s.tab === "requests" && <div className="h-full"><Requests /></div>}
              {s.tab === "stock" && <div className="h-full"><Stock /></div>}
              {s.tab === "network" && <div className="h-full"><Network /></div>}
              {s.tab === "shipments" && <Shipments />}
              {s.tab === "ledger" && <div className="h-full"><Ledger /></div>}
              {s.tab === "autopilot" && <Autopilot />}
              {s.tab === "team" && <Team />}
            </>
          )}
        </div>
      </main>
      <Drawers />
    </div>
  );
}

function OrgSwitcher() {
  const s = useSupply();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, []);
  const org = s.orgs.find((o) => o.id === s.orgId)!;
  const Icon = (sec: string) => (sec === "healthcare" ? HeartPulse : ShoppingBasket);
  const I = Icon(org.sector);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="w-full rounded-xl border border-line hover:border-cyan/50 bg-white/[0.03] p-2.5 flex items-center gap-2.5 text-left">
        <div className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${org.sector === "healthcare" ? "bg-danger/15 text-danger" : "bg-lime/15 text-lime"}`}><I size={17} /></div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold leading-tight truncate">{org.name}</div>
          <div className="text-[10.5px] text-faint truncate">{org.sector_label} · {org.city_name}</div>
        </div>
        <ChevronDown size={14} className="text-faint" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 glass-strong rounded-xl p-1.5 flex flex-col gap-0.5">
          {s.orgs.map((o) => {
            const J = Icon(o.sector);
            return (
              <button key={o.id} onClick={() => { setOpen(false); if (o.id !== s.orgId) s.selectOrg(o.id); }}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[12px] ${o.id === s.orgId ? "bg-cyan/10 text-cyan" : "hover:bg-white/[0.05]"}`}>
                <J size={13} /><span className="flex-1 truncate">{o.name}</span>
                {o.shared && <span className="text-[9px] text-faint uppercase tracking-wider">demo</span>}
              </button>
            );
          })}
          <div className="h-px bg-line my-1" />
          <button onClick={() => { setOpen(false); s.set({ drawer: { kind: "org" } }); }} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] text-cyan hover:bg-cyan/10">
            <Plus size={13} /> New organisation
          </button>
        </div>
      )}
    </div>
  );
}

function UserChip() {
  const s = useSupply();
  if (!s.status?.auth) {
    return <div className="text-[10.5px] text-faint px-1 flex items-center gap-1.5"><UserRound size={12} /> Demo mode · sign-in not configured</div>;
  }
  if (!s.user) return null;
  return (
    <div className="flex items-center gap-2 px-1">
      <div className="w-7 h-7 rounded-full grid place-items-center bg-gradient-to-br from-cyan to-magenta text-void text-[12px] font-bold">
        {(s.user.name ?? s.user.email ?? "?").slice(0, 1).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11.5px] font-medium truncate">{s.user.name ?? s.user.email}</div>
        <div className="text-[10px] text-faint truncate">{s.user.email}</div>
      </div>
      <button className="btn !p-1.5" title="Sign out" onClick={() => s.signOut()}><LogOut size={13} /></button>
    </div>
  );
}
