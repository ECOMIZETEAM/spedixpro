'use client'
// LE TESSERE della Proposta D «Bento». Ogni tessera è UNA cosa: un numero protagonista, un micro-grafico su misura e
// spesso un piccolo oggetto 3D che le dà identità. Tutta la tessera apre il suo foglio (il bottone trasparente che
// la copre); i verbi dentro (Crea distinta, Rispondi…) portano dritti alla pagina, sopra al bottone.
// Dove un dato non arriva, la tessera lo dice: «…» mentre legge, «non disponibile» se la rotta non lo dà.
import type { ReactNode } from 'react'
import { Conta } from '../../movimento'
import { Euro, fmtN, euroPiano } from '../../PlanciaNuova'
import { Anello, Colonne, Composizione, Mosaico, Ore, Puntini, Quota, Strada, Italia } from './grafici'
import { gruppiStati, meseItaliano, pct, type Lettura, type Periodo } from './comune'

export const intero = (n: number) => fmtN.format(n)
// Conta, ma senza il segno sbagliato al primo fotogramma: quando il tempo del fotogramma cade un attimo prima della
// partenza, la corsa da zero dà −0,16 e si vedeva «−0» (o «−€ 0,04»). Il numero resta dalla parte del suo segno.
export function Cifra({ v, children }: { v: number; children: (n: number) => ReactNode }) {
  return <Conta v={v}>{n => children(v >= 0 ? Math.max(0, n) : Math.min(0, n))}</Conta>
}
export const soldo = (n: number) => <Euro v={n} />

// le voci dei soldi: ognuna col suo oggetto e la pagina del suo rapporto
export const VOCI = [
  { k: 'spedizioni', nome: 'Spedizioni', url: '/api/reports/guadagno', segno: 'pacco', href: '/dashboard/statistiche/profitto' },
  { k: 'rettifiche', nome: 'Rettifiche', url: '/api/reports/guadagno-rettifiche', segno: 'bilancia', href: '/dashboard/reports/rettifiche' },
  { k: 'resi', nome: 'Resi', url: '/api/reports/guadagno-resi', segno: 'resi', href: '/dashboard/reports/resi' },
  { k: 'giacenze', nome: 'Giacenze', url: '/api/reports/guadagno-giacenze', segno: 'gabbia', href: '/dashboard/reports/giacenze' },
  { k: 'logistica', nome: 'Logistica', url: '/api/reports/guadagno-logistica', segno: 'scaffale', href: '/dashboard/logistica/addebiti' },
  { k: 'consumabili', nome: 'Consumabili', url: '/api/reports/guadagno-consumabili', segno: 'nastro', href: '/dashboard/reports/consumabili' },
] as const

export type Soldi = { tot: Lettura<any>; voci: Lettura<any>[]; gest: Lettura<any>; quota: (k: string) => number; altre: number }

// ── i pezzi comuni ──
export function Oggetto({ n, tema, misura }: { n: string; tema: string; misura: 's' | 'm' | 'l' }) {
  return <img className={'bd-oggetto bd-oggetto--' + misura} src={`/grafica/proposte/d/${n}-${tema === 'notte' ? 'notte' : 'giorno'}.webp`} alt="" draggable={false} />
}
export function Nome({ children, punto }: { children: ReactNode; punto?: 'bene' | 'problema' | 'accento' | '' }) {
  return <span className="bd-nome">{punto ? <i className={'bd-punto bd-punto--' + punto} /> : null}{children}</span>
}
// mentre la rotta risponde: una barretta che luccica al posto del numero (i tre puntini sembravano un errore)
export const Attesa = () => <span className="bd-attesa" role="img" aria-label="sto leggendo" />
// il numero: la barretta mentre legge, — se manca
export function Numero({ l, v, fmt = intero }: { l: 'attesa' | 'ok' | 'manca'; v: number; fmt?: (n: number) => ReactNode }) {
  if (l === 'attesa') return <Attesa />
  if (l === 'manca') return <span className="bd-manca">—</span>
  return <Cifra v={v}>{fmt}</Cifra>
}
const st = (data: any) => (data ? 'ok' : 'attesa') as 'ok' | 'attesa'

// ── OGGI: le partite, le create, ora per ora ──
export function TOggi({ data, giornata, adesso, tema, giorno }: { data: any; giornata: any; adesso: number | null; tema: string; giorno: string }) {
  return (
    <>
      <div className="bd-testa"><Nome>Oggi</Nome><span className="bd-sotto">{giorno}</span></div>
      <Oggetto n="furgone" tema={tema} misura="l" />
      <div className="bd-oggi">
        <b className="bd-n bd-n--xl"><Numero l={st(data)} v={Number(data?.spediteOggi || 0)} /></b>
        <div className="bd-oggi__cosa">
          <span>spedizioni partite</span>
          <span className="bd-nota">{giornata ? <>{intero(giornata.create)} create · <em>{intero(giornata.fuoriDistinta)} da chiudere</em></> : ' '}{data ? <> · {intero(Number(data.inLavorazione || 0))} in lavorazione</> : null}</span>
        </div>
      </div>
      <div className="bd-oggi__grafico">
        {giornata?.ore ? <Ore ore={giornata.ore} adesso={adesso} /> : <div className="bd-grafico--pieno" />}
        <span className="bd-legenda-mini"><i className="bd-l-p" />in distinta<i className="bd-l-r" />da chiudere</span>
      </div>
    </>
  )
}

// ── DA FARE: ogni riga col suo verbo, le righe a zero nascoste ──
export function righeFare(data: any, badge: any) {
  return [
    { k: 'distinta', n: Number(data?.daMettereInDistinta || 0), testo: 'da chiudere in distinta', nota: 'tutta la tua rete', verbo: 'Crea distinta', href: '/dashboard/distinte/crea' },
    { k: 'giacenze', n: Number(data?.inGiacenza || 0), testo: 'giacenze aspettano te', nota: 'servono istruzioni', verbo: 'Rispondi', href: '/dashboard/spedizioni/giacenze' },
    { k: 'rettifiche', n: Number(badge?.daConfermare || 0), testo: 'rettifiche da confermare', nota: Number(badge?.daConfermareImporto) > 0 ? euroPiano(Number(badge.daConfermareImporto)) : '', verbo: 'Conferma', href: '/dashboard/spedizioni/rettifica' },
    { k: 'rete', n: Number(badge?.daAccettare || 0), testo: 'richieste della rete', nota: '', verbo: 'Rivedi', href: '/dashboard/network' },
  ].filter(r => r.n > 0)
}
export function TFare({ data, badge, tema }: { data: any; badge: any; tema: string }) {
  const righe = righeFare(data, badge)
  return (
    <>
      <div className="bd-testa"><Nome>Da fare</Nome></div>
      <Oggetto n="pedana" tema={tema} misura="m" />
      <p className="bd-fare__quante">{!data ? <Attesa /> : righe.length ? <><b>{righe.length}</b> {righe.length === 1 ? 'cosa aspetta' : 'cose aspettano'} te</> : 'Tutto in ordine'}</p>
      {data && !righe.length && <p className="bd-nota"><i className="bd-punto bd-punto--bene" /> niente da chiudere, nessuna giacenza, nessuna richiesta</p>}
      {/* le righe solo coi dati della Plancia: le rettifiche arrivano prima, e le altre righe le spingevano giù */}
      <ul className="bd-fare">
        {data && righe.map((r, i) => (
          <li key={r.k}>
            <b><Cifra v={r.n}>{intero}</Cifra></b>
            <span>{r.testo}{r.nota && <em>{r.nota}</em>}</span>
            <a className={'bd-verbo' + (i === 0 ? ' bd-verbo--pieno' : '')} href={r.href}>{r.verbo}</a>
          </li>
        ))}
      </ul>
    </>
  )
}

// ── le piccole delle spedizioni ──
export function TTransito({ data, tema }: { data: any; tema: string }) {
  return (
    <>
      <div className="bd-testa"><Nome>In transito</Nome></div>
      <Oggetto n="strada" tema={tema} misura="s" />
      <div className="bd-piede">
        <b className="bd-n"><Numero l={st(data)} v={Number(data?.inTransito || 0)} /></b>
        <p className="bd-nota">{data ? `${intero(Number(data.consegnateMese || 0))} consegnate` : ' '}</p>
        {data?.statiUltimi30 && <Strada s={data.statiUltimi30} />}
      </div>
    </>
  )
}
export function TGiacenze({ data, tema }: { data: any; tema: string }) {
  const n = Number(data?.inGiacenza || 0)
  return (
    <>
      <div className="bd-testa"><Nome punto={data ? (n ? 'problema' : 'bene') : ''}>In giacenza</Nome></div>
      <Oggetto n="gabbia" tema={tema} misura="s" />
      <div className="bd-piede">
        <b className="bd-n"><Numero l={st(data)} v={n} /></b>
        <p className="bd-nota">{data ? (n ? 'aspettano una risposta' : 'nessuna da risolvere') : ' '}</p>
        {data && <Puntini n={n} />}
      </div>
    </>
  )
}
export function TCod({ data, tema }: { data: any; tema: string }) {
  return (
    <>
      <div className="bd-testa"><Nome>Contrassegni</Nome></div>
      <Oggetto n="cassa" tema={tema} misura="s" />
      <div className="bd-piede">
        <b className="bd-n bd-n--euro"><Numero l={st(data)} v={Number(data?.codDaRimettere || 0)} fmt={soldo} /></b>
        <p className="bd-nota">da rimettere ai clienti</p>
      </div>
    </>
  )
}
// il piano del mese: l'anello al posto dell'oggetto
export function TPiano({ data, mese }: { data: any; mese: string }) {
  const n = Number(data?.spedizioniMese || 0), limite = Number(data?.limiteMese || 0), senza = !!data?.illimitato || !limite
  return (
    <>
      <div className="bd-testa"><Nome>Il piano</Nome></div>
      <span className="bd-t__anello"><Anello quota={data && !senza ? n / limite : 0} lato={58} spessore={6}><b>{!data ? '' : senza ? '∞' : `${Math.round(n / limite * 100)}%`}</b></Anello></span>
      <div className="bd-piede">
        <b className="bd-n"><Numero l={st(data)} v={n} /></b>
        <p className="bd-nota">{!data ? ' ' : senza ? `${mese || 'questo mese'}, senza limite` : `su ${intero(limite)} a ${mese || 'questo mese'}`}</p>
      </div>
    </>
  )
}

// ── I SOLDI: il guadagno totale del periodo e il margine giorno per giorno ──
export function TSoldi({ s, p, tema }: { s: Soldi; p: Periodo | null; tema: string }) {
  const t = s.tot.d, sped = s.voci[0].d
  const margine = t?.ricavi ? t.guadagno / t.ricavi * 100 : 0
  const serie: any[] = sped?.serie || []
  return (
    <>
      <div className="bd-testa"><Nome>Guadagno totale</Nome><span className="bd-sotto">{p ? p.titolo : ' '}</span></div>
      <Oggetto n="monete" tema={tema} misura="l" />
      <b className="bd-n bd-n--xl bd-n--soldi"><Numero l={s.tot.stato} v={Number(t?.guadagno || 0)} fmt={soldo} /></b>
      <p className="bd-nota bd-soldi__righe">
        {t ? <><span>margine <b>{pct(margine)}%</b></span><span>incassato <b>{euroPiano(t.ricavi || 0)}</b></span><span>costi <b>{euroPiano(t.costi || 0)}</b></span></> : s.tot.stato === 'manca' ? 'Il guadagno non è disponibile per il tuo profilo.' : ' '}
      </p>
      <div className="bd-soldi__grafico">
        {serie.length > 1
          ? <Colonne valori={serie.map((g: any, i: number) => ({ k: g.giorno, v: Number(g.margine || 0), accento: i === serie.length - 1, titolo: g.giorno.slice(8, 10) + '/' + g.giorno.slice(5, 7), sopra: undefined }))} larghezzaMax={18} />
          : t && t.guadagno > 0
            // un giorno solo: niente colonne (sarebbe una), ma di cosa è fatto il guadagno
            ? <Composizione parti={[...VOCI.map((v, i) => ({ k: v.k, nome: v.nome, v: Number(s.voci[i].d?.guadagno || 0) })), { k: 'altre', nome: 'Altre voci', v: s.altre }]} />
            : <div className="bd-vuoto">{s.voci[0].stato === 'attesa' ? '' : 'Nessuna spedizione nel periodo'}</div>}
        <span className="bd-legenda-mini">{serie.length > 1 ? 'margine delle spedizioni, giorno per giorno' : 'di cosa è fatto il guadagno'}</span>
      </div>
    </>
  )
}
export function TVoce({ v, l, quota, tema }: { v: typeof VOCI[number]; l: Lettura<any>; quota: number; tema: string }) {
  const g = Number(l.d?.guadagno || 0)
  return (
    <>
      <div className="bd-testa"><Nome>{v.nome}</Nome></div>
      <Oggetto n={v.segno} tema={tema} misura="s" />
      <div className="bd-piede">
        <b className="bd-n bd-n--euro"><Numero l={l.stato} v={g} fmt={soldo} /></b>
        <p className="bd-nota">{l.d ? `incassato ${euroPiano(Number(l.d.ricavi || 0))}` : l.stato === 'manca' ? 'non disponibile' : ' '}</p>
        {l.d && <Quota v={quota} etichetta={`${Math.round(quota * 100)}% del guadagno`} />}
      </div>
    </>
  )
}
export function TSaldi({ data }: { data: any }) {
  const sc = data?.creditiDaRecuperare?.scalare, fa = data?.creditiDaRecuperare?.fattura, pr = Number(data?.creditoMaster?.proprio || 0)
  const voci = [
    // «da recuperare» si legge già come un debito: l'importo si mostra senza segno (il saldo vero ha il meno)
    { k: 'scalare', nome: 'Da recuperare a scalare', v: Math.abs(Number(sc?.totale || 0)), nota: `${intero(Number(sc?.clienti || 0))} clienti bloccati`, punto: Math.abs(Number(sc?.totale || 0)) > 0.004 ? 'problema' : '' },
    { k: 'fattura', nome: 'Da recuperare a fattura', v: Math.abs(Number(fa?.totale || 0)), nota: `${intero(Number(fa?.clienti || 0))} clienti a fattura`, punto: '' },
    { k: 'proprio', nome: 'Conto proprio', v: pr, nota: 'i tuoi contratti', punto: pr < 0 ? 'problema' : '' },
  ]
  return (
    <>
      <div className="bd-testa"><Nome>Saldi aperti</Nome><span className="bd-sotto">adesso · non cambiano col periodo</span></div>
      <div className="bd-saldi">
        {voci.map(x => (
          <div key={x.k}>
            <span className="bd-saldi__nome">{x.punto ? <i className={'bd-punto bd-punto--' + x.punto} /> : null}{x.nome}</span>
            <b className="bd-n bd-n--m"><Numero l={st(data)} v={x.v} fmt={soldo} /></b>
            <span className="bd-nota">{data ? x.nota : ' '}</span>
          </div>
        ))}
      </div>
    </>
  )
}
// l'utile netto: una striscia larga sotto le voci, solo se la rotta dà i costi di gestione (li vedono il master e i
// suoi admin). Si legge come un conto: guadagno meno costi di gestione, uguale utile.
export function TUtile({ t, gest, tema }: { t: any; gest: any; tema: string }) {
  const cat: any[] = gest?.perCategoria || []
  return (
    <div className="bd-utile">
      <Oggetto n="cassa" tema={tema} misura="s" />
      <div className="bd-utile__voce"><span>Guadagno totale</span><b className="bd-n bd-n--m"><Cifra v={Number(t?.guadagno || 0)}>{soldo}</Cifra></b></div>
      <i className="bd-utile__segno" aria-hidden="true">−</i>
      <div className="bd-utile__voce"><span>Costi di gestione</span><b className="bd-n bd-n--m"><Cifra v={Number(t?.costiGestione || 0)}>{soldo}</Cifra></b>
        <em>{cat.length ? cat.slice(0, 2).map(c => c.categoria).join(' · ') : 'nessun costo segnato nel periodo'}</em></div>
      <i className="bd-utile__segno" aria-hidden="true">=</i>
      <div className="bd-utile__voce bd-utile__voce--utile"><span><i className="bd-punto bd-punto--accento" />Utile netto</span><b className="bd-n bd-n--m"><Cifra v={Number(t?.utileNetto || 0)}>{soldo}</Cifra></b></div>
      <p className="bd-riservato"><svg className="gx-ico" aria-hidden="true"><use href="#i-lucchetto" /></svg>lo vedete solo tu<br />e i tuoi admin</p>
    </div>
  )
}

// ── COME VA ──
export function TStati({ data }: { data: any }) {
  const { g, tot } = gruppiStati(data?.statiUltimi30)
  const bene = g[1].n
  return (
    <div className="bd-stati">
      <div className="bd-stati__testo">
        <div className="bd-testa"><Nome>Ultimi 30 giorni</Nome></div>
        <b className="bd-n bd-n--l">{data ? <Cifra v={tot ? Math.round(bene / tot * 100) : 0}>{n => <>{intero(n)}<small>%</small></>}</Cifra> : <Attesa />}</b>
        <p className="bd-nota">{data ? `consegnate, su ${intero(tot)} spedizioni` : ' '}</p>
        <ul className="bd-legenda">
          {g.map(x => <li key={x.k}><i className={'bd-cella-l bd-cella-l--' + x.k} />{x.nome}<b>{intero(x.n)}</b></li>)}
        </ul>
      </div>
      <div className="bd-stati__mosaico">{data ? <Mosaico gruppi={g} lato={176} /> : null}</div>
    </div>
  )
}
export function TMesi({ data }: { data: any }) {
  const mesi: any[] = (data?.statsMensili || []).slice(-6)
  const ora = mesi[mesi.length - 1]
  return (
    <>
      <div className="bd-testa"><Nome>Mesi</Nome><span className="bd-sotto">{ora ? `${meseItaliano(ora.mese)} fino a oggi` : ' '}</span></div>
      <b className="bd-n bd-n--l">{data ? <Cifra v={Number(ora?.totale || 0)}>{intero}</Cifra> : <Attesa />}</b>
      <p className="bd-nota">spedizioni {ora ? `a ${meseItaliano(ora.mese)}` : 'questo mese'}</p>
      <div className="bd-mesi__grafico">
        {mesi.length ? <Colonne valori={mesi.map((m, i) => ({ k: String(m.mese), v: Number(m.totale || 0), sopra: intero(Number(m.totale || 0)), sotto: meseItaliano(m.mese).slice(0, 3), accento: i === mesi.length - 1, titolo: meseItaliano(m.mese) }))} larghezzaMax={34} />
          : <div className="bd-vuoto">{data ? 'Ancora nessun mese da mostrare' : ''}</div>}
      </div>
    </>
  )
}
export function TDove({ dati, forme, tema, nomeDi }: { dati: Lettura<any>; forme: any[] | null; tema: string; nomeDi: (s: string) => string }) {
  const d = dati.d, top = (d?.province || []).slice(0, 3)
  return (
    <div className="bd-dove">
      <div className="bd-dove__testo">
        <div className="bd-testa"><Nome>Destinazioni</Nome></div>
        <b className="bd-n bd-n--l"><Numero l={dati.stato} v={Number(d?.totale || 0)} /></b>
        <p className="bd-nota">{d ? `in Italia, in ${intero(d.nProvince || 0)} province · ultimi 30 giorni` : ' '}</p>
        <ol className="bd-province">
          {top.map((p: any, i: number) => <li key={p.sigla}><span>{i + 1}</span>{nomeDi(p.sigla)}<b>{pct(p.perc)}%</b></li>)}
        </ol>
      </div>
      <div className="bd-dove__mappa"><Italia forme={forme} province={d?.province || []} tema={tema} W={220} H={250} /></div>
    </div>
  )
}
export function TRete({ data, tema }: { data: any; tema: string }) {
  return (
    <>
      <div className="bd-testa"><Nome>La tua rete</Nome></div>
      <Oggetto n="rete" tema={tema} misura="s" />
      <div className="bd-piede">
        <b className="bd-n"><Numero l={st(data)} v={Number(data?.clientiTotali || 0)} /></b>
        <p className="bd-nota">{data ? `clienti · ${intero(Number(data.sottomaster || 0))} sotto-master` : ' '}</p>
      </div>
    </>
  )
}
export function TResi({ analisi, tema }: { analisi: Lettura<any>; tema: string }) {
  const a = analisi.d, peggiori: any[] = (a?.peggiori || []).slice(0, 3)
  const max = Math.max(1, ...peggiori.map(c => Number(c.pct || 0)))
  return (
    <div className="bd-resi">
      <div>
        <div className="bd-testa"><Nome>Resi a 90 giorni</Nome></div>
        <b className="bd-n bd-n--m">{a ? <Cifra v={Number(a.totale?.pct || 0)}>{n => <>{pct(n)}<small>%</small></>}</Cifra> : analisi.stato === 'manca' ? <span className="bd-manca">—</span> : <Attesa />}</b>
        <p className="bd-nota">{a ? `${intero(a.totale?.resi || 0)} resi su ${intero(a.totale?.partite || 0)}` : ' '}</p>
      </div>
      <ul className="bd-peggiori">
        <li className="bd-peggiori__testa">Clienti con più resi</li>
        {peggiori.length ? peggiori.map(c => (
          <li key={c.id}>
            <span>{c.livello === 'rosso' && <i className="bd-punto bd-punto--problema" />}{String(c.nome || '').trim()}</span>
            <Quota v={Number(c.pct || 0) / max} etichetta={`${pct(c.pct)}% di resi`} />
            <b>{pct(c.pct)}%</b>
          </li>
        )) : <li className="bd-nota">{a ? 'nessun cliente da segnalare' : analisi.stato === 'manca' ? 'non disponibile' : ''}</li>}
      </ul>
      <Oggetto n="resi" tema={tema} misura="s" />
    </div>
  )
}

