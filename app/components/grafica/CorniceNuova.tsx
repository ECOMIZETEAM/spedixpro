'use client'
// La cornice della grafica nuova (v11): il menu a sinistra e la barra in alto, in vetro sul magazzino 3D.
// Non decide niente da sola: le voci arrivano da Layout già filtrate coi permessi di oggi (puoVedere), i pallini
// rossi sono gli stessi conteggi, credito, SMS, supporto, campanella e profilo sono i componenti di oggi. Così la
// grafica nuova non può far vedere a nessuno una voce o un numero che con la grafica di oggi non vede.
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import FlashBanner from '../FlashBanner'
import Moovy from '../Moovy'
import MenuProfilo from '../MenuProfilo'
import CampanellaNotifiche from '../CampanellaNotifiche'
import SupportoButton from '../SupportoButton'
import ContiTendina from '../ContiTendina'
import { FoglioIcone, Icona, ICONA_VOCE } from './icone'
import { GraficaNuova } from './contesto'
import Sondaggio from './Sondaggio'
import { PAGINE_PROVA } from './pagine-prova'
import './grafica.css'

export type VoceMenu = { label: string; href?: string; external?: boolean; sub?: { label: string; href: string }[] }
export type Pallino = { n: number; title?: string }

// I gruppi del menu approvato (v11): stesse voci e stesso ordine di oggi, con un titoletto ogni tanto. Il titoletto
// compare davanti alla prima voce VISIBILE del gruppo (chi non ha i permessi di Dal mio network vede «Rete» davanti
// ad Assistenza Clienti).
const GRUPPO: Record<string, string> = {
  'Dal mio network': 'Rete', 'Assistenza Clienti': 'Rete',
  'Il mio listino': 'Listini e clienti', 'Listini Prezzi': 'Listini e clienti', 'Preventivi': 'Listini e clienti', 'Clienti': 'Listini e clienti',
  'Logistica': 'Magazzino', 'Autisti e Consegne': 'Magazzino', 'Consumabili': 'Magazzino', 'Circuito interno': 'Magazzino',
  'Fatture': 'Soldi', 'Lista Movimenti': 'Soldi', 'Costi di gestione': 'Soldi', 'Abbonamento': 'Soldi',
  'Reports': 'Analisi', 'Statistiche': 'Analisi',
  'Registro Attività': 'Sistema', 'Controllo Giacenze': 'Sistema', 'Centrale di Controllo': 'Sistema', 'Abbonamenti API': 'Sistema',
  'Account Demo': 'Sistema', 'Impostazioni': 'Sistema', 'Centro Notifiche': 'Sistema', 'Documentazione': 'Sistema',
}

// Lorenzo 18/11: «Circuito interno va su Magazzino; Prezzi POD si chiama Listini POD e va sotto Listini Prezzi». Solo nel
// menu nuovo: le voci arrivano dal menu di oggi (Layout, già filtrate coi permessi) e qui si spostano, così con la grafica
// di oggi il menu resta identico.
function riordina(nav: VoceMenu[], ruolo?: string, prova?: boolean): VoceMenu[] {
  const voci = nav.map(v => v.sub ? { ...v, sub: [...v.sub] } : v)
  // la Live View (anteprima 18/11) subito sotto la Dashboard; non per l'agente, che ha la sua plancia confinata
  // (non nella prova per tutti: finché i numeri sono di prova, un master li prenderebbe per veri)
  if ((ruolo || '').toLowerCase() !== 'agente' && !prova) voci.unshift({ label: 'Live View', href: '/dashboard/live' })
  // Listini POD sotto Listini Prezzi; chi non vede Listini Prezzi la trova dov'era, col nome nuovo
  const assist = voci.find(v => v.label === 'Assistenza Clienti'), listini = voci.find(v => v.label === 'Listini Prezzi')
  const pod = assist?.sub?.find(s => s.href === '/dashboard/assistenza/prezzi-pod')
  if (assist?.sub && pod) {
    const rinominata = { ...pod, label: 'Listini POD' }
    if (listini?.sub) { assist.sub = assist.sub.filter(s => s !== pod); listini.sub.push(rinominata) }
    else assist.sub = assist.sub.map(s => s === pod ? rinominata : s)
  }
  // Circuito interno in fondo al Magazzino (se il Magazzino non si vede, dopo Listini e clienti; se no resta dov'era)
  const i = voci.findIndex(v => v.label === 'Circuito interno')
  if (i >= 0) {
    const [circuito] = voci.splice(i, 1)
    let dopo = -1
    voci.forEach((v, k) => { if (GRUPPO[v.label] === 'Magazzino') dopo = k })
    if (dopo < 0) voci.forEach((v, k) => { if (GRUPPO[v.label] === 'Listini e clienti') dopo = k })
    voci.splice(dopo >= 0 ? dopo + 1 : i, 0, circuito)
  }
  return voci
}

// le pagine già pronte nella grafica nuova (le stesse del proxy, middleware.ts)

// i gruppi del menu del portale cliente (le voci sono quelle di ClienteNav)
// (nell'ordine in cui le voci arrivano: un gruppo spezzato in due farebbe comparire due volte lo stesso titoletto)
const GRUPPO_CLIENTE: Record<string, string> = {
  'SMS': 'Servizi', 'Assistenza': 'Servizi',
  'Reports': 'Analisi',
  'Mio Account': 'Account', 'Impostazioni': 'Account',
  'Documentazione': 'Aiuto', 'Introduzione': 'Aiuto',
}

const RUOLI: Record<string, string> = { master: 'master', admin: 'amministratore', operatore: 'operatore', agente: 'agente', cliente: 'portale cliente' }

// Auto: la luce dell'ora, come nella prova (notte prima delle 7 e dopo le 18:12, mattina fino alle 10, giorno fino alle 17)
export function luceDellOra(d = new Date()) {
  const m = d.getHours() * 60 + d.getMinutes()
  if (m < 7 * 60 || m >= 18 * 60 + 12) return 'notte'
  if (m < 10 * 60) return 'mattina'
  if (m < 17 * 60) return 'giorno'
  return 'tramonto'
}
type Scelta = 'auto' | 'giorno' | 'notte'

export default function CorniceNuova({ children, user, path, nav: navDiOggi, portale = 'master', pallinoVoce, pallinoSotto, credito, mostraSms, isMobile, vociProfilo }: {
  children: React.ReactNode
  user?: { nome?: string; ruolo?: string; brandLogo?: string | null; brandNome?: string | null; graficaScelta?: string; graficaLuce?: string; graficaEntrata?: boolean; graficaProposta?: string; graficaProva?: boolean }
  path: string
  nav: VoceMenu[]
  // il portale cliente (19/11) usa la stessa cornice: cambiano la pagina di partenza, i gruppi e dove porta il credito
  portale?: 'master' | 'cliente'
  pallinoVoce: (label: string, href?: string) => Pallino | null
  pallinoSotto: (href: string) => number
  credito: { mostra: boolean; rete: number; reteLabel?: string | null; conti: number } | null
  mostraSms: boolean
  isMobile: boolean
  vociProfilo: { label: string; href: string; icona: string }[]
}) {
  const cliente = portale === 'cliente'
  const home = cliente ? '/cliente/dashboard' : '/dashboard'
  const nav = cliente ? navDiOggi : riordina(navDiOggi, user?.ruolo, !!user?.graficaProva)
  const GRUPPI = cliente ? GRUPPO_CLIENTE : GRUPPO
  // ── la prova per tutti (Lorenzo 19/11): si provano solo Dashboard ed Elenco spedizioni, con «?nuova=1» nell'indirizzo.
  // Le altre voci si vedono (anche i sottomenu) ma non si cliccano: «arrivano presto».
  const prova = !!user?.graficaProva
  const inProva = (href?: string) => !!href && PAGINE_PROVA.has(href)
  const vai = (href?: string) => (prova && inProva(href) ? href + '?nuova=1' : href)
  const spenta = (href?: string) => prova && !inProva(href)
  const [voto, setVoto] = useState<null | 'voto' | 'esci'>(null)
  // i collegamenti dentro le pagine (es. dalla Dashboard all'Elenco) restano nella prova: al clic si aggiunge «?nuova=1»
  useEffect(() => {
    if (!prova) return
    const clic = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank') return
      const u = new URL(a.href, window.location.href)
      if (u.origin !== window.location.origin || !PAGINE_PROVA.has(u.pathname) || u.searchParams.get('nuova') === '1') return
      u.searchParams.set('nuova', '1'); a.href = u.toString()
    }
    document.addEventListener('click', clic, true)
    return () => document.removeEventListener('click', clic, true)
  }, [prova])
  // ── Auto / Giorno / Notte: la scelta di chi guarda sta nel biscotto mx_tema, così il server disegna già la pagina
  // nella luce giusta (dashboard/layout.tsx) e qui si parte da quella: server e browser disegnano la stessa pagina ──
  const [scelta, setScelta] = useState<Scelta>(() => (['auto', 'giorno', 'notte'].includes(user?.graficaScelta || '') ? user!.graficaScelta : 'auto') as Scelta)
  const [luce, setLuce] = useState<string>(user?.graficaLuce || 'giorno')
  const tema = luce === 'notte' ? 'notte' : 'giorno'
  // la luce di una scelta: di giorno il plastico bianco («argilla»), di notte la notte
  const luceDi = (s: Scelta) => { const l = s === 'auto' ? luceDellOra() : s; return l === 'notte' ? 'notte' : 'argilla' }
  useEffect(() => {
    const metti = () => setLuce(luceDi(scelta))
    metti()
    const t = setInterval(metti, 60000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scelta])
  // le due luci pronte in memoria: al cambio, la foto nuova c'è già e il passaggio non mostra un buco
  useEffect(() => { for (const l of ['argilla', 'notte']) { const im = new Image(); im.src = `/grafica/luce-${l}.webp` } }, [])
  // anche su <html>: i menu a tendina (campanella, profilo, conti) si aprono in fondo alla pagina, fuori dalla cornice
  useEffect(() => {
    const r = document.documentElement
    r.dataset.grafica = 'nuova'; r.dataset.luce = luce; r.dataset.tema = tema
  }, [luce, tema])
  useEffect(() => () => { const r = document.documentElement; delete r.dataset.grafica; delete r.dataset.luce; delete r.dataset.tema }, [])
  // Il passaggio fra giorno e notte: la luce nuova si allarga in un cerchio dall'icona premuta (View Transitions;
  // dove il browser non le ha, o con meno movimento, cambia e basta)
  const scegli = (s: Scelta, e?: React.MouseEvent) => {
    document.cookie = `mx_tema=${s}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
    const nuova = luceDi(s), d: any = document
    if (nuova === luce || !d.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) { setScelta(s); setLuce(nuova); return }
    const x = e ? e.clientX : innerWidth - 200, y = e ? e.clientY : 40, r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
    const r0 = document.documentElement
    r0.classList.add('vt-tema')
    const vt = d.startViewTransition(() => {
      flushSync(() => { setScelta(s); setLuce(nuova) })
      r0.dataset.luce = nuova; r0.dataset.tema = nuova === 'notte' ? 'notte' : 'giorno'
    })
    vt.ready.then(() => r0.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] }, { duration: 900, easing: 'cubic-bezier(.65,0,.35,1)', pseudoElement: '::view-transition-new(root)' })).catch(() => {})
    vt.finished.finally(() => r0.classList.remove('vt-tema'))
  }

  // ── il menu: una sola voce aperta alla volta, all'apertura quella della pagina in cui si è ──
  const dentro = (href?: string) => !!href && (path === href || path.startsWith(href + '/'))
  const [aperta, setAperta] = useState<string | null>(() => {
    // vince l'indirizzo più lungo: /dashboard/assistenza/prezzi-pod (Listini POD, sotto Listini Prezzi) comincia come
    // /dashboard/assistenza dei Ticket, e senza questo si apriva Assistenza Clienti
    let meglio: { label: string; n: number } | null = null
    for (const x of nav) if (x.sub) for (const h of [x.href, ...x.sub.map(s => s.href)]) {
      if (h && dentro(h) && (!meglio || h.length > meglio.n)) meglio = { label: x.label, n: h.length }
    }
    return meglio ? meglio.label : null
  })
  const [chiuso, setChiuso] = useState(false)
  const [drawer, setDrawer] = useState(false)
  useEffect(() => { try { if (localStorage.getItem('spx_sidebar_chiusa') === '1') setChiuso(true) } catch {} }, [])
  useEffect(() => { setDrawer(false) }, [path])
  const menu = () => {
    if (isMobile) { setDrawer(true); return }
    setChiuso(v => { const n = !v; try { localStorage.setItem('spx_sidebar_chiusa', n ? '1' : '0') } catch {}; return n })
  }

  // ⌘K / Ctrl+K apre Moovy, come nella prova
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); window.dispatchEvent(new CustomEvent('moovy:apri')) } }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])

  const plancia = path === home
  const iniziali = (user?.nome || 'Admin').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase()
  let gruppoPrima: string | undefined

  return (
    <div className="gx" data-grafica="nuova" data-luce={luce} data-tema={tema}>
      {/* le transizioni fra le pagine del portale (stessa origine, navigazione intera): menu e barra in alto restano
          fermi, la pagina vecchia scivola via e la nuova sale. Solo con la grafica nuova: è in questo componente */}
      <style>{'@view-transition { navigation: auto; }'}</style>
      <FoglioIcone />
      {/* il magazzino dell'ora, sfocato: sulle pagine di lavoro è solo la luce dietro il vetro */}
      <div className="gx-fondo" aria-hidden="true"><img src={`/grafica/luce-${luce}.webp`} alt="" /></div>

      {isMobile && drawer && <div className="gx-velo-menu" onClick={() => setDrawer(false)} />}
      <nav className={'gx-lato gx-vetro' + (!isMobile && chiuso ? ' gx-lato--chiuso' : '') + (isMobile && drawer ? ' gx-lato--aperto' : '')} aria-label="Menu">
        <a className={'gx-marca' + (user?.brandLogo ? ' gx-marca--logo' : '')} href={vai(home)}>
          {user?.brandLogo ? <img className="gx-marca__logo" src={user.brandLogo} alt={user?.brandNome || 'Logo'} /> : (
            <>
              <span className="gx-marca__v">{(user?.brandNome || 'M').substring(0, 1).toUpperCase()}</span>
              <span style={{ minWidth: 0 }}><b>{user?.brandNome || 'MoovExpress'}</b><small>{RUOLI[(user?.ruolo || '').toLowerCase()] || 'utente'}</small></span>
            </>
          )}
        </a>
        <div className="gx-menu">
          <a className={'gx-voce' + (plancia ? ' gx-voce--su' : '')} href={vai(home)} aria-current={plancia ? 'page' : undefined}><Icona id="i-plancia" />Dashboard</a>
          {nav.map(v => {
            const gruppo = GRUPPI[v.label]
            const titolo = gruppo && gruppo !== gruppoPrima ? gruppo : null
            gruppoPrima = gruppo
            const su = dentro(v.href) && !plancia
            const icona = ICONA_VOCE[v.label] || 'i-pacco'
            const p = pallinoVoce(v.label, v.href)
            if (v.sub && v.sub.length) {
              const apri = aperta === v.label
              return (
                <div key={v.label}>
                  {titolo && <div className="gx-gruppo">{titolo}</div>}
                  <button type="button" className={'gx-voce' + (su ? ' gx-voce--su' : '') + (apri ? ' gx-voce--aperta' : '')} aria-expanded={apri}
                    onClick={(e) => { const el = e.currentTarget; setAperta(apri ? null : v.label); if (!apri) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80) }}>
                    <Icona id={icona} />{v.label}
                    {!apri && p && p.n > 0 && <span className="gx-conta" title={p.title}>{p.n}</span>}
                    <Icona id="i-chevron" className="gx-freccia" />
                  </button>
                  {apri && (
                    <div className="gx-rami">
                      {v.sub.map(s => {
                        const n = pallinoSotto(s.href)
                        if (spenta(s.href)) return <span key={s.href} className="gx-spenta" aria-disabled="true" title="Arriva presto nella nuova versione">{s.label}</span>
                        return <a key={s.href} href={vai(s.href)} className={path === s.href ? 'gx-su' : undefined} aria-current={path === s.href ? 'page' : undefined}>{s.label}{n > 0 && <span className="gx-conta">{n}</span>}</a>
                      })}
                    </div>
                  )}
                </div>
              )
            }
            return (
              <div key={v.label}>
                {titolo && <div className="gx-gruppo">{titolo}</div>}
                {spenta(v.href) ? (
                  <span className="gx-voce gx-voce--spenta" aria-disabled="true" title="Arriva presto nella nuova versione"><Icona id={icona} />{v.label}</span>
                ) : (
                <a className={'gx-voce' + (su ? ' gx-voce--su' : '')} href={vai(v.href)} aria-current={su ? 'page' : undefined} {...(v.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                  <Icona id={icona} />{v.label}
                  {p && p.n > 0 && <span className="gx-conta" title={p.title}>{p.n}</span>}
                </a>
                )}
              </div>
            )
          })}
        </div>
        <div className="gx-piede">
          <a className="gx-voce" href="/api/auth/logout"><Icona id="i-esci" />Esci</a>
        </div>
      </nav>

      <div className="gx-destra">
        {prova && (
          <div className="gx-prova" role="region" aria-label="Prova della nuova versione">
            <span className="gx-prova__punto" aria-hidden="true" />
            <span className="gx-prova__testo"><b>Stai provando la nuova MoovExpress.</b> Per ora sono pronte la Dashboard, l'Elenco spedizioni e la Nuova spedizione: le altre voci arrivano presto.</span>
            <button type="button" className="gx-prova__voto" onClick={() => setVoto('voto')}>Lascia il tuo voto</button>
            <button type="button" className="gx-prova__esci" onClick={() => setVoto('esci')}>Torna alla versione attuale<Icona id="i-chevron" /></button>
          </div>
        )}
        {prova && voto && <Sondaggio pagina={path} uscita={voto === 'esci'} chiudi={() => setVoto(null)} />}
        <header className="gx-alto">
          <button type="button" className="gx-tasto" onClick={menu} aria-label={isMobile ? 'Menu' : (chiuso ? 'Apri il menu' : 'Chiudi il menu')} title={isMobile ? 'Menu' : (chiuso ? 'Apri il menu' : 'Chiudi il menu')}><Icona id="i-menu" /></button>
          <button type="button" className="gx-cerca gx-vetro gx-pillola" onClick={() => window.dispatchEvent(new CustomEvent('moovy:apri'))} title="Moovy, l'assistente">
            <span className="gx-cerca__moovy"><Icona id="i-moovy" /></span>
            <span className="gx-cerca__testo">Chiedi a Moovy</span>
            <kbd>⌘K</kbd>
          </button>
          <span className="gx-spazio" />
          {credito?.mostra && credito.conti > 1 && <ContiTendina conti={credito.conti} compatto={isMobile} aspetto="nuova" />}
          {credito?.mostra && !(credito.conti > 1) && (
            <a className={'gx-tasto gx-vetro gx-pillola gx-credito' + (Number(credito.rete) < 0 ? ' gx-credito--meno' : '')} href={cliente ? '/cliente/movimenti' : '/dashboard/movimenti'} title="Il tuo credito — vai ai movimenti">
              <Icona id="i-carta" />{!isMobile && <small>{credito.reteLabel || 'Credito'}</small>}
              <b>€ {Number(credito.rete || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
            </a>
          )}
          <div className="gx-gruppo-tasti gx-vetro gx-pillola">
            {mostraSms && <a className="gx-tasto" href="/dashboard/reports/storico-sms" title="SMS — credito e acquisto"><Icona id="i-messaggio" />{!isMobile && <span className="gx-solo-largo">SMS</span>}</a>}
            <SupportoButton compatto={isMobile} aspetto="nuova" />
          </div>
          <div className="gx-gruppo-tasti gx-aspetto gx-vetro gx-pillola gx-solo-largo" role="group" aria-label="Aspetto">
            {/* solo le icone (Lorenzo 27/10: «lascerei solo auto, sole e luna»); la parola resta per chi passa sopra e
                per i lettori di schermo */}
            <button type="button" aria-pressed={scelta === 'auto'} onClick={e => scegli('auto', e)} title="Auto: segue l'ora del giorno" aria-label="Auto"><Icona id="i-auto" /></button>
            <button type="button" aria-pressed={scelta === 'giorno'} onClick={e => scegli('giorno', e)} title="Giorno" aria-label="Giorno"><Icona id="i-sole" /></button>
            <button type="button" aria-pressed={scelta === 'notte'} onClick={e => scegli('notte', e)} title="Notte" aria-label="Notte"><Icona id="i-luna" /></button>
          </div>
          <div className="gx-gruppo-tasti gx-vetro gx-pillola">
            <CampanellaNotifiche aspetto="nuova" />
            <MenuProfilo nome={user?.nome} ruolo={user?.ruolo} voci={vociProfilo} compatto={isMobile} aspetto="nuova" iniziali={iniziali} />
          </div>
        </header>
        <main className="gx-pagina">
          <FlashBanner />
          <GraficaNuova.Provider value={{ attiva: true, ruolo: (user?.ruolo || '').toLowerCase(), luce, tema, chi: `${user?.brandNome || ''}|${user?.nome || ''}`, entrata: !!user?.graficaEntrata, proposta: user?.graficaProposta || '' }}>{children}</GraficaNuova.Provider>
        </main>
      </div>
      <Moovy senzaPulsante />
    </div>
  )
}
