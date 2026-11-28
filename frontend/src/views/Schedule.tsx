import { useMemo, useState } from "react";
import { CalendarClock, Download, FileJson, Printer, Sparkles } from "lucide-react";
import { useStore } from "../store";
import { PRIORITY_COLOR, clock, fmt, rgba } from "../lib/sim";

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Schedule() {
  const plan = useStore((s) => s.plan);
  const scenario = useStore((s) => s.scenario);
  const simTime = useStore((s) => s.simTime);
  const planStart = useStore((s) => s.planStart);
  const [filter, setFilter] = useState<string>("all");
  const optimize = useStore((s) => s.optimize);
  const busy = useStore((s) => s.busy);
  const setS = useStore((s) => s.set);

  const rows = useMemo(
    () =>
      plan?.routes.flatMap((r) =>
        r.stops.map((s, i) => ({ ...s, vehicle: r.vehicle_id, color: r.color, seq: i + 1, slack: s.deadline - s.arrival })),
      ) ?? [],
    [plan],
  );

  if (!plan || !scenario) {
    return (
      <div className="glass rounded-2xl h-full grid place-items-center text-center">
        <div>
          <CalendarClock size={42} className="text-cyan mx-auto" />
          <div className="font-display text-xl tracking-[0.14em] mt-4 grad-text font-black">DISPATCH SCHEDULE</div>
          <p className="text-dim text-sm mt-3">Optimise the fleet to generate the driver schedule.</p>
          <button
            className="btn-quantum mt-5 inline-flex items-center gap-2"
            disabled={busy || !scenario}
            onClick={() => {
              setS({ view: "command" });
              setTimeout(() => optimize(), 50);
            }}
          >
            <Sparkles size={15} /> OPTIMIZE FLEET
          </button>
        </div>
      </div>
    );
  }

  const end = Math.max(...plan.routes.map((r) => r.return_time), planStart + 60);
  const span = end - planStart;
  const x = (t: number) => ((t - planStart) / span) * 100;
  const ticks: number[] = [];
  const step = span > 300 ? 60 : 30;
  for (let t = Math.ceil(planStart / step) * step; t <= end; t += step) ticks.push(t);
  const used = plan.routes.filter((r) => r.stops.length);
  const shown = rows.filter((r) => filter === "all" || r.vehicle === filter).sort((a, b) => a.arrival - b.arrival);

  const exportCsv = () => {
    const head = "vehicle,seq,order_id,customer,priority,demand_kg,eta,deadline,slack_min,status";
    const lines = rows.map((r) =>
      [r.vehicle, r.seq, r.order_id, `"${r.customer}"`, r.priority, r.demand, clock(r.arrival), clock(r.deadline), r.slack.toFixed(1), r.late_min > 0.5 ? "LATE" : "ON_TIME"].join(","),
    );
    download(`qfleet-${scenario.city}-schedule.csv`, [head, ...lines].join("\n"), "text/csv");
  };
  const exportJson = () =>
    download(
      `qfleet-${scenario.city}-plan.json`,
      JSON.stringify({ city: scenario.city_name, solver: plan.solver_label, metrics: plan.metrics, routes: plan.routes.map(({ path, timestamps, timeline, ...r }) => r) }, null, 2),
      "application/json",
    );

  // clean, light, paper-friendly driver manifest in its own window
  const printManifest = () => {
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    const m = plan.metrics;
    const blocks = used
      .map((r) => {
        const v = scenario.vehicles.find((x) => x.id === r.vehicle_id);
        const body = r.stops
          .map(
            (st, i) => `<tr><td>${i + 1}</td><td>${clock(st.arrival)}</td><td>${esc(st.order_id)}</td><td>${esc(st.customer)}</td><td class="p-${st.priority}">${st.priority}</td><td>${st.demand} kg</td><td>${clock(st.deadline)}</td><td>${st.late_min > 0.5 ? "LATE +" + Math.round(st.late_min) + "m" : "on time"}</td><td class="sig"></td></tr>`,
          )
          .join("");
        return `<section><h2>${esc(r.vehicle_id)} · ${esc(v?.label ?? "")}</h2><p class="sub">${r.stops.length} stops · ${fmt(r.distance_km, 1)} km · load ${Math.round(r.load)} kg · back at hub ${clock(r.return_time)}</p>
<table><thead><tr><th>#</th><th>ETA</th><th>Order</th><th>Customer</th><th>Priority</th><th>Load</th><th>Deadline</th><th>Status</th><th>Signature</th></tr></thead><tbody>${body}</tbody></table></section>`;
      })
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>QFleet manifest · ${esc(scenario.city_name)}</title><style>
body{font:12px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;margin:24px}
header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}
h1{font-size:20px;margin:0;letter-spacing:.08em}h1 small{font-size:11px;font-weight:500;letter-spacing:.12em;color:#555;display:block}
.kpi{font-size:11px;color:#333;text-align:right}h2{font-size:14px;margin:18px 0 2px}.sub{margin:0 0 6px;color:#555}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}th{background:#f2f2f2}
.sig{width:90px}.p-critical{color:#c00;font-weight:700}.p-high{color:#b77600;font-weight:600}section{page-break-inside:avoid}
</style></head><body><header><h1>QFLEET<small>BY TEAM NONCHALANT · DRIVER MANIFEST</small></h1>
<div class="kpi">${esc(scenario.city_name)} · hub ${esc(scenario.depot.name)}<br>${esc(plan.solver_label)}<br>${m.served} stops · ${fmt(m.distance_km, 1)} km · ₹${Math.round(m.cost_inr).toLocaleString("en-IN")} · ${fmt(m.on_time_pct, 0)}% on time</div></header>${blocks}</body></html>`;
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) {
      useStore.getState().toast("warn", "Pop-up blocked: allow pop-ups to print the manifest");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <div className="h-full flex flex-col gap-3 min-h-0 max-md:overflow-y-auto">
      <div className="glass rounded-2xl p-4 flex items-center gap-4 max-md:flex-wrap max-md:gap-2">
        <div className="max-md:w-full">
          <div className="font-display text-xl font-black tracking-[0.14em] grad-text">DISPATCH SCHEDULE</div>
          <div className="text-[12px] text-dim mt-1">
            {plan.solver_label} · {scenario.city_name} · {rows.length} stops · {used.length} vehicles
          </div>
        </div>
        <div className="flex-1 max-md:hidden" />
        <button className="btn" onClick={exportCsv}>
          <Download size={14} /> CSV
        </button>
        <button className="btn" onClick={exportJson}>
          <FileJson size={14} /> JSON
        </button>
        <button className="btn" onClick={printManifest} title="Printable driver manifest">
          <Printer size={14} /> Print
        </button>
      </div>

      <section className="glass rounded-2xl p-4">
        <div className="flex items-center justify-between max-md:flex-wrap max-md:gap-2">
          <span className="label">Fleet timeline</span>
          <span className="text-[11px] text-dim flex flex-wrap gap-3">
            <span><span className="inline-block w-3 h-1.5 rounded bg-white/30 mr-1" />driving</span>
            {(["critical", "high", "standard"] as const).map((p) => (
              <span key={p}>
                <span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: rgba(PRIORITY_COLOR[p]) }} />
                {p}
              </span>
            ))}
          </span>
        </div>
        <div className="mt-3 relative">
          <div className="ml-[110px] relative h-5">
            {ticks.map((t) => (
              <span key={t} className={`absolute -translate-x-1/2 text-[10px] num text-faint ${ticks.indexOf(t) % 2 ? "max-md:hidden" : ""}`} style={{ left: `${x(t)}%` }}>
                {clock(t)}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            {used.map((r) => (
              <div key={r.vehicle_id} className="flex items-center gap-2">
                <div className="w-[102px] shrink-0 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: rgba(r.color) }} />
                  <span className="num text-[12px] font-semibold">{r.vehicle_id}</span>
                  <span className="text-[10px] text-faint num">{r.stops.length}</span>
                </div>
                <div className="relative flex-1 h-7 rounded-md bg-white/[0.025] border border-line overflow-hidden">
                  {ticks.map((t) => (
                    <div key={t} className="absolute top-0 bottom-0 w-px bg-white/[0.04]" style={{ left: `${x(t)}%` }} />
                  ))}
                  {r.timeline.map((seg, i) => (
                    <div
                      key={i}
                      title={seg.kind === "service" ? `${seg.order} · ${clock(seg.start)}–${clock(seg.end)}` : `${seg.kind} ${clock(seg.start)}–${clock(seg.end)}`}
                      className="absolute top-1/2 -translate-y-1/2 rounded-sm"
                      style={{
                        left: `${x(seg.start)}%`,
                        width: `${Math.max(0.35, x(seg.end) - x(seg.start))}%`,
                        height: seg.kind === "service" ? 18 : 6,
                        background:
                          seg.kind === "service"
                            ? rgba(PRIORITY_COLOR[seg.priority ?? "standard"], 0.95)
                            : rgba(r.color, seg.kind === "return" ? 0.25 : 0.5),
                        boxShadow: seg.kind === "service" ? `0 0 8px ${rgba(PRIORITY_COLOR[seg.priority ?? "standard"], 0.7)}` : undefined,
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {simTime >= planStart && simTime <= end && (
            <div className="absolute top-5 bottom-0 w-px bg-cyan shadow-[0_0_10px_#00e5ff]" style={{ left: `calc(110px + (100% - 110px) * ${x(simTime) / 100})` }}>
              <span className="absolute -top-5 -translate-x-1/2 text-[10px] num text-cyan">{clock(simTime)}</span>
            </div>
          )}
        </div>
      </section>

      <section className="glass rounded-2xl p-4 flex-1 min-h-0 flex flex-col">
        <div className="flex items-center gap-2">
          <span className="label">Stop manifest</span>
          <div className="flex-1" />
          <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All vehicles</option>
            {used.map((r) => (
              <option key={r.vehicle_id} value={r.vehicle_id}>
                {r.vehicle_id}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 overflow-y-auto flex-1">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-[#0b0f20]">
              <tr className="text-dim text-left">
                {["ETA", "Vehicle", "#", "Order", "Customer", "Priority", "Load", "Deadline", "Slack", "Status"].map((h) => (
                  <th key={h} className="py-2 px-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const done = r.arrival <= simTime;
                const late = r.late_min > 0.5;
                return (
                  <tr key={r.order_id} className={`border-t border-line ${done ? "opacity-50" : ""}`}>
                    <td className="py-1.5 px-2 num text-ink">{clock(r.arrival)}</td>
                    <td className="py-1.5 px-2">
                      <span className="num font-semibold" style={{ color: rgba(r.color) }}>
                        {r.vehicle}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 num text-dim">{r.seq}</td>
                    <td className="py-1.5 px-2 num">{r.order_id}</td>
                    <td className="py-1.5 px-2 text-dim truncate max-w-[260px]">{r.customer}</td>
                    <td className="py-1.5 px-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: rgba(PRIORITY_COLOR[r.priority]) }}>
                        {r.priority}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 num text-dim">{r.demand} kg</td>
                    <td className="py-1.5 px-2 num text-dim">{clock(r.deadline)}</td>
                    <td className={`py-1.5 px-2 num ${r.slack < 15 ? "text-amber" : "text-dim"}`}>{fmt(r.slack, 0)} min</td>
                    <td className="py-1.5 px-2">
                      <span className={`text-[10px] font-bold tracking-wider ${done ? "text-lime" : late ? "text-danger" : "text-cyan"}`}>
                        {done ? "DELIVERED" : late ? "AT RISK" : "ON TRACK"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
