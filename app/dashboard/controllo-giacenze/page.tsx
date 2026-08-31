'use client'
import { useEffect, useState } from 'react'

// CONTROLLO AGENTE GIACENZE — pagina del super master. Mostra l'esito del giro automatico che
// verifica, corriere per corriere, se le giacenze che risultano svincolate sono davvero uscite.
export default function ControlloGiacenzePage() {
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [controllando, setControllando] = useState(false)
  const [msg, setMsg] = useState<string>('')
  const [busy, setBusy] = useState<string | null>(null)

  async function carica() {
    setLoading(true)
    const r = await fetch('/api/spedizioni/verifica-giacenze/report').then(x => x.json()).catch(() => null)
    setD(r && !r.error ? r : null)
    if (r?.error) setMsg(r.error)
    setLoading(false)
  }
  useEffect(() => { carica() }, [])

  async function controllaOra() {
    setControllando(true); setMsg('')
    const r = await fetch('/api/spedizioni/verifica-giacenze').then(x => x.json()).catch(() => null)
    if (r && !r.error) setMsg(`Giro fatto: ${r.controllate} controllate · ${r.ok} ok · ${r.ferme} ferme${r.saltate ? ` · ${r.saltate} troppo recenti (riprovo dopo)` : ''}.`)
    else setMsg(r?.error || 'Errore nel controllo')
    setControllando(false)
    await carica()
  }

  // RI-SVINCOLA una giacenza ancora "ferma" (attiva su SpediamoPro senza svincolo registrato) col FLUSSO
  // COMPLETO, lo stesso di cliente/master: 'richiesta' (calcola i costi) + 'conferma_svincolo' (corriere +
  // addebito del servizio a CASCATA + distinta reso, via lib/giacenza-svincolo). Cosi' il reso e' "vero"
  // (prezzo reso a norma + stato reso_mittente + distinta), non un semplice rilascio al corriere.
  async function riSvincola(p: any, operazione: 'riconsegna' | 'reso') {
    if (!p.id || busy) return
    const che = operazione === 'reso' ? 'RESO al mittente' : 'RICONSEGNA'
    if (!confirm(`${che} per ${p.ldv}?\n\nParte lo svincolo COMPLETO: chiamata al corriere + addebito del servizio a cascata${operazione === 'reso' ? ' + distinta reso' : ''}.`)) return
    setBusy(p.id); setMsg('')
    try {
      // 1) richiesta operazione (crea la richiesta + calcola i costi)
      const r1 = await fetch(`/api/giacenze/${p.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ azione: 'richiesta', operazione }) })
      const j1 = await r1.json().catch(() => ({}))
      if (!j1?.id) { setMsg(j1?.error || 'Richiesta non riuscita'); setBusy(null); return }
      // 2) conferma svincolo (svincolo vero: corriere + addebito a cascata + distinta reso)
      const r2 = await fetch(`/api/giacenze/${p.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ azione: 'conferma_svincolo', richiestaId: j1.id }) })
      const j2 = await r2.json().catch(() => ({}))
      setMsg(j2?.success
        ? `${che} eseguito per ${p.ldv}${j2.addebito ? ` (addebito € ${Number(j2.addebito).toFixed(2)})` : ''}${j2.avviso ? ` — ${j2.avviso}` : ''}.`
        : (j2?.error || 'Svincolo non riuscito'))
    } catch { setMsg('Errore di rete') }
    setBusy(null)
    await carica()
  }

  const card = (label: string, val: any, color = '#1a1a1a', bg = '#fff') => (
    <div style={{ background: bg, border: '1px solid #eee', borderRadius: 10, padding: '14px 16px', minWidth: 130 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#8a8a8a' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, marginTop: 4 }}>{val}</div>
    </div>
  )
  const th: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#8a8a8a', borderBottom: '1px solid #eee' }
  const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid #f4f4f4' }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#1a1a1a', margin: 0 }}>🛰️ Controllo Giacenze</h1>
        <button onClick={controllaOra} disabled={controllando}
          style={{ background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: controllando ? .6 : 1 }}>
          {controllando ? 'Controllo in corso…' : '🔄 Controlla ora'}
        </button>
      </div>
      <p style={{ fontSize: 13, color: '#8a8a8a', marginTop: 0 }}>
        Verifica sul corriere che le giacenze <b>svincolate</b> siano davvero uscite (SpediamoPro, Spedisci, DVA). Gira da solo ogni poche ore; le appena svincolate (&lt;12h) le riprova dopo.
      </p>
      {msg && <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#075985', margin: '10px 0' }}>{msg}</div>}

      {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Caricamento…</div> : !d ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Nessun dato (o sezione riservata al super master).</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '14px 0' }}>
            {card('Controllate oggi', d.controllateOggi)}
            {card('Svincolate totali', d.totaliSvincolate)}
            {card('✅ Uscite', d.ok, '#16a34a', '#f0fdf4')}
            {card('⚠️ Ancora ferme', d.ferma, d.ferma > 0 ? '#dc2626' : '#16a34a', d.ferma > 0 ? '#fef2f2' : '#f0fdf4')}
            {d.errore > 0 && card('Verifica fallita', d.errore, '#b45309', '#fffbeb')}
            {d.nonVerificate > 0 && card('Da controllare', d.nonVerificate, '#6b7280')}
          </div>

          {/* Per corriere */}
          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, overflow: 'hidden', marginBottom: 18 }}>
            <div style={{ padding: '12px 16px', fontWeight: 700, fontSize: 14, borderBottom: '1px solid #eee' }}>Per corriere</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Corriere</th><th style={th}>✅ Uscite</th><th style={th}>⚠️ Ferme</th><th style={th}>Verifica fallita</th><th style={th}>Da controllare</th></tr></thead>
              <tbody>
                {Object.entries<any>(d.perCorriere || {}).map(([nome, v]) => (
                  <tr key={nome}>
                    <td style={{ ...td, fontWeight: 600 }}>{nome}</td>
                    <td style={{ ...td, color: '#16a34a', fontWeight: 700 }}>{v.ok}</td>
                    <td style={{ ...td, color: v.ferma > 0 ? '#dc2626' : '#999', fontWeight: 700 }}>{v.ferma}</td>
                    <td style={td}>{v.errore || '—'}</td>
                    <td style={td}>{v.nonVerificate || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Problemi */}
          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', fontWeight: 700, fontSize: 14, borderBottom: '1px solid #eee', color: d.problemi?.length ? '#dc2626' : '#16a34a' }}>
              {d.problemi?.length ? `⚠️ ${d.problemi.length} ancora ferme dal corriere (svincolate da noi ma non uscite)` : '✅ Nessun problema: tutte le svincolate sono uscite dal corriere'}
            </div>
            {d.problemi?.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>LDV</th><th style={th}>Corriere</th><th style={th}>Cliente</th><th style={th}>Master</th><th style={th}>Controllata</th><th style={th}>Motivo</th><th style={th}>Azione</th></tr></thead>
                <tbody>
                  {d.problemi.map((p: any, i: number) => (
                    <tr key={i}>
                      <td style={{ ...td, fontWeight: 600 }}>{p.ldv}</td>
                      <td style={td}>{p.corriere}</td>
                      <td style={td}>{p.cliente}</td>
                      <td style={td}>{p.master}</td>
                      <td style={td}>{p.controllata ? new Date(p.controllata).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td style={{ ...td, color: '#6b7280', fontSize: 12, maxWidth: 220 }}>{p.motivo || '—'}</td>
                      <td style={td}>
                        {p.corriere_tipo === 'spediamopro' && p.id ? (
                          <span style={{ display: 'inline-flex', gap: 6 }}>
                            <button onClick={() => riSvincola(p, 'riconsegna')} disabled={busy === p.id} title="Svincolo completo: riconsegna al destinatario (corriere + addebito a cascata)"
                              style={{ background: '#eef2ff', color: '#3730a3', border: '1px solid #c7d2fe', borderRadius: 6, padding: '5px 9px', fontSize: 12, fontWeight: 600, cursor: busy === p.id ? 'default' : 'pointer', opacity: busy === p.id ? .5 : 1 }}>Riconsegna</button>
                            <button onClick={() => riSvincola(p, 'reso')} disabled={busy === p.id} title="Svincolo completo: reso al mittente (corriere + addebito reso a cascata + distinta reso)"
                              style={{ background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', borderRadius: 6, padding: '5px 9px', fontSize: 12, fontWeight: 600, cursor: busy === p.id ? 'default' : 'pointer', opacity: busy === p.id ? .5 : 1 }}>Reso</button>
                          </span>
                        ) : <span style={{ color: '#bbb' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
