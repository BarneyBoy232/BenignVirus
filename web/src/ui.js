// Shared styles + the trefoil mark, used across dashboard pages.
export const trefoilSvg = (size = 30) => ({
  __html: `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="49" fill="#111"/>
    <circle cx="50" cy="50" r="44" fill="#ffd200"/>
    <g fill="#111">
      <path d="M50 50 L30 15.36 A40 40 0 0 1 70 15.36 Z"/>
      <path d="M50 50 L90 50 A40 40 0 0 1 70 84.64 Z"/>
      <path d="M50 50 L30 84.64 A40 40 0 0 1 10 50 Z"/>
    </g>
    <circle cx="50" cy="50" r="15" fill="#ffd200"/>
    <circle cx="50" cy="50" r="9" fill="#111"/>
  </svg>`,
})

export const c = {
  panel: { background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: 20, marginBottom: 22 },
  sub: { margin: '0 0 14px', color: 'var(--dim)', fontSize: 13 },
  empty: { color: 'var(--dim)', textAlign: 'center', padding: 24 },
  label: { display: 'block', fontSize: 12, color: 'var(--dim)', margin: '0 0 5px' },
  input: { width: '100%', background: 'var(--panel2)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 8, padding: '9px 11px', font: 'inherit' },
  th: { textAlign: 'left', color: 'var(--dim)', fontWeight: 500, fontSize: 12, padding: '8px 10px', borderBottom: '1px solid var(--line)' },
  td: { padding: 10, borderBottom: '1px solid var(--line)', overflowWrap: 'anywhere' },
  primary: { background: 'var(--accent)', color: 'var(--accent-ink)', border: 0, borderRadius: 8, padding: '10px 18px', fontWeight: 650, cursor: 'pointer' },
  h2: { margin: '0 0 4px', fontSize: 15 },
}
