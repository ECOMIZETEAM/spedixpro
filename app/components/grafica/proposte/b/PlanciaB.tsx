'use client'
// PROPOSTA B DI PLANCIA — «IL FLUSSO» (27/10). Il mestiere di un master è far scorrere le spedizioni: la Plancia lo
// mostra come un fiume. In cima il fiume degli ultimi 30 giorni (dove scorrono, dove si fermano, dove escono) e la
// chiusa (le cose che aspettano lui); scendendo il flusso di oggi, i soldi come flusso, la foce (le province), la
// portata dei mesi, la rete e le giacenze da risolvere.
// Tutti i numeri vengono dalle rotte che il portale ha già (vedi ../dati.ts e le rotte lette con usaJson): dove un
// dato non c'è, il riquadro lo dice. Niente segue il mouse; con prefers-reduced-motion tutto sta fermo.
import { useEffect, useRef } from 'react'
import { useDatiPlancia } from '../dati'
import { Icona } from '../../icone'
import { Conta, useScorrimentoMorbido } from '../../movimento'
import { Euro, fmtN, GIORNI, MESI } from '../../PlanciaNuova'
import { useTinte } from './particelle'
import Fiume from './Fiume'
import Oggi from './Oggi'
import Soldi from './Soldi'
import { Foce, Portata, Rete, Resi, Giacenze } from './Fondo'
import './b.css'

// le sezioni entrano quando arrivano (pb-anima c'è solo col JavaScript acceso: senza, tutto resta visibile)
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

export default function PlanciaB() {
  const { data, giornata, badge, quando, tema } = useDatiPlancia()
  const radice = useRef<HTMLDivElement>(null)
  useScorrimentoMorbido(radice)
  useEntrate(radice, !!data)
  const tinte = useTinte(radice, tema)

  const nome = String(data?.masterNome || '').trim()
  const ora = quando ? quando.getHours() : 12
  const saluto = ora < 13 ? 'Buongiorno' : ora < 18 ? 'Buon pomeriggio' : 'Buonasera'
  const s: Record<string, number> = data?.statiUltimi30 || {}
  const tot = Object.values(s).reduce((a: number, x: any) => a + Number(x || 0), 0)
  const fermi = ['in_giacenza', 'non_consegnato', 'reso_mittente'].reduce((a, k) => a + Number(s[k] || 0), 0)

  return (
    <div className={'pb pb--' + tema} ref={radice}>
      {/* ── la prima schermata: il fiume ── */}
      <section className="pb-lastra gx-vetro pb-prima" aria-labelledby="pb-titolo">
        <header className="pb-testata">
          <div>
            <small className="pb-occhiello"><i className="pb-polso" />{quando ? <>{GIORNI[quando.getDay()]} {quando.getDate()} {MESI[quando.getMonth()]} · aggiornato alle {String(quando.getHours()).padStart(2, '0')}:{String(quando.getMinutes()).padStart(2, '0')}</> : ' '}</small>
            <h1 id="pb-titolo">{quando ? saluto : 'Ciao'}, <b>{nome || '…'}</b></h1>
            <p>Il fiume delle tue spedizioni negli ultimi 30 giorni: dove scorrono, dove si fermano, dove escono.</p>
          </div>
          <dl className="pb-sommario">
            <div><dt>Consegnate da sempre</dt><dd>{data ? <>{String(data.tassoConsegna ?? 0).replace('.', ',')}<small>%</small></> : '…'}</dd></div>
            <div><dt>Ancora in viaggio</dt><dd>{data ? <Conta v={['in_lavorazione', 'spedita', 'in_transito', 'in_consegna'].reduce((a, k) => a + Number(s[k] || 0), 0)}>{n => fmtN.format(n)}</Conta> : '…'}</dd></div>
            <div><dt>Uscite dal percorso</dt><dd>{data ? <>{tot ? String(Math.round(fermi / tot * 1000) / 10).replace('.', ',') : '0'}<small>%</small></> : '…'}</dd></div>
          </dl>
        </header>
        <Fiume stati={data ? s : null} tinte={tinte} pronto={!!data} />
        <p className="pb-didascalia">Le spedizioni create negli ultimi 30 giorni, nello stato in cui sono oggi. Lo spessore è proporzionale al numero; i fili più sottili hanno uno spessore minimo per restare visibili.</p>
      </section>

      <Chiusa data={data} badge={badge} />

      <div className="pb-sezioni">
        <Oggi data={data} giornata={giornata} quando={quando} />
        <Soldi data={data} tinte={tinte} />
        <Foce tinte={tinte} />
        <div className="pb-fondo">
          <div className="pb-due">
            <Portata mesi={data ? (data.statsMensili || []) : null} tinte={tinte} />
            <Rete data={data} />
          </div>
          <div className="pb-due">
            <Resi />
            <Giacenze data={data} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── La chiusa: dove il fiume aspetta il master. Le righe a zero spariscono ──
function Chiusa({ data, badge }: { data: any; badge: any }) {
  // singolare e plurale secondo il numero: con 1 si leggeva «1 richieste della rete aspettano» (Lorenzo 20/11)
  const nG = Number(data?.inGiacenza || 0), nR = Number(badge?.daConfermare || 0), nA = Number(badge?.daAccettare || 0)
  const voci = [
    { k: 'giac', n: nG, nome: nG === 1 ? 'giacenza' : 'giacenze', frase: nG === 1 ? 'aspetta le tue istruzioni' : 'aspettano le tue istruzioni', importo: 0, verbo: 'Rispondi', href: '/dashboard/spedizioni/giacenze' },
    { k: 'rett', n: nR, nome: nR === 1 ? 'rettifica da confermare' : 'rettifiche da confermare', frase: 'peso e misure ricontrollati dal corriere', importo: Number(badge?.daConfermareImporto || 0), verbo: 'Conferma', href: '/dashboard/spedizioni/rettifica' },
    { k: 'rete', n: nA, nome: nA === 1 ? 'richiesta della rete' : 'richieste della rete', frase: nA === 1 ? 'aspetta una tua risposta' : 'aspettano una tua risposta', importo: 0, verbo: 'Rivedi', href: '/dashboard/network' },
  ]
  const attive = voci.filter(v => v.n > 0)
  const caricato = !!data && !!badge
  return (
    <section className="pb-chiusa gx-vetro" aria-labelledby="pb-t-chiusa">
      <div className="pb-chiusa__testa">
        <span className="pb-chiusa__segno" aria-hidden="true"><i /><i /></span>
        <div>
          <h2 id="pb-t-chiusa">Da fare adesso</h2>
          <p>{!caricato ? '…' : attive.length ? `La chiusa del fiume: ${attive.length === 1 ? 'una cosa aspetta' : attive.length + ' cose aspettano'} te.` : 'La chiusa è aperta: niente aspetta te.'}</p>
        </div>
      </div>
      {attive.length > 0 && (
        <ul className="pb-chiusa__voci">
          {attive.map(v => (
            <li key={v.k} className={'pb-chiusa__voce' + (v.k === 'giac' ? ' pb-chiusa__voce--problema' : '')}>
              <b><Conta v={v.n}>{n => fmtN.format(n)}</Conta></b>
              <div>
                <span className="pb-chiusa__nome">{v.nome}</span>
                <span className="pb-chiusa__frase">{v.importo > 0 ? <>per <Euro v={v.importo} />{v.n > 1 ? ' in tutto' : ''}</> : v.frase}</span>
              </div>
              <a className="pb-verbo" href={v.href}>{v.verbo}<Icona id="i-chevron" /></a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
