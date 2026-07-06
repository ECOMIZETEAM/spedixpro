// Scala tipografica e stili condivisi — riferimento: portale master.
// Usare questi token per mantenere font, grandezze e colori uguali ovunque.

export const COL = {
  text: '#1a1a1a',
  muted: '#666666',
  accent: '#f97316',
  accentDark: '#ea580c',
  border: '#e8e8e8',
  borderStrong: '#d1d5db',
  bg: '#f5f5f5',
  card: '#ffffff',
  danger: '#dc2626',
  success: '#16a34a',
} as const

export const FS = {
  h1: '20px', h2: '16px', h3: '14px',
  body: '13px', sm: '12px', label: '11px', xs: '11px',
} as const

// Stili pronti (oggetti style inline)
export const ui = {
  h1: { fontSize: FS.h1, fontWeight: 700 as const, color: COL.text, margin: 0 },
  h2: { fontSize: FS.h2, fontWeight: 700 as const, color: COL.text, margin: 0 },
  h3: { fontSize: FS.h3, fontWeight: 700 as const, color: COL.text, margin: 0 },
  label: { fontSize: FS.label, fontWeight: 600 as const, color: COL.muted, display: 'block' as const, marginBottom: '4px' },
  input: { width: '100%', padding: '9px 12px', border: `1px solid ${COL.border}`, borderRadius: '6px', fontSize: FS.body, color: COL.text, background: COL.card, boxSizing: 'border-box' as const },
  card: { background: COL.card, borderRadius: '8px', border: `1px solid ${COL.borderStrong}`, overflow: 'hidden' as const },
  btnPrimary: { padding: '9px 20px', background: COL.accent, color: '#fff', border: 'none', borderRadius: '6px', fontSize: FS.body, fontWeight: 700 as const, cursor: 'pointer' as const },
  btnGhost: { padding: '9px 20px', background: '#f5f5f5', border: `1px solid ${COL.borderStrong}`, borderRadius: '6px', fontSize: FS.body, color: COL.text, cursor: 'pointer' as const },
  th: { textAlign: 'left' as const, padding: '9px 12px', fontSize: FS.label, fontWeight: 700 as const, color: COL.text, borderBottom: `1px solid ${COL.borderStrong}` },
  td: { padding: '10px 12px', fontSize: FS.sm, color: COL.text },
  muted: { fontSize: FS.sm, color: COL.muted },
} as const
