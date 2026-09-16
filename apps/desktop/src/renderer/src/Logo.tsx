export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "brand compact" : "brand"} aria-label="REACTOR">
      <svg className="mark" viewBox="0 0 120 120" role="img" aria-hidden="true">
        <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="3" />
        <circle cx="60" cy="60" r="43" fill="none" stroke="currentColor" strokeWidth="1" opacity=".45" />
        <path d="M60 20 99 88H21L60 20Z" fill="none" stroke="currentColor" strokeWidth="7" strokeLinejoin="round" />
        <path d="M60 38 82 77H38L60 38Z" fill="currentColor" opacity=".15" stroke="currentColor" strokeWidth="2" />
        <circle cx="60" cy="60" r="5" fill="#f4fbff" />
      </svg>
      {!compact && <div><strong>REACTOR</strong><span>ARC LIQUIDITY SNIPER</span></div>}
    </div>
  );
}
