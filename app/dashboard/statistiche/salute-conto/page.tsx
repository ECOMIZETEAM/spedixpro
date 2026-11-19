'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

// SALUTE DEL CONTO (lib/salute-conto, Lorenzo 18-19/11/2026): dall'estratto conto caricato e dai conti del
// portale, quanto ha il master, quanto deve dare e avere, quanto gli resta al mese togliendo le spese, e dove
// arriva se continua cosi'. Solo titolare e admin, in prova per Ecomize Solution.

// Il punto delle migliaia anche sotto 10.000 e il meno davanti all'euro: come in lib/salute-conto.
const eur = (n: any) => { const v = Number(n || 0); return `${v < 0 ? '−' : ''}€ ${Math.abs(v).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as any)}` }
const it = (d: string) => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : ''
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const nomeMese = (m: string) => `${MESI[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
const NERO = '#1a1a1a', GRIGIO = '#6b7280', BORDO = '#e8e8e8'
const card: any = { background: '#fff', border: `1px solid ${BORDO}`, borderRadius: '10px' }
// I rischi che si scrivono sotto il giudizio (lib/salute-conto li mette in testa alle attenzioni).
const RISCHI = /coprono quelli dei clienti|Quasi tutta la posizione/
const LIVELLI: Record<string, { titolo: string, colore: string, fondo: string }> = {
  sana: { titolo: 'Situazione sana', colore: '#15803d', fondo: '#f0fdf4' },
  media: { titolo: 'Da tenere d\'occhio', colore: '#c2410c', fondo: '#fff7ed' },
  rischio: { titolo: 'Situazione a rischio', colore: '#b91c1c', fondo: '#fef2f2' },
}

export default function SaluteConto() {
  const [d, setD] = useState<any>(null)
  const [errore, setErrore] = useState('')
  const [aperti, setAperti] = useState<Record<string, boolean>>({})
  const apri = (k: string) => setAperti(a => ({ ...a, [k]: !a[k] }))

  useEffect(() => {
    fetch('/api/contabilita/salute').then(async r => {
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.error) { setErrore(j.error || 'Non riesco a fare il conto — ricarica la pagina'); return }
      setD(j)
    }).catch(() => setErrore('Errore di rete — ricarica la pagina'))
  }, [])

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '22px 20px' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '18px' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: NERO, margin: 0 }}>Salute del conto</h1>
          <p style={{ color: '#666', fontSize: '13px', margin: '4px 0 0', lineHeight: 1.45 }}>
            Quanto hai, quanto devi dare e avere, quanto ti resta ogni mese togliendo le spese, e dove arrivi se continui così.
            {d?.banca && <> Banca aggiornata al <b>{it(d.banca.giorno)}</b>.</>}
          </p>
        </div>
        <Link href="/dashboard/statistiche/estratto-conto" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 12px', border: '1px solid #d5d5d5', borderRadius: '6px', background: '#fff', color: NERO, fontSize: '12.5px', fontWeight: 600, textDecoration: 'none' }}>
          <Icona d="M12 16V4M7 9l5-5 5 5M5 20h14" />Carica l&apos;estratto conto
        </Link>
      </div>

      {errore && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '8px', padding: '10px 14px', fontSize: '13px' }}>{errore}</div>}
      {!d && !errore && <div style={{ ...card, padding: '40px', textAlign: 'center', color: GRIGIO, fontSize: '13px' }}>Faccio il conto: leggo banca, conti dei clienti, contrassegni e rettifiche…</div>}
      {d?.senzaEstratto && (
        <div style={{ ...card, padding: '28px', textAlign: 'center', color: GRIGIO, fontSize: '13.5px', lineHeight: 1.5 }}>
          Per fare il conto serve almeno un estratto conto della banca.<br />
          <Link href="/dashboard/statistiche/estratto-conto" style={{ color: '#f97316', fontWeight: 600 }}>Caricalo da Estratto conto</Link>, poi torna qui.
        </div>
      )}

      {d && !d.senzaEstratto && <>
        <Giudizio d={d} />

        {/* Dove arrivi */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', margin: '14px 0 6px' }}>
          <Numero titolo="Oggi" valore={d.stima.oggi} nota={d.stima.giorniDopo > 0 ? `stima: banca al ${it(d.banca.giorno)} + ${d.stima.giorniDopo} giorni di portale` : 'dalla banca di oggi'} />
          <Numero titolo={`A fine ${MESI[Number(d.oggi.slice(5, 7)) - 1]}`} valore={d.stima.fineMese} nota="se continua come negli ultimi 30 giorni" />
          <Numero titolo="Fra 3 mesi" valore={d.stima.treMesi} nota="se continua come negli ultimi 30 giorni" />
        </div>
        <div style={{ fontSize: '12px', color: GRIGIO, marginBottom: '22px', lineHeight: 1.5 }}>
          Negli ultimi 30 giorni hai guadagnato <b style={{ color: NERO }}>{eur(d.stima.guadagnoMese)}</b>; le spese al mese le conto <b style={{ color: NERO }}>{eur(d.stima.costiMese)}</b>
          {d.stima.fonteCosti === 'gestione' ? ' (dai tuoi Costi di gestione)' : d.stima.fonteCosti === 'banca' ? ' (media di quello che è uscito dalla banca)' : ' (nessuna spesa nota)'}.
          Ti restano circa <b style={{ color: d.stima.alMese >= 0 ? '#15803d' : '#b91c1c' }}>{eur(d.stima.alMese)}</b> al mese.
        </div>

        {/* La fotografia al giorno della banca */}
        <Titolo testo={`La fotografia al ${it(d.posizione.giorno)}`} frase="Il giorno dell'ultimo estratto: banca e conti del portale presi allo stesso momento." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' }}>
          <Colonna titolo="Hai" righe={d.posizione.hai} colore="#15803d" aperti={aperti} apri={apri} chiave="hai" />
          <Colonna titolo="Ti devono" righe={d.posizione.devonoA} colore="#15803d" aperti={aperti} apri={apri} chiave="dev" vuota="Nessuno ti deve soldi." />
          <Colonna titolo="Devi dare" righe={d.posizione.devi} colore="#b91c1c" aperti={aperti} apri={apri} chiave="dai" vuota="Non devi soldi a nessuno." />
        </div>
        <div style={{ ...card, padding: '14px 16px', marginTop: '12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
          <Totale titolo="La tua posizione" valore={d.posizione.totale} frase="Hai + ti devono − devi dare: quello che resta tuo se tutti pagano e tu paghi tutti." />
          <Totale titolo="I soldi veri" valore={d.posizione.liquidita} frase="Hai − devi dare, senza contare chi ti deve: se è sotto zero vai avanti anche coi soldi dei clienti." />
        </div>

        {/* Mese per mese */}
        <div style={{ marginTop: '26px' }}>
          <Titolo testo="Mese per mese" frase="Il guadagno è quello del Report Guadagno Totale. Le spese sono quelle uscite dalla banca, tolti i pagamenti a chi ti vende le spedizioni, i contrassegni e i rimborsi ai clienti." />
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '620px' }}>
                <thead><tr style={{ background: '#fafafa' }}>
                  {['Mese', 'Guadagno', 'Spese dalla banca', 'Costi di gestione', 'Ti resta'].map((t, i) => <th key={t} style={{ ...th, textAlign: i ? 'right' : 'left' }}>{t}</th>)}
                </tr></thead>
                <tbody>
                  {d.mesi.map((m: any) => {
                    const spese = m.spese ?? 0
                    const resta = m.guadagno - (m.banca === 'completa' ? spese : m.gestione)
                    return (
                      <FragmentMese key={m.mese} m={m} resta={resta} aperto={!!aperti['m' + m.mese]} apri={() => apri('m' + m.mese)} />
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Da guardare */}
        {/* I due rischi grossi stanno gia' sotto il giudizio: qui il resto. */}
        {d.attenzioni.filter((a: any) => !RISCHI.test(a.titolo)).length > 0 && (
          <div style={{ marginTop: '26px' }}>
            <Titolo testo="Da guardare" frase="Quello che rende questi numeri meno sicuri, con l'importo." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {d.attenzioni.filter((a: any) => !RISCHI.test(a.titolo)).map((a: any, i: number) => (
                <div key={i} style={{ ...card, padding: '12px 14px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <span style={{ marginTop: '1px' }}><Icona d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" colore="#c2410c" /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <b style={{ fontSize: '13.5px', color: NERO, flex: '1 1 220px' }}>{a.titolo}</b>
                      {a.importo != null && <b style={{ fontSize: '13.5px', color: NERO, whiteSpace: 'nowrap' }}>{eur(a.importo)}</b>}
                    </div>
                    <div style={{ fontSize: '12.5px', color: '#4b5563', marginTop: '3px', lineHeight: 1.45 }}>{a.frase}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </>}
    </div>
  )
}

function Giudizio({ d }: { d: any }) {
  const l = LIVELLI[d.giudizio.livello] || LIVELLI.media
  // I due rischi che contano di piu' (cassa che non copre i soldi dei clienti, posizione fatta del debito di
  // uno solo) stanno in testa alle attenzioni: si ripetono qui, sotto il giudizio, perche' non si perdano.
  const rischi = d.attenzioni.filter((a: any) => RISCHI.test(a.titolo))
  return (
    <div style={{ ...card, borderLeft: `4px solid ${l.colore}`, background: l.fondo, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: l.colore, flexShrink: 0 }} />
        <span style={{ fontSize: '17px', fontWeight: 800, color: l.colore }}>{l.titolo}</span>
      </div>
      <div style={{ fontSize: '14px', color: NERO, marginTop: '6px', lineHeight: 1.5 }}>{d.giudizio.frase}</div>
      {rischi.length > 0 && (
        <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(0,0,0,0.07)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#c2410c', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Però</span>
          {rischi.map((a: any, i: number) => <div key={i} style={{ fontSize: '13px', color: '#374151', lineHeight: 1.45 }}><b>{a.titolo}</b>{a.importo != null ? ` (${eur(a.importo)})` : ''}. {a.frase}</div>)}
        </div>
      )}
    </div>
  )
}

function Numero({ titolo, valore, nota }: { titolo: string, valore: number, nota: string }) {
  return (
    <div style={{ ...card, padding: '14px 16px' }}>
      <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', fontWeight: 700 }}>{titolo}</div>
      <div style={{ fontSize: '22px', fontWeight: 800, color: valore >= 0 ? NERO : '#b91c1c', marginTop: '4px', whiteSpace: 'nowrap' }}>{eur(valore)}</div>
      <div style={{ fontSize: '11.5px', color: GRIGIO, marginTop: '2px' }}>{nota}</div>
    </div>
  )
}

function Colonna({ titolo, righe, colore, aperti, apri, chiave, vuota }: { titolo: string, righe: any[], colore: string, aperti: Record<string, boolean>, apri: (k: string) => void, chiave: string, vuota?: string }) {
  const tot = righe.reduce((t, r) => t + r.importo, 0)
  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: NERO, flex: 1 }}>{titolo}</span>
        <span style={{ fontSize: '16px', fontWeight: 800, color: colore, whiteSpace: 'nowrap' }}>{eur(tot)}</span>
      </div>
      {righe.length === 0 && <div style={{ padding: '14px', fontSize: '12.5px', color: GRIGIO }}>{vuota}</div>}
      {righe.map((r, i) => {
        const k = chiave + i
        return (
          <div key={k} style={{ padding: '10px 14px', borderTop: i ? '1px solid #f5f5f5' : 'none' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
              <span style={{ fontSize: '13px', color: NERO, fontWeight: 600, flex: 1, minWidth: 0 }}>{r.etichetta}</span>
              <span style={{ fontSize: '13px', color: NERO, fontWeight: 700, whiteSpace: 'nowrap' }}>{eur(r.importo)}</span>
            </div>
            {r.nota && <div style={{ fontSize: '11.5px', color: GRIGIO, marginTop: '2px', lineHeight: 1.4 }}>{r.nota}</div>}
            {r.dettaglio?.length > 0 && <>
              <button onClick={() => apri(k)} style={{ background: 'none', border: 'none', padding: '3px 0 0', color: '#f97316', fontSize: '11.5px', fontWeight: 600, cursor: 'pointer' }}>
                {aperti[k] ? 'nascondi' : r.dettaglio.length > 1 ? `vedi chi (${r.dettaglio.length}${r.dettaglio.length === 8 ? ', i più grandi' : ''})` : 'vedi chi'}
              </button>
              {aperti[k] && (
                <div style={{ marginTop: '4px', borderLeft: '2px solid #f3f4f6', paddingLeft: '10px' }}>
                  {r.dettaglio.map((x: any, j: number) => (
                    <div key={j} style={{ display: 'flex', gap: '8px', fontSize: '12px', padding: '2px 0', alignItems: 'baseline' }}>
                      <span style={{ flex: 1, minWidth: 0, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.nome}{x.nota && <span style={{ color: GRIGIO }}> · {x.nota}</span>}</span>
                      <span style={{ whiteSpace: 'nowrap', color: NERO }}>{eur(x.importo)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>}
          </div>
        )
      })}
    </div>
  )
}

function FragmentMese({ m, resta, aperto, apri }: { m: any, resta: number, aperto: boolean, apri: () => void }) {
  const spese = m.banca === 'completa' ? eur(m.spese) : m.banca === 'parziale' ? `${eur(m.spese)} (in parte)` : '—'
  return (
    <>
      <tr>
        <td style={td}>
          <span style={{ fontWeight: 600, color: NERO, textTransform: 'capitalize' }}>{nomeMese(m.mese)}</span>
          {!m.completo && <span style={{ color: GRIGIO, fontSize: '11.5px' }}> · fino al {it(m.al)}</span>}
          {m.banca !== 'completa' && <div style={{ fontSize: '11px', color: GRIGIO }}>{m.banca === 'assente' ? 'banca non caricata' : 'banca solo per una parte del mese'}</div>}
          {m.voci.length > 0 && <button onClick={apri} style={{ display: 'block', background: 'none', border: 'none', padding: '2px 0 0', color: '#f97316', fontSize: '11.5px', fontWeight: 600, cursor: 'pointer' }}>{aperto ? 'nascondi le spese' : 'vedi le spese'}</button>}
        </td>
        <td style={{ ...td, textAlign: 'right' }}>{eur(m.guadagno)}</td>
        <td style={{ ...td, textAlign: 'right', color: m.banca === 'assente' ? '#9ca3af' : NERO }}>{spese}</td>
        <td style={{ ...td, textAlign: 'right', color: m.gestione ? NERO : '#9ca3af' }}>{m.gestione ? eur(m.gestione) : '—'}</td>
        <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: m.banca === 'completa' || m.gestione ? (resta >= 0 ? '#15803d' : '#b91c1c') : '#9ca3af' }}>
          {m.banca === 'completa' || m.gestione ? eur(resta) : '—'}
        </td>
      </tr>
      {aperto && m.voci.map((v: any) => (
        <tr key={v.voce} style={{ background: '#fcfcfc' }}>
          <td style={{ ...td, paddingLeft: '26px', color: '#4b5563', fontSize: '12px' }}>{v.voce} <span style={{ color: GRIGIO }}>· {v.n}</span></td>
          <td style={td} />
          <td style={{ ...td, textAlign: 'right', fontSize: '12px' }}>{eur(v.totale)}</td>
          <td style={td} /><td style={td} />
        </tr>
      ))}
    </>
  )
}

function Totale({ titolo, valore, frase }: { titolo: string, valore: number, frase: string }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: NERO }}>{titolo}</span>
        <span style={{ fontSize: '18px', fontWeight: 800, color: valore >= 0 ? NERO : '#b91c1c', whiteSpace: 'nowrap' }}>{eur(valore)}</span>
      </div>
      <div style={{ fontSize: '11.5px', color: GRIGIO, marginTop: '2px', lineHeight: 1.4 }}>{frase}</div>
    </div>
  )
}

function Titolo({ testo, frase }: { testo: string, frase?: string }) {
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ fontSize: '15px', fontWeight: 700, color: NERO }}>{testo}</div>
      {frase && <div style={{ fontSize: '12px', color: GRIGIO, marginTop: '2px', lineHeight: 1.4 }}>{frase}</div>}
    </div>
  )
}

// Icone a linea (regola di Lorenzo: niente emoji).
function Icona({ d, colore = '#f97316' }: { d: string, colore?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d={d} fill="none" stroke={colore} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const th: any = { padding: '9px 12px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#666', whiteSpace: 'nowrap' }
const td: any = { padding: '10px 12px', fontSize: '13px', color: NERO, borderTop: '1px solid #f0f0f0', verticalAlign: 'top', whiteSpace: 'nowrap' }
