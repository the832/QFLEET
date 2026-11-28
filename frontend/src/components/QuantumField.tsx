import { useEffect, useRef } from "react";

/** Animated "qubit field": orbiting particles on Bloch-sphere rings with entanglement links. */
export function QuantumField({ density = 1 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    let raf = 0;
    let w = 0,
      h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      w = cv.clientWidth;
      h = cv.clientHeight;
      cv.width = w * dpr;
      cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const N = Math.round(160 * density);
    const parts = Array.from({ length: N }, () => ({
      r: 120 + Math.random() * 520,
      a: Math.random() * Math.PI * 2,
      tilt: (Math.random() - 0.5) * 1.4,
      sp: (0.0006 + Math.random() * 0.0022) * (Math.random() < 0.5 ? -1 : 1),
      size: 0.6 + Math.random() * 1.8,
      hue: Math.random(),
      phase: Math.random() * Math.PI * 2,
    }));
    const t0 = performance.now();
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2,
        cy = h / 2;
      // rings
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, 180 + k * 120, 60 + k * 38, (k % 2 ? 1 : -1) * 0.35 + t * 0.03 * (k + 1), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${k % 2 ? "255,61,172" : "0,229,255"},${0.07 - k * 0.012})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      const pts: [number, number, number][] = [];
      for (const p of parts) {
        p.a += p.sp * 16;
        const x = cx + Math.cos(p.a) * p.r;
        const y = cy + Math.sin(p.a) * p.r * (0.36 + p.tilt * 0.2);
        const flick = 0.55 + 0.45 * Math.sin(t * 2.4 + p.phase);
        const col = p.hue < 0.5 ? `0,229,255` : p.hue < 0.8 ? `157,123,255` : `255,61,172`;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${col},${0.35 + 0.5 * flick})`;
        ctx.shadowBlur = 12;
        ctx.shadowColor = `rgba(${col},0.9)`;
        ctx.fill();
        pts.push([x, y, p.hue]);
      }
      ctx.shadowBlur = 0;
      // entanglement links
      for (let i = 0; i < pts.length; i += 2) {
        for (let j = i + 1; j < Math.min(pts.length, i + 14); j++) {
          const dx = pts[i][0] - pts[j][0],
            dy = pts[i][1] - pts[j][1];
          const d = Math.hypot(dx, dy);
          if (d < 70) {
            ctx.beginPath();
            ctx.moveTo(pts[i][0], pts[i][1]);
            ctx.lineTo(pts[j][0], pts[j][1]);
            ctx.strokeStyle = `rgba(0,229,255,${(1 - d / 70) * 0.16})`;
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [density]);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full" />;
}
