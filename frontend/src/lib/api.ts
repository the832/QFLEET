import { apiUrl } from "./apiBase";
import type { Meta, PlanResult, QaoaResult, Route, ScalingResult, Scenario } from "../types";

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(apiUrl(url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      const j = await r.json();
      msg = j.detail ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export const api = {
  meta: async (): Promise<Meta> => (await fetch(apiUrl("/api/meta"))).json(),
  scenario: (city: string, n_orders: number, n_vehicles: number, seed: number) =>
    post<Scenario>("/api/scenario", { city, n_orders, n_vehicles, seed }),
  optimize: (scenario: Scenario, solver: string) =>
    post<PlanResult>("/api/optimize", { scenario, solver }),
  compare: (scenario: Scenario, solvers?: string[]) =>
    post<{ results: Record<string, PlanResult>; matrix_source: string }>("/api/compare", { scenario, solvers }),
  scaling: (scenario: Scenario, trials = 3) => post<ScalingResult>("/api/scaling", { scenario, trials }),
  qaoa: (scenario: Scenario, route: Route, n_stops: number, layers: number) =>
    post<QaoaResult>("/api/qaoa", { scenario, route, n_stops, layers }),
};
