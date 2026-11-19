'use client'
// IL FIUME (proposta B): le spedizioni create negli ultimi 30 giorni, nello stato in cui sono oggi (statiUltimi30).
// Il fiume parte con tutte; a ogni tappa si stacca dal fondo un filo per quelle che sono ancora lì (una lingua che
// scende e si ferma) e, dove serve, un ramo per quelle uscite dal percorso (annullate, giacenza, non consegnate,
// resi). Quello che arriva in fondo sono le consegnate. Lo spessore è proporzionale ai numeri veri; i fili più
// sottili hanno uno spessore minimo per restare visibili (lo dice la didascalia).
// Gli strati stanno impilati dall'alto e si staccano sempre dal fondo: così ogni strato resta alla sua quota finché
// esce, e i nastri non si incrociano mai.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Conta } from '../../movimento'
import { fmtN } from '../../PlanciaNuova'
import { corsia, nastro, useLarghezza, useParticelle, usePartenza, type Stazione, type Tinte } from './particelle'

type Strato = { k: string; v: number; a: number; b: number }
const pct = (n: number, t: number) => (t ? Math.round(n / t * 1000) / 10 : 0).toString().replace('.', ',')

const TAPPE = [
  { k: 'lav', nome: 'In lavorazione', frase: 'pronte, aspettano il ritiro' },
  { k: 'sped', nome: 'Spedite', frase: 'affidate al corriere' },
  { k: 'tra', nome: 'In transito', frase: 'in viaggio fra gli hub' },
  { k: 'cons', nome: 'In consegna', frase: "sul furgone, l'ultimo tratto" },
]
const USCITE: Record<string, { nome: string; frase: string }> = {
  reso: { nome: 'Resi', frase: 'tornano al mittente' },
  nc: { nome: 'Non consegnate', frase: 'il corriere non è riuscito' },
  giac: { nome: 'In giacenza', frase: 'ferme, aspettano istruzioni' },
}

function geometria(s: Record<string, number>, W: number, Hb: number) {
  const n = (k: string) => Math.max(0, Number(s?.[k] || 0))
  const v: Record<string, number> = {
    ok: n('consegnata'), reso: n('reso_mittente'), nc: n('non_consegnato'), giac: n('in_giacenza'),
    cons: n('in_consegna'), tra: n('in_transito'), sped: n('spedita'), lav: n('in_lavorazione'),
    ann: n('annullata') + n('storno_richiesto') + n('annullamento_pending'),
  }
  const tot = Object.values(v).reduce((a, b) => a + b, 0)
  if (!tot || W < 300) return null
  const LT = 108, T = LT + 16, kpx = Hb / tot
  const spessore = (x: number) => x > 0 ? Math.max(1.6, x * kpx) : 0
  // dall'alto: le consegnate, poi chi esce alla fine, poi chi si ferma (dall'ultima tappa alla prima), le annullate in fondo
  const ordine = ['ok', 'reso', 'nc', 'giac', 'cons', 'tra', 'sped', 'lav', 'ann']
  const S: Record<string, Strato> = {}
  let y = T
  for (const k of ordine) { const w = spessore(v[k]); S[k] = { k, v: v[k], a: y, b: y + w }; y += w }
  const fondo = y
  const RC = Math.round(Math.min(260, Math.max(214, W * 0.21)))
  const xS = 40, xE = W - RC, xC = xS + 52, g = (xE - xC) / 5
  const X = [xC, xC + g, xC + 2 * g, xC + 3 * g, xC + 4 * g, xE]
  const D = 40, yB = fondo + 70
  const xa0 = xC + 0.04 * g, xa1 = xC + 0.6 * g
  const lingua = (i: number) => [X[i] - 0.3 * g, X[i] + 0.02 * g]
  const xu0 = X[4] + 0.16 * g
  // le righe delle uscite in fondo a destra: dall'alto resi, non consegnate, giacenza (il contrario degli strati: nessun incrocio)
  const righe: Record<string, number> = {}
  let r = S.ok.b + (Hb < 140 ? 32 : 40)
  const passo = Hb < 140 ? 36 : 42
  for (const k of ['reso', 'nc', 'giac']) if (v[k] > 0) { righe[k] = r; r += passo }

  // il corpo del fiume: la riva in alto è dritta, il fondo scende a gradini dove si stacca uno strato (il gradino
  // sta sotto l'attacco del nastro che si stacca, e non si vede)
  const rag = Math.min(18, (S.ok.b - T) / 2)
  const gradini: [number, number][] = [] // [x, quota del fondo a sinistra di x]
  if (v.ann) gradini.push([xa0, S.ann.b])
  ;['lav', 'sped', 'tra', 'cons'].forEach((k, i) => { if (v[k]) gradini.push([lingua(i + 1)[0], S[k].b]) })
  const ultimoUscita = ['giac', 'nc', 'reso'].find(k => v[k])
  if (ultimoUscita) gradini.push([xu0, S[ultimoUscita].b])
  let d = `M${xS} ${T} L${xE - rag} ${T} Q${xE} ${T} ${xE} ${T + rag} L${xE} ${S.ok.b - rag} Q${xE} ${S.ok.b} ${xE - rag} ${S.ok.b}`
  let quota = S.ok.b
  for (let i = gradini.length - 1; i >= 0; i--) { const [x, q] = gradini[i]; d += ` L${x.toFixed(1)} ${quota.toFixed(1)} L${x.toFixed(1)} ${q.toFixed(1)}`; quota = q }
  d += ` L${xS} ${quota.toFixed(1)} Z`

  const rami: { k: string; d: string; tipo: 'lingua' | 'uscita' | 'annullate'; fine: [number, number, number] }[] = []
  const corsie = []
  const tutto: Stazione = { x: xS, a: 0, b: 0 }
  const st = (k: string, x: number): Stazione => ({ x, a: S[k].a, b: S[k].b })
  // le consegnate: dritte fino alla foce
  corsie.push(corsia([{ ...tutto, a: S.ok.a, b: S.ok.b }, st('ok', xE - 4)]))
  if (v.ann) {
    const w = S.ann.b - S.ann.a, fine: Stazione = { x: xa1, a: yB - w / 2, b: yB + w / 2 }
    rami.push({ k: 'ann', d: nastro([st('ann', xa0 - 0.6), fine]), tipo: 'annullate', fine: [xa1, yB, w] })
    corsie.push(corsia([st('ann', xS), st('ann', xa0), fine], { ferma: true }))
  }
  ;['lav', 'sped', 'tra', 'cons'].forEach((k, i) => {
    if (!v[k]) return
    const [l0, l1] = lingua(i + 1), fine: Stazione = { x: l1, a: S[k].a + D, b: S[k].b + D }
    rami.push({ k, d: nastro([st(k, l0 - 0.6), fine]), tipo: 'lingua', fine: [l1, S[k].b + D, S[k].b - S[k].a] })
    corsie.push(corsia([st(k, xS), st(k, l0), fine], { ferma: true }))
  })
  for (const k of ['reso', 'nc', 'giac']) {
    if (!v[k]) continue
    const w = S[k].b - S[k].a, fine: Stazione = { x: xE, a: righe[k] - w / 2, b: righe[k] + w / 2 }
    rami.push({ k, d: nastro([st(k, xu0 - 0.6), fine]), tipo: 'uscita', fine: [xE, righe[k], w] })
    corsie.push(corsia([st(k, xS), st(k, xu0), fine]))
  }
  const H = Math.max(yB + 34, (Object.values(righe).pop() || 0) + 30, S.ok.b + 60)
  return { W, H, T, LT, xS, xE, xC, g, X, D, S, v, tot, fondo, yB, righe, corpo: d, rami, corsie, lingua }
}

export default function Fiume({ stati, tinte, pronto }: { stati: Record<string, number> | null; tinte: Tinte | null; pronto: boolean }) {
  const box = useRef<HTMLDivElement>(null), tela = useRef<HTMLCanvasElement>(null)
  // sul telefono il fiume non si schiaccia: resta largo almeno 860 e il riquadro scorre di lato
  const misura = useLarghezza(box), W = misura ? Math.max(misura, 860) : 0
  // lo spessore del fiume segue l'altezza dello schermo (sul portatile il fiume e la chiusa stanno nella prima schermata)
  const [Hb, setHb] = useState(150)
  useEffect(() => { const m = () => setHb(Math.round(Math.min(178, Math.max(112, innerHeight * (innerHeight < 820 ? 0.17 : 0.19))))); m(); addEventListener('resize', m); return () => removeEventListener('resize', m) }, [])
  const chiave = stati ? JSON.stringify(stati) : ''
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const G = useMemo(() => (stati && W ? geometria(stati, W, Hb) : null), [chiave, W, Hb])
  // i colli partono quando il fiume si è riempito (la prima volta; agli aggiornamenti ogni 2 minuti ripartono subito)
  const partenza = usePartenza(!!G && pronto, 1900)
  useParticelle(tela, G?.corsie ?? null, { W: G?.W || 0, H: G?.H || 0, densita: tinte?.notte ? 470 : 380, velocita: 54, partenza, tinte, x0: G?.xS || 0, x1: G?.xE || 1, massimo: 620, lato: 2.3 })

  if (stati && !Object.values(stati).some(x => Number(x) > 0)) {
    return <div className="pb-fiume pb-fiume--vuoto"><p>Il fiume è ancora asciutto: nessuna spedizione creata negli ultimi 30 giorni.</p></div>
  }

  const tot = G?.tot || 0
  const etichetta = G ? `Le ${fmtN.format(tot)} spedizioni degli ultimi 30 giorni: ${fmtN.format(G.v.ok)} consegnate, ${fmtN.format(G.v.lav)} in lavorazione, ${fmtN.format(G.v.sped)} spedite, ${fmtN.format(G.v.tra)} in transito, ${fmtN.format(G.v.cons)} in consegna, ${fmtN.format(G.v.giac)} in giacenza, ${fmtN.format(G.v.nc)} non consegnate, ${fmtN.format(G.v.reso)} resi, ${fmtN.format(G.v.ann)} annullate.` : 'Il fiume delle spedizioni'
  const inAnnullamento = Number(stati?.storno_richiesto || 0) + Number(stati?.annullamento_pending || 0)
  return (
    <div className={'pb-fiume' + (G && pronto ? ' pb-fiume--scorre' : '')} ref={box}>
      <div className="pb-fiume__tela" style={{ height: G ? G.H : 420 }} role="img" aria-label={etichetta}>
        {!G && W > 0 && (
          // il letto del fiume mentre arrivano i numeri (la rotta impiega un paio di secondi): niente riquadro vuoto
          <svg className="pb-fiume__letto" width={W} height={420} aria-hidden="true">
            <rect x={40} y={124} width={Math.max(0, W - 40 - Math.round(Math.min(260, Math.max(214, W * 0.21))))} height={Hb} rx={18} />
          </svg>
        )}
        {G && <>
          <svg className="pb-fiume__svg" width={G.W} height={G.H} viewBox={`0 0 ${G.W} ${G.H}`} aria-hidden="true">
            <defs>
              <linearGradient id="pb-g-fiume" gradientUnits="userSpaceOnUse" x1={G.xS} x2={G.xE} y1="0" y2="0">
                <stop offset="0" className="pb-st pb-st--0" />
                <stop offset=".07" className="pb-st pb-st--1" />
                <stop offset=".5" className="pb-st pb-st--2" />
                <stop offset="1" className="pb-st pb-st--3" />
              </linearGradient>
              <linearGradient id="pb-g-uscita" gradientUnits="userSpaceOnUse" x1={G.X[4]} x2={G.xE} y1="0" y2="0">
                <stop offset="0" className="pb-st pb-st--3" />
                <stop offset=".7" className="pb-st pb-st--uscita" />
              </linearGradient>
              <linearGradient id="pb-g-lingua" x1="0" x2="0" y1="0" y2="1">
                <stop offset=".45" stopColor="#fff" />
                <stop offset="1" stopColor="#000" />
              </linearGradient>
              <mask id="pb-m-lingua" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#pb-g-lingua)" /></mask>
              <linearGradient id="pb-g-riva" gradientUnits="userSpaceOnUse" x1={G.xS} x2={G.xE} y1="0" y2="0">
                <stop offset="0" stopOpacity="0" className="pb-st-riva" />
                <stop offset=".35" stopOpacity=".35" className="pb-st-riva" />
                <stop offset="1" stopOpacity=".95" className="pb-st-riva" />
              </linearGradient>
              <pattern id="pb-p-correnti" width="8" height="5" patternUnits="userSpaceOnUse"><rect width="8" height=".9" className="pb-corrente" /></pattern>
              <filter id="pb-f-alone" x="-10%" y="-60%" width="120%" height="220%"><feGaussianBlur stdDeviation="16" /></filter>
            </defs>
            {/* di notte il fiume ha un alone: la sua stessa forma sfocata, sotto */}
            <path className="pb-fiume__alone" d={G.corpo} fill="url(#pb-g-fiume)" filter="url(#pb-f-alone)" />
            <path className="pb-fiume__corpo" d={G.corpo} fill="url(#pb-g-fiume)" />
            {/* la trama delle correnti: righe sottili, come i grafici a trama dei riferimenti */}
            <path className="pb-fiume__trama" d={G.corpo} fill="url(#pb-p-correnti)" />
            {G.rami.map(r => (
              <g key={r.k} className={'pb-ramo pb-ramo--' + r.tipo}>
                <path d={r.d} fill={r.tipo === 'uscita' ? 'url(#pb-g-uscita)' : 'url(#pb-g-fiume)'} mask={r.tipo === 'lingua' ? 'url(#pb-m-lingua)' : undefined}>
                  <title>{r.k === 'ann' ? 'Annullate' : USCITE[r.k]?.nome || TAPPE.find(t => t.k === r.k)?.nome}: {fmtN.format(G.v[r.k])}</title>
                </path>
                {r.tipo !== 'lingua' && <rect className="pb-ramo__nodo" x={r.fine[0] - 1} y={r.fine[1] - r.fine[2] / 2 - 4} width="3" height={r.fine[2] + 8} rx="1.5" />}
              </g>
            ))}
            {/* la riva: un filo di luce sul bordo alto */}
            <path d={`M${G.xS} ${G.T + 0.5} L${G.xE - 18} ${G.T + 0.5}`} stroke="url(#pb-g-riva)" strokeWidth="1.2" fill="none" />
            {/* le stazioni: un filo che scende dal cartellino alla lingua */}
            {[1, 2, 3, 4].map(i => {
              const k = TAPPE[i - 1].k, fine = G.v[k] ? G.S[k].b + G.D : G.S[k].a
              return <g key={i} className="pb-stazione"><line x1={G.X[i]} x2={G.X[i]} y1={G.LT - 4} y2={fine} /><circle cx={G.X[i]} cy={G.T} r="3.2" /></g>
            })}
          </svg>
          <canvas ref={tela} className="pb-fiume__colli" style={{ width: G.W, height: G.H }} aria-hidden="true" />

          {/* le sorgenti e la foce: due oggetti 3D già disegnati */}
          <img className="pb-fiume__pacco" src={`/grafica/segni/pacco-${tinte?.notte ? 'notte' : 'giorno'}.webp`} alt="" style={{ top: G.T + (G.fondo - G.T) / 2 - 46 }} />
          <img className="pb-fiume__casa" src={`/grafica/segni/consegna-${tinte?.notte ? 'notte' : 'giorno'}.webp`} alt="" style={{ left: G.xE - 34, top: G.T + (G.S.ok.b - G.T) / 2 - 56 }} />

          {/* i cartellini: il numero di chi è lì adesso */}
          <div className="pb-tappa pb-tappa--sorgente" style={{ left: 0, top: 0, ['--x' as any]: 0 }}>
            <b><Conta v={tot}>{n => fmtN.format(n)}</Conta></b>
            <span className="pb-tappa__nome">Create</span>
            <span className="pb-tappa__frase">negli ultimi 30 giorni</span>
          </div>
          {TAPPE.map((t, i) => (
            <div key={t.k} className="pb-tappa" style={{ left: G.X[i + 1] + 10, top: 0, width: G.g - 16, ['--x' as any]: (G.X[i + 1] / G.W).toFixed(3) }}>
              <b><Conta v={G.v[t.k]}>{n => fmtN.format(n)}</Conta></b>
              <span className="pb-tappa__nome">{t.nome}</span>
              <span className="pb-tappa__frase">{t.frase}</span>
            </div>
          ))}
          <div className="pb-tappa pb-tappa--foce" style={{ left: G.xE + 80, top: G.T + (G.S.ok.b - G.T) / 2 - 50, ['--x' as any]: 1 }}>
            <b><Conta v={G.v.ok}>{n => fmtN.format(n)}</Conta></b>
            <span className="pb-tappa__nome">Consegnate</span>
            <span className="pb-tappa__frase">{pct(G.v.ok, tot)}% delle spedizioni</span>
          </div>
          {['reso', 'nc', 'giac'].filter(k => G.v[k]).map(k => (
            <div key={k} className={'pb-uscita' + (k === 'giac' ? ' pb-uscita--problema' : '')} style={{ left: G.xE + 12, top: G.righe[k] - 17, ['--x' as any]: 1 }}>
              <b><Conta v={G.v[k]}>{n => fmtN.format(n)}</Conta></b>
              <span><span className="pb-uscita__nome">{USCITE[k].nome}</span><span className="pb-uscita__frase">{USCITE[k].frase} · {pct(G.v[k], tot)}%</span></span>
            </div>
          ))}
          {G.v.ann > 0 && (
            <div className="pb-uscita pb-uscita--annullate" style={{ left: G.xC + 0.6 * G.g + 12, top: G.yB - 17, ['--x' as any]: 0.2 }}>
              <b><Conta v={G.v.ann}>{n => fmtN.format(n)}</Conta></b>
              <span><span className="pb-uscita__nome">Annullate</span><span className="pb-uscita__frase">fermate prima di partire{inAnnullamento ? ` · ${fmtN.format(inAnnullamento)} in annullamento` : ''}</span></span>
            </div>
          )}
        </>}
      </div>
    </div>
  )
}
