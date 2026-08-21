'use client'
import { useState, useEffect } from 'react'

const ACCENT = '#f97316'
const card = { background: '#fff', borderRadius: '10px', border: '1px solid #e8e8e8', padding: '18px' } as const

export default function RettificheAutoPage() {
  const [stato, setStato] = useState<any>(null)
  const [curl, setCurl] = useState('')
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [controllando, setControllando] = useState(false)
  const [esitoRun, setEsitoRun] = useState<any>(null)

  async function carica() {
    const d = await fetch('/api/tracking/onetracking-sessione').then(r => r.json()).catch(() => null)
    if (d && !d.error) { setStato(d); if (d.email_alert && !email) setEmail(d.email_alert) }
  }
  useEffect(() => { carica() }, [])

  async function salva() {
    if (!curl.trim()) { setMsg('Incolla prima il cURL di OneTracking.'); return }
    setSalvando(true); setMsg('')
    const d = await fetch('/api/tracking/onetracking-sessione', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ curl, email_alert: email }),
    }).then(r => r.json()).catch(() => ({ error: 'connessione' }))
    setSalvando(false)
    if (d.error) setMsg('❌ ' + d.error)
    else { setMsg('✅ Sessione attiva. Il controllo automatico riparte.'); setCurl(''); carica() }
  }

  async function controllaOra() {
    setControllando(true); setMsg(''); setEsitoRun(null)
    const d = await fetch('/api/tracking/ripesature-auto').then(r => r.json()).catch(() => ({ error: 'connessione' }))
    setControllando(false)
    if (d.error) setMsg('❌ ' + d.error)
    else { setEsitoRun(d); carica() }
  }

  const scaduta = !stato || stato.stato !== 'attiva' || !stato.ha_cookie
  const st = stato?.statistiche || {}

  return (
    <div style={{ maxWidth: '860px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: '0 0 4px' }}>Rettifiche automatiche</h1>
      <p style={{ color: '#999', fontSize: '13px', margin: '0 0 18px' }}>
        Ogni PDB che risulta <b>consegnata</b> viene controllata su OneTracking: se il ripesato è più alto, nasce
        una rettifica (in attesa, la confermi in <b>Rettifica Costi</b>). Solo recuperi, mai rimborsi.
      </p>

      {/* Stato sessione */}
      <div style={{ ...card, marginBottom: '16px', borderColor: scaduta ? '#fecaca' : '#bbf7d0', background: scaduta ? '#fef2f2' : '#f0fdf4' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: scaduta ? '#dc2626' : '#166534' }}>
              {scaduta ? '● Sessione OneTracking SCADUTA — in pausa' : '● Sessione attiva'}
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '3px' }}>
              {stato?.aggiornato_il && <>Cookie aggiornato: {new Date(stato.aggiornato_il).toLocaleString('it-IT')} · </>}
              {stato?.ultimo_ok_il && <>ultimo controllo ok: {new Date(stato.ultimo_ok_il).toLocaleString('it-IT')} · </>}
              arretrato da controllare: <b>{stato?.arretrato ?? '—'}</b>
            </div>
          </div>
          <button onClick={controllaOra} disabled={controllando || scaduta}
            style={{ padding: '8px 16px', background: scaduta ? '#e5e7eb' : ACCENT, color: scaduta ? '#9ca3af' : '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: scaduta ? 'not-allowed' : 'pointer' }}>
            {controllando ? 'Controllo…' : 'Controlla ora'}
          </button>
        </div>
      </div>

      {esitoRun && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '12px 14px', marginBottom: '16px', fontSize: '13px', color: '#9a3412' }}>
          Controllate <b>{esitoRun.controllate}</b> · rettifiche create <b>{esitoRun.rettificate}</b> (€ {Number(esitoRun.recuperoTot || 0).toFixed(2)})
          {esitoRun.giaRettificate ? <> · già fatte {esitoRun.giaRettificate}</> : null}
          {esitoRun.senzaMisure ? <> · senza misure {esitoRun.senzaMisure}</> : null}
          {esitoRun.sessioneScaduta ? <> · <b style={{ color: '#dc2626' }}>sessione scaduta durante il giro</b></> : null}
          {' '}· restano <b>{esitoRun.arretrato}</b>
        </div>
      )}

      {/* Incolla cURL */}
      <div style={{ ...card, marginBottom: '16px' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a', marginBottom: '6px' }}>Rinnova la sessione (cURL)</div>
        <ol style={{ fontSize: '12.5px', color: '#4b5563', lineHeight: 1.7, margin: '0 0 10px', paddingLeft: '18px' }}>
          <li>Su OneTracking filiali apri una spedizione qualsiasi.</li>
          <li>F12 → Network → filtro <code>tracking</code> → ricarica.</li>
          <li>Tasto destro sulla riga <b>full-tracking</b> → Copy → <b>Copy as cURL</b>.</li>
          <li>Incolla qui sotto e salva.</li>
        </ol>
        <textarea value={curl} onChange={e => setCurl(e.target.value)} placeholder="curl 'https://one-tracking-filiali.posteitaliane.it/api/dettaglio-spedizione/…' -H 'cookie: …' …"
          style={{ width: '100%', minHeight: '90px', fontSize: '11px', fontFamily: 'monospace', padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px', color: '#1a1a1a', resize: 'vertical' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email per l'avviso scadenza"
            style={{ flex: 1, minWidth: '200px', padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12.5px', color: '#1a1a1a' }} />
          <button onClick={salva} disabled={salvando}
            style={{ padding: '9px 18px', background: ACCENT, color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: salvando ? .7 : 1 }}>
            {salvando ? 'Salvo…' : 'Salva sessione'}
          </button>
        </div>
        {msg && <div style={{ marginTop: '10px', fontSize: '13px', color: msg.startsWith('❌') ? '#dc2626' : '#166534' }}>{msg}</div>}
      </div>

      {/* Statistiche */}
      <div style={card}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a', marginBottom: '10px' }}>
          Riepilogo controllo <span style={{ fontWeight: 400, color: '#6b7280' }}>· recuperato € {Number(stato?.recuperoTot || 0).toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[['rettificata', 'Rettificate', '#16a34a'], ['ok', 'Ok (niente)', '#6b7280'], ['gia-rettificata', 'Già fatte', '#6b7280'], ['no-misure', 'Senza misure', '#92400e'], ['errore', 'Errori', '#dc2626']].map(([k, label, col]) => (
            <div key={k} style={{ background: '#f9fafb', border: '1px solid #eee', borderRadius: '8px', padding: '10px 14px', minWidth: '110px' }}>
              <div style={{ fontSize: '20px', fontWeight: 800, color: col as string }}>{st[k as string] || 0}</div>
              <div style={{ fontSize: '11px', color: '#6b7280' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
