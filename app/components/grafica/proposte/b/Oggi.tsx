'use client'
// IL FLUSSO DI OGGI (proposta B): le create ora per ora (/api/dashboard/giornata) scendono nel bacino «da chiudere in
// distinta» e da lì, dopo la distinta, partono. Ogni quadratino è un collo (o un gruppo di colli, lo dice la
// legenda); quelli arancio sono ancora fuori distinta. Si vede a colpo d'occhio dove si ferma il lavoro.
// Il bacino divide le fuori distinta per corriere con /api/distinte/contratti di oggi: si mostra SOLO il vettore
// (vettoreFisico), mai il nome del contratto né il tipo di integrazione.
import { Icona } from '../../icone'
import { Conta } from '../../movimento'
import { fmtN, iso, usaJson } from '../../PlanciaNuova'
import { vettoreFisico } from '@/lib/vettore'
import { TECNICI, Testa } from './comuni'


export default function Oggi({ data, giornata, quando }: { data: any; giornata: any; quando: Date | null }) {
  const oggi = quando ? iso(quando) : null
  const contratti = usaJson<any[]>(oggi ? `/api/distinte/contratti?dal=${oggi}&al=${oggi}` : null)
  const perVettore = (() => {
    if (!Array.isArray(contratti)) return null
    const m = new Map<string, number>()
    for (const c of contratti) {
      const n = Number(c?.da_chiudere || 0); if (!n) continue
      let v = vettoreFisico(c); if (!v || TECNICI.test(v)) v = 'Altri'
      m.set(v, (m.get(v) || 0) + n)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  })()
  const sommaV = (perVettore || []).reduce((a, x) => a + x[1], 0)
  const fuori = Number(giornata?.fuoriDistinta || 0), create = Number(giornata?.create || 0)
  const partite = Number(data?.spediteOggi || 0)
  const rete = Number(data?.daMettereInDistinta || 0)

  return (
    <section className="pb-sez" aria-labelledby="pb-t-oggi">
      <Testa id="pb-t-oggi" occhiello="Oggi" titolo={<>Il flusso <b>di oggi</b></>}
        frase="Le spedizioni create ora per ora, quelle che aspettano la distinta e quelle già partite."
        destra={giornata ? <ul className="pb-legenda"><li><i className="pb-q pb-q--dentro" />già in distinta</li><li><i className="pb-q pb-q--fuori" />fuori distinta</li></ul> : null} />
      <div className="pb-oggi gx-vetro">
        <div className="pb-oggi__ore">
          <div className="pb-oggi__testa">
            <span className="pb-bacino__nome">Create oggi</span>
            <b className="pb-bacino__n">{giornata ? <Conta v={create}>{n => fmtN.format(n)}</Conta> : '…'}</b>
            <span className="pb-bacino__frase">ora per ora, dalla prima all&apos;ultima</span>
          </div>
          {giornata ? <Matrice g={giornata} ora={quando ? quando.getHours() : null} /> : <div className="pb-vuoto">…</div>}
        </div>
        <Condotto acceso={fuori > 0} />
        <div className={'pb-bacino' + (fuori > 0 ? ' pb-bacino--pieno' : '')}>
          <span className="pb-bacino__nome">Da chiudere in distinta</span>
          <b className="pb-bacino__n">{giornata ? <Conta v={fuori}>{n => fmtN.format(n)}</Conta> : '…'}</b>
          <span className="pb-bacino__frase">{giornata ? (fuori ? (fuori === create ? 'tutte le create di oggi sono ancora qui' : `delle ${fmtN.format(create)} create oggi`) : 'oggi non resta niente fuori distinta') : ' '}</span>
          {perVettore && perVettore.length > 0 && (
            <div className="pb-vettori" role="img" aria-label={'Per corriere, sui tuoi contratti: ' + perVettore.map(([v, n]) => `${v} ${n}`).join(', ')}>
              <div className="pb-vettori__barra">{perVettore.map(([v, n], i) => <i key={v} style={{ flex: n, opacity: 1 - i * 0.18 }} title={`${v}: ${fmtN.format(n)}`} />)}</div>
              <ul>{perVettore.slice(0, 4).map(([v, n]) => <li key={v}><span>{v}</span><b>{fmtN.format(n)}</b></li>)}</ul>
              <em>per corriere, sui tuoi contratti{sommaV !== fuori ? ` (${fmtN.format(sommaV)})` : ''}</em>
            </div>
          )}
          <div className="pb-bacino__piede">
            <span>In tutta la rete, da sempre <b>{data ? fmtN.format(rete) : '…'}</b></span>
            <a className="pb-pieno" href="/dashboard/distinte/crea"><Icona id="i-distinta" />Crea distinta</a>
          </div>
        </div>
        <Condotto acceso={partite > 0} neutro />
        <div className="pb-partite">
          <span className="pb-bacino__nome">Partite oggi</span>
          <b className="pb-bacino__n">{data ? <Conta v={partite}>{n => fmtN.format(n)}</Conta> : '…'}</b>
          <span className="pb-bacino__frase">hanno preso la strada oggi</span>
          <div className="pb-partite__coda">
            <span>In lavorazione</span><b>{data ? fmtN.format(Number(data.inLavorazione || 0)) : '…'}</b>
            <em>aspettano il ritiro</em>
          </div>
        </div>
      </div>
    </section>
  )
}

// il tratto fra due bacini: puntini che scorrono (nel foglio di stile; fermi con prefers-reduced-motion)
function Condotto({ acceso, neutro }: { acceso: boolean; neutro?: boolean }) {
  return (
    <svg className={'pb-condotto' + (neutro ? ' pb-condotto--neutro' : '') + (acceso ? '' : ' pb-condotto--fermo')} viewBox="0 0 60 40" preserveAspectRatio="none" aria-hidden="true">
      <path className="pb-condotto__letto" d="M0 20 L60 20" />
      <path className="pb-condotto__colli" d="M0 20 L60 20" />
    </svg>
  )
}

// le ore: ogni colonna un'ora, ogni quadratino uno o più colli; sotto quelli già in distinta, sopra quelli fuori
function Matrice({ g, ora }: { g: any; ora: number | null }) {
  const ore: any[] = Array.isArray(g?.ore) ? g.ore : []
  const con = ore.filter(o => Number(o.create) > 0).map(o => o.ora)
  const h0 = Math.min(8, ...(con.length ? con : [8])), h1 = Math.max(19, ...(con.length ? con : [19]), ora ?? 0)
  const fila = ore.filter(o => o.ora >= h0 && o.ora <= h1)
  const max = Math.max(1, ...fila.map(o => Number(o.create || 0)))
  const unita = [1, 2, 3, 4, 5, 10, 15, 20, 25, 50, 100, 200, 500].find(u => max / u <= 15) || 1000
  const C = 30, Q = 8, P = 10.5, R = 15, H = R * P + 30, W = fila.length * C
  return (
    <figure className="pb-matrice">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={'Create oggi ora per ora: ' + fila.filter(o => o.create).map(o => `alle ${o.ora} ${o.create}, ${o.fuoriDistinta} fuori distinta`).join('; ')}>
        {fila.map((o, i) => {
          const dentro = Math.max(0, Number(o.create || 0) - Number(o.fuoriDistinta || 0)), fuori = Number(o.fuoriDistinta || 0)
          let nd = Math.round(dentro / unita), nf = Math.round(fuori / unita)
          // una colonna con spedizioni vere non resta mai vuota per l'arrotondamento
          if (Number(o.create) > 0 && nd + nf === 0) { if (fuori) nf = 1; else nd = 1 }
          const x = i * C + (C - Q) / 2, adesso = ora === o.ora
          return (
            <g key={o.ora}>
              <title>{`Alle ${o.ora}: ${o.create} create, ${o.fuoriDistinta} fuori distinta`}</title>
              {adesso && <rect className="pb-matrice__adesso" x={i * C + 2} y={0} width={C - 4} height={R * P + 4} rx="6" />}
              {Array.from({ length: nd + nf }, (_, r) => (
                <rect key={r} className={'pb-cade ' + (r < nd ? 'pb-q--dentro' : 'pb-q--fuori')} x={x} y={R * P - (r + 1) * P + (P - Q) + 2} width={Q} height={Q} rx="2"
                  style={{ animationDelay: (i * 40 + r * 28) + 'ms' }} />
              ))}
              {(o.ora % 2 === 0 || adesso) && <text x={i * C + C / 2} y={H - 8} textAnchor="middle" className={adesso ? 'pb-matrice__ora pb-matrice__ora--adesso' : 'pb-matrice__ora'}>{adesso ? 'ora' : o.ora}</text>}
            </g>
          )
        })}
      </svg>
      <figcaption>{unita === 1 ? 'Ogni quadratino è una spedizione' : `Ogni quadratino vale circa ${unita} spedizioni`}</figcaption>
    </figure>
  )
}
