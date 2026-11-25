'use client'
import { useEffect, useState } from 'react'
import { euro, intero } from './formati'

// I CONTI DEL MASTER nella Dashboard nuova, come un portafoglio (Lorenzo 25/11: «anche i wallet, ovvero i conti, non mi
// piace come li hai fatti»): ogni conto è una carta, impilate come nel Wallet dell'iPhone. Delle carte dietro si vede la
// testa (nome e saldo); quella davanti mostra il saldo grande, cosa è e il collegamento ai movimenti. Un clic su una
// carta dietro la porta davanti.
// I conti sono gli stessi della tendina «I tuoi conti» in alto e della Lista Movimenti (lib/movimenti-sezioni,
// /api/master/credito?dettaglio=1). Il 25/11 Wave (7 conti) vedeva solo «MULTIEXPRESS € 0,00»: la scheda leggeva
// rete + proprio da /api/dashboard, un conto solo, e non diceva che su LOGIXIA SRLS Wave aveva 12.433,16 €. Qui non si
// sommano e non si scelgono conti, ci sono tutti:
// - la rete (carta nera) e i fornitori (carta arancio), i conti da cui si spende. Rosso solo se sotto zero su un conto
//   a scalare: un master a fattura (QUICK, MULTI) va sotto zero per forza fino alla fattura;
// - i contratti propri, quanto è costato il corriere da sempre (negativi per forza, li paga il master al corriere): una
//   carta sola col totale; davanti, sotto la pila, li elenca uno per uno (QUICK ne ha 21);
// - le commissioni MoovExpress, quando ci sono.

type Sezione = { id: string; tipo: 'rete' | 'fornitore' | 'proprio' | 'commissioni'; titolo: string; sottotitolo: string; saldo: number }
type Carta = { id: string; tinta: 'rete' | 'fornitore' | 'propri' | 'commissioni'; titolo: string; tipo: string; nota: string; saldo: number; href?: string; allarme: boolean; righe?: Sezione[] }

const URL_CONTI = '/api/master/credito?dettaglio=1'
const vai = (id: string) => `/dashboard/movimenti?sezione=${encodeURIComponent(id)}`

export default function ContiFinexy({ aScalare, codDaRimettere }: { aScalare: boolean; codDaRimettere: number }) {
  const [sezioni, setSezioni] = useState<Sezione[] | null>(null)
  const [errore, setErrore] = useState(false)
  const [davanti, setDavanti] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    fetch(URL_CONTI, { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (!vivo) return; if (Array.isArray(d?.sezioni)) setSezioni(d.sezioni); else setErrore(true) })
      .catch(() => { if (vivo) setErrore(true) })
    return () => { vivo = false }
  }, [])

  const tutte = sezioni || []
  const propri = tutte.filter(s => s.tipo === 'proprio')
  const carte: Carta[] = [
    ...tutte.filter(s => s.tipo === 'rete' || s.tipo === 'fornitore').map(s => ({
      id: s.id, tinta: s.tipo as 'rete' | 'fornitore', titolo: s.titolo, saldo: s.saldo, href: vai(s.id),
      tipo: s.tipo === 'rete' ? (aScalare ? 'a scalare' : 'a fattura') : 'fornitore',
      nota: s.tipo === 'rete' ? (aScalare ? 'ti vende i contratti, si ricarica' : 'ti vende i contratti, a fattura') : s.sottotitolo,
      // sotto zero è un allarme solo dove il conto si consuma: la rete a scalare e i fornitori (credito prepagato)
      allarme: s.saldo < 0 && (s.tipo === 'fornitore' || aScalare),
    })),
    ...(propri.length ? [{
      id: 'propri', tinta: 'propri' as const, titolo: 'Contratti tuoi', tipo: `${intero(propri.length)} ${propri.length === 1 ? 'contratto' : 'contratti'}`,
      nota: 'quanto ti è costato il corriere da sempre · lo paghi tu', saldo: propri.reduce((t, s) => t + Number(s.saldo || 0), 0),
      allarme: false, righe: propri,
    }] : []),
    ...tutte.filter(s => s.tipo === 'commissioni').map(s => ({
      id: s.id, tinta: 'commissioni' as const, titolo: 'Commissioni', tipo: 'MoovExpress', nota: s.sottotitolo, saldo: s.saldo, href: vai(s.id), allarme: false,
    })),
  ]
  // la carta davanti è l'ultima della pila (sta in basso, intera); le altre restano nel loro ordine. Di partenza davanti
  // c'è il conto da cui si spende con più soldi in gioco: per Wave LOGIXIA SRLS (12.433,16), non MULTIEXPRESS a zero
  const daSpendere = carte.filter(c => c.tinta === 'rete' || c.tinta === 'fornitore')
  const primo = daSpendere.reduce<Carta | undefined>((m, c) => !m || Math.abs(c.saldo) > Math.abs(m.saldo) ? c : m, undefined)
  const scelta = carte.find(c => c.id === davanti) || primo || carte[0]
  const pila = scelta ? [...carte.filter(c => c !== scelta), scelta] : []

  return (
    <section className="fx-scheda fx-conti">
      <div className="fx-testa">
        <h2>I tuoi conti</h2>
        {sezioni && <span className="fx-chip fx-chip--neutro">{sezioni.length} {sezioni.length === 1 ? 'conto' : 'conti'}</span>}
      </div>

      {!sezioni ? <div className="fx-vuoto">{errore ? 'Conti non disponibili: aprili da Movimenti.' : 'Carico i conti…'}</div> : !carte.length ? <div className="fx-vuoto">Nessun conto.</div> : (
        <div className="fx-wallet">
          {pila.map(c => {
            const su = c === scelta
            return (
              <div key={c.id} className={`fx-cc fx-cc--${c.tinta}${su ? ' fx-cc--su' : ''}`}
                {...(su ? {} : { role: 'button', tabIndex: 0, title: `Porta davanti: ${c.titolo}`, onClick: () => setDavanti(c.id),
                  onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDavanti(c.id) } } })}>
                <div className="fx-cc-testa">
                  <b>{c.titolo}</b>
                  {su ? <span className="fx-cc-tipo">{c.tipo}</span> : <span className={c.allarme ? 'fx-cc-meno' : undefined}>{euro(c.saldo)}</span>}
                </div>
                {su && <>
                  <div className={`fx-cc-cifra${c.allarme ? ' fx-cc-meno' : ''}`}>{euro(c.saldo)}</div>
                  <div className="fx-cc-piede">
                    <span title={c.nota}>{c.nota}</span>
                    {c.href && <a href={c.href}>Movimenti →</a>}
                  </div>
                </>}
              </div>
            )
          })}
        </div>
      )}
      {scelta?.righe && (
        <div className="fx-cc-righe">
          {scelta.righe.map(r => <a key={r.id} href={vai(r.id)} title={`${r.titolo}: apri i movimenti`}><span>{r.titolo}</span><b>{euro(r.saldo)}</b></a>)}
        </div>
      )}

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
