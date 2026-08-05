'use client'
// Pezzi condivisi dalle pagine della Logistica.
//
// Stanno qui e non copiati in ogni pagina per il motivo di sempre: quattro copie degli stessi stili
// e delle stesse chiamate diventano quattro comportamenti diversi al primo ritocco.

// Gli stili sono quelli del resto del portale (li stessi di Catalogo prodotti e Listini), non
// inventati qui: in un gestionale la coerenza vale, perche' uno impara un posto e si aspetta di
// ritrovarlo uguale. Stavano a occhio e si vedeva.
export const ACCENT = '#f97316'
export const inp: any = { width: '100%', padding: '9px 11px', fontSize: '13px', border: '1px solid #d5d5d5', borderRadius: '6px', outline: 'none', color: '#1a1a1a', background: '#fff', boxSizing: 'border-box' }
export const card: any = { background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', overflow: 'hidden', marginBottom: '14px' }
export const cardH: any = { padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }
export const th: any = { padding: '9px 12px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#666', textAlign: 'left', whiteSpace: 'nowrap' }
export const td: any = { padding: '8px 12px', fontSize: '12.5px', color: '#1a1a1a', borderTop: '1px solid #f0f0f0' }
export const lbl: any = { display: 'block', fontSize: '11.5px', color: '#666', marginBottom: '4px' }
export const btn: any = { background: ACCENT, color: '#fff', border: 'none', borderRadius: '6px', padding: '9px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }
export const btnSec: any = { background: '#fff', color: '#555', border: '1px solid #d5d5d5', borderRadius: '6px', padding: '9px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }

export const eur = (n: any) => `€ ${Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function Testata({ titolo, sottotitolo }: { titolo: string; sottotitolo?: string }) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>{titolo}</h1>
      {sottotitolo && <p style={{ color: '#1a1a1a', fontSize: '13px', marginTop: '4px' }}>{sottotitolo}</p>}
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
  return <div style={{ padding: '46px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>{testo}</div>
}

// La descrizione di una variante: "rosso · S". Uguale a quella del selettore articoli.
export const variante = (a: any) => Object.values(a?.attributi || {}).filter(Boolean).join(' · ')
