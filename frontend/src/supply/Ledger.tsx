import { ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { useSupply } from "./store";
import { ago, Empty } from "./ui";

const KINDS: Record<string, { label: string; cls: string; text: string }> = {
  receipt: { label: "Receipt", cls: "text-lime bg-lime/10", text: "Purchase received at the central store" },
  allocate: { label: "Picked", cls: "text-cyan bg-cyan/10", text: "Allocated from central to an approved request" },
  deliver: { label: "Delivered", cls: "text-violet bg-violet/10", text: "Received at a branch" },
  consume: { label: "Used", cls: "text-dim bg-white/[0.05]", text: "Daily usage at a branch" },
  adjust: { label: "Count", cls: "text-amber bg-amber/10", text: "Stock count correction" },
  return: { label: "Returned", cls: "text-amber bg-amber/10", text: "Allocation returned to central" },
};

export function Ledger() {
  const s = useSupply();
  const [kind, setKind] = useState<string>("all");
  const rows = useMemo(() => s.movements.filter((m) => kind === "all" || m.kind === kind), [s.movements, kind]);
  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <div className="flex items-center gap-1 p-1 rounded-xl border border-line bg-white/[0.02] self-start">
        {["all", ...Object.keys(KINDS)].map((k) => (
          <button key={k} onClick={() => setKind(k)} title={KINDS[k]?.text}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold ${kind === k ? "bg-cyan/15 text-cyan" : "text-dim hover:text-ink"}`}>
            {k === "all" ? "All" : KINDS[k].label}
          </button>
        ))}
      </div>
      <p className="text-[11.5px] text-faint -mt-1">Every unit that moves is recorded here, append-only, in your Neon Postgres database. This is the audit trail.</p>
      <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-line">
        {rows.length === 0 ? <Empty icon={ScrollText} title="No movements" text="Stock movements appear here as the network runs." /> : (
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-[#0b1024]">
              <tr className="label !text-[9px] text-left">
                <th className="py-2.5 pl-4">When</th><th className="py-2.5">Type</th><th className="py-2.5">Product</th><th className="py-2.5">Location</th><th className="py-2.5 text-right">Units</th><th className="py-2.5 pl-6 pr-4">Reference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-t border-line/60 hover:bg-white/[0.02]">
                  <td className="py-2 pl-4 text-faint whitespace-nowrap">{ago(m.at)}</td>
                  <td className="py-2"><span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${KINDS[m.kind]?.cls}`}>{KINDS[m.kind]?.label ?? m.kind}</span></td>
                  <td className="py-2">{m.product} <span className="text-faint num text-[10.5px]">{m.sku}</span></td>
                  <td className="py-2 text-dim">{m.location}</td>
                  <td className={`py-2 text-right num ${m.delta > 0 ? "text-lime" : "text-dim"}`}>{m.delta > 0 ? "+" : ""}{m.delta.toLocaleString("en-IN")}</td>
                  <td className="py-2 pl-6 pr-4 text-faint num text-[11.5px]">{m.ref}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
