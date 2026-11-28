import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useEffect } from "react";
import { useStore } from "./store";
import { Landing } from "./components/Landing";
import { TopBar } from "./components/TopBar";
import { SideNav } from "./components/SideNav";
import { FleetMap } from "./components/FleetMap";
import { MissionPanel } from "./components/MissionPanel";
import { SimControls, useSimLoop } from "./components/SimControls";
import { DisruptionDock, EventFeed, Toasts } from "./components/Disruptions";
import { AnnealOverlay } from "./components/AnnealOverlay";
import { DemoCaption } from "./components/DemoCaption";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { runDemo, runSupplyDemo, stopDemo } from "./lib/demo";
import { AuthGate } from "./components/AuthGate";
import { useSupply } from "./supply/store";
import { returningFromOAuth } from "./lib/auth";

const QuantumLab = lazy(() => import("./views/QuantumLab"));
const Benchmark = lazy(() => import("./views/Benchmark"));
const Schedule = lazy(() => import("./views/Schedule"));
const Supply = lazy(() => import("./views/Supply"));

function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const st = useStore.getState();
      if (!st.entered) return;
      if (e.code === "Space") {
        e.preventDefault(); // also stops Space from re-clicking whichever button has focus
        (e.target as HTMLElement)?.blur?.();
        if (st.plan) st.set({ playing: !st.playing });
      } else if (e.key === "1") st.setView("command");
      else if (e.key === "2") st.setView("lab");
      else if (e.key === "3") st.setView("bench");
      else if (e.key === "4") st.setView("schedule");
      else if (e.key === "5") st.setView("supply");
      else if (e.key.toLowerCase() === "o" && !st.demo) st.optimize();
      else if (e.key.toLowerCase() === "d") (st.demo ? stopDemo() : st.view === "supply" ? runSupplyDemo() : runDemo());
      else if (e.key.toLowerCase() === "f" && st.selectedVehicle) st.set({ follow: !st.follow });
      else if (e.key === "Escape") {
        if (st.demo) stopDemo();
        st.set({ mapMode: "none", selectedVehicle: null, follow: false });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export default function App() {
  const entered = useStore((s) => s.entered);
  const enter = useStore((s) => s.enter);
  const init = useStore((s) => s.init);
  const view = useStore((s) => s.view);
  const needsSignIn = useSupply((s) => s.needsSignIn);
  const booted = useSupply((s) => s.booted);
  useSimLoop();
  useHotkeys();
  useEffect(() => {
    init();
  }, [init]);
  useEffect(() => {
    // the Supply Network asks the backend whether sign-in (Neon Auth) is on; coming back from
    // Google sign-in skips the landing screen so the session is picked up straight away
    if (returningFromOAuth()) useStore.getState().enter();
    if (!booted) useSupply.getState().boot();
  }, [booted]);

  return (
    <div className="fixed inset-0 bg-void">
      <AnimatePresence>
        {!entered && (
          <motion.div key="landing" className="absolute inset-0 z-[60]" exit={{ opacity: 0, scale: 1.06, filter: "blur(8px)" }} transition={{ duration: 0.7 }}>
            <Landing onEnter={enter} />
          </motion.div>
        )}
      </AnimatePresence>

      <ErrorBoundary label="map">
        <FleetMap />
      </ErrorBoundary>
      <TopBar />
      <SideNav />

      {view === "command" && (
        <>
          <DisruptionDock />
          <EventFeed />
          <MissionPanel />
          <MobileMetricsToggle />
          <SimControls />
        </>
      )}

      <AnimatePresence mode="wait">
        {view !== "command" && (
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25 }}
            className="absolute left-[76px] right-3 top-20 bottom-4 z-20 max-md:left-2 max-md:right-2 max-md:top-[58px] max-md:bottom-[72px]"
          >
            <ErrorBoundary label={view}>
            <Suspense fallback={<div className="glass rounded-2xl h-full grid place-items-center text-dim">Loading…</div>}>
              {view === "lab" && <QuantumLab />}
              {view === "bench" && <Benchmark />}
              {view === "schedule" && <Schedule />}
              {view === "supply" && <Supply />}
            </Suspense>
            </ErrorBoundary>
          </motion.div>
        )}
      </AnimatePresence>

      <ErrorBoundary label="anneal overlay">
        <AnnealOverlay />
      </ErrorBoundary>
      {entered && needsSignIn && <AuthGate />}
      <DemoCaption />
      <Toasts />
    </div>
  );
}

/** Phones: the mission metrics open as a sheet over the map instead of a permanent side column. */
function MobileMetricsToggle() {
  const open = useStore((s) => s.mobileMetrics);
  const hasPlan = useStore((s) => !!s.plan);
  if (!hasPlan) return null;
  return (
    <button
      className={`md:hidden absolute right-2 top-[58px] z-30 btn !py-1.5 !text-[11px] ${open ? "btn-active" : ""}`}
      onClick={() => useStore.getState().set({ mobileMetrics: !open })}
    >
      {open ? "Hide metrics" : "Metrics"}
    </button>
  );
}
