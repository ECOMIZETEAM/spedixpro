'use client'
// Scheda "Elenco zone" del Listino Prezzi del cliente: le zone che paga su un contratto, cosa c'e'
// dentro, e la verifica di un indirizzo col calcolo vero. Sola lettura. Regole: lib/zone-cliente.ts.
import { useEffect, useMemo, useState } from 'react'
import { PAESI_MONDO } from '@/lib/paesi-elenco'

type Riga = { paese: string; provincia: string | null; cap: string | null; citta: string | null; tipo: string; localita?: string[] }
type Zona = { nome: string; partenza: boolean; multicollo: boolean; righe: Riga[] }

const NOME_PAESE = new Map(PAESI_MONDO.map((p) => [p.code, p.nome]))
const nomePaese = (c: string) => NOME_PAESE.get(c) || c
const MOSTRA_SUBITO = 300

const valePer = (r: Riga) =>
  r.tipo === 'tutto_paese' ? (r.paese === 'IT' ? 'tutta Italia' : 'tutto il paese')
    : r.tipo === 'provincia' ? 'tutta la provincia'
    : r.tipo === 'cap' ? 'tutto il CAP'
    : 'solo questa località'

const luogo = (r: Riga) =>
  r.tipo === 'tutto_paese' ? (r.paese === 'IT' ? 'Tutta Italia' : nomePaese(r.paese))
    : r.tipo === 'provincia' ? `Tutta la provincia ${r.provincia}`
    : r.tipo === 'cap' ? (r.localita || []).join(', ')
    : r.citta || ''

const chiaveCap = (r: Riga) => (r.cap ? `${r.paese}|${r.cap}` : '')
const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’'`\s]/g, '')

export default function ZoneContratto({ corriereId }: { corriereId: string }) {
  const [zone, setZone] = useState<Zona[] | null>(null)
  const [errore, setErrore] = useState('')
  const [cerca, setCerca] = useState('')
  const [aperte, setAperte] = useState<Record<string, boolean>>({})
  const [tutte, setTutte] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let vivo = true
    setZone(null); setErrore('')
    fetch('/api/cliente/zone?corriere=' + encodeURIComponent(corriereId))
      .then(async (r) => { const x = await r.json().catch(() => ({})); if (!vivo) return; if (!r.ok) setErrore(x.error || 'Elenco zone non disponibile.'); else setZone(x.zone || []) })
      .catch(() => vivo && setErrore('Elenco zone non disponibile: controlla la connessione e riprova.'))
    return () => { vivo = false }
  }, [corriereId])

  // Un CAP che compare in piu' zone di destinazione: l'elenco non puo' dire da solo quale vince
  // (lo decide il calcolo, citta' compresa) → si avvisa e si rimanda alla verifica.
  const zonePerCap = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const z of zone || []) {
      if (z.partenza || z.multicollo) continue
      for (const r of z.righe) { const k = chiaveCap(r); if (!k) continue; if (!m.has(k)) m.set(k, new Set()); m.get(k)!.add(z.nome) }
    }
    return m
  }, [zone])

  const q = norm(cerca.trim())
  const corrisponde = (r: Riga) => !q || norm(r.cap || '').startsWith(q) || norm(r.citta || '').includes(q) ||
    (r.localita || []).some((l) => norm(l).includes(q)) || norm(r.provincia || '') === q || norm(nomePaese(r.paese)).includes(q)

  const paesi = useMemo(() => {
    const s = new Set<string>(['IT'])
    for (const z of zone || []) for (const r of z.righe) s.add(r.paese)
    return Array.from(s).sort((a, b) => (a === 'IT' ? -1 : b === 'IT' ? 1 : nomePaese(a).localeCompare(nomePaese(b))))
  }, [zone])

  function scaricaCsv() {
    const cella = (v: string) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
    const righe = [['Zona', 'Uso', 'Paese', 'Provincia', 'CAP', 'Località', 'Vale per'].map(cella).join(';')]
    for (const z of zone || []) for (const r of z.righe) {
      righe.push([z.nome, z.partenza ? 'alla partenza' : z.multicollo ? 'multicollo' : 'destinazione', r.paese, r.provincia || '', r.cap || '', luogo(r), valePer(r)].map(cella).join(';'))
    }
    // BOM: senza, Excel apre il file come testo occidentale e storpia le lettere accentate.
    const blob = new Blob(['﻿' + righe.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = 'zone.csv'; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  if (errore) return <div style={{ fontSize: '13px', color: '#b91c1c', padding: '4px 0' }}>{errore}</div>
  if (!zone) return <div style={{ fontSize: '13px', color: '#9ca3af', padding: '4px 0' }}>Caricamento zone…</div>
  if (!zone.length) return <div style={{ fontSize: '13px', color: '#9ca3af', padding: '4px 0' }}>Nessuna zona impostata per questo contratto.</div>

  const visibili = zone.map((z) => ({ z, righe: z.righe.filter(corrisponde) })).filter((x) => !q || x.righe.length)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <p style={{ fontSize: '12.5px', color: '#4b5563', margin: 0, lineHeight: 1.55 }}>
        Le zone che paghi con questo contratto e le località che contengono. Il nome della zona è lo stesso
        della colonna nella scheda <b>Pesi / Zone</b>. Per un indirizzo preciso usa <b>Verifica un indirizzo</b>:
        fa lo stesso calcolo della creazione della spedizione.
      </p>

      {/* Telefono: la colonna "Vale per" allargava la tabella oltre lo schermo e tagliava gli avvisi;
          sotto i 600 px la si legge sotto la localita'. */}
      <style>{'@media (max-width: 600px){ .zc-vale{display:none} .zc-vale-m{display:block !important} }'}</style>
      <Verifica corriereId={corriereId} paesi={paesi} />

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca CAP o località nell'elenco"
          style={{ flex: '1 1 220px', minWidth: 0, padding: '8px 10px', fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '6px' }} />
        <button onClick={scaricaCsv} style={{ padding: '8px 12px', fontSize: '12.5px', fontWeight: 600, border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', color: '#374151', cursor: 'pointer' }}>
          Scarica elenco (CSV)
        </button>
      </div>

      {q && !visibili.length && <div style={{ fontSize: '12.5px', color: '#6b7280' }}>Nessuna riga dell'elenco contiene “{cerca.trim()}”. Usa la verifica qui sopra per sapere in che zona cade.</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {visibili.map(({ z, righe }) => {
          const aperta = !!q || !!aperte[z.nome]
          const estera = righe.length > 0 && righe.every((r) => r.paese !== 'IT')
          const mostrate = tutte[z.nome] ? righe : righe.slice(0, MOSTRA_SUBITO)
          return (
            <div key={z.nome} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
              <button onClick={() => setAperte((a) => ({ ...a, [z.nome]: !a[z.nome] }))}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', background: aperta ? '#fff7ed' : '#fafafa', border: 'none', cursor: 'pointer', textAlign: 'left', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#1a1a1a' }}>{z.nome}</span>
                {z.partenza && <Badge testo="alla partenza" />}
                {z.multicollo && <Badge testo="multicollo" />}
                <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#6b7280' }}>{q ? `${righe.length} di ${z.righe.length}` : z.righe.length} {z.righe.length === 1 ? 'riga' : 'righe'}</span>
                <span style={{ fontSize: '16px', color: '#9ca3af', transform: aperta ? 'rotate(90deg)' : 'none' }}>›</span>
              </button>
              {aperta && (
                <div style={{ borderTop: '1px solid #eee', overflowX: 'auto' }}>
                  {z.partenza && <div style={{ fontSize: '12px', color: '#6b7280', padding: '8px 12px 0' }}>Si applica in base al CAP del <b>mittente</b>, non del destinatario.</div>}
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                    <thead>
                      <tr style={{ background: '#f9fafb', color: '#6b7280', textAlign: 'left' }}>
                        {estera && <th style={th}>Paese</th>}
                        <th style={th}>CAP</th>
                        {!estera && <th style={th}>Prov.</th>}
                        <th style={th}>Località</th>
                        <th style={th} className="zc-vale">Vale per</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mostrate.map((r, i) => {
                        const altre = Array.from(zonePerCap.get(chiaveCap(r)) || []).filter((n) => n !== z.nome)
                        return (
                          <tr key={i} style={{ borderTop: '1px solid #f1f1f1', verticalAlign: 'top' }}>
                            {estera && <td style={td}>{nomePaese(r.paese)}</td>}
                            <td style={{ ...td, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{r.cap || '—'}</td>
                            {!estera && <td style={td}>{r.paese === 'IT' ? (r.provincia || '—') : nomePaese(r.paese)}</td>}
                            <td style={{ ...td, color: r.tipo === 'cap' ? '#6b7280' : '#1a1a1a' }}>
                              {luogo(r) || '—'}
                              <div className="zc-vale-m" style={{ display: 'none', fontSize: '11.5px', color: '#4b5563', marginTop: '2px' }}>{valePer(r)}</div>
                              {altre.length > 0 && !z.partenza && !z.multicollo && (
                                <div style={{ fontSize: '11.5px', color: '#b45309', marginTop: '3px' }}>
                                  Questo CAP compare anche in {altre.map((n) => `“${n}”`).join(', ')}: per un indirizzo preciso usa la verifica.
                                </div>
                              )}
                            </td>
                            <td className="zc-vale" style={{ ...td, whiteSpace: 'nowrap', color: '#4b5563' }}>{valePer(r)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {righe.length > mostrate.length && (
                    <button onClick={() => setTutte((t) => ({ ...t, [z.nome]: true }))}
                      style={{ margin: '8px 12px 10px', padding: '6px 10px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', cursor: 'pointer' }}>
                      Mostra tutte le {righe.length} righe
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const th: React.CSSProperties = { padding: '7px 12px', fontWeight: 600, fontSize: '11.5px' }
// whiteSpace esplicito: il portale tiene le celle delle tabelle su una riga sola, e sul telefono l'elenco delle
// localita' di un CAP allargava la tabella oltre lo schermo.
const td: React.CSSProperties = { padding: '7px 12px', whiteSpace: 'normal', overflowWrap: 'anywhere' }

function Badge({ testo }: { testo: string }) {
  return <span style={{ fontSize: '11px', fontWeight: 600, color: '#9a3412', background: '#ffedd5', borderRadius: '999px', padding: '2px 8px' }}>{testo}</span>
}

function Verifica({ corriereId, paesi }: { corriereId: string; paesi: string[] }) {
  const [cap, setCap] = useState('')
  const [citta, setCitta] = useState('')
  const [paese, setPaese] = useState('IT')
  const [inCorso, setInCorso] = useState(false)
  const [esito, setEsito] = useState<any>(null)

  async function verifica(cittaScelta?: string) {
    const c = cittaScelta ?? citta
    if (cittaScelta !== undefined) setCitta(cittaScelta)
    if (!cap.trim()) { setEsito({ errore: 'Scrivi il CAP.' }); return }
    setInCorso(true); setEsito(null)
    try {
      const r = await fetch('/api/cliente/zone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ corriere: corriereId, cap: cap.trim(), citta: c.trim(), paese }) })
      const x = await r.json().catch(() => ({}))
      setEsito(r.ok ? x : { errore: x.error || 'Verifica non riuscita.' })
    } catch { setEsito({ errore: 'Verifica non riuscita: controlla la connessione e riprova.' }) }
    setInCorso(false)
  }

  const campo: React.CSSProperties = { padding: '8px 10px', fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '6px', minWidth: 0 }
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px' }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>Verifica un indirizzo</div>
      <form onSubmit={(e) => { e.preventDefault(); verifica() }} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {paesi.length > 1 && (
          <select value={paese} onChange={(e) => { setPaese(e.target.value); setEsito(null) }} style={{ ...campo, flex: '0 1 160px' }}>
            {paesi.map((p) => <option key={p} value={p}>{nomePaese(p)}</option>)}
          </select>
        )}
        <input value={cap} onChange={(e) => { setCap(e.target.value); setEsito(null) }} placeholder="CAP" inputMode={paese === 'IT' ? 'numeric' : 'text'} style={{ ...campo, flex: '0 1 110px' }} />
        <input value={citta} onChange={(e) => { setCitta(e.target.value); setEsito(null) }} placeholder="Città o località" style={{ ...campo, flex: '1 1 180px' }} />
        <button type="submit" disabled={inCorso} style={{ padding: '8px 14px', fontSize: '13px', fontWeight: 700, border: 'none', borderRadius: '6px', background: '#f97316', color: '#fff', cursor: inCorso ? 'default' : 'pointer', opacity: inCorso ? 0.6 : 1 }}>
          {inCorso ? 'Verifico…' : 'Verifica'}
        </button>
      </form>
      {esito && (
        <div style={{ marginTop: '10px', fontSize: '13px', lineHeight: 1.5 }}>
          {esito.errore && <span style={{ color: '#b91c1c' }}>{esito.errore}</span>}
          {esito.esito === 'ok' && <span style={{ color: '#065f46' }}>Con questo contratto l'indirizzo è in zona <b>{esito.zona}</b>.</span>}
          {esito.esito === 'non_disponibile' && <span style={{ color: '#b91c1c' }}>Con il tuo listino questo contratto <b>non spedisce</b> a questo indirizzo.</span>}
          {esito.esito === 'citta' && (
            <div>
              <div style={{ color: '#b45309' }}>{esito.messaggio}</div>
              {(esito.suggeriti || []).length > 0 && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                  {esito.suggeriti.slice(0, 12).map((s: string) => (
                    <button key={s} type="button" onClick={() => verifica(s)} style={{ padding: '4px 9px', fontSize: '12px', border: '1px solid #fdba74', borderRadius: '999px', background: '#fff', color: '#9a3412', cursor: 'pointer' }}>{s}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
