import type { PlanResult, Route, TrailSegment } from "../types";

/** Interpolated [lng, lat] of a route at simulation minute t. */
export function positionAt(route: Route, t: number): [number, number] {
  const { path, timestamps } = route;
  if (!path.length) return [route.start.lng, route.start.lat];
  if (t <= timestamps[0]) return path[0];
  const n = timestamps.length;
  if (t >= timestamps[n - 1]) return path[n - 1];
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timestamps[mid] <= t) lo = mid;
    else hi = mid;
  }
  const t0 = timestamps[lo],
    t1 = timestamps[hi];
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return [path[lo][0] + (path[hi][0] - path[lo][0]) * f, path[lo][1] + (path[hi][1] - path[lo][1]) * f];
}

/** Heading in degrees (for vehicle glyph orientation). */
export function headingAt(route: Route, t: number): number {
  const a = positionAt(route, t - 0.4);
  const b = positionAt(route, t + 0.4);
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
}

export type VehicleState = "depot" | "driving" | "servicing" | "returned" | "idle";

export function vehicleState(route: Route, t: number): VehicleState {
  if (!route.stops.length) return "idle";
  if (t < route.start_time) return "depot";
  if (t >= route.return_time) return "returned";
  for (const s of route.stops) if (t >= s.arrival && t < s.depart) return "servicing";
  return "driving";
}

/** Part of a trip already driven before time t (kept as history after a re-plan). */
export function cutTrail(route: Route, t: number): TrailSegment | null {
  const path: [number, number][] = [];
  const ts: number[] = [];
  for (let i = 0; i < route.timestamps.length; i++) {
    if (route.timestamps[i] <= t) {
      path.push(route.path[i]);
      ts.push(route.timestamps[i]);
    } else break;
  }
  if (path.length && ts[ts.length - 1] < t && route.timestamps.length) {
    path.push(positionAt(route, t));
    ts.push(t);
  }
  if (path.length < 2) return null;
  return { vehicle_id: route.vehicle_id, color: route.color, path, timestamps: ts };
}

export function planEnd(plan: PlanResult | null): number {
  if (!plan) return 0;
  return Math.max(0, ...plan.routes.map((r) => (r.stops.length ? r.return_time : 0)));
}

export const clock = (min: number, shift = 540) => {
  const m = Math.max(0, Math.round(shift + min));
  const h = Math.floor(m / 60) % 24;
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export const inr = (v: number) => "₹" + Math.round(v).toLocaleString("en-IN");
export const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
export const pctDelta = (a: number, b: number) => (b ? ((a - b) / b) * 100 : 0);
export const rgba = (c: number[], a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export const PRIORITY_COLOR: Record<string, [number, number, number]> = {
  critical: [255, 61, 110],
  high: [255, 196, 0],
  standard: [120, 200, 255],
};
