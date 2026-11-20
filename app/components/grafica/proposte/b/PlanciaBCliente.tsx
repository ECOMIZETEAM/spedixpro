'use client'
// LA DASHBOARD B DEL CLIENTE (Lorenzo 19/11: la prova «Scopri la nuova versione» anche per i clienti). Lo stesso fiume
// della Dashboard dei master, coi numeri del cliente: tutto da /api/cliente/dashboard, la rotta della sua dashboard di
// oggi. Niente guadagni, margini o rete: al cliente si mostrano le sue spedizioni, il suo credito e le sue spese.
import { useContext, useEffect, useRef, useState } from 'react'
import { GraficaNuova } from '../../contesto'
import { Icona } from '../../icone'
import { Conta, useScorrimentoMorbido } from '../../movimento'
import { Euro, fmtN, GIORNI, MESI } from '../../PlanciaNuova'
import { useTinte } from './particelle'
import Fiume from './Fiume'
import { Portata } from './Fondo'
import { virgola } from './comuni'
import './b.css'

function useDatiCliente() {
  const g = useContext(GraficaNuova)
  const chiave = 'plancia_cliente_v1|' + g.chi
  const [data, setData] = useState<any>(null)
  const [quando, setQuando] = useState<Date | null>(null)
  useEffect(() => {
    // la copia di sessione si legge DOPO l'apertura: letta subito, server e browser disegnerebbero due pagine diverse
    try { const c = sessionStorage.getItem(chiave); if (c) setData(JSON.parse(c)) } catch {}
    setQuando(new Date())
    let vivo = true, ultimo = 0
    const carica = () => {
      const t = Date.now(); if (t - ultimo < 1000) return; ultimo = t
      fetch('/api/cliente/dashboard', { cache: 'no-store' }).then(r => r.json()).then(d => {
        if (vivo && d && !d.error) { setData(d); setQuando(new Date()); try { sessionStorage.setItem(chiave, JSON.stringify(d)) } catch {} }
      }).catch(() => {})
    }
    carica()
    // come la dashboard di oggi: ogni 2 minuti a scheda visibile, e al ritorno sulla scheda
    const t = setInterval(() => { if (document.visibilityState === 'visible') carica() }, 120000)
    const torna = () => { if (document.visibilityState === 'visible') carica() }
    document.addEventListener('visibilitychange', torna); window.addEventListener('focus', torna)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', torna); window.removeEventListener('focus', torna) }
  }, [chiave])
  return { data, quando, tema: g.tema }
}

function useEntrate(radice: React.RefObject<HTMLElement | null>, dipende: unknown) {
  useEffect(() => {
    const r = radice.current
    if (!r || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return
    r.classList.add('pb-anima')
    const oss = new IntersectionObserver(voci => {
      for (const v of voci) if (v.isIntersecting) { v.target.classList.add('pb-visto'); oss.unobserve(v.target) }
    }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' })
    r.querySelectorAll('.pb-sez:not(.pb-visto)').forEach(s => oss.observe(s))
    return () => oss.disconnect()
  }, [radice, dipende])
}

export default function PlanciaBCliente() {
  const { data, quando, tema } = useDatiCliente()
  const radice = useRef<HTMLDivElement>(null)
  useScorrimentoMorbido(radice)
  useEntrate(radice, !!data)
  const tinte = useTinte(radice, tema)

  const nome = String(data?.clienteNome || '').trim()
  const ora = quando ? quando.getHours() : 12
  const saluto = ora < 13 ? 'Buongiorno' : ora < 18 ? 'Buon pomeriggio' : 'Buonasera'
  const s: Record<string, number> = data?.statiUltimi30 || {}
  const tot = Object.values(s).reduce((a: number, x: any) => a + Number(x || 0), 0)
  const fermi = ['in_giacenza', 'non_consegnato', 'reso_mittente'].reduce((a, k) => a + Number(s[k] || 0), 0)
  const consegnate = Number(s.consegnata || 0)

  return (
    <div className={'pb pb--' + tema} ref={radice}>
      <section className="pb-lastra gx-vetro pb-prima" aria-labelledby="pb-titolo">
        <header className="pb-testata">
          <div>
            <small className="pb-occhiello"><i className="pb-polso" />{quando ? <>{GIORNI[quando.getDay()]} {quando.getDate()} {MESI[quando.getMonth()]} · aggiornato alle {String(quando.getHours()).padStart(2, '0')}:{String(quando.getMinutes()).padStart(2, '0')}</> : 'oggi'}</small>
            <h1 id="pb-titolo">{quando ? saluto : 'Ciao'}, <b>{nome || '…'}</b></h1>
            <p>Le tue spedizioni degli ultimi 30 giorni: dove scorrono, dove si fermano, dove escono.</p>
          </div>
          <dl className="pb-sommario">
            <div><dt>Consegnate, 30 giorni</dt><dd>{data ? <>{tot ? virgola(consegnate / tot * 100) : '0'}<small>%</small></> : '…'}</dd></div>
            <div><dt>Ancora in viaggio</dt><dd>{data ? <Conta v={['in_lavorazione', 'spedita', 'in_transito', 'in_consegna'].reduce((a, k) => a + Number(s[k] || 0), 0)}>{n => fmtN.format(n)}</Conta> : '…'}</dd></div>
            <div><dt>Uscite dal percorso</dt><dd>{data ? <>{tot ? virgola(fermi / tot * 100) : '0'}<small>%</small></> : '…'}</dd></div>
          </dl>
        </header>
        <Fiume stati={data ? s : null} tinte={tinte} pronto={!!data} />
        <p className="pb-didascalia">Le spedizioni create negli ultimi 30 giorni, nello stato in cui sono oggi. Lo spessore è proporzionale al numero; i fili più sottili hanno uno spessore minimo per restare visibili.</p>
      </section>

      <Chiusa data={data} />

      <div className="pb-sezioni">
        <div className="pb-due">
          <Numeri data={data} />
          <Soldi data={data} />
        </div>
        <Portata mesi={data ? (data.statsMensili || []) : null} tinte={tinte} />
      </div>
    </div>
  )
}

// ── Da fare adesso: le cose che aspettano il cliente. Le righe a zero spariscono ──
function Chiusa({ data }: { data: any }) {
  const credito = Number(data?.credito || 0)
  // singolare e plurale secondo il numero (come la Dashboard dei master)
  const nG = Number(data?.inGiacenza || 0), nS = Number(data?.daSpedire || 0)
  const voci = [
    { k: 'giac', n: nG, nome: nG === 1 ? 'giacenza' : 'giacenze', frase: nG === 1 ? 'aspetta le tue istruzioni' : 'aspettano le tue istruzioni', verbo: 'Rispondi', href: '/cliente/spedizioni/giacenze', problema: true },
    { k: 'sped', n: nS, nome: 'da spedire', frase: nS === 1 ? 'pronta, da chiudere in una distinta' : 'pronte, da chiudere in una distinta', verbo: 'Crea distinta', href: '/cliente/distinte/nuova', problema: false },
  ].filter(v => v.n > 0)
  const senzaCredito = !!data && credito <= 0
  const quante = voci.length + (senzaCredito ? 1 : 0)
  return (
    <section className="pb-chiusa gx-vetro" aria-labelledby="pb-t-chiusa">
      <div className="pb-chiusa__testa">
        <span className="pb-chiusa__segno" aria-hidden="true"><i /><i /></span>
        <div>
          <h2 id="pb-t-chiusa">Da fare adesso</h2>
          <p>{!data ? '…' : quante ? `${quante === 1 ? 'Una cosa aspetta' : quante + ' cose aspettano'} te.` : 'Niente aspetta te.'}</p>
        </div>
      </div>
      {quante > 0 && (
        <ul className="pb-chiusa__voci">
          {senzaCredito && (
            <li className="pb-chiusa__voce pb-chiusa__voce--problema">
              {/* il segno e non la cifra: la cifra grande non ci sta accanto al tasto, e il saldo esatto è nella frase */}
              <b>€</b>
              <div><span className="pb-chiusa__nome">credito finito</span><span className="pb-chiusa__frase">saldo {credito.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €: per spedire serve una ricarica</span></div>
              <a className="pb-verbo" href="/cliente/ricarica">Ricarica<Icona id="i-chevron" /></a>
            </li>
          )}
          {voci.map(v => (
            <li key={v.k} className={'pb-chiusa__voce' + (v.problema ? ' pb-chiusa__voce--problema' : '')}>
              <b><Conta v={v.n}>{n => fmtN.format(n)}</Conta></b>
              <div><span className="pb-chiusa__nome">{v.nome}</span><span className="pb-chiusa__frase">{v.frase}</span></div>
              <a className="pb-verbo" href={v.href}>{v.verbo}<Icona id="i-chevron" /></a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Oggi e questo mese, in cifre ──
function Numeri({ data }: { data: any }) {
  // Non ci sono «in lavorazione» e «in transito»: la rotta li conta in un altro modo rispetto al fiume qui sopra (stato
  // di oggi delle spedizioni degli ultimi 30 giorni), e sulla stessa pagina due numeri diversi per la stessa parola
  // sembrerebbero un errore. Qui solo quello che il fiume non dice.
  const cifre = [
    { n: data?.spediteOggi, nome: 'Spedite oggi', frase: 'affidate al corriere' },
    { n: data?.spedizioniMese, nome: 'Create', frase: 'questo mese' },
    { n: data?.consegnateMese, nome: 'Consegnate', frase: 'questo mese' },
    { n: data?.spedizioniTotali, nome: 'Create', frase: 'da sempre' },
  ]
  return (
    <section className="pb-sez pb-scheda gx-vetro" aria-labelledby="pbc-t-numeri">
      <div className="pb-scheda__testa"><h3 id="pbc-t-numeri">Le tue spedizioni</h3><a href="/cliente/spedizioni">Elenco<Icona id="i-chevron" /></a></div>
      <div className="pbc-cifre">
        {cifre.map((c, i) => (
          <div key={i} className="pbc-cifra">
            <b>{data ? <Conta v={Number(c.n || 0)}>{n => fmtN.format(n)}</Conta> : '…'}</b>
            <span>{c.nome}</span><small>{c.frase}</small>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── I soldi del cliente: il credito, quanto ha speso, i contrassegni ──
function Soldi({ data }: { data: any }) {
  const credito = Number(data?.credito || 0)
  return (
    <section className="pb-sez pb-scheda gx-vetro pbc-soldi" aria-labelledby="pbc-t-soldi">
      <div className="pb-scheda__testa"><h3 id="pbc-t-soldi">I tuoi soldi</h3><a href="/cliente/movimenti">Movimenti<Icona id="i-chevron" /></a></div>
      <div className="pbc-credito">
        <span>Credito disponibile</span>
        <b className={credito <= 0 ? 'pbc-meno' : undefined}>{data ? <Euro v={credito} /> : '…'}</b>
        <a href="/cliente/ricarica">Ricarica<Icona id="i-chevron" /></a>
      </div>
      <dl className="pbc-voci">
        <div><dt>Speso questo mese</dt><dd>{data ? <Euro v={Number(data.speseMese || 0)} /> : '…'}</dd></div>
        <div><dt>Speso da sempre</dt><dd>{data ? <Euro v={Number(data.speseTotali || 0)} /> : '…'}</dd></div>
        <div><dt>Contrassegni da incassare</dt><dd>{data ? <Euro v={Number(data.codDaIncassare || 0)} /> : '…'}</dd></div>
        <div><dt>Contrassegni incassati</dt><dd>{data ? <Euro v={Number(data.codIncassati || 0)} /> : '…'}</dd></div>
      </dl>
    </section>
  )
}
