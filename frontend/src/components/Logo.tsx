export function LogoMark({ size = 34, spin = false }: { size?: number; spin?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="lg-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00e5ff" />
          <stop offset="0.55" stopColor="#9d7bff" />
          <stop offset="1" stopColor="#ff3dac" />
        </linearGradient>
        <filter id="lg-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#lg-glow)">
        <path d="M32 5 55 18.5v27L32 59 9 45.5v-27z" fill="none" stroke="url(#lg-a)" strokeWidth="3" />
        <g className={spin ? "spin-slow" : ""} style={{ transformOrigin: "32px 32px" }}>
          <ellipse cx="32" cy="32" rx="19" ry="7" fill="none" stroke="#00e5ff" strokeWidth="1.6" transform="rotate(-32 32 32)" opacity="0.9" />
          <circle cx="48" cy="22" r="2.4" fill="#00e5ff" />
        </g>
        <g className={spin ? "spin-rev" : ""} style={{ transformOrigin: "32px 32px" }}>
          <ellipse cx="32" cy="32" rx="19" ry="7" fill="none" stroke="#ff3dac" strokeWidth="1.6" transform="rotate(32 32 32)" opacity="0.9" />
          <circle cx="16" cy="22" r="2.4" fill="#ff3dac" />
        </g>
        <circle cx="32" cy="32" r="6" fill="url(#lg-a)" />
      </g>
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center gap-3 select-none ${compact ? "max-md:gap-2" : ""}`}>
      <LogoMark size={compact ? 30 : 40} spin />
      <div className="leading-none">
        <div className={`font-display font-black tracking-[0.18em] grad-text ${compact ? "text-[17px] max-md:text-[14px] max-md:tracking-[0.12em]" : "text-2xl"}`}>
          QFLEET
        </div>
        <div className={`mt-1 text-[9px] font-semibold tracking-[0.32em] text-dim ${compact ? "max-[400px]:hidden" : ""}`}>
          BY TEAM <span className="text-ink">NONCHALANT</span>
        </div>
      </div>
    </div>
  );
}
