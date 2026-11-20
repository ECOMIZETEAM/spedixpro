'use client'
// IN FONDO (proposta B): la foce (dove sfociano le spedizioni, per provincia), la portata dei mesi, la rete, i clienti
// con più resi e le giacenze da risolvere. Rotte: /api/dashboard/destinazioni, /api/dashboard (statsMensili, numeri
// della rete), /api/resi/analisi, /api/spedizioni/lista in giacenza.
import { useMemo, useRef } from 'react'
import { Icona } from '../../icone'
import { Conta } from '../../movimento'
import { euroPiano, fmtN, MESI, usaJson } from '../../PlanciaNuova'
import { vettoreFisico } from '@/lib/vettore'
import { corsia, nastro, useLarghezza, useParticelle, usePartenza, type Stazione, type Tinte } from './particelle'
import { PROVINCE, TECNICI, Testa, virgola } from './comuni'


// ── LA FOCE: il fiume si apre a ventaglio verso le province (le prime dieci, poi tutte le altre insieme, poi l'estero).
// Lo spessore di ogni ramo è proporzionale alle spedizioni degli ultimi 30 giorni ──
export function Foce({ tinte }: { tinte: Tinte | null }) {
  const dati = usaJson<any>('/api/dashboard/destinazioni')
  const box = useRef<HTMLDivElement>(null), tela = useRef<HTMLCanvasElement>(null)
  // sotto i 600 px (il telefono: qui si misura la lastra, margini compresi) la foce è una classifica con le barre (FoceLista): a 700 px da scorrere di lato le
  // province restavano fuori dallo schermo e si vedeva solo il ventaglio (20/11)
  const misura = useLarghezza(box), lista = !!misura && misura < 600, W = misura && !lista ? Math.max(misura, 700) : 0
  // le province (le prime dieci, poi le altre insieme, poi l'estero): le stesse per il ventaglio e per la classifica
  const base = useMemo(() => {
    if (!dati) return null
    const prov: any[] = (Array.isArray(dati.province) ? dati.province : []).slice().sort((a: any, b: any) => b.n - a.n)
    const italia = Number(dati.totale || 0), estero = Math.max(0, Number(dati.totalePaesi || 0) - italia)
    if (!italia && !estero) return { vuoto: true as const, rami: [], italia, estero }
    const prime = prov.slice(0, 10), resto = prov.slice(10), altre = resto.reduce((a, p) => a + Number(p.n || 0), 0)
    const rami = [
      ...prime.map((p, i) => ({ k: p.sigla, rango: String(i + 1).padStart(2, '0'), nome: PROVINCE[p.sigla] || p.sigla, sigla: p.sigla, n: Number(p.n || 0), tipo: 'prov' })),
      ...(altre > 0 ? [{ k: 'altre', rango: '', nome: `Altre ${fmtN.format(resto.length)} province`, sigla: '', n: altre, tipo: 'altre' }] : []),
      ...(estero > 0 ? [{ k: 'estero', rango: '', nome: 'Estero', sigla: '', n: estero, tipo: 'estero' }] : []),
    ]
    return { vuoto: false as const, rami, italia, estero }
  }, [dati])
  const G = useMemo(() => {
    if (!base || W < 560) return null
    if (base.vuoto) return { vuoto: true as const }
    const { rami, italia, estero } = base
    const tot = rami.reduce((a, r) => a + r.n, 0) || 1
    const H = Math.max(380, rami.length * 36 + 30), sopra = 14, sotto = 14, gap = 5, MIN = 31
    const libero = H - sopra - sotto - gap * (rami.length - 1)
    let s = libero / tot
    for (let i = 0; i < 4; i++) {
      const piccoli = rami.filter(r => r.n * s < MIN), grandi = rami.filter(r => r.n * s >= MIN).reduce((a, r) => a + r.n, 0)
      s = grandi > 0 ? Math.max(0.0001, (libero - piccoli.length * MIN) / grandi) : libero / tot
    }
    s = Math.min(s, (H - sopra - sotto) * 0.8 / tot)
    const RW = Math.min(380, Math.max(300, W * 0.33)), xT = Math.min(260, W * 0.22), xR = W - RW
    const tronco = tot * s, yT0 = (H - tronco) / 2
    let y = sopra, acc = yT0
    const righe = rami.map(r => {
      const h = r.n * s, slot = Math.max(h, MIN), y0 = y + (slot - h) / 2
      const a: Stazione = { x: xT, a: acc, b: acc + h }, b: Stazione = { x: xR, a: y0, b: y0 + h }
      acc += h; const riga = { ...r, h, y: y + slot / 2, d: nastro([a, b]), st: [a, b] }
      y += slot + gap
      return riga
    })
    const corsie = righe.filter(r => r.h > 0).map(r => corsia(r.st, { neutro: r.tipo === 'estero' }))
    return { vuoto: false as const, W, H, xT, xR, righe, corsie, tronco, yT0, italia, estero, tot }
  }, [base, W])
  const g = G && !G.vuoto ? G : null
  const partenza = usePartenza(!!g, 300)
  useParticelle(tela, g?.corsie ?? null, { W: g?.W || 0, H: g?.H || 0, densita: 420, velocita: 46, partenza, tinte, x0: g?.xT || 0, x1: g?.xR || 1, massimo: 360 })
  return (
    <section className="pb-sez" aria-labelledby="pb-t-foce">
      <Testa id="pb-t-foce" occhiello="La foce" titolo={<>Dove <b>sfociano</b> le tue spedizioni</>}
        frase="Le province che ricevono di più negli ultimi 30 giorni: ogni ramo è largo quanto le spedizioni che ci arrivano." />
      <div className="pb-lastra gx-vetro pb-foce" ref={box}>
        {!dati ? <div className="pb-vuoto pb-vuoto--alto">…</div> : base?.vuoto ? <div className="pb-vuoto pb-vuoto--alto">Nessuna spedizione negli ultimi 30 giorni.</div> : lista && base ? <FoceLista {...base} /> : g && (
          <div className="pb-foce__tela" style={{ height: g.H }}>
            <svg width={g.W} height={g.H} viewBox={`0 0 ${g.W} ${g.H}`} role="img" aria-label={'Spedizioni per provincia, ultimi 30 giorni: ' + g.righe.map(r => `${r.nome} ${r.n}`).join(', ')}>
              <defs>
                <linearGradient id="pb-g-foce" gradientUnits="userSpaceOnUse" x1={g.xT} x2={g.xR} y1="0" y2="0"><stop offset="0" className="pb-st pb-st--3" /><stop offset="1" className="pb-st pb-st--foce1" /></linearGradient>
                <linearGradient id="pb-g-altre" gradientUnits="userSpaceOnUse" x1={g.xT} x2={g.xR} y1="0" y2="0"><stop offset="0" className="pb-st pb-st--2" /><stop offset="1" className="pb-st pb-st--altre1" /></linearGradient>
              </defs>
              {g.righe.map(r => <path key={r.k} d={r.d} fill={r.tipo === 'prov' ? 'url(#pb-g-foce)' : 'url(#pb-g-altre)'} className={'pb-foce__ramo pb-foce__ramo--' + r.tipo}><title>{r.nome}: {fmtN.format(r.n)}</title></path>)}
              <rect className="pb-nodo pb-nodo--incassato" x={g.xT - 2} y={g.yT0} width="4" height={g.tronco} rx="2" />
            </svg>
            <canvas ref={tela} className="pb-foce__colli" style={{ width: g.W, height: g.H }} aria-hidden="true" />
            <div className="pb-foce__tronco" style={{ width: g.xT - 22, top: g.H / 2 }}>
              <b><Conta v={g.italia}>{n => fmtN.format(n)}</Conta></b>
              <span>in Italia</span>
              {g.estero > 0 && <em>e {fmtN.format(g.estero)} all&apos;estero</em>}
            </div>
            <ol className="pb-foce__righe" style={{ left: g.xR + 14 }}>
              {g.righe.map(r => (
                <li key={r.k} className={'pb-foce__riga pb-foce__riga--' + r.tipo} style={{ top: r.y }}>
                  <span className="pb-foce__rango">{r.rango}</span>
                  <span className="pb-foce__nome">{r.nome}{r.sigla && <small>{r.sigla}</small>}</span>
                  <b>{fmtN.format(r.n)}</b>
                  <em>{r.tipo === 'estero' ? '' : virgola(r.n / (g.italia || 1) * 100) + '%'}</em>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  )
}

// ── la foce sul telefono: l'Italia (e l'estero) in testa, poi la classifica con una barra per provincia, lunga quanto
// le sue spedizioni rispetto alla prima ──
function FoceLista({ rami, italia, estero }: { rami: { k: string; rango: string; nome: string; sigla: string; n: number; tipo: string }[]; italia: number; estero: number }) {
  const max = Math.max(1, ...rami.map(r => r.n))
  return (
    <div className="pb-fl">
      <div className="pb-fl__tronco">
        <b><Conta v={italia}>{n => fmtN.format(n)}</Conta></b>
        <span>in Italia</span>
        {estero > 0 && <em>e {fmtN.format(estero)} all&apos;estero</em>}
      </div>
      <ol className="pb-fl__righe">
        {rami.map(r => (
          <li key={r.k} className={'pb-fl__riga pb-fl__riga--' + r.tipo} style={{ ['--q' as any]: Math.max(1.5, r.n / max * 100).toFixed(1) + '%' }}>
            <span className="pb-fl__rango">{r.rango}</span>
            <span className="pb-fl__nome">{r.nome}{r.sigla && <small>{r.sigla}</small>}</span>
            <b>{fmtN.format(r.n)}</b>
            <em>{r.tipo === 'estero' ? '' : virgola(r.n / (italia || 1) * 100) + '%'}</em>
            <i className="pb-fl__barra" aria-hidden="true" />
          </li>
        ))}
      </ol>
    </div>
  )
}

// statsMensili porta il mese all'inglese («Jul 26», dalla funzione del database): qui in italiano
const INGLESE: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
const meseItaliano = (m: any) => { const s = String(m || '').trim(), i = INGLESE[s.slice(0, 3).toLowerCase()]; return i === undefined ? s.toLowerCase() : MESI[i] }

// ── LA PORTATA: il fiume mese per mese, largo quanto le spedizioni di quel mese (il mese in corso fino a oggi) ──
export function Portata({ mesi, tinte }: { mesi: any[] | null; tinte: Tinte | null }) {
  const box = useRef<HTMLDivElement>(null), tela = useRef<HTMLCanvasElement>(null)
  const W = useLarghezza(box)
  // sul telefono (sotto i 560 px) gli ultimi tre mesi: sei mesi in 330 px si accavallavano, e a 600 px da scorrere di
  // lato il terzo mese restava tagliato dal bordo (20/11)
  const ultimi = (mesi || []).slice(W && W < 560 ? -3 : -6)
  const chiave = JSON.stringify(ultimi.map(m => m.totale))
  const G = useMemo(() => {
    if (!ultimi.length || W < 300) return null
    const H = 250, cy = 128, T = 96, pad = 64, n = ultimi.length
    const max = Math.max(1, ...ultimi.map(m => Number(m.totale || 0)))
    const X = (i: number) => n === 1 ? W / 2 : pad + i * (W - pad * 2) / (n - 1)
    const sp = (m: any) => Math.max(3, Number(m.totale || 0) / max * T)
    const st: Stazione[] = [{ x: 4, a: cy - sp(ultimi[0]) / 2, b: cy + sp(ultimi[0]) / 2 }, ...ultimi.map((m, i) => ({ x: X(i), a: cy - sp(m) / 2, b: cy + sp(m) / 2 }))]
    const u = ultimi[n - 1]
    st.push({ x: W - 4, a: cy - sp(u) / 2, b: cy + sp(u) / 2 })
    return { W, H, cy, X, sp, d: nastro(st), corsie: [corsia(st)] }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiave, W])
  const partenza = usePartenza(!!G, 300)
  useParticelle(tela, G?.corsie ?? null, { W: G?.W || 0, H: G?.H || 0, densita: 380, velocita: 42, partenza, tinte, x0: 0, x1: G?.W || 1, massimo: 220 })
  return (
    <section className="pb-sez pb-scheda gx-vetro pb-portata" aria-labelledby="pb-t-portata">
      <div className="pb-scheda__testa"><h3 id="pb-t-portata">La portata, mese per mese</h3><span>spedizioni create, il mese in corso fino a oggi</span></div>
      <div className="pb-portata__scorri">
      <div className="pb-portata__tela" ref={box} style={{ height: G?.H || 250 }}>
        {!mesi ? <div className="pb-vuoto">…</div> : !ultimi.length ? <div className="pb-vuoto">Ancora nessun mese da mostrare.</div> : G && <>
          <svg width={G.W} height={G.H} viewBox={`0 0 ${G.W} ${G.H}`} role="img" aria-label={'Spedizioni per mese: ' + ultimi.map(m => `${meseItaliano(m.mese)} ${m.totale}`).join(', ')}>
            <defs>
              <linearGradient id="pb-g-portata" gradientUnits="userSpaceOnUse" x1="0" x2={G.W} y1="0" y2="0"><stop offset="0" className="pb-st pb-st--1" /><stop offset="1" className="pb-st pb-st--3" /></linearGradient>
            </defs>
            <path d={G.d} fill="url(#pb-g-portata)" className="pb-portata__nastro" />
            {ultimi.map((m, i) => <line key={i} x1={G.X(i)} x2={G.X(i)} y1={G.cy - G.sp(m) / 2 - 10} y2={G.cy + G.sp(m) / 2 + 10} className="pb-portata__tacca" />)}
          </svg>
          <canvas ref={tela} className="pb-portata__colli" style={{ width: G.W, height: G.H }} aria-hidden="true" />
          {ultimi.map((m, i) => (
            <div key={i} className={'pb-mese' + (i === ultimi.length - 1 ? ' pb-mese--ora' : '')} style={{ left: G.X(i), ['--su' as any]: (G.cy - G.sp(m) / 2 - 16) + 'px', ['--giu' as any]: (G.cy + G.sp(m) / 2 + 16) + 'px' }}>
              <b><Conta v={Number(m.totale || 0)}>{n => fmtN.format(n)}</Conta></b>
              <span>{meseItaliano(m.mese)}{i === ultimi.length - 1 ? ', fino a oggi' : ''}<em>{euroPiano(Number(m.importo || 0))}</em></span>
            </div>
          ))}
        </>}
      </div>
      </div>
    </section>
  )
}

// ── LA RETE: da sempre ──
export function Rete({ data }: { data: any }) {
  const tc = data?.topCorriere
  let corriere = String(tc?.nome || '').trim()
  if (TECNICI.test(corriere)) { corriere = vettoreFisico({ nome_contratto: corriere }); if (TECNICI.test(corriere)) corriere = '' }
  const numeri = [
    { v: Number(data?.spedizioniTotali || 0), l: 'spedizioni da sempre', ic: 'i-pacco' },
    { v: Number(data?.clientiTotali || 0), l: 'clienti', ic: 'i-clienti' },
    { v: Number(data?.sottomaster || 0), l: 'sotto-master', ic: 'i-rete' },
  ]
  return (
    <section className="pb-sez pb-scheda gx-vetro pb-rete" aria-labelledby="pb-t-rete">
      <div className="pb-scheda__testa"><h3 id="pb-t-rete">La rete</h3><span>da sempre</span></div>
      <ul className="pb-rete__numeri">
        {numeri.map(n => <li key={n.l}><Icona id={n.ic} /><b>{data ? <Conta v={n.v}>{x => fmtN.format(x)}</Conta> : '…'}</b><span>{n.l}</span></li>)}
      </ul>
      <div className="pb-rete__corriere">
        <Icona id="i-camion" />
        <div><span>Il corriere più usato</span><b>{data ? (corriere || 'Nessun dato') : '…'}</b></div>
        <em>{tc?.n ? `${fmtN.format(Number(tc.n))} spedizioni` : ''}</em>
      </div>
    </section>
  )
}

// ── I clienti con più resi negli ultimi 90 giorni ──
export function Resi() {
  const analisi = usaJson<any>('/api/resi/analisi?giorni=90&riepilogo=1')
  const peggiori: any[] = analisi?.peggiori || []
  const max = Math.max(1, ...peggiori.map(c => Number(c.pct || 0)))
  return (
    <section className="pb-sez pb-scheda gx-vetro pb-resi" aria-labelledby="pb-t-resi">
      <div className="pb-scheda__testa"><h3 id="pb-t-resi">I clienti con più resi</h3><a href="/dashboard/resi/analisi">Analisi resi<Icona id="i-chevron" /></a></div>
      <p className="pb-scheda__frase">{analisi ? <>Negli ultimi 90 giorni la rete ha {fmtN.format(Number(analisi.totale?.resi || 0))} resi su {fmtN.format(Number(analisi.totale?.partite || 0))} partite: il <b>{virgola(Number(analisi.totale?.pct || 0))}%</b>.</> : '…'}</p>
      {peggiori.length ? (
        <ul className="pb-resi__righe">
          {peggiori.map((c: any) => (
            <li key={c.id}>
              <span className="pb-resi__nome"><span>{c.livello === 'rosso' && <i className="pb-resi__allarme" title="sopra la soglia di allarme" />}{c.nome}</span><em>{fmtN.format(Number(c.resi || 0))} resi su {fmtN.format(Number(c.partite || 0))} partite</em></span>
              <span className="pb-resi__barra"><i style={{ width: Math.min(100, Number(c.pct || 0) / max * 100) + '%' }} /></span>
              <b>{virgola(Number(c.pct || 0))}%</b>
            </li>
          ))}
        </ul>
      ) : <div className="pb-vuoto">{analisi ? 'Nessun cliente con resi da segnalare.' : '…'}</div>}
    </section>
  )
}

// ── Le giacenze da risolvere, ognuna col suo «Istruzioni» ──
export function Giacenze({ data }: { data: any }) {
  const giac = usaJson<any>('/api/spedizioni/lista?page=1&perPage=5&stato=in_giacenza')
  const righe: any[] = giac?.rows || []
  const gg = (s: string) => { const d = new Date(s); return isNaN(+d) ? '' : `${d.getDate()} ${MESI[d.getMonth()].slice(0, 3)}` }
  return (
    <section className="pb-sez pb-scheda gx-vetro pb-giac" aria-labelledby="pb-t-giac">
      <div className="pb-scheda__testa"><h3 id="pb-t-giac">Giacenze da risolvere</h3><a href="/dashboard/spedizioni/giacenze">{data ? `Tutte le ${fmtN.format(Number(data.inGiacenza || 0))}` : 'Tutte'}<Icona id="i-chevron" /></a></div>
      {righe.length ? (
        <ul className="pb-giac__righe">
          {righe.map((s: any, i: number) => (
            <li key={s.id || i}>
              <i className="pb-giac__segno" aria-hidden="true" />
              <div><b>{s.dest_nome}<span className="pb-giac__citta"> · {s.dest_citta}</span></b><em>ferma dal {gg(s.giacenza_data || s.created_at)}{s.giacenza_motivo ? ' · ' + String(s.giacenza_motivo).toLowerCase() : ''}</em></div>
              <a className="pb-verbo pb-verbo--chiaro" href="/dashboard/spedizioni/giacenze">Istruzioni<Icona id="i-chevron" /></a>
            </li>
          ))}
        </ul>
      ) : <div className="pb-vuoto">{giac ? 'Nessuna giacenza da risolvere: il fiume scorre.' : '…'}</div>}
    </section>
  )
}
