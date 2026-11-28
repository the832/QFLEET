import { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { FlyToInterpolator } from "@deck.gl/core";
import type { PickingInfo } from "@deck.gl/core";
import { ArcLayer, ColumnLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import { Map } from "react-map-gl/maplibre";
import { useStore } from "../store";
import { PRIORITY_COLOR, clock, positionAt, vehicleState } from "../lib/sim";
import type { Order, Route, TrailSegment, Vehicle } from "../types";

const STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

interface VehicleDot {
  id: string;
  pos: [number, number];
  color: number[];
  broken: boolean;
  route?: Route;
  vehicle?: Vehicle;
}

export function FleetMap() {
  const scenario = useStore((s) => s.scenario);
  const plan = useStore((s) => s.plan);
  const history = useStore((s) => s.history);
  const simTime = useStore((s) => s.simTime);
  const mapMode = useStore((s) => s.mapMode);
  const selected = useStore((s) => s.selectedVehicle);
  const arcFlash = useStore((s) => s.arcFlash);
  const follow = useStore((s) => s.follow);
  const setS = useStore((s) => s.set);
  const addUrgent = useStore((s) => s.addUrgent);
  const addTraffic = useStore((s) => s.addTraffic);

  const [viewState, setViewState] = useState<any>({
    longitude: 77.61,
    latitude: 12.97,
    zoom: 11,
    pitch: 48,
    bearing: -14,
  });
  const [pulse, setPulse] = useState(0);

  const recenter = useStore((s) => s.recenter);
  // leaving follow-cam flies back to the overview
  const prevFollow = useRef(follow);
  const [overview, setOverview] = useState(0);
  useEffect(() => {
    if (prevFollow.current && !follow) setOverview((n) => n + 1);
    prevFollow.current = follow;
  }, [follow]);

  // fly to city on scenario change / reset / end of follow-cam
  useEffect(() => {
    if (!scenario) return;
    setViewState((v: any) => ({
      ...v,
      longitude: scenario.center[0],
      latitude: scenario.center[1],
      zoom: scenario.zoom,
      pitch: 48,
      bearing: -14,
      transitionDuration: 1800,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.6 }),
    }));
  }, [scenario?.city, recenter, overview]);

  // ambient pulse clock (~30fps)
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 33) {
        setPulse(t / 1000);
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const stopIndex = useMemo(() => {
    const m: Record<string, { route: Route; arrival: number; color: number[] }> = {};
    plan?.routes.forEach((r) => r.stops.forEach((s) => (m[s.order_id] = { route: r, arrival: s.arrival, color: r.color })));
    return m;
  }, [plan]);

  const unassigned = useMemo(() => new Set(plan?.unassigned ?? []), [plan]);

  const vehicles: VehicleDot[] = useMemo(() => {
    if (!scenario) return [];
    const out: VehicleDot[] = [];
    for (const v of scenario.vehicles) {
      if (v.status === "breakdown") {
        out.push({ id: v.id, pos: [v.start.lng, v.start.lat], color: [255, 60, 90], broken: true, vehicle: v });
        continue;
      }
      const r = plan?.routes.find((x) => x.vehicle_id === v.id);
      if (r && r.stops.length) {
        out.push({ id: v.id, pos: positionAt(r, simTime), color: r.color, broken: false, route: r, vehicle: v });
      }
    }
    return out;
  }, [scenario, plan, simTime]);

  // cinematic follow-cam on the selected vehicle
  const followTarget = follow && selected ? vehicles.find((v) => v.id === selected && !v.broken) : undefined;
  const fx = followTarget?.pos[0];
  const fy = followTarget?.pos[1];
  useEffect(() => {
    if (fx === undefined || fy === undefined) return;
    setViewState((v: any) => ({
      ...v,
      longitude: v.longitude + (fx - v.longitude) * 0.18,
      latitude: v.latitude + (fy - v.latitude) * 0.18,
      zoom: v.zoom + (Math.max(v.zoom, 13.4) - v.zoom) * 0.08,
      pitch: v.pitch + (58 - v.pitch) * 0.08,
      transitionDuration: 0,
    }));
  }, [fx, fy]);

  if (!scenario) return <div className="absolute inset-0 bg-void" />;

  const depot = scenario.depot;
  const routes = plan?.routes.filter((r) => r.path?.length) ?? [];
  const trips: (Route | TrailSegment)[] = [...history, ...routes];
  const flashAge = (performance.now() - arcFlash) / 1000;
  const arcAlpha = arcFlash && flashAge < 4 ? Math.max(0, 1 - flashAge / 4) : 0;
  const ordersVisible: Order[] = scenario.orders;
  const isDelivered = (o: Order) =>
    o.status === "delivered" || (stopIndex[o.id] && stopIndex[o.id].arrival <= simTime);

  const layers = [
    // traffic gridlock zones
    new ScatterplotLayer({
      id: "traffic-fill",
      data: scenario.traffic_zones,
      getPosition: (z: any) => [z.lng, z.lat],
      getRadius: (z: any) => z.radius_km * 1000,
      radiusUnits: "meters",
      getFillColor: [255, 40, 80, 38],
      getLineColor: [255, 60, 100, 200],
      stroked: true,
      lineWidthMinPixels: 1.5,
      updateTriggers: { getRadius: pulse },
    }),
    new ScatterplotLayer({
      id: "traffic-ring",
      data: scenario.traffic_zones,
      getPosition: (z: any) => [z.lng, z.lat],
      getRadius: (z: any) => z.radius_km * 1000 * (0.3 + ((pulse * 0.6) % 1) * 0.8),
      radiusUnits: "meters",
      filled: false,
      stroked: true,
      getLineColor: () => [255, 60, 100, Math.round(220 * (1 - ((pulse * 0.6) % 1)))],
      lineWidthMinPixels: 2,
      updateTriggers: { getRadius: pulse, getLineColor: pulse },
    }),
    // completed history before re-plans
    new PathLayer({
      id: "history",
      data: history,
      getPath: (d: TrailSegment) => d.path,
      getColor: (d: TrailSegment) => [...d.color, 70] as any,
      widthMinPixels: 2,
      capRounded: true,
      jointRounded: true,
    }),
    // planned routes (faint)
    new PathLayer({
      id: "routes",
      data: routes,
      getPath: (r: Route) => r.path,
      getColor: (r: Route) =>
        [...r.color, selected ? (r.vehicle_id === selected ? 230 : 25) : 85] as any,
      getWidth: (r: Route) => (r.vehicle_id === selected ? 6 : 3),
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      pickable: true,
      updateTriggers: { getColor: selected, getWidth: selected },
    }),
    // animated glowing trails
    new TripsLayer({
      id: "trips-glow",
      data: trips,
      getPath: (d: any) => d.path,
      getTimestamps: (d: any) => d.timestamps,
      getColor: (d: any) => d.color,
      opacity: 0.35,
      widthMinPixels: 12,
      capRounded: true,
      jointRounded: true,
      trailLength: 22,
      fadeTrail: true,
      currentTime: simTime,
    }),
    new TripsLayer({
      id: "trips",
      data: trips,
      getPath: (d: any) => d.path,
      getTimestamps: (d: any) => d.timestamps,
      getColor: (d: any) => d.color.map((c: number) => Math.min(255, c + 60)),
      opacity: 1,
      widthMinPixels: 4,
      capRounded: true,
      jointRounded: true,
      trailLength: 40,
      fadeTrail: true,
      currentTime: simTime,
    }),
    // quantum allocation arcs flash after each plan
    new ArcLayer({
      id: "alloc-arcs",
      data: arcAlpha > 0 ? routes.flatMap((r) => r.stops.map((s) => ({ r, s }))) : [],
      getSourcePosition: (d: any) => [d.r.start.lng, d.r.start.lat],
      getTargetPosition: (d: any) => [d.s.lng, d.s.lat],
      getSourceColor: (d: any) => [...d.r.color, Math.round(255 * arcAlpha)] as any,
      getTargetColor: (d: any) => [255, 255, 255, Math.round(200 * arcAlpha)],
      getWidth: 2,
      getHeight: 0.55,
      updateTriggers: { getSourceColor: arcAlpha, getTargetColor: arcAlpha },
    }),
    // critical halos
    new ScatterplotLayer({
      id: "crit-halo",
      data: ordersVisible.filter((o) => o.priority === "critical" && !isDelivered(o)),
      getPosition: (o: Order) => [o.lng, o.lat],
      getRadius: () => 9 + ((pulse * 1.4) % 1) * 16,
      radiusUnits: "pixels",
      filled: false,
      stroked: true,
      getLineColor: () => [255, 61, 110, Math.round(230 * (1 - ((pulse * 1.4) % 1)))],
      lineWidthMinPixels: 1.5,
      updateTriggers: { getRadius: pulse, getLineColor: pulse },
    }),
    // orders
    new ScatterplotLayer({
      id: "orders",
      data: ordersVisible,
      pickable: true,
      getPosition: (o: Order) => [o.lng, o.lat],
      getRadius: (o: Order) => (isDelivered(o) ? 3.2 : o.priority === "critical" ? 6.5 : 5),
      radiusUnits: "pixels",
      getFillColor: (o: Order) =>
        isDelivered(o)
          ? [80, 255, 170, 150]
          : unassigned.has(o.id)
            ? [120, 120, 140, 230]
            : ([...PRIORITY_COLOR[o.priority], 240] as any),
      stroked: true,
      getLineColor: (o: Order) =>
        (isDelivered(o) ? [0, 0, 0, 0] : stopIndex[o.id] ? [...stopIndex[o.id].color, 255] : [255, 255, 255, 120]) as any,
      lineWidthMinPixels: 1.6,
      updateTriggers: { getRadius: simTime, getFillColor: [simTime, plan], getLineColor: [simTime, plan] },
    }),
    // depot tower
    new ColumnLayer({
      id: "depot-col",
      data: [depot],
      diskResolution: 6,
      radius: 220,
      extruded: true,
      elevationScale: 1,
      getPosition: (d: any) => [d.lng, d.lat],
      getElevation: 1600,
      getFillColor: [0, 229, 255, 210],
      pickable: true,
    }),
    new ScatterplotLayer({
      id: "depot-ring",
      data: [depot],
      getPosition: (d: any) => [d.lng, d.lat],
      getRadius: () => 300 + ((pulse * 0.5) % 1) * 1400,
      radiusUnits: "meters",
      filled: false,
      stroked: true,
      getLineColor: () => [0, 229, 255, Math.round(200 * (1 - ((pulse * 0.5) % 1)))],
      lineWidthMinPixels: 2,
      updateTriggers: { getRadius: pulse, getLineColor: pulse },
    }),
    // vehicles
    new ScatterplotLayer({
      id: "veh-glow",
      data: vehicles,
      getPosition: (v: VehicleDot) => v.pos,
      getRadius: (v: VehicleDot) => (v.broken ? 16 + Math.sin(pulse * 6) * 5 : v.id === selected ? 22 : 16),
      radiusUnits: "pixels",
      getFillColor: (v: VehicleDot) => [...v.color, v.broken ? 90 : 70] as any,
      updateTriggers: { getRadius: [pulse, selected] },
    }),
    new ScatterplotLayer({
      id: "veh-core",
      data: vehicles,
      pickable: true,
      getPosition: (v: VehicleDot) => v.pos,
      getRadius: 7,
      radiusUnits: "pixels",
      getFillColor: (v: VehicleDot) => v.color as any,
      stroked: true,
      getLineColor: [255, 255, 255, 255],
      lineWidthMinPixels: 2,
    }),
    new TextLayer({
      id: "veh-label",
      data: vehicles,
      getPosition: (v: VehicleDot) => v.pos,
      getText: (v: VehicleDot) => (v.broken ? `${v.id} ✕ DOWN` : v.id),
      getColor: (v: VehicleDot) => (v.broken ? [255, 90, 110] : (v.color as any)),
      getSize: 11,
      getPixelOffset: [0, -22],
      fontFamily: "JetBrains Mono, monospace",
      fontWeight: 600,
      characterSet: "auto",
      background: true,
      getBackgroundColor: [4, 6, 14, 210],
      backgroundPadding: [5, 3],
    }),
    new TextLayer({
      id: "depot-label",
      data: [depot],
      getPosition: (d: any) => [d.lng, d.lat],
      getText: (d: any) => d.name.toUpperCase(),
      getColor: [0, 229, 255],
      getSize: 11,
      getPixelOffset: [0, 26],
      fontFamily: "JetBrains Mono, monospace",
      fontWeight: 600,
      characterSet: "auto",
      background: true,
      getBackgroundColor: [4, 6, 14, 220],
      backgroundPadding: [6, 3],
    }),
  ];

  const onClick = (info: PickingInfo) => {
    if (mapMode !== "none" && info.coordinate) {
      const [lng, lat] = info.coordinate as [number, number];
      if (mapMode === "urgent") addUrgent(lng, lat);
      else addTraffic(lng, lat);
      return;
    }
    const obj: any = info.object;
    if (info.layer?.id === "veh-core" && obj) setS({ selectedVehicle: obj.id === selected ? null : obj.id });
    else if (info.layer?.id === "routes" && obj) setS({ selectedVehicle: obj.vehicle_id === selected ? null : obj.vehicle_id });
    else if (!obj) setS({ selectedVehicle: null });
  };

  const tooltip = ({ object, layer }: PickingInfo): any => {
    if (!object || !layer) return null;
    const style = {
      background: "rgba(8,10,22,0.94)",
      border: "1px solid rgba(0,229,255,0.35)",
      borderRadius: "10px",
      color: "#e8f1ff",
      fontFamily: "Space Grotesk, sans-serif",
      fontSize: "12px",
      padding: "10px 12px",
      boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
    };
    if (layer.id === "orders") {
      const o = object as Order;
      const st = stopIndex[o.id];
      const pc = PRIORITY_COLOR[o.priority];
      return {
        html: `<div style="font-weight:700;margin-bottom:4px">${o.customer}</div>
          <div style="font-family:JetBrains Mono;font-size:11px;color:#8a96b8">${o.id} · ${o.demand} kg</div>
          <div style="margin-top:6px"><span style="color:rgb(${pc})">● ${o.priority.toUpperCase()}</span> · due ${clock(o.deadline)}</div>
          ${st ? `<div style="margin-top:4px;color:rgb(${st.color})">${st.route.vehicle_id} ETA ${clock(st.arrival)}${st.arrival > o.deadline + 0.5 ? " ⚠ late" : " ✓ on time"}</div>` : `<div style="margin-top:4px;color:#8a96b8">${isDelivered(o) ? "Delivered" : "Awaiting plan"}</div>`}`,
        style,
      };
    }
    if (layer.id === "veh-core") {
      const v = object as VehicleDot;
      if (v.broken) return { html: `<b>${v.id}</b> — breakdown`, style };
      const r = v.route!;
      const stt = vehicleState(r, simTime);
      const done = r.stops.filter((s) => s.arrival <= simTime).length;
      return {
        html: `<div style="font-weight:700">${v.id} · ${r.vehicle_label}</div>
          <div style="font-family:JetBrains Mono;font-size:11px;color:#8a96b8;margin-top:3px">${stt.toUpperCase()} · ${done}/${r.stops.length} stops</div>
          <div style="margin-top:5px">Load ${Math.round(r.load)} / ${r.capacity} kg (${Math.round(r.utilization * 100)}%)</div>
          <div>Back at hub ${clock(r.return_time)}</div>`,
        style,
      };
    }
    if (layer.id === "depot-col") return { html: `<b>${depot.name}</b><br/>Central fleet hub`, style };
    return null;
  };

  return (
    <div className="absolute inset-0" style={{ cursor: mapMode !== "none" ? "crosshair" : undefined }}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }: any) => setViewState(vs)}
        controller={{ dragRotate: true, doubleClickZoom: mapMode === "none" }}
        layers={layers}
        onClick={onClick}
        getTooltip={tooltip}
        getCursor={({ isHovering }) => (mapMode !== "none" ? "crosshair" : isHovering ? "pointer" : "grab")}
      >
        <Map mapStyle={STYLE} reuseMaps attributionControl={{ compact: true }} />
      </DeckGL>
      {/* vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(3,4,10,0.85) 100%), linear-gradient(180deg, rgba(3,4,10,0.55), transparent 18%, transparent 80%, rgba(3,4,10,0.7))",
        }}
      />
    </div>
  );
}
