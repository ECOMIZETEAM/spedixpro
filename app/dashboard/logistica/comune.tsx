'use client'
// Pezzi condivisi dalle pagine della Logistica.
//
// Stanno qui e non copiati in ogni pagina per il motivo di sempre: quattro copie degli stessi stili
// e delle stesse chiamate diventano quattro comportamenti diversi al primo ritocco.

export const inp: any = { width: '100%', padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box' }
export const card: any = { background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', overflow: 'hidden', marginBottom: '18px' }
export const cardH: any = { padding: '13px 16px', borderBottom: '1px solid #f0f0f0', fontSize: '13.5px', fontWeight: 700, color: '#1a1a1a' }
export const th: any = { textAlign: 'left', padding: '9px 14px', fontSize: '11.5px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.03em', borderBottom: '1px solid #eee' }
export const td: any = { padding: '10px 14px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f5f5f5' }
export const lbl: any = { fontSize: '11.5px', fontWeight: 600, color: '#1a1a1a', display: 'block', marginBottom: '4px' }
export const btn: any = { background: '#f97316', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }
export const btnSec: any = { background: '#fff', color: '#f97316', border: '1px solid #fdba74', padding: '8px 14px', borderRadius: '6px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }

export const eur = (n: any) => `€ ${Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function Testata({ titolo, sottotitolo }: { titolo: string; sottotitolo?: string }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#1a1a1a', margin: '0 0 6px' }}>{titolo}</h1>
      {sottotitolo && <p style={{ color: '#666', fontSize: '13px', margin: 0 }}>{sottotitolo}</p>}
    </div>
  )
}

export function Avviso({ msg }: { msg: { t: 'ok' | 'err'; x: string } | null }) {
  if (!msg) return null
  const ok = msg.t === 'ok'
  return (
    <div style={{ background: ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${ok ? '#bbf7d0' : '#fecaca'}`, color: ok ? '#15803d' : '#b91c1c', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '14px' }}>
      {msg.x}
    </div>
  )
}

export function Vuoto({ testo }: { testo: string }) {
  return <div style={{ padding: '26px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>{testo}</div>
}

// La descrizione di una variante: "rosso · S". Uguale a quella del selettore articoli.
export const variante = (a: any) => Object.values(a?.attributi || {}).filter(Boolean).join(' · ')
