'use client'
import { useEffect, useState } from 'react'
import { euro, intero } from './formati'

// I CONTI DEL MASTER nella Dashboard nuova. Sono gli stessi della tendina «I tuoi conti» in alto e della Lista
// Movimenti (lib/movimenti-sezioni, /api/master/credito?dettaglio=1), uno per riga, ognuno col suo saldo.
// Il 25/11 Wave (7 conti) vedeva solo «MULTIEXPRESS € 0,00»: la scheda leggeva rete + proprio da /api/dashboard, cioè
// un conto solo, e non diceva che su LOGIXIA SRLS Wave aveva 12.433,16 € con cui spediva tutto il giorno. Era lo
// stesso errore già fatto il 23/11: qui non si sommano e non si scelgono conti, si mostrano tutti.
//
// - I conti da cui si spende (rete e fornitori) stanno in chiaro, con la cifra grande. Rosso solo se sotto zero su un
//   conto a scalare: un master a fattura (QUICK, MULTI) va sotto zero per forza fino alla fattura, e non è un allarme.
// - I contratti propri sono quanto è costato il corriere da sempre (negativi per forza, li paga il master al
//   corriere): una riga sottile col totale, che si apre per vederli uno per uno (QUICK ne ha 21). Sotto, le
//   commissioni MoovExpress quando ci sono.
// Ogni riga apre la sua sezione in Lista Movimenti.

type Sezione = { id: string; tipo: 'rete' | 'fornitore' | 'proprio' | 'commissioni'; titolo: string; sottotitolo: string; saldo: number }

const URL_CONTI = '/api/master/credito?dettaglio=1'
const vai = (id: string) => `/dashboard/movimenti?sezione=${encodeURIComponent(id)}`

export default function ContiFinexy({ aScalare, codDaRimettere }: { aScalare: boolean; codDaRimettere: number }) {
  const [sezioni, setSezioni] = useState<Sezione[] | null>(null)
  const [errore, setErrore] = useState(false)
  const [aperti, setAperti] = useState(false)
  useEffect(() => {
    let vivo = true
    fetch(URL_CONTI, { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (!vivo) return; if (Array.isArray(d?.sezioni)) setSezioni(d.sezioni); else setErrore(true) })
      .catch(() => { if (vivo) setErrore(true) })
    return () => { vivo = false }
  }, [])

  const principali = (sezioni || []).filter(s => s.tipo === 'rete' || s.tipo === 'fornitore')
  const propri = (sezioni || []).filter(s => s.tipo === 'proprio')
  const commissioni = (sezioni || []).filter(s => s.tipo === 'commissioni')
  const costoPropri = propri.reduce((t, s) => t + Number(s.saldo || 0), 0)

  // sotto zero è un allarme solo dove il conto si consuma: la rete a scalare e i fornitori (credito prepagato)
  const allarme = (s: Sezione) => s.saldo < 0 && (s.tipo === 'fornitore' || aScalare)
  const nota = (s: Sezione) => s.tipo === 'rete' ? (aScalare ? 'a scalare · ti vende i contratti' : 'a fattura · lo saldi con la fattura') : s.sottotitolo

  return (
    <section className="fx-scheda fx-conti">
      <div className="fx-testa">
        <h2>I tuoi conti</h2>
        {sezioni && <span className="fx-chip fx-chip--neutro">{sezioni.length} {sezioni.length === 1 ? 'conto' : 'conti'}</span>}
      </div>

      <div className="fx-conti-lista">
        {!sezioni ? <div className="fx-vuoto">{errore ? 'Conti non disponibili: aprili da Movimenti.' : 'Carico i conti…'}</div> : (
          <>
            {principali.map(s => (
              <a key={s.id} className="fx-conto" href={vai(s.id)} title={`${s.titolo}: apri i movimenti`}>
                <span className="fx-conto-nome"><b>{s.titolo}</b><small>{nota(s)}</small></span>
                <span className={`fx-conto-cifra${allarme(s) ? ' fx-conto-cifra--male' : s.saldo === 0 ? ' fx-conto-cifra--zero' : ''}`}>{euro(s.saldo)}</span>
              </a>
            ))}
            {/* contratti propri e commissioni: righe sottili in un riquadro solo, così i conti di Wave (7) stanno tutti in
                vista senza scorrere; i contratti si aprono uno per uno (QUICK ne ha 21) */}
            {(propri.length > 0 || commissioni.length > 0) && (
              <div className="fx-conti-altri">
                {propri.length > 0 && (
                  <button type="button" className="fx-conto-riga" onClick={() => setAperti(a => !a)} aria-expanded={aperti}
                    title="Quanto ti è costato il corriere da sempre sui contratti tuoi: lo paghi tu al corriere">
                    <span><i className={aperti ? 'fx-giu' : undefined} aria-hidden="true">›</i>Contratti tuoi · {intero(propri.length)}</span>
                    <b>{euro(costoPropri)}</b>
                  </button>
                )}
                {aperti && (
                  <div className="fx-conti-propri">
                    {propri.map(s => (
                      <a key={s.id} href={vai(s.id)} title={`${s.titolo}: apri i movimenti`}><span>{s.titolo}</span><b>{euro(s.saldo)}</b></a>
                    ))}
                  </div>
                )}
                {commissioni.map(s => (
                  <a key={s.id} className="fx-conto-riga" href={vai(s.id)} title={`${s.titolo}: ${s.sottotitolo}`}>
                    <span><i aria-hidden="true" />{s.titolo}</span><b>{euro(s.saldo)}</b>
                  </a>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <a className="fx-conti-cod" href="/dashboard/contrassegni" title="Contrassegni incassati sui pacchi consegnati, da rimettere ai clienti">
        <span><b />Contrassegni da rimettere</span><strong>{euro(codDaRimettere)}</strong>
      </a>
      <div className="fx-tasti">
        <a className="fx-tasto fx-tasto--nero" href="/dashboard/movimenti"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>Movimenti</a>
        <a className="fx-tasto fx-tasto--chiaro" href="/dashboard/fatture"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10a2 2 0 012 2v16l-3-2-3 2-3-2-3 2V5a2 2 0 012-2zM9 8h6M9 12h6" /></svg>Fatture</a>
      </div>
    </section>
  )
}
