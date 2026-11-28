import type { PlanResult, Priority, Scenario } from "../types";

export type ReqStatus = "pending" | "approved" | "dispatched" | "delivered" | "rejected" | "cancelled";

export interface InvStatus {
  db: "neon" | "postgres" | "sqlite";
  host: string;
  organizations: number;
  auth: boolean;
  auth_url: string | null;
}

export interface Org {
  id: number;
  name: string;
  shared: boolean;
  sector: "healthcare" | "retail";
  sector_label: string;
  city: string;
  city_name: string;
  tagline: string;
  center: [number, number];
  zoom: number;
  /** what the signed-in user may do here */
  my_role: "admin" | "branch";
  my_location_id: number | null;
  my_location: string | null;
  owner: boolean;
}

export interface Rules {
  enabled: boolean;
  auto_approve: boolean;
  on_critical: boolean;
  load_pct: number;
  times: string[];
}

export interface AutoStatus {
  rules: Rules;
  approved_kg: number;
  capacity_kg: number;
  load_pct: number;
  approved: number;
  critical_waiting: boolean;
  pending: number;
  next_time: string | null;
  now: string;
  last_auto_at: string | null;
  running: string | null;
  latest_shipment_id: number | null;
  auto_waves: Shipment[];
}

export interface Member {
  id: number | null;
  email: string | null;
  name: string | null;
  role: "owner" | "admin" | "branch";
  status: "invited" | "active";
  location_id: number | null;
  location: string | null;
  invited_by?: string | null;
  created_at?: string | null;
  joined_at: string | null;
}

export interface Location {
  id: number;
  code: string;
  name: string;
  kind: string;
  kind_label: string;
  area: string;
  lng: number;
  lat: number;
  contact: string;
  active: boolean;
  created_at: string | null;
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  unit_weight_kg: number;
  unit_cost_inr: number;
  critical: boolean;
}

export interface StockCell {
  location_id: number;
  product_id: number;
  qty: number;
  daily_usage: number;
  reorder_days: number;
  target_days: number;
  cover_days: number | null;
  on_order: number;
}

export interface StockMatrix {
  locations: Location[];
  products: Product[];
  cells: StockCell[];
}

export interface ReqLine {
  id: number;
  product_id: number;
  sku: string;
  name: string;
  unit: string;
  critical: boolean;
  qty_requested: number;
  qty_approved: number;
}

export interface Requisition {
  id: number;
  code: string;
  location_id: number;
  location: string;
  location_kind: string;
  area: string;
  priority: Priority;
  status: ReqStatus;
  source: "manual" | "auto";
  note: string;
  shipment_id: number | null;
  eta_min: number | null;
  eta: string | null;
  late_min: number | null;
  weight_kg: number;
  value_inr: number;
  lines: ReqLine[];
  created_at: string | null;
  approved_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
}

export interface Shipment {
  id: number;
  code: string;
  status: "in_transit" | "completed";
  solver: string;
  trigger: "manual" | "load" | "critical" | "schedule";
  cost_inr: number;
  legacy_cost_inr: number;
  saved_inr: number;
  distance_km: number;
  co2_kg: number;
  legacy_co2_kg: number;
  on_time_pct: number;
  vehicles_used: number;
  solve_ms: number;
  qubits: number;
  stops: number;
  created_at: string | null;
  completed_at: string | null;
  scenario?: Scenario;
  plan?: PlanResult;
  dispatched?: number;
  held_back?: number;
}

export interface Alert {
  location_id: number;
  location: string;
  product_id: number;
  product: string;
  sku: string;
  critical: boolean;
  qty: number;
  cover_days: number;
  on_order: number;
}

export interface Movement {
  id: number;
  kind: "receipt" | "allocate" | "deliver" | "consume" | "adjust" | "return";
  delta: number;
  ref: string;
  location: string;
  product: string;
  sku?: string;
  at: string | null;
}

export interface Overview {
  org: Org;
  kpis: {
    branches: number;
    skus: number;
    inventory_value_inr: number;
    service_level_pct: number;
    low_stock: number;
    critical_low: number;
    pending: number;
    approved: number;
    in_transit: number;
    delivered: number;
    shipments: number;
    saved_inr: number;
    spent_inr: number;
    co2_saved_kg: number;
    on_time_pct: number | null;
  };
  alerts: Alert[];
  central_short: { product_id: number; product: string; sku: string; qty: number; cover_days: number; critical: boolean }[];
  movements: Movement[];
  recent_shipments: Shipment[];
}

export interface Templates {
  sectors: Record<string, { label: string; central: string; tagline: string; kinds: { key: string; label: string }[]; products: number }>;
  cities: { key: string; name: string; areas: string[] }[];
}
