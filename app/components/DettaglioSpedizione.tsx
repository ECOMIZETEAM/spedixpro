'use client'
import React from 'react'
import { ldvProvvisoria, LDV_IN_ELABORAZIONE } from '@/lib/numero-spedizione'

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', overflow: 'hidden' }
const cardH: React.CSSProperties = { padding: '11px 15px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', fontWeight: 700, color: '#1a1a1a', background: '#fafafa' }
const cardB: React.CSSProperties = { padding: '14px 15px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 18px' }
const lblS: React.CSSProperties = { fontSize: '10.5px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '2px' }
const valS: React.CSSProperties = { fontSize: '13px', color: '#1a1a1a', fontWeight: 500, wordBreak: 'break-word' }

function F({ label, value, full }: { label: string; value: any; full?: boolean }) {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : undefined}>
      <div style={lblS}>{label}</div>
      <div style={valS}>{value != null && value !== '' ? value : '—'}</div>
    </div>
  )
}

export default function DettaglioSpedizione({ s, onClose, etichettaHref, onModificata }: { s: any; onClose: () => void; etichettaHref?: string; onModificata?: () => void }) {
  // Correzione peso/misure (solo master creatore, spedizione con cliente). L'etichetta NON cambia: si
  // ricalcola solo il costo e la differenza va in rettifica su tutta la catena (addebito o rimborso).
  // MULTICOLLO: si corregge ogni collo. colli_dettaglio non e' in SPED_COLS -> lo prendo da /[id].
  const [mod, setMod] = React.useState(false)
  const [dett, setDett] = React.useState<any>(null)
  const [colliForm, setColliForm] = React.useState<{ peso: string; lunghezza: string; larghezza: string; altezza: string }[]>([])
  const [ant, setAnt] = React.useState<any>(null)
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState('')
  React.useEffect(() => {
    setMod(false); setAnt(null); setMsg(''); setDett(null); setColliForm([])
    if (!s?.id) return
    let vivo = true
    fetch(`/api/spedizioni/${s.id}`).then(r => r.ok ? r.json() : null).then(d => {
      if (!vivo || !d) return
      setDett(d)
      const cd = Array.isArray(d.colli_dettaglio) ? d.colli_dettaglio : []
      const n = Math.max(Number(d.colli) || 0, cd.length, 1)
      // pre-riempio i colli: dal dettaglio se c'e', altrimenti (mono) dai campi della spedizione
      setColliForm(Array.from({ length: n }, (_, i) => {
        const c = cd[i] || {}
        const g = (k: string, mono: any) => { const v = c[k] != null ? c[k] : (n === 1 ? mono : ''); return String(v ?? '') }
        return { peso: g('peso', d.peso_reale), lunghezza: g('lunghezza', d.lunghezza), larghezza: g('larghezza', d.larghezza), altezza: g('altezza', d.altezza) }
      }))
    }).catch(() => {})
    return () => { vivo = false }
  }, [s?.id])
  function setCollo(i: number, k: string, v: string) { setColliForm(prev => prev.map((c, idx) => idx === i ? { ...c, [k]: v } : c)); setAnt(null) }
  async function invia(dry: boolean) {
    setBusy(true); setMsg('')
    try {
      const colli = colliForm.map(c => ({ peso: Number(c.peso), lunghezza: Number(c.lunghezza), larghezza: Number(c.larghezza), altezza: Number(c.altezza) }))
      const r = await fetch('/api/spedizioni/modifica', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spedizioneId: s.id, dryRun: dry, colli }),
      })
      const d = await r.json()
      if (!r.ok) { setMsg(d.error || 'Errore'); setAnt(null); return }
      if (dry) setAnt(d)
      else { onModificata?.(); onClose() }
    } catch (e: any) { setMsg(String(e?.message || e)) }
    finally { setBusy(false) }
  }
  if (!s) return null
  const eur = (x: any) => '€ ' + Number(x || 0).toFixed(2)
  const dims = [s.lunghezza, s.larghezza, s.altezza].every((x: any) => Number(x) > 0) ? `${s.lunghezza} × ${s.larghezza} × ${s.altezza} cm` : '—'
  const accessori = (s.servizi_accessori || []).map((e: any) => `${e.nome}${e.importo ? ' (€' + Number(e.importo).toFixed(2) + ')' : ''}`).join(', ')
  const colliDett = Array.isArray(dett?.colli_dettaglio) ? dett.colli_dettaglio : []
  const multicollo = Number(s.colli) > 1
  const puoCorreggere = !!onModificata && !!s.cliente_id && s.stato !== 'annullata'

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '30px 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#f6f7f8', borderRadius: '12px', width: '100%', maxWidth: '760px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '15px 20px', borderBottom: '1px solid #e8e8e8', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', borderRadius: '12px 12px 0 0' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: '#1a1a1a' }}>Dettaglio spedizione</div>
            <div style={{ fontSize: '12px', color: '#f97316', fontWeight: 700, marginTop: '2px' }}>{ldvProvvisoria(s.numero) ? `⏳ ${LDV_IN_ELABORAZIONE}` : s.numero}{s.tracking_number ? ` · ${s.tracking_number}` : ''}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '22px', color: '#999', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={card}>
              <div style={cardH}>Mittente</div>
              <div style={cardB}>
                <F label="Nome" value={s.mitt_nome} full />
                <F label="Indirizzo" value={s.mitt_indirizzo} full />
                <F label="Città" value={s.mitt_citta} />
                <F label="Prov / CAP" value={`${s.mitt_provincia || ''} ${s.mitt_cap || ''}`.trim()} />
                <F label="Paese" value={s.mitt_paese} />
                <F label="Telefono" value={s.mitt_telefono} />
                <F label="Email" value={s.mitt_email} full />
              </div>
            </div>
            <div style={card}>
              <div style={cardH}>Destinatario</div>
              <div style={cardB}>
                <F label="Nome" value={s.dest_nome} full />
                <F label="Indirizzo" value={s.dest_indirizzo} full />
                <F label="Città" value={s.dest_citta} />
                <F label="Prov / CAP" value={`${s.dest_provincia || ''} ${s.dest_cap || ''}`.trim()} />
                <F label="Paese" value={s.dest_paese} />
                <F label="Telefono" value={s.dest_telefono} />
                <F label="Email" value={s.dest_email} full />
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={cardH}>Spedizione</div>
            <div style={{ ...cardB, gridTemplateColumns: '1fr 1fr 1fr' }}>
              <F label="Corriere" value={s.corrieri?.nome_contratto} />
              <F label="Stato" value={String(s.stato || '').replace(/_/g, ' ')} />
              <F label="Data" value={s.created_at ? new Date(s.created_at).toLocaleString('it-IT') : '—'} />
              <F label="Colli" value={s.colli} />
              <F label="Peso reale" value={s.peso_reale != null ? `${s.peso_reale} kg` : '—'} />
              <F label="Dimensioni" value={dims} />
              <F label="Contrassegno" value={Number(s.contrassegno) > 0 ? eur(s.contrassegno) : '—'} />
              <F label="Assicurazione" value={Number(s.assicurazione) > 0 ? eur(s.assicurazione) : '—'} />
              <F label="Valore merce" value={Number(s.valore_merce) > 0 ? eur(s.valore_merce) : '—'} />
              <F label="Contenuto" value={s.contenuto} full />
              <F label="Servizi accessori" value={accessori || '—'} full />
              <F label="Note" value={s.note} full />
            </div>
          </div>

          {multicollo && colliDett.length > 0 && (
            <div style={card}>
              <div style={cardH}>Colli ({colliDett.length})</div>
              <div style={{ padding: '8px 15px 12px' }}>
                {colliDett.map((c: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: i < colliDett.length - 1 ? '1px solid #f0f0f0' : 'none', fontSize: '13px' }}>
                    <span style={{ color: '#666' }}>Collo {c.numero || i + 1}</span>
                    <span style={{ fontWeight: 600, color: '#1a1a1a' }}>{c.peso != null && c.peso !== '' ? `${c.peso} kg` : '—'} · {[c.lunghezza, c.larghezza, c.altezza].every((x: any) => Number(x) > 0) ? `${c.lunghezza}×${c.larghezza}×${c.altezza} cm` : '— cm'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={card}>
            <div style={cardH}>Costo</div>
            <div style={cardB}>
              <F label="Prezzo" value={<span style={{ fontWeight: 800, color: '#16a34a', fontSize: '15px' }}>{eur(s.costo_totale)}</span>} />
              {s.richiedi_ritiro ? <F label="Ritiro richiesto" value={`${s.data_ritiro || ''} ${s.intervallo_ritiro || ''}`.trim() || 'Sì'} /> : <div />}
            </div>
          </div>

          {mod && (
            <div style={{ ...card, border: '1px solid #fed7aa' }}>
              <div style={{ ...cardH, background: '#fff7ed', color: '#ea580c' }}>Correggi peso / misure</div>
              <div style={{ padding: '14px 15px' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>L'etichetta <b>non</b> cambia. Si ricalcola il costo: la differenza va in rettifica sul cliente (addebito se sale, rimborso se scende).</div>
                {colliForm.map((c, i) => (
                  <div key={i} style={{ marginBottom: '10px' }}>
                    {colliForm.length > 1 && <div style={{ ...lblS, marginBottom: '4px', color: '#ea580c' }}>Collo {i + 1}</div>}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                      {([['Peso kg', 'peso'], ['Lungh. cm', 'lunghezza'], ['Largh. cm', 'larghezza'], ['Alt. cm', 'altezza']] as [string, string][]).map(([lab, k]) => (
                        <div key={k}>
                          <div style={lblS}>{lab}</div>
                          <input type="number" value={(c as any)[k]} onChange={e => setCollo(i, k, e.target.value)} style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {ant && (
                  <div style={{ marginTop: '12px', padding: '10px 12px', background: ant.tipo === 'addebito' ? '#fef2f2' : ant.tipo === 'rimborso' ? '#f0fdf4' : '#f8fafc', borderRadius: '7px', fontSize: '13px' }}>
                    <div>Peso: <b>{ant.pesoPrima} kg → {ant.pesoDopo} kg</b></div>
                    <div>Nuovo costo cliente: <b>{eur(ant.nuovoCostoCliente)}</b> (era {eur(s.costo_totale)})</div>
                    <div style={{ marginTop: '4px', fontWeight: 700, color: ant.tipo === 'addebito' ? '#dc2626' : ant.tipo === 'rimborso' ? '#16a34a' : '#666' }}>
                      {ant.tipo === 'addebito' ? `Addebito al cliente: ${eur(Math.abs(ant.importo))}` : ant.tipo === 'rimborso' ? `Rimborso al cliente: ${eur(ant.importo)}` : 'Nessuna variazione di costo'}
                    </div>
                  </div>
                )}
                {msg && <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '8px' }}>{msg}</div>}
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button onClick={() => invia(true)} disabled={busy} style={{ padding: '8px 14px', background: '#fff', color: '#ea580c', border: '1px solid #fed7aa', borderRadius: '7px', fontSize: '13px', fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>{busy ? '…' : 'Calcola'}</button>
                  {ant && ant.tipo !== 'nessuna variazione' && <button onClick={() => invia(false)} disabled={busy} style={{ padding: '8px 14px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>{busy ? '…' : 'Conferma correzione'}</button>}
                  <button onClick={() => { setMod(false); setAnt(null); setMsg('') }} style={{ padding: '8px 14px', background: 'none', color: '#666', border: 'none', fontSize: '13px', cursor: 'pointer' }}>Annulla</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid #e8e8e8', display: 'flex', justifyContent: 'flex-end', gap: '10px', background: '#fff', borderRadius: '0 0 12px 12px' }}>
          {puoCorreggere && !mod && <button onClick={() => setMod(true)} style={{ marginRight: 'auto', padding: '9px 16px', background: '#fff', color: '#ea580c', border: '1px solid #fed7aa', borderRadius: '7px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>✏️ Correggi peso/misure</button>}
          {etichettaHref && <a href={etichettaHref} download style={{ padding: '9px 16px', background: '#fff7ed', color: '#ea580c', border: '1px solid #fed7aa', borderRadius: '7px', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }}>🖨️ Etichetta</a>}
          <button onClick={onClose} style={{ padding: '9px 18px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Chiudi</button>
        </div>
      </div>
    </div>
  )
}
