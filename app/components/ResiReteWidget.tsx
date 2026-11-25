'use client'
import { useEffect, useState } from 'react'
import { BadgeResi, LegendaResi } from '@/app/components/ResiPercentuale'
import { COLORI_RESI } from '@/lib/resi-percentuale'
import { prendiAnticipata } from '@/lib/richieste-anticipate'

// IL BLOCCO "RESI DELLA RETE" DELLA DASHBOARD DEL MASTER (richiesta di Lorenzo, 17/10/2026): i clienti
// della rete con troppi resi, per accorgersi per tempo di chi truffa o sta per fallire. Ultimi 90 giorni;
// il dettaglio (periodo a scelta, sotto-master coi loro clienti) sta in Resi > Analisi resi.
// Si carica una volta per apertura della pagina, non a ogni aggiornamento della dashboard: il conteggio
// sulla rete piu' grande costa circa un secondo al database.

const CHIAVE = 'resi_rete_v1'
// Esportati perche' la home li anticipa insieme a /api/dashboard (vedi lib/richieste-anticipate).
export const URL_RESI_RETE = '/api/resi/analisi?giorni=90&riepilogo=1'
export const INIT_RESI_RETE: RequestInit = { cache: 'no-store' }

// `fx`: nella Dashboard nuova del master (app/components/dashboard-finexy) la scheda prende il disegno delle altre;
// l'agente vede ancora la dashboard di oggi e il riquadro com'era. Dati e regole sono gli stessi.
export default function ResiReteWidget({ fx = false }: { fx?: boolean } = {}) {
  const [d, setD] = useState<any>(null)
  const [errore, setErrore] = useState(false)
  useEffect(() => {
    let vivo = true
    try { const c = sessionStorage.getItem(CHIAVE); if (c) setD(JSON.parse(c)) } catch { /* si carica e basta */ }
    const risposta = prendiAnticipata(URL_RESI_RETE) ?? fetch(URL_RESI_RETE, INIT_RESI_RETE)
    risposta.then(r => r.json()).then(x => {
      if (!vivo) return
      if (x && !x.error) { setD(x); try { sessionStorage.setItem(CHIAVE, JSON.stringify(x)) } catch { /* idem */ } }
      else setErrore(true)
    }).catch(() => { if (vivo) setErrore(true) })
    return () => { vivo = false }
  }, [])

  const card = { background: '#fff', border: '1px solid #e8e8e8', borderRadius: '8px', padding: '16px' }
  const etichetta = { fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.6px', color: '#999' }
  if (!d && fx) return (
    <section className="fx-scheda">
      <div className="fx-testa"><h2>Resi della rete</h2><span className="fx-chip fx-chip--neutro">ultimi 90 giorni</span></div>
      <div className="fx-vuoto">{errore ? 'Dati non disponibili.' : 'Carico i resi…'}</div>
    </section>
  )
  if (!d) return (
    <div style={card}>
      <div style={etichetta}>Resi della rete · ultimi 90 giorni</div>
      <div style={{ fontSize: '13px', color: '#999', marginTop: '10px' }}>{errore ? 'Dati non disponibili.' : 'Caricamento…'}</div>
    </div>
  )

  const contatore = (livello: 'rosso' | 'arancione' | 'giallo', n: number) => (
    <div style={{ flex: '1 1 0', minWidth: '78px', background: COLORI_RESI[livello].bg, border: `1px solid ${COLORI_RESI[livello].bd}`, borderRadius: '8px', padding: '8px 10px' }}>
      <div style={{ fontSize: '22px', fontWeight: 800, color: COLORI_RESI[livello].fg, lineHeight: 1 }}>{n}</div>
      <div style={{ fontSize: '11px', fontWeight: 600, color: COLORI_RESI[livello].fg, marginTop: '3px' }}>
        {livello === 'rosso' ? 'oltre 20%' : livello === 'arancione' ? '10–20%' : '8–10%'}
      </div>
    </div>
  )

  if (fx) return (
    <section className="fx-scheda">
      <div className="fx-testa">
        <h2>Resi della rete</h2>
        <a className="fx-link" href="/dashboard/resi/analisi">Analisi resi →</a>
      </div>
      <div className="fx-resi-testa">
        <div className="fx-grande">{String(d.totale.pct).replace('.', ',')}%</div>
        <p className="fx-sotto">di resi negli ultimi 90 giorni<br />{Number(d.totale.resi).toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)} su {Number(d.totale.partite).toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)} spedizioni partite</p>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }} title="Clienti oltre soglia di resi">
        {(['rosso', 'arancione', 'giallo'] as const).map(l => (
          <div key={l} className={`fx-soglia fx-soglia--${l}`} style={{ flex: '1 1 0', minWidth: 0, background: COLORI_RESI[l].bg, borderRadius: 11, padding: '8px 11px' }}>
            <div style={{ fontSize: 19, fontWeight: 600, color: COLORI_RESI[l].fg, lineHeight: 1 }}>{d.allarmi[l]}</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: COLORI_RESI[l].fg, marginTop: 4 }}>clienti {l === 'rosso' ? 'oltre 20%' : l === 'arancione' ? '10–20%' : '8–10%'}</div>
          </div>
        ))}
      </div>
      <div className="fx-cella-nome" style={{ marginTop: 14 }}>Da controllare per primi</div>
      {!d.peggiori.length ? (
        <p className="fx-sotto" style={{ color: 'var(--fx-bene)' }}>Nessun cliente oltre l&apos;8% di resi.</p>
      ) : (
        <div className="fx-righe" style={{ marginTop: 4 }}>
          {d.peggiori.slice(0, 3).map((p: any) => (
            <div key={p.id} className="fx-riga" title={`${p.master} · ${p.resi} resi su ${p.partite} spedizioni`}>
              <span>{p.nome}<small style={{ color: 'var(--fx-grigio)', marginLeft: 6, fontSize: 11 }}>{p.resi} su {p.partite}</small></span>
              <BadgeResi pct={p.pct} livello={p.livello} />
            </div>
          ))}
        </div>
      )}
    </section>
  )

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <div style={etichetta}>↩ Resi della rete · ultimi 90 giorni</div>
        <a href="/dashboard/resi/analisi" style={{ fontSize: '12.5px', fontWeight: 700, color: '#f97316', textDecoration: 'none' }}>Apri l&apos;analisi resi →</a>
      </div>
      <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', marginTop: '12px', alignItems: 'stretch' }}>
        <div style={{ flex: '1 1 180px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '28px', fontWeight: 800, color: '#1a1a1a', lineHeight: 1 }}>{String(d.totale.pct).replace('.', ',')}%</span>
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
            di resi su tutta la rete · {Number(d.totale.resi).toLocaleString('it-IT')} su {Number(d.totale.partite).toLocaleString('it-IT')} spedizioni partite
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#1a1a1a', marginTop: '12px', marginBottom: '6px' }}>Clienti oltre soglia</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {contatore('rosso', d.allarmi.rosso)}
            {contatore('arancione', d.allarmi.arancione)}
            {contatore('giallo', d.allarmi.giallo)}
          </div>
        </div>
        <div style={{ flex: '2 1 280px', minWidth: 0 }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#1a1a1a', marginBottom: '6px' }}>Da controllare per primi</div>
          {!d.peggiori.length ? (
            <div style={{ fontSize: '13px', color: '#15803d', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 12px' }}>
              Nessun cliente oltre l&apos;8% di resi.
            </div>
          ) : d.peggiori.map((p: any) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0', borderTop: '1px solid #f3f4f6' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nome}</div>
                <div style={{ fontSize: '11px', color: '#9ca3af' }}>{p.master} · {p.resi} resi su {p.partite}</div>
              </div>
              <BadgeResi pct={p.pct} livello={p.livello} />
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: '12px' }}><LegendaResi /></div>
    </div>
  )
}
