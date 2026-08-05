'use client'
import { useState, useEffect, useCallback } from 'react'

// CHI PAGA LE API.
//
// La regola commerciale e' una sola: paga chi RIVENDE le spedizioni fuori dal portale, non chi usa
// le API per spedire la propria merce. Nessun conto la puo' decidere — una chiamata e' identica nei
// due casi — quindi questa pagina non classifica nessuno: mette davanti i numeri e lascia premere
// l'interruttore a chi incassa.
//
// IL NUMERO CHE CONTA E' IL MITTENTE. Chi spedisce roba sua parte sempre dallo stesso magazzino;
// chi rivende ha un mittente diverso per ogni cliente suo. Sui dati veri i due gruppi si separano
// senza sfumature, e in mezzo c'e' il vuoto: 93-100% da una parte, 7-35% dall'altra.

const ACCENT = '#f97316'
const card: any = { background: '#fff', borderRadius: '10px', border: '1px solid #e8e8e8', marginBottom: '16px', overflow: 'hidden' }
const th: any = { textAlign: 'left', padding: '10px 12px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#666', borderBottom: '1px solid #e8e8e8', whiteSpace: 'nowrap' }
const td: any = { padding: '11px 12px', fontSize: '12.5px', color: '#1a1a1a', borderBottom: '1px solid #f5f5f5', verticalAlign: 'middle' }
const num: any = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

const VERDETTI: Record<string, { testo: string; sfondo: string; colore: string }> = {
  rivende:    { testo: 'Sembra rivendere', sfondo: '#fef3c7', colore: '#92400e' },
  proprie:    { testo: 'Spedizioni proprie', sfondo: '#f0fdf4', colore: '#15803d' },
  incerto:    { testo: 'Da guardare',       sfondo: '#eff6ff', colore: '#1d4ed8' },
  pochi_dati: { testo: 'Pochi dati',        sfondo: '#f5f5f5', colore: '#6b7280' },
}

export default function ApiClientiPage() {
  const [d, setD] = useState<any>(null)
  const [errore, setErrore] = useState('')
  const [inCorso, setInCorso] = useState('')
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const [soloDaVedere, setSoloDaVedere] = useState(false)

  const carica = useCallback(async () => {
    setErrore('')
    try {
      const r = await fetch('/api/root/api-clienti')
      const x = await r.json()
      if (!r.ok) { setErrore(x?.error || 'Errore'); setD({ clienti: [] }); return }
      setD(x)
    } catch { setErrore('Errore di rete'); setD({ clienti: [] }) }
  }, [])
  useEffect(() => { carica() }, [carica])

  async function cambia(c: any, paga: boolean) {
    setInCorso(c.cliente_id); setMsg(null)
    try {
      const r = await fetch('/api/root/api-clienti', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente_id: c.cliente_id, paga }),
      })
      const x = await r.json()
      if (!r.ok) setMsg({ t: 'err', x: x?.error || 'Non riesco a salvare' })
      else {
        // Se aveva un abbonamento attivo, la disdetta va detta: e' l'unica cosa che non si vede
        // dalla tabella, e riguarda quando smetteranno davvero di addebitargli.
        const fine = x?.disdettaDal ? new Date(x.disdettaDal).toLocaleDateString('it-IT') : ''
        setMsg({
          t: 'ok',
          x: paga ? `${c.cliente} ora paga il pacchetto API.`
            : `${c.cliente} non paga le API.${fine ? ` L’abbonamento resta attivo fino al ${fine}, poi non gli viene più addebitato.` : ''}`,
        })
        await carica()
      }
    } catch { setMsg({ t: 'err', x: 'Errore di rete' }) }
    setInCorso('')
  }

  if (!d && !errore) return <div style={{ padding: '30px', color: '#8a8a8a', fontSize: '13px' }}>Caricamento…</div>

  const tutti: any[] = d?.clienti || []
  // "Da vedere" = dove il numero e la decisione non vanno d'accordo. Sono le uniche righe su cui
  // c'e' davvero qualcosa da fare: tutto il resto e' gia' a posto e serve solo a poterlo controllare.
  const daVedere = (c: any) => (c.verdetto === 'rivende' && !c.paga) || (c.verdetto === 'proprie' && c.paga)
  const righe = soloDaVedere ? tutti.filter(daVedere) : tutti
  const nDaVedere = tutti.filter(daVedere).length
  const nPaganti = tutti.filter((c: any) => c.paga).length
  const incasso = tutti.filter((c: any) => c.paga).reduce((s: number, c: any) => s + Number(c.prezzo || 0), 0)

  return (
    <div style={{ maxWidth: '1180px' }}>
      <div style={{ marginBottom: '18px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Abbonamenti API</h1>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '6px', lineHeight: 1.6, maxWidth: '760px' }}>
          Il pacchetto API lo paga chi <strong style={{ color: '#1a1a1a' }}>rivende le spedizioni fuori dal
          portale</strong>. Chi usa le API per spedire la propria merce non paga niente. Lo decidi qui, e
          solo tu: l’incasso è della piattaforma, non del master di riferimento.
        </p>
      </div>

      {errore && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '8px', padding: '11px 14px', fontSize: '13px', marginBottom: '14px' }}>{errore}</div>
      )}
      {msg && (
        <div style={{ background: msg.t === 'ok' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msg.t === 'ok' ? '#bbf7d0' : '#fecaca'}`, color: msg.t === 'ok' ? '#15803d' : '#b91c1c', borderRadius: '8px', padding: '11px 14px', fontSize: '13px', marginBottom: '14px' }}>{msg.x}</div>
      )}

      {/* Il riassunto: quanti pagano, quanto fa, e quante righe chiedono una decisione */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { k: 'Clienti con le API', v: String(tutti.length), c: '#1a1a1a' },
          { k: 'Pagano il pacchetto', v: String(nPaganti), c: nPaganti ? ACCENT : '#8a8a8a' },
          { k: 'Al mese', v: `€ ${incasso.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, c: '#15803d' },
          { k: 'Da decidere', v: String(nDaVedere), c: nDaVedere ? '#b45309' : '#8a8a8a' },
        ].map(x => (
          <div key={x.k} style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#8a8a8a', letterSpacing: '.03em' }}>{x.k}</div>
            <div style={{ fontSize: '25px', fontWeight: 800, color: x.c, marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>{x.v}</div>
          </div>
        ))}
      </div>

      {nDaVedere > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px 15px', marginBottom: '16px', fontSize: '13px', color: '#92400e', lineHeight: 1.6 }}>
          Su <strong>{nDaVedere}</strong> {nDaVedere === 1 ? 'cliente i numeri dicono una cosa e l’interruttore un’altra' : 'clienti i numeri dicono una cosa e l’interruttore un’altra'}.
          <button onClick={() => setSoloDaVedere(v => !v)}
            style={{ background: 'none', border: 'none', color: '#92400e', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', fontSize: '13px', padding: '0 0 0 6px' }}>
            {soloDaVedere ? 'Mostra tutti' : 'Vedi solo quelli'}
          </button>
        </div>
      )}

      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
            <thead>
              <tr>
                <th style={th}>Cliente</th>
                <th style={th}>Come usa le API</th>
                <th style={{ ...th, textAlign: 'right' }}>Via API<br /><span style={{ fontWeight: 400, textTransform: 'none' }}>ultimi {d?.giorni || 60} gg</span></th>
                <th style={{ ...th, textAlign: 'right' }}>Mittenti<br /><span style={{ fontWeight: 400, textTransform: 'none' }}>diversi</span></th>
                <th style={{ ...th, textAlign: 'right' }}>Dal principale</th>
                <th style={{ ...th, textAlign: 'right' }}>Questo mese</th>
                <th style={{ ...th, textAlign: 'center' }}>Paga</th>
              </tr>
            </thead>
            <tbody>
              {righe.map((c: any) => {
                const v = VERDETTI[c.verdetto] || VERDETTI.pochi_dati
                const attenzione = daVedere(c)
                const oltre = c.usate_mese > c.limite
                return (
                  <tr key={c.cliente_id} style={attenzione ? { background: '#fffdf5' } : undefined}>
                    <td style={td}>
                      <div style={{ fontWeight: 700 }}>{c.cliente}</div>
                      <div style={{ fontSize: '11.5px', color: '#8a8a8a', marginTop: '2px' }}>
                        {c.master}{c.chiavi > 0 ? ` · ${c.chiavi} ${c.chiavi === 1 ? 'chiave' : 'chiavi'}` : ' · nessuna chiave attiva'}
                      </div>
                    </td>
                    <td style={td}>
                      <span style={{ display: 'inline-block', background: v.sfondo, color: v.colore, borderRadius: '20px', padding: '3px 10px', fontSize: '11.5px', fontWeight: 700 }}>{v.testo}</span>
                    </td>
                    <td style={num}>{c.api_periodo.toLocaleString('it-IT')}</td>
                    <td style={num}>{c.mittenti || '—'}</td>
                    <td style={{ ...num, fontWeight: 700, color: c.pct_principale == null ? '#c0c0c0' : c.pct_principale >= 80 ? '#15803d' : c.pct_principale < 70 ? '#b45309' : '#1a1a1a' }}>
                      {c.pct_principale == null ? '—' : `${c.pct_principale}%`}
                    </td>
                    <td style={num}>
                      <span style={{ color: c.paga && oltre ? '#dc2626' : '#1a1a1a', fontWeight: c.paga && oltre ? 700 : 400 }}>
                        {c.usate_mese.toLocaleString('it-IT')}
                      </span>
                      <span style={{ color: '#a0a0a0' }}> / {c.limite.toLocaleString('it-IT')}</span>
                      {c.paga && (
                        <div style={{ fontSize: '11px', color: c.bloccato ? '#dc2626' : '#8a8a8a', marginTop: '2px', fontWeight: c.bloccato ? 700 : 400 }}>
                          {c.bloccato ? 'API ferme' : `${c.piano_nome}${Number(c.prezzo) > 0 ? ` · € ${Number(c.prezzo).toFixed(0)}` : ''}`}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {/* Due tasti e non una spunta: la spunta non dice cosa succede se la premi, e
                          qui premerla significa fermare o non fermare le spedizioni di un'azienda. */}
                      <div style={{ display: 'inline-flex', border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' }}>
                        {[false, true].map(p => (
                          <button key={String(p)} disabled={inCorso === c.cliente_id || c.paga === p}
                            onClick={() => cambia(c, p)}
                            style={{
                              border: 'none', padding: '7px 13px', fontSize: '12px', fontWeight: 700,
                              cursor: c.paga === p ? 'default' : 'pointer', whiteSpace: 'nowrap',
                              background: c.paga === p ? (p ? ACCENT : '#f0f0f0') : '#fff',
                              color: c.paga === p ? (p ? '#fff' : '#555') : '#9ca3af',
                              opacity: inCorso === c.cliente_id ? 0.5 : 1,
                            }}>
                            {p ? 'Paga' : 'Gratis'}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!righe.length && (
                <tr><td colSpan={7} style={{ padding: '46px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>
                  {soloDaVedere ? 'Nessuna riga da decidere: numeri e interruttori vanno d’accordo.' : 'Nessun cliente usa le API.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: '12.5px', color: '#8a8a8a', lineHeight: 1.7, maxWidth: '760px' }}>
        <strong style={{ color: '#666' }}>Come leggere i numeri.</strong> “Dal principale” è la quota di
        spedizioni partite dal mittente più usato. Vicino al 100% vuol dire un magazzino solo, cioè merce
        propria; sotto il 70% con molti mittenti diversi vuol dire che le spedizioni sono di altri.
        Resta un indizio: un negozio che spedisce da più fornitori assomiglia a un rivenditore senza
        esserlo, per questo l’ultima parola è l’interruttore, non il numero.
        <br />
        <strong style={{ color: '#666' }}>Chi non paga</strong> non ha limiti e non viene mai fermato.
        Chi paga ha il pacchetto del suo portale: superato il limite ha tre giorni, poi le API si
        fermano — il portale resta aperto e i pacchi già partiti proseguono.
      </div>
    </div>
  )
}
