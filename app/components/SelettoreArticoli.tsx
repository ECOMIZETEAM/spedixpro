'use client'
import { useMemo, useState } from 'react'

// COSA C'E' DENTRO IL PACCO.
//
// Non e' obbligatorio: si spedisce benissimo senza dirlo. Ma se lo si dice, il magazzino del
// cliente si scarica da solo, e in elenco resta scritto cosa conteneva quel pacco.
//
// Perche' un componente e non il codice dentro la pagina: le pagine da cui si spedisce sono tre
// (portale cliente, portale master, ordini importati). Scriverlo tre volte significa che fra sei
// mesi si comportano in tre modi diversi — e' il difetto che questo progetto paga da giorni.
//
// La RICERCA c'e' perche' un catalogo vero ha centinaia di righe: scorrere non e' un'opzione.
// Si cerca per SKU, nome, prodotto e anche per variante ("rosso", "S"), perche' e' cosi' che uno
// se lo ricorda.

export type RigaArticolo = { id: string; qta: number }
export type ArticoloCat = {
  id: string; sku: string; nome?: string | null; prodotto?: string | null
  attributi?: Record<string, any> | null; quantita?: number | null
}

const inp: any = { width: '100%', padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box' }

export function descriviVariante(a: ArticoloCat): string {
  const at = a.attributi || {}
  const parti = Object.entries(at).map(([k, v]) => String(v)).filter(Boolean)
  return parti.join(' · ')
}

export default function SelettoreArticoli({
  articoli, valore, onChange, titolo = 'Cosa c’e’ nel pacco',
}: {
  articoli: ArticoloCat[]
  valore: RigaArticolo[]
  onChange: (v: RigaArticolo[]) => void
  titolo?: string
}) {
  const [aperto, setAperto] = useState(false)
  const [q, setQ] = useState('')

  const scelti = useMemo(() => new Map(valore.map(r => [r.id, r.qta])), [valore])

  const filtrati = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return articoli
    return articoli.filter(a =>
      (a.sku || '').toLowerCase().includes(s) ||
      (a.nome || '').toLowerCase().includes(s) ||
      (a.prodotto || '').toLowerCase().includes(s) ||
      descriviVariante(a).toLowerCase().includes(s))
  }, [articoli, q])

  function toggle(a: ArticoloCat) {
    if (scelti.has(a.id)) onChange(valore.filter(r => r.id !== a.id))
    else onChange([...valore, { id: a.id, qta: 1 }])
  }
  function cambiaQta(id: string, n: number) {
    onChange(valore.map(r => r.id === id ? { ...r, qta: Math.max(1, Math.trunc(n) || 1) } : r))
  }

  const pezzi = valore.reduce((t, r) => t + (r.qta || 0), 0)
  if (!articoli.length) return null

  return (
    <div style={{ border: '1px solid #e8e8e8', borderRadius: '8px', background: '#fff', overflow: 'hidden' }}>
      <button type="button" onClick={() => setAperto(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '12px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>
          {titolo} <span style={{ fontWeight: 400, color: '#999' }}>(facoltativo)</span>
        </span>
        <span style={{ fontSize: '12.5px', color: valore.length ? '#15803d' : '#9ca3af', fontWeight: valore.length ? 700 : 400 }}>
          {valore.length ? `${valore.length} articoli · ${pezzi} pezzi` : 'nessuno'} {aperto ? '▲' : '▼'}
        </span>
      </button>

      {aperto && (
        <div style={{ borderTop: '1px solid #f0f0f0', padding: '12px 14px' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Cerca SKU, nome, colore, taglia…" style={{ ...inp, marginBottom: '10px' }} />

          <div style={{ maxHeight: '260px', overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: '6px' }}>
            {filtrati.map(a => {
              const sel = scelti.has(a.id)
              const qta = scelti.get(a.id) || 1
              const giac = Number(a.quantita ?? 0)
              const variante = descriviVariante(a)
              return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderBottom: '1px solid #f7f7f7', background: sel ? '#fff7ed' : undefined }}>
                  <input type="checkbox" checked={sel} onChange={() => toggle(a)} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => toggle(a)}>
                    <div style={{ fontSize: '13px', color: '#1a1a1a' }}>
                      <b>{a.prodotto || a.nome || a.sku}</b>
                      {variante && <span style={{ color: '#6b7280' }}> · {variante}</span>}
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#9ca3af' }}>
                      {a.sku} — ne restano <span style={{ color: giac > 0 ? '#15803d' : giac < 0 ? '#b91c1c' : '#9ca3af', fontWeight: 700 }}>{giac}</span>
                    </div>
                  </div>
                  {sel && (
                    <input type="number" min={1} value={qta}
                      onChange={e => cambiaQta(a.id, Number(e.target.value))}
                      onClick={e => e.stopPropagation()}
                      style={{ ...inp, width: '72px', padding: '5px 8px', textAlign: 'center' }} />
                  )}
                  {/* Si avvisa e si lascia fare: il pacco e' reale e va spedito comunque.
                      Bloccare per un conteggio sbagliato fermerebbe il lavoro vero. */}
                  {sel && qta > giac && (
                    <span title="Ne stai spedendo piu' di quanti ne risultano: la giacenza andra' sotto zero"
                      style={{ color: '#b45309', fontSize: '15px', flexShrink: 0 }}>⚠</span>
                  )}
                </div>
              )
            })}
            {!filtrati.length && (
              <div style={{ padding: '18px', textAlign: 'center', color: '#9ca3af', fontSize: '12.5px' }}>Nessun articolo per la ricerca.</div>
            )}
          </div>

          {valore.length > 0 && (
            <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#6b7280' }}>Alla creazione questi pezzi vengono tolti dal magazzino.</span>
              <button type="button" onClick={() => onChange([])}
                style={{ background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb', padding: '6px 12px', borderRadius: '6px', fontSize: '12.5px', cursor: 'pointer' }}>Togli tutti</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
