'use client'
import { useEffect, useState } from 'react'
import { useDialog } from '@/app/components/DialogProvider'

const ACCENT = '#f97316'
const card = { background: '#fff', borderRadius: '10px', border: '1px solid #e8e8e8', padding: '18px' as const }
const STATI: Record<string, { txt: string, bg: string, fg: string }> = {
  in_attesa: { txt: 'In attesa', bg: '#fff7ed', fg: '#c2410c' },
  attiva:    { txt: 'Attiva',    bg: '#dcfce7', fg: '#16a34a' },
  rifiutata: { txt: 'Rifiutata', bg: '#f3f4f6', fg: '#6b7280' },
  revocata:  { txt: 'Revocata',  bg: '#fef2f2', fg: '#b91c1c' },
}
const badge = (s: string) => {
  const st = STATI[s] || STATI.in_attesa
  return <span style={{ background: st.bg, color: st.fg, borderRadius: '999px', padding: '3px 10px', fontSize: '11px', fontWeight: 700 }}>{st.txt}</span>
}

export default function CondivisioniPage() {
  const dialog = useDialog()
  const [dati, setDati] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [copiato, setCopiato] = useState(false)

  // Form "condividi"
  const [codice, setCodice] = useState('')
  const [risolto, setRisolto] = useState<{ nome: string } | null>(null)
  const [risolvendo, setRisolvendo] = useState(false)
  const [erroreCodice, setErroreCodice] = useState('')
  const [corriereSel, setCorriereSel] = useState('')
  const [markupMode, setMarkupMode] = useState<'perc' | 'fisso'>('perc')
  const [markupVal, setMarkupVal] = useState('')
  const [azione, setAzione] = useState('')

  async function carica() {
    setLoading(true)
    const d = await fetch('/api/condivisioni').then(r => r.json()).catch(() => null)
    setDati(d); setLoading(false)
  }
  useEffect(() => { carica() }, [])

  function copia() {
    if (!dati?.codice) return
    navigator.clipboard?.writeText(dati.codice).then(() => { setCopiato(true); setTimeout(() => setCopiato(false), 1800) }, () => {})
  }

  async function risolvi() {
    const c = codice.trim().toUpperCase()
    setErroreCodice(''); setRisolto(null)
    if (!c) return
    setRisolvendo(true)
    const r = await fetch('/api/condivisioni/risolvi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codice: c }) })
    const d = await r.json().catch(() => ({}))
    setRisolvendo(false)
    if (d?.tu) { setErroreCodice('Questo è il tuo codice.'); return }
    if (!d?.trovato) { setErroreCodice(r.status === 429 ? 'Troppi tentativi, riprova fra un minuto.' : 'Codice non valido.'); return }
    setRisolto({ nome: d.nome })
  }

  const markupValido = markupVal.trim() !== '' && Number.isFinite(Number(markupVal)) && Number(markupVal) >= 0
  async function crea() {
    if (!risolto || !corriereSel || !markupValido) return
    const ricaricoTxt = markupMode === 'fisso' ? `+ € ${Number(markupVal).toFixed(2)} a fascia` : `+ ${Number(markupVal)}% sul tuo costo`
    if (!await dialog.confirm({ title: 'Condividere il contratto?', message: `Condividi questo contratto con ${risolto.nome} a ${ricaricoTxt}. Dovrà accettarlo prima che diventi operativo.`, confirmText: 'Condividi' })) return
    setAzione('crea'); setMsg('')
    const markup = { default: { mode: markupMode, valore: Number(markupVal) } }
    const r = await fetch('/api/condivisioni', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codice: codice.trim().toUpperCase(), corriere_id: corriereSel, markup }) })
    const d = await r.json().catch(() => ({})); setAzione('')
    if (d?.error) { setMsg(d.error); return }
    setMsg(`✓ Condiviso con ${d.compratore} — in attesa che accetti.`)
    setCodice(''); setRisolto(null); setCorriereSel(''); setMarkupVal(''); carica()
  }

  async function revoca(id: string, contratto: string, compratore: string) {
    if (!await dialog.confirm({ title: 'Revocare la condivisione?', message: `Revochi "${contratto}" a ${compratore}. Resta nello storico, ma non sarà più utilizzabile.`, danger: true, confirmText: 'Revoca' })) return
    setAzione('rev_' + id)
    const d = await fetch(`/api/condivisioni/${id}/revoca`, { method: 'POST' }).then(r => r.json()).catch(() => ({})); setAzione('')
    if (d?.error) { setMsg(d.error); return }
    carica()
  }

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>Caricamento…</div>
  if (!dati || dati.error) return <div style={{ padding: '40px', textAlign: 'center', color: '#b91c1c' }}>{dati?.error || 'Errore'}</div>

  const contrattiCondivisibili = dati.contratti || []

  return (
    <div style={{ maxWidth: '900px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: '0 0 4px' }}>Condivisione contratti</h1>
      <p style={{ fontSize: '13px', color: '#777', margin: '0 0 18px', lineHeight: 1.5 }}>
        Rivendi un tuo contratto a un altro master, o ricevi i suoi. Ci si connette con un codice, non con un elenco.
      </p>

      {msg && <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '10px 12px', marginBottom: '16px', fontSize: '13px', color: '#ea580c' }}>{msg}</div>}

      {/* IL TUO CODICE */}
      <div style={{ ...card, marginBottom: '18px', borderColor: '#fed7aa', background: '#fffaf5' }}>
        <div style={{ fontSize: '12px', color: '#9a6b4a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Il tuo codice di condivisione</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '8px' }}>
          <code style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '.08em', color: '#1a1a1a', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{dati.codice || '—'}</code>
          <button onClick={copia} style={{ background: copiato ? '#16a34a' : ACCENT, color: '#fff', border: 'none', borderRadius: '7px', padding: '8px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
            {copiato ? '✓ Copiato' : 'Copia'}
          </button>
        </div>
        <div style={{ fontSize: '12px', color: '#9a6b4a', marginTop: '8px', lineHeight: 1.5 }}>
          Dallo a chi vuole rivenderti un suo contratto, o a chi vuole che tu rivenda il tuo. È permanente: non cambia mai.
        </div>
      </div>

      {/* CONTRATTI CHE RIVENDO */}
      <div style={{ ...card, marginBottom: '18px' }}>
        <div style={{ fontSize: '15px', fontWeight: 800, color: '#1a1a1a', marginBottom: '2px' }}>Contratti che rivendo</div>
        <div style={{ fontSize: '12px', color: '#777', marginBottom: '14px' }}>Incolla il codice di chi comprerà, scegli il contratto, e condividilo. Lui dovrà accettare.</div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 220px', minWidth: '200px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input value={codice} onChange={e => { setCodice(e.target.value); setRisolto(null); setErroreCodice('') }}
                placeholder="Codice del compratore" spellCheck={false}
                style={{ flex: 1, padding: '9px 11px', border: `1px solid ${erroreCodice ? '#fca5a5' : '#e2e2e2'}`, borderRadius: '7px', fontSize: '13px', fontFamily: 'ui-monospace, monospace', letterSpacing: '.05em', textTransform: 'uppercase' }} />
              <button onClick={risolvi} disabled={risolvendo || !codice.trim()} style={{ background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '7px', padding: '9px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: (risolvendo || !codice.trim()) ? .5 : 1 }}>{risolvendo ? '…' : 'Cerca'}</button>
            </div>
            {erroreCodice && <div style={{ fontSize: '12px', color: '#b91c1c', marginTop: '6px' }}>{erroreCodice}</div>}
            {risolto && <div style={{ fontSize: '13px', color: '#16a34a', marginTop: '8px', fontWeight: 600 }}>✓ {risolto.nome}</div>}
          </div>

          <div style={{ flex: '1 1 220px', minWidth: '200px' }}>
            <select value={corriereSel} onChange={e => setCorriereSel(e.target.value)} disabled={!risolto}
              style={{ width: '100%', padding: '9px 11px', border: '1px solid #e2e2e2', borderRadius: '7px', fontSize: '13px', background: risolto ? '#fff' : '#f7f7f7', color: risolto ? '#1a1a1a' : '#aaa' }}>
              <option value="">{contrattiCondivisibili.length ? 'Scegli il contratto…' : 'Nessun contratto condivisibile'}</option>
              {contrattiCondivisibili.map((c: any) => <option key={c.id} value={c.id}>{c.nome_contratto}</option>)}
            </select>
          </div>

          {/* RICARICO: il prezzo d'ingrosso = tuo costo + questo. Sul tuo costo del contratto, per ogni fascia. */}
          <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ display: 'inline-flex', border: '1px solid #e2e2e2', borderRadius: '7px', overflow: 'hidden' }}>
              {(['perc', 'fisso'] as const).map(m => (
                <button key={m} type="button" onClick={() => setMarkupMode(m)} disabled={!risolto}
                  style={{ padding: '9px 10px', fontSize: '13px', fontWeight: 700, border: 'none', cursor: 'pointer', background: markupMode === m ? '#1a1a1a' : '#fff', color: markupMode === m ? '#fff' : '#888' }}>{m === 'perc' ? '%' : '€'}</button>
              ))}
            </div>
            <input value={markupVal} onChange={e => setMarkupVal(e.target.value.replace(',', '.'))} disabled={!risolto}
              inputMode="decimal" placeholder="ricarico"
              style={{ width: '90px', padding: '9px 11px', border: '1px solid #e2e2e2', borderRadius: '7px', fontSize: '13px', background: risolto ? '#fff' : '#f7f7f7' }} />
          </div>

          <button onClick={crea} disabled={!risolto || !corriereSel || !markupValido || !!azione}
            style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: '7px', padding: '9px 18px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: (!risolto || !corriereSel || !markupValido || !!azione) ? .5 : 1, whiteSpace: 'nowrap' }}>
            {azione === 'crea' ? 'Condivido…' : 'Condividi'}
          </button>
        </div>
        <div style={{ fontSize: '11.5px', color: '#999', marginTop: '8px' }}>Il compratore pagherà il tuo <b>costo</b> del contratto + il ricarico che imposti qui (per ogni fascia di peso). Zone e supplementi restano i tuoi.</div>

        {!!(dati.rivendo || []).length && (
          <div style={{ overflowX: 'auto', marginTop: '16px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead><tr style={{ background: '#fafafa' }}>
                {['Contratto', 'Compratore', 'Ricarico', 'Stato', ''].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: '11px', fontWeight: 600, color: '#777', borderBottom: '1px solid #f0f0f0' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {dati.rivendo.map((r: any) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f5f5f5', opacity: ['revocata', 'rifiutata'].includes(r.stato) ? .55 : 1 }}>
                    <td style={{ padding: '9px 12px', fontWeight: 600, color: '#1a1a1a' }}>{r.contratto}</td>
                    <td style={{ padding: '9px 12px', color: '#555' }}>{r.compratore}</td>
                    <td style={{ padding: '9px 12px', color: '#c2410c', fontWeight: 700, whiteSpace: 'nowrap' }}>{r.ricarico}</td>
                    <td style={{ padding: '9px 12px' }}>{badge(r.stato)}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                      {['in_attesa', 'attiva'].includes(r.stato) &&
                        <button onClick={() => revoca(r.id, r.contratto, r.compratore)} disabled={azione === 'rev_' + r.id}
                          style={{ background: '#fff', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '6px', padding: '5px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>{azione === 'rev_' + r.id ? '…' : 'Revoca'}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CONTRATTI PRESI DA FORNITORI */}
      <div style={card}>
        <div style={{ fontSize: '15px', fontWeight: 800, color: '#1a1a1a', marginBottom: '2px' }}>Contratti presi da fornitori</div>
        <div style={{ fontSize: '12px', color: '#777', marginBottom: '14px' }}>Contratti che un altro master ha condiviso con te. Da accettare per usarli tra i tuoi corrieri.</div>
        {!(dati.ricevuti || []).length ? (
          <div style={{ fontSize: '13px', color: '#999', padding: '10px 0' }}>Nessun contratto ricevuto. Dai il tuo codice a chi vuole rivenderti un contratto.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead><tr style={{ background: '#fafafa' }}>
                {['Contratto', 'Fornitore', 'Stato', ''].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: '11px', fontWeight: 600, color: '#777', borderBottom: '1px solid #f0f0f0' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {dati.ricevuti.map((r: any) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f5f5f5', opacity: ['revocata', 'rifiutata'].includes(r.stato) ? .55 : 1 }}>
                    <td style={{ padding: '9px 12px', fontWeight: 600, color: '#1a1a1a' }}>{r.contratto}</td>
                    <td style={{ padding: '9px 12px', color: '#555' }}>{r.fornitore}</td>
                    <td style={{ padding: '9px 12px' }}>{badge(r.stato)}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                      {r.stato === 'in_attesa' && <span style={{ fontSize: '11px', color: '#9a6b4a' }}>Accetta — a breve</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
