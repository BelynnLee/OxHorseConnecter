export function Backdrop() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background: 'var(--backdrop-base, var(--background-base))',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.045]"
        style={{
          background:
            'linear-gradient(135deg, transparent 0 44%, var(--midground) 44% 45%, transparent 45% 100%)',
          backgroundSize: '34px 34px',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.42]"
        style={{
          background:
            'radial-gradient(ellipse at 0% 0%, var(--warm-glow) 0%, transparent 56%), radial-gradient(ellipse at 100% 100%, var(--accent-soft) 0%, transparent 52%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 160 160' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E\")",
          backgroundSize: '220px 220px',
        }}
      />
    </>
  );
}
