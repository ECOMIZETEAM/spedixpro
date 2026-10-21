'use client'

import { useEffect, useState } from 'react'

// I DATI PER RICARICARE IL CREDITO, IN UN PUNTO SOLO.
//
// Li mostrano la pagina Ricarica credito e il riquadro "credito insufficiente" (PagaConCarta) di Nuova
// spedizione, Ordini e Import. Fino al 21/10/2026 stavano solo nella pagina, e il riquadro, cioe' il
// punto in cui il cliente scopre di non avere credito, offriva soltanto la carta, che e' sospesa. Le
// regole (quando i dati sono pronti, l'intestatario, la causale, il contatto) le decide la rotta
// /api/cliente/ricarica-bonifico; qui si decide solo come si leggono.
//
// Chi incassa e' il MASTER DIRETTO del cliente, non noi. Se il master non ha pubblicato l'IBAN non si
// inventa niente: si dice di contattarlo, col suo indirizzo e la strada dei ticket (decisione di Lorenzo
// del 21/10/2026, uguale per tutti i clienti). Al 21/10/2026 e' il caso di 47 master su 51.

type Dati = {
  pronto: boolean
  iban: string | null
  intestatario: string | null
  banca: string | null
  causale: string
  contatto: string | null
  master: string | null
  credito: number
}

const card: React.CSSProperties = {
  background: '#fff', borderRadius: '10px', border: '1px solid #e8e8e8', padding: '24px',
}
const avviso: React.CSSProperties = { ...card, background: '#fff7ed', borderColor: '#fed7aa' }
const testoAvviso: React.CSSProperties = { color: '#9a3412', fontSize: 13, lineHeight: 1.6 }

export default function DatiBonifico({ variante }: { variante: 'pagina' | 'riquadro' }) {
  const [d, setD] = useState<Dati | null>(null)
  const [stato, setStato] = useState<'carico' | 'letti' | 'errore'>('carico')

  useEffect(() => {
    let vivo = true
    fetch('/api/cliente/ricarica-bonifico')
      .then(async r => {
        const j = await r.json().catch(() => null)
        if (!r.ok || !j || j.error) throw new Error('dati per il bonifico non disponibili')
        return j as Dati
      })
      .then(j => { if (vivo) { setD(j); setStato('letti') } })
      .catch(() => { if (vivo) setStato('errore') })
    return () => { vivo = false }
  }, [])

  const riquadro = variante === 'riquadro'

  if (stato === 'carico') {
    return riquadro
      ? <div style={{ ...testoAvviso, marginTop: 10 }}>Carico i dati per ricaricare il credito…</div>
      : <div style={card}>Caricamento…</div>
  }
  if (stato === 'errore' || !d) {
    // Senza risposta non si mostra nessun dato bancario a memoria: si dice di riprovare e dove chiedere.
    const t = <>Non siamo riusciti a caricare i dati per ricaricare il credito. Aggiorna la pagina; se si ripete, apri un ticket in <LinkAssistenza />.</>
    return riquadro
      ? <div style={{ ...testoAvviso, marginTop: 10 }}>{t}</div>
      : <div style={avviso}><div style={testoAvviso}>{t}</div></div>
  }

  // Senza intestatario la riga manca e basta: ripiegare sul nome del master (d.master) mostrerebbe come
  // beneficiario un nome che puo' non essere quello del conto (il perche' e' nella rotta).
  const coordinate = d.pronto && d.iban ? (
    <>
      {d.intestatario ? <Riga etichetta="Intestatario" valore={d.intestatario} /> : null}
      <Riga etichetta="IBAN" valore={ibanLeggibile(d.iban)} daCopiare={d.iban} mono />
      {d.banca ? <Riga etichetta="Banca" valore={d.banca} /> : null}
      <Riga etichetta="Causale" valore={d.causale} daCopiare={d.causale} ultima />
    </>
  ) : null

  if (riquadro) {
    if (!coordinate) return <div style={{ ...testoAvviso, marginTop: 10 }}><Ripiego d={d} /></div>
    return (
      <div style={{ marginTop: 10 }}>
        <div style={testoAvviso}>Il credito si ricarica con bonifico: appena arriva puoi spedire.</div>
        <div style={{ background: '#fff', border: '1px solid #fed7aa', borderRadius: 8, padding: '2px 14px', marginTop: 8 }}>
          {coordinate}
        </div>
        <div style={{ ...testoAvviso, fontSize: 12, marginTop: 8 }}>
          <strong>Metti la causale esatta</strong>: contiene il tuo codice cliente ed è quello che fa riconoscere il versamento.
          {d.contatto ? <> Per qualsiasi cosa: <strong>{d.contatto}</strong>.</> : null}
        </div>
      </div>
    )
  }

  // Pagina. Il saldo serve al negozio per vedere quando il bonifico e' stato accreditato: il credito lo
  // carica il master a mano, all'arrivo del versamento, e prima questa pagina non lo mostrava.
  return (
    <>
      <p style={{ color: '#666', fontSize: 13.5, margin: '0 0 14px', lineHeight: 1.6 }}>
        {coordinate
          ? <>Le spedizioni si pagano con il credito: si ricarica con <strong>bonifico bancario</strong>. Appena il bonifico arriva, il credito viene accreditato e puoi spedire.</>
          : <>Le spedizioni si pagano con il credito.</>}
      </p>
      <div style={card}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10,
          ...(coordinate ? { paddingBottom: 16, marginBottom: 8, borderBottom: '1px solid #f0f0f0' } : {}),
        }}>
          <span style={{ color: '#888', fontSize: 13 }}>Credito attuale</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: d.credito > 0 ? '#16a34a' : '#dc2626' }}>€ {d.credito.toFixed(2)}</span>
        </div>
        {coordinate}
      </div>
      <div style={{ ...avviso, marginTop: 12 }}>
        {coordinate ? (
          <div style={{ ...testoAvviso, color: '#7c2d12' }}>
            <strong>Metti la causale esatta</strong>: contiene il tuo codice cliente ed è quello che
            fa riconoscere il versamento. Senza, l’accredito richiede più tempo.
            {d.contatto ? <> Per qualsiasi cosa: <strong>{d.contatto}</strong>.</> : null}
          </div>
        ) : (
          <div style={testoAvviso}><Ripiego d={d} /></div>
        )}
      </div>
    </>
  )
}

// Il master non ha pubblicato l'IBAN: si dice a chi rivolgersi, con un contatto vero e
// la strada dei ticket, invece di campi vuoti che sembrano un guasto. La parola "assistenza" senza
// link lasciava il cliente a cercare da solo dove scrivere.
function Ripiego({ d }: { d: Dati }) {
  return (
    <>
      Per ricaricare il credito contatta <strong>{d.master || 'il tuo referente'}</strong>
      {d.contatto
        ? <>: scrivi a <strong>{d.contatto}</strong> oppure apri un ticket in <LinkAssistenza />.</>
        : <>: apri un ticket in <LinkAssistenza />.</>}
    </>
  )
}

function LinkAssistenza() {
  return <a href="/cliente/assistenza" style={{ color: 'inherit', fontWeight: 700, textDecoration: 'underline' }}>Assistenza</a>
}

function Riga({ etichetta, valore, daCopiare, mono, ultima }: {
  etichetta: string; valore: string; daCopiare?: string; mono?: boolean; ultima?: boolean
}) {
  const [esito, setEsito] = useState<'' | 'ok' | 'ko'>('')
  async function copia() {
    if (!daCopiare) return
    const ok = await copiaNegliAppunti(daCopiare)
    setEsito(ok ? 'ok' : 'ko')
    setTimeout(() => setEsito(''), ok ? 1500 : 4000)
  }
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px 10px',
      padding: '9px 0', borderBottom: ultima ? 'none' : '1px solid #f2f2f2',
    }}>
      <span style={{ fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: '.03em', fontWeight: 600 }}>{etichetta}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {/* Un tocco seleziona tutto il valore: e' la strada quando il browser non lascia copiare dal pulsante. */}
        <span style={{
          fontSize: 14, color: '#1a1a1a', fontWeight: 600, fontFamily: mono ? 'monospace' : undefined,
          overflowWrap: 'anywhere', userSelect: 'all', WebkitUserSelect: 'all',
        }}>{valore}</span>
        {daCopiare ? (
          <button type="button" onClick={copia}
            title={esito === 'ko' ? 'Il browser non ha permesso la copia: tocca il valore per selezionarlo e copialo.' : `Copia ${etichetta.toLowerCase()}`}
            style={{ fontSize: 11, padding: '3px 9px', border: '1px solid #e5e5e5', background: '#fff', borderRadius: 5, cursor: 'pointer', fontWeight: 700, color: esito === 'ko' ? '#dc2626' : '#555', whiteSpace: 'nowrap' }}>
            {esito === 'ok' ? '✓' : esito === 'ko' ? 'non copiato' : 'copia'}
          </button>
        ) : null}
      </span>
    </div>
  )
}

// A gruppi di quattro, come le coordinate stampate dalle banche: si legge e si confronta meglio. Negli
// appunti invece va senza spazi (daCopiare).
const ibanLeggibile = (iban: string) => iban.replace(/(.{4})(?=.)/g, '$1 ')

// "✓" solo se la copia e' riuscita davvero. writeText risponde in modo asincrono: senza aspettarlo, il
// vecchio pulsante segnava ✓ anche quando il browser la rifiutava, e chi poi incollava nell'app della
// banca poteva ritrovarsi quello che aveva copiato prima (l'IBAN al posto della causale, o viceversa).
// Se l'API manca o rifiuta, si prova la copia classica del browser.
async function copiaNegliAppunti(testo: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(testo)
    return true
  } catch { /* API assente o rifiutata: si prova sotto */ }
  try {
    const t = document.createElement('textarea')
    t.value = testo
    t.setAttribute('readonly', '')
    t.style.position = 'fixed'
    t.style.top = '0'
    t.style.opacity = '0'
    document.body.appendChild(t)
    t.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(t)
    return ok
  } catch {
    return false
  }
}
