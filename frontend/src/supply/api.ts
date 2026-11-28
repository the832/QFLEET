import { apiUrl } from "../lib/apiBase";
import { getToken } from "../lib/auth";
import type { AutoStatus, InvStatus, Location, Member, Movement, Org, Overview, Requisition, Rules, Shipment, StockMatrix, Templates } from "./types";

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = await getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(apiUrl(`/api/inv${path}`), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      const j = await r.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {
      /* not JSON */
    }
    const err = new Error(msg) as Error & { status?: number };
    err.status = r.status;
    throw err;
  }
  return r.json() as Promise<T>;
}

const get = <T,>(p: string) => call<T>("GET", p);
const post = <T,>(p: string, b: unknown = {}) => call<T>("POST", p, b);

export const inv = {
  status: () => get<InvStatus>("/status"),
  me: () => get<{ id: string; email: string | null; name: string | null; demo: boolean }>("/me"),
  templates: () => get<Templates>("/templates"),
  orgs: () => get<Org[]>("/orgs"),
  createOrg: (b: { name: string; sector: string; city: string; branches: number }) => post<Org>("/orgs", b),
  overview: (o: number) => get<Overview>(`/orgs/${o}/overview`),
  stock: (o: number) => get<StockMatrix>(`/orgs/${o}/stock`),
  requisitions: (o: number) => get<Requisition[]>(`/orgs/${o}/requisitions`),
  shipments: (o: number) => get<Shipment[]>(`/orgs/${o}/shipments`),
  shipment: (o: number, s: number) => get<Shipment>(`/orgs/${o}/shipments/${s}`),
  movements: (o: number, limit = 150) => get<Movement[]>(`/orgs/${o}/movements?limit=${limit}`),
  approve: (o: number, ids?: number[]) => post<{ approved: number; shortages: { req: string; product_id: number; short: number }[] }>(`/orgs/${o}/approve`, { ids }),
  reject: (o: number, rid: number, reason = "") => post(`/orgs/${o}/requisitions/${rid}/reject`, { reason }),
  autoIndent: (o: number) => post<{ created: number }>(`/orgs/${o}/auto-indent`),
  simulateDay: (o: number) => post<{ units_used: number; stockouts: number; new_requisitions: number }>(`/orgs/${o}/simulate-day`),
  dispatch: (o: number, ids?: number[], solver = "quantum") => post<Shipment>(`/orgs/${o}/dispatch`, { ids, solver }),
  deliver: (o: number, sid: number, ids?: number[]) => post<{ delivered: number; shipment_status: string }>(`/orgs/${o}/shipments/${sid}/deliver`, { ids }),
  receive: (o: number, product_id: number, qty: number) => post(`/orgs/${o}/receive`, { product_id, qty }),
  adjust: (o: number, b: { location_id: number; product_id: number; qty?: number; daily_usage?: number; reorder_days?: number; target_days?: number }) =>
    post(`/orgs/${o}/adjust`, b),
  createRequisition: (o: number, b: { location_id: number; lines: { product_id: number; qty: number }[]; priority?: string | null; note?: string }) =>
    post<Requisition>(`/orgs/${o}/requisitions`, b),
  members: (o: number) => get<{ shared: boolean; members: Member[] }>(`/orgs/${o}/members`),
  invite: (o: number, b: { email: string; role: "admin" | "branch"; location_id?: number | null }) => post<Member>(`/orgs/${o}/members`, b),
  removeMember: (o: number, mid: number) => post(`/orgs/${o}/members/${mid}/remove`),
  automation: (o: number) => get<AutoStatus>(`/orgs/${o}/automation`),
  saveRules: (o: number, b: Partial<Rules>) => post<AutoStatus>(`/orgs/${o}/automation`, b),
  runRules: (o: number) => post(`/orgs/${o}/automation/run`),
  registerBranch: (o: number, b: { name: string; kind: string; area: string; contact?: string }) => post<Location>(`/orgs/${o}/locations`, b),
};
