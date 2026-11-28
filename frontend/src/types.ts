export type RGB = [number, number, number];
export type Priority = "critical" | "high" | "standard";

export interface LngLat {
  lng: number;
  lat: number;
}

export interface Vehicle {
  id: string;
  type: string;
  label: string;
  capacity: number;
  cost_per_km: number;
  co2_per_km: number;
  color: RGB;
  status: "active" | "breakdown" | "idle";
  start: LngLat;
  start_time: number;
}

export interface Order {
  id: string;
  customer: string;
  area: string;
  lng: number;
  lat: number;
  demand: number;
  priority: Priority;
  deadline: number;
  service: number;
  status: "pending" | "delivered";
  urgent_injected?: boolean;
}

export interface TrafficZone {
  id: string;
  lng: number;
  lat: number;
  radius_km: number;
  factor: number;
}

export interface Scenario {
  city: string;
  city_name: string;
  center: [number, number];
  zoom: number;
  depot: { name: string; lng: number; lat: number };
  shift_start: number;
  vehicles: Vehicle[];
  orders: Order[];
  traffic_zones: TrafficZone[];
  seed: number;
}

export interface Stop {
  order_id: string;
  arrival: number;
  depart: number;
  late_min: number;
  lng: number;
  lat: number;
  priority: Priority;
  demand: number;
  customer: string;
  deadline: number;
}

export interface TimelineSeg {
  kind: "drive" | "service" | "return";
  start: number;
  end: number;
  order?: string;
  priority?: Priority;
}

export interface Route {
  vehicle_id: string;
  vehicle_label: string;
  vehicle_type: string;
  color: RGB;
  capacity: number;
  seq: number[];
  stops: Stop[];
  distance_km: number;
  duration_min: number;
  return_time: number;
  start_time: number;
  load: number;
  utilization: number;
  cost: number;
  co2: number;
  timeline: TimelineSeg[];
  start: LngLat;
  path: [number, number][];
  timestamps: number[];
}

export interface Metrics {
  distance_km: number;
  cost_inr: number;
  co2_kg: number;
  makespan_min: number;
  avg_turnaround_min: number;
  fleet_hours: number;
  on_time_pct: number;
  critical_on_time_pct: number;
  late_orders: number;
  late_minutes: number;
  served: number;
  unserved: number;
  orders_total: number;
  vehicles_used: number;
  vehicles_total: number;
  avg_utilization_pct: number;
}

export interface Stage1 {
  n_vars: number;
  n_assign: number;
  n_slack: number;
  energy: number;
  ms: number;
  raw_violations: number;
  repairs: number;
  read_energies: number[];
  penalties: Record<string, number>;
  candidates_per_order?: number;
  qubo: { n: number; size: number; cells: number[][]; nnz: number };
  orders: number;
  vehicles: number;
  vehicle_ids: string[];
  trace?: { gamma: number[]; e_min: number[]; e_mean: number[]; j_perp: number[] };
  replicas?: { P: number; n: number; frames: number[][][] };
  sweeps?: number;
  trotter_slices?: number;
  refine_gain_pct?: number;
  inr_quantum?: number;
  inr_hybrid?: number;
  quantum_cost?: number;
  hybrid_cost?: number;
  note?: string;
}

export interface Stage2 {
  vehicle_id: string;
  stops: number;
  n_vars: number;
  valid: boolean;
  raw_cost: number;
  final_cost: number;
  ms: number;
  energy?: number;
  trace?: { gamma: number[]; e_min: number[] };
}

export interface QuantumTelemetry {
  method: string;
  stage1: Stage1;
  stage2: Stage2[];
  fleet_exploration: { k: number; distance_km: number; cost_inr: number; on_time_pct: number; unserved: number; score: number }[];
  chosen_k: number;
  total_qubits: number;
  raw_vs_polished: { raw: number; polished: number; polish_gain_pct: number };
  valid_routes_pct: number;
  lns?: { iterations: number; seed_inr: number; final_inr: number; gain_pct: number };
}

export interface PlanResult {
  routes: Route[];
  metrics: Metrics;
  unassigned: string[];
  solver: string;
  solver_label: string;
  solver_short: string;
  family: "quantum" | "classical" | "baseline";
  solve_ms: number;
  matrix_source: "osrm" | "haversine";
  quantum: QuantumTelemetry | null;
}

export interface QaoaState {
  state: number;
  bits: number[];
  prob: number;
  energy: number;
  valid: boolean;
  optimal: boolean;
  tour: string[] | null;
  minutes: number | null;
}

export interface QaoaResult {
  vehicle_id: string;
  stops: { order_id: string; customer: string; priority: Priority }[];
  n_qubits: number;
  layers: number;
  hilbert_dim: number;
  gammas: number[];
  betas: number[];
  trace: number[];
  p_valid: number;
  p_optimal: number;
  random_p_optimal: number;
  random_p_valid: number;
  restarts: number;
  amplification: number;
  optimal_tour: string[];
  optimal_minutes: number;
  top_states: QaoaState[];
  shots: { total: number; optimal: number; valid: number };
  circuit: { rzz: [number, number, number][]; rz: [number, number][]; rx: number };
  qiskit: { max_prob_diff?: number; depth?: number; cx?: number; gates?: number; logical_depth?: number; error?: string };
  ms: number;
}

export interface Meta {
  cities: { key: string; name: string; center: [number, number]; zoom: number }[];
  solvers: Record<string, { label: string; short: string; family: string }>;
  leap_enabled: boolean;
}

export interface FleetEvent {
  id: string;
  t: number;
  kind: "plan" | "breakdown" | "urgent" | "traffic" | "info" | "compare";
  title: string;
  detail: string;
}

export interface TrailSegment {
  vehicle_id: string;
  color: RGB;
  path: [number, number][];
  timestamps: number[];
}

export interface ScalingRow {
  stops: number;
  qubits: number;
  sqa_gap_pct: number;
  sa_gap_pct: number;
  sqa_valid_pct: number;
  sa_valid_pct: number;
  sqa_ms: number;
  sa_ms: number;
  exact_reference: boolean;
}

export interface ScalingResult {
  rows: ScalingRow[];
  trials: number;
  ms: number;
}
