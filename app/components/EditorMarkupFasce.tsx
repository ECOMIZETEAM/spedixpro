'use client'
import { useEffect, useMemo, useState } from 'react'
import { normalizzaMarkup, creaApplicaMarkup } from '@/lib/markup-fasce'

// EDITOR MAGGIORAZIONE PER FASCIA — condiviso da TUTTI i Duplica listino (costo→cliente, corriere in
// listino cliente). Un posto solo perche' prima si comportavano diversi e nascevano i "valori
// sbagliati". Novita': (1) MODIFICA IN BLOCCO — un modo (% o € fisso) + un valore applicati a TUTTE le
// fasce in un click, oppure switch di solo il modo; (2) ANTEPRIMA DAL VIVO del prezzo cliente per ogni
// fascia, calcolata con la STESSA funzione del server (creaApplicaMarkup): quello che vedi qui e' quello
// che verra' salvato. Cosi' un valore inatteso si vede PRIMA di confermare — parliamo di soldi.

export type FasciaMarkup = { key: string; label: string; tipo: string; peso: number; costo: number }
export type MarkupOut = { default: { mode: 'perc' | 'fisso'; valore: number } | null; perFascia: Record<string, { mode: string; valore: number }> }

const num = (v: string) => Number(String(v).replace(',', '.')) || 0
const inp: any = { padding: '6px 8px', border: '1px solid #d5d5d5', borderRadius: '6px', fontSize: '12.5px', color: '#1a1a1a', boxSizing: 'border-box' }
const eur = (n: number) => `€ ${Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function EditorMarkupFasce({ fasce, onChange }: { fasce: FasciaMarkup[]; onChange: (m: MarkupOut) => void }) {
  const [pf, setPf] = useState<Record<string, { mode: 'perc' | 'fisso'; valore: string }>>({})
  const [bulkMode, setBulkMode] = useState<'perc' | 'fisso'>('perc')
  const [bulkVal, setBulkVal] = useState('')

  // Emette il payload markup a ogni cambio (onChange NON in deps: evita loop; il padre lo memorizza).
  useEffect(() => {
    const perFascia: Record<string, { mode: string; valore: number }> = {}
    for (const [k, v] of Object.entries(pf)) { const val = num(v.valore); if (val) perFascia[k] = { mode: v.mode, valore: val } }
    onChange({ default: null, perFascia })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pf])

  function setPerFascia(k: string, patch: Partial<{ mode: 'perc' | 'fisso'; valore: string }>) {
    setPf(prev => ({ ...prev, [k]: { mode: prev[k]?.mode || 'perc', valore: prev[k]?.valore ?? '', ...patch } }))
  }
  // BULK: applica lo stesso modo+valore a TUTTE le fasce.
  function applicaATutte() {
    const n: Record<string, { mode: 'perc' | 'fisso'; valore: string }> = {}
    for (const f of fasce) n[f.key] = { mode: bulkMode, valore: bulkVal }
    setPf(n)
  }
  // Switcha SOLO il modo (%↔€) di tutte le fasce già impostate, tenendo i valori.
  function switchaTutte(mode: 'perc' | 'fisso') {
    setBulkMode(mode)
    setPf(prev => { const n: any = {}; for (const k of Object.keys(prev)) n[k] = { ...prev[k], mode }; return n })
  }
  function svuota() { setPf({}); setBulkVal('') }

  // Anteprima con la STESSA funzione del server.
  const applica = useMemo(() => {
    const perFascia: Record<string, { mode: string; valore: number }> = {}
    for (const [k, v] of Object.entries(pf)) { const val = num(v.valore); if (val) perFascia[k] = { mode: v.mode, valore: val } }
    return creaApplicaMarkup(normalizzaMarkup({ default: null, perFascia }))
  }, [pf])

  const nImpostate = Object.values(pf).filter(v => num(v.valore) > 0).length

  return (
    <div>
      {/* MODIFICA IN BLOCCO */}
      <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: '#9a3412', marginBottom: '8px' }}>Modifica in blocco — applica a tutte le fasce</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <select value={bulkMode} onChange={e => setBulkMode(e.target.value as any)} style={{ ...inp, padding: '7px 8px' }}>
            <option value="perc">% percentuale</option>
            <option value="fisso">€ valore fisso</option>
          </select>
          <input type="number" step="0.01" value={bulkVal} onChange={e => setBulkVal(e.target.value)} placeholder="valore" style={{ ...inp, width: '90px', textAlign: 'right' }} />
          <span style={{ fontSize: '13px', fontWeight: 700 }}>{bulkMode === 'perc' ? '%' : '€'}</span>
          <button type="button" onClick={applicaATutte} style={{ background: '#ea580c', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 14px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}>Applica a tutte</button>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '6px' }}>
            <button type="button" onClick={() => switchaTutte('perc')} title="Passa tutte a %" style={{ ...inp, cursor: 'pointer', fontWeight: 700, background: '#fff' }}>tutte %</button>
            <button type="button" onClick={() => switchaTutte('fisso')} title="Passa tutte a € fisso" style={{ ...inp, cursor: 'pointer', fontWeight: 700, background: '#fff' }}>tutte €</button>
            {nImpostate > 0 && <button type="button" onClick={svuota} style={{ ...inp, cursor: 'pointer', color: '#b91c1c', background: '#fff' }}>svuota</button>}
          </span>
        </div>
        <div style={{ fontSize: '11px', color: '#9a3412', marginTop: '6px' }}>Poi puoi ritoccare le singole fasce qui sotto. Le fasce lasciate a 0 vengono copiate al costo (senza margine).</div>
      </div>

      {/* PER FASCIA + ANTEPRIMA */}
      <div style={{ border: '1px solid #eee', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
          <thead><tr style={{ background: '#fafafa' }}>
            <th style={{ textAlign: 'left', padding: '7px 10px', fontWeight: 700, color: '#666', borderBottom: '1px solid #eee' }}>Fascia</th>
            <th style={{ textAlign: 'left', padding: '7px 8px', fontWeight: 700, color: '#666', borderBottom: '1px solid #eee' }}>Modo</th>
            <th style={{ textAlign: 'left', padding: '7px 8px', fontWeight: 700, color: '#666', borderBottom: '1px solid #eee' }}>Valore</th>
            <th style={{ textAlign: 'right', padding: '7px 10px', fontWeight: 700, color: '#666', borderBottom: '1px solid #eee' }}>Anteprima (costo → cliente)</th>
          </tr></thead>
          <tbody>
            {fasce.map(f => {
              const cur = pf[f.key]
              const nuovo = applica(f.costo, f.tipo, f.peso)
              const sottocosto = num(cur?.valore || '') > 0 && nuovo < f.costo
              return (
                <tr key={f.key} style={{ borderBottom: '1px solid #f4f4f4' }}>
                  <td style={{ padding: '6px 10px', color: '#1a1a1a', fontWeight: 600 }}>{f.label}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <select value={cur?.mode || 'perc'} onChange={e => setPerFascia(f.key, { mode: e.target.value as any })} style={{ ...inp, padding: '5px 6px' }}>
                      <option value="perc">%</option><option value="fisso">€ fisso</option>
                    </select>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input type="number" step="0.01" value={cur?.valore ?? ''} onChange={e => setPerFascia(f.key, { valore: e.target.value })} placeholder="0" style={{ ...inp, width: '80px', textAlign: 'right' }} />
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <span style={{ color: '#9ca3af' }}>{eur(f.costo)}</span>
                    <span style={{ color: '#9ca3af' }}> → </span>
                    <span style={{ fontWeight: 700, color: sottocosto ? '#b91c1c' : nuovo > f.costo ? '#15803d' : '#1a1a1a' }}>{eur(nuovo)}</span>
                    {sottocosto && <span title="Sotto il costo: ci rimetti" style={{ marginLeft: '4px' }}>⚠</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: '11px', color: '#888', marginTop: '6px' }}>L’anteprima usa un costo d’esempio per fascia (la stessa maggiorazione vale su tutte le zone di quella fascia).</div>
    </div>
  )
}
