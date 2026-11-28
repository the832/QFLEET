import { Building2, Crown, Loader2, Mail, Plus, ShieldCheck, Trash2, Users, Warehouse } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";
import { inv } from "./api";
import { useSupply } from "./store";
import type { Member } from "./types";
import { ago } from "./ui";

const CAN = {
  admin: ["Approve and reject requests", "Plan and dispatch delivery waves", "Set autopilot rules", "Receive stock, register branches", "Invite the team"],
  branch: ["See only their own branch's shelf", "Raise stock requests for their branch", "Track the van and its ETA", "Confirm receipt when stock arrives"],
};

export function Team() {
  const s = useSupply();
  const o = s.orgId!;
  const org = s.orgs.find((x) => x.id === o);
  const branches = (s.stock?.locations ?? []).filter((l) => l.kind !== "central");
  const [data, setData] = useState<{ shared: boolean; members: Member[] } | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "branch">("branch");
  const [loc, setLoc] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => inv.members(o).then(setData).catch((e) => useStore.getState().toast("err", e.message)), [o]);
  useEffect(() => { void load(); }, [load]);

  if (!data) return <div className="h-full grid place-items-center"><Loader2 size={16} className="animate-spin text-dim" /></div>;

  const invite = async () => {
    setBusy(true);
    try {
      await inv.invite(o, { email: email.trim(), role, location_id: role === "branch" ? (loc ?? branches[0]?.id) : null });
      useStore.getState().toast("ok", `Invite saved: ${email.trim()} can sign in now`);
      setEmail("");
      await load();
    } catch (e) {
      useStore.getState().toast("err", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-[1100px]">
      <section className="grid grid-cols-2 gap-3">
        <RoleCard icon={Warehouse} title="Main operator" tone="text-cyan" items={CAN.admin}
          sub="Runs the central store. The person who created the organisation is the owner." />
        <RoleCard icon={Building2} title="Branch operator" tone="text-violet" items={CAN.branch}
          sub="Store-keeper at one hospital, clinic or shop. Locked to that site." />
      </section>

      {data.shared ? (
        <section className="rounded-2xl border border-amber/30 bg-amber/[0.05] p-5 flex items-center gap-4">
          <Users size={22} className="text-amber" />
          <div className="flex-1">
            <div className="font-semibold">{org?.name} is a shared demo organisation</div>
            <div className="text-[12.5px] text-dim mt-0.5">Everyone who signs in is a main operator here, so judges can try everything. Create your own organisation to invite a real team with roles.</div>
          </div>
          <button className="btn btn-active" onClick={() => s.set({ drawer: { kind: "org" } })}><Plus size={14} /> Create organisation</button>
        </section>
      ) : (
        <section className="rounded-2xl border border-line bg-white/[0.02] p-4">
          <div className="label mb-3">Invite a teammate</div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
              <span className="text-[11px] text-faint">Email they will sign in with</span>
              <div className="relative">
                <Mail size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <input className="input w-full !pl-8 !py-2" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="storekeeper@hospital.in" />
              </div>
            </label>
            <div className="flex p-1 rounded-xl border border-line">
              {(["branch", "admin"] as const).map((r) => (
                <button key={r} type="button" onClick={() => setRole(r)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${role === r ? "bg-cyan/15 text-cyan" : "text-dim"}`}>
                  {r === "admin" ? "Main operator" : "Branch operator"}
                </button>
              ))}
            </div>
            {role === "branch" && (
              <select className="input !py-2 min-w-[220px]" value={loc ?? branches[0]?.id ?? ""} onChange={(e) => setLoc(Number(e.target.value))} aria-label="Branch">
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <button className="btn btn-active !py-2" disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())} onClick={invite}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Invite
            </button>
          </div>
          <p className="text-[11.5px] text-faint mt-2">No email is sent: share the app link. The invite activates automatically the first time they sign in with this address (Google or email).</p>
        </section>
      )}

      <section className="rounded-2xl border border-line bg-white/[0.02] p-4">
        <div className="label mb-2">{data.members.length} {data.members.length === 1 ? "person" : "people"}</div>
        {data.members.length === 0 && <div className="text-[12.5px] text-dim py-2">No team yet.</div>}
        <div className="flex flex-col divide-y divide-line/60">
          {data.members.map((m) => (
            <div key={m.id ?? "owner"} className="flex items-center gap-3 py-2.5">
              <div className={`w-8 h-8 rounded-full grid place-items-center text-[12px] font-bold ${m.role === "branch" ? "bg-violet/20 text-violet" : "bg-cyan/20 text-cyan"}`}>
                {(m.name ?? m.email ?? "?").slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">{m.name ?? m.email}</div>
                <div className="text-[11px] text-faint truncate">{m.name ? m.email : ""}</div>
              </div>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${
                m.role === "branch" ? "text-violet border-violet/30 bg-violet/10" : "text-cyan border-cyan/30 bg-cyan/10"}`}>
                {m.role === "owner" ? <Crown size={11} /> : m.role === "admin" ? <ShieldCheck size={11} /> : <Building2 size={11} />}
                {m.role === "owner" ? "Owner · main operator" : m.role === "admin" ? "Main operator" : `Branch · ${m.location ?? "?"}`}
              </span>
              <span className={`text-[11px] w-32 text-right ${m.status === "active" ? "text-lime" : "text-amber"}`}>
                {m.status === "active" ? `Active${m.joined_at ? ` · ${ago(m.joined_at)}` : ""}` : "Invited · not signed in yet"}
              </span>
              {m.id !== null ? (
                <button className="btn !p-1.5" title="Remove" aria-label={`Remove ${m.email}`}
                  onClick={async () => { await inv.removeMember(o, m.id!).catch((e) => useStore.getState().toast("err", e.message)); await load(); }}>
                  <Trash2 size={13} />
                </button>
              ) : <span className="w-[30px]" />}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function RoleCard({ icon: Icon, title, sub, items, tone }: { icon: typeof Users; title: string; sub: string; items: string[]; tone: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white/[0.02] p-4">
      <div className="flex items-center gap-2"><Icon size={17} className={tone} /><span className="font-semibold">{title}</span></div>
      <p className="text-[12px] text-dim mt-1">{sub}</p>
      <ul className="mt-2.5 flex flex-col gap-1">
        {items.map((x) => <li key={x} className="text-[12.5px] flex items-center gap-2"><span className={`w-1 h-1 rounded-full ${tone.replace("text-", "bg-")}`} />{x}</li>)}
      </ul>
    </div>
  );
}
