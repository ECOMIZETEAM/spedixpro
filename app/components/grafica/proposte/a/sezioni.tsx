'use client'
// Sotto la prima schermata della Torre (proposta A, 27/10): gli stessi dati della Plancia di oggi, nello stesso
// linguaggio della sala di controllo (etichette monospazio, tacche, vetro sottile, un solo accento).
// 01 giacenze da risolvere · 02 gli stati e i mesi · 03 i soldi col periodo unico · 04 i saldi aperti · 05 la rete
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Conta, calmo } from '../../movimento'
import { fmtN, iso, MESI, usaJson } from '../../PlanciaNuova'
import { Icona } from '../../icone'
import { vettoreFisico } from '@/lib/vettore'

const intero = (n: number) => fmtN.format(n)
const fmtE = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' as any })
const euroT = (v: number) => (v < -0.004 ? '−€ ' : '€ ') + fmtE.format(Math.abs(v))
const virgola = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d).replace('.', ',')

// l'euro della Torre: cifre monospazio, i centesimi più piccoli
function Euro({ v, segno }: { v: number; segno?: boolean }) {
  const neg = v < -0.004, s = fmtE.format(Math.abs(v)).split(',')
  return <span className="pa-euro"><small>{neg || segno ? '−€' : '€'}</small>{s[0]}<small>,{s[1]}</small></span>
}

// le sezioni entrano quando arrivano; quelle già nello schermo all'apertura restano ferme (niente lampo)
function useRivelaA(radice: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const r = radice.current
    if (!r || calmo() || !('IntersectionObserver' in window)) return
    const sez = [...r.querySelectorAll(':scope > section')] as HTMLElement[]
    for (const s of sez) if (s.getBoundingClientRect().top < innerHeight) s.classList.add('pa-visto')
    r.classList.add('pa-anima')
    const oss = new IntersectionObserver((voci) => {
      for (const v of voci) if (v.isIntersecting) { v.target.classList.add('pa-visto'); oss.unobserve(v.target) }
    }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' })
    sez.forEach(s => { if (!s.classList.contains('pa-visto')) oss.observe(s) })
    return () => oss.disconnect()
  }, [radice])
}

function Testa({ n, titolo, meta, children, id }: { n: string; titolo: React.ReactNode; meta?: React.ReactNode; children?: React.ReactNode; id: string }) {
  return (
    <header className="pa-mod">
      <span className="pa-mod__n">{n}</span>
      <h2 id={id}>{titolo}</h2>
      <i className="pa-mod__filo" />
      {meta && <span className="pa-mod__meta">{meta}</span>}
      {children}
    </header>
  )
}

// le tacche: una barra fatta di segmenti, accesi in proporzione (come i misuratori di una console)
function Tacche({ quota, n = 40, tono }: { quota: number; n?: number; tono?: string }) {
  const accese = Math.round(Math.max(0, Math.min(1, quota)) * n)
  return <span className={'pa-tacche' + (tono ? ' pa-tacche--' + tono : '')} aria-hidden="true">{Array.from({ length: n }, (_, i) => <i key={i} className={i < accese ? 'pa-su' : undefined} style={{ ['--k' as any]: i }} />)}</span>
}

export const Sezioni = memo(function Sezioni({ data, badge, resi, quando }: { data: any; badge: any; resi: any; quando: Date | null }) {
  const radice = useRef<HTMLDivElement>(null)
  useRivelaA(radice)
  return (
    <div className="pa-sezioni" ref={radice}>
      <Giacenze data={data} badge={badge} />
      <Stati data={data} />
      <Soldi />
      <Saldi data={data} />
      <Rete data={data} resi={resi} />
      <p className="pa-piede">{quando ? `Aggiornato alle ${String(quando.getHours()).padStart(2, '0')}:${String(quando.getMinutes()).padStart(2, '0')} · i numeri si rileggono da soli ogni due minuti` : ' '}</p>
    </div>
  )
})

// ── 01 · Giacenze da risolvere, e le altre code che aspettano una mano ──
function Giacenze({ data, badge }: { data: any; badge: any }) {
  const giac = usaJson<any>('/api/spedizioni/lista?page=1&perPage=5&stato=in_giacenza')
  const n = Number(data?.inGiacenza || 0)
  const gg = (s: string) => { const d = new Date(s); return isNaN(+d) ? '' : `${d.getDate()} ${MESI[d.getMonth()].slice(0, 3)}` }
  const code = [
    { n: Number(badge?.daConfermare || 0), testo: 'rettifiche da confermare', sotto: badge?.daConfermareImporto ? euroT(Number(badge.daConfermareImporto)) + ' in attesa' : '', azione: 'Conferma', href: '/dashboard/spedizioni/rettifica', pronto: !!badge },
    { n: Number(badge?.daAccettare || 0), testo: 'richieste della rete', sotto: '', azione: 'Rivedi', href: '/dashboard/network', pronto: !!badge },
    { n: Number(data?.daMettereInDistinta || 0), testo: 'da chiudere in distinta', sotto: 'tutta la tua rete', azione: 'Crea distinta', href: '/dashboard/distinte/crea', pronto: !!data },
  ]
  return (
    <section aria-labelledby="pa-t-giac">
      <Testa n="01" id="pa-t-giac" titolo="Giacenze da risolvere" meta={data ? (n === 1 ? '1 aperta' : `${intero(n)} aperte`) : '…'} />
      <div className="pa-due pa-due--7-5">
        <div className="pa-pan gx-vetro">
          <div className="pa-pan__testa"><span>Aspettano le tue istruzioni</span><a href="/dashboard/spedizioni/giacenze">Tutte le giacenze<Icona id="i-chevron" /></a></div>
          {giac?.rows?.length ? (
            <ul className="pa-giac">
              {giac.rows.map((s: any, i: number) => (
                <li key={s.id || i}>
                  <time><small>dal</small>{gg(s.giacenza_data || s.created_at)}</time>
                  <div><b>{s.dest_nome || '—'}</b><span>{String(s.dest_citta || '').toUpperCase()}{s.giacenza_motivo ? ' · ' + String(s.giacenza_motivo).toLowerCase() : ''}</span></div>
                  <a className="pa-btn" href="/dashboard/spedizioni/giacenze">Istruzioni</a>
                </li>
              ))}
            </ul>
          ) : <p className="pa-vuoto">{giac ? 'Nessuna giacenza da risolvere: tutto in movimento.' : '…'}</p>}
        </div>
        <div className="pa-pan gx-vetro">
          <div className="pa-pan__testa"><span>Le altre code</span></div>
          <ul className="pa-code">
            {code.map(c => (
              <li key={c.href} className={c.n ? undefined : 'pa-spento'}>
                <b>{c.pronto ? <Conta v={c.n}>{intero}</Conta> : '—'}</b>
                <div><span>{c.testo}</span>{c.sotto && <small>{c.sotto}</small>}</div>
                <a className="pa-btn" href={c.href}>{c.azione}</a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

// ── 02 · Gli stati degli ultimi 30 giorni e i mesi ──
const INGLESE: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
const meseIt = (m: any) => { const s = String(m || '').trim(), i = INGLESE[s.slice(0, 3).toLowerCase()]; return i === undefined ? s.toLowerCase() : MESI[i] }

function Stati({ data }: { data: any }) {
  const s: Record<string, number> = data?.statiUltimi30 || {}
  const v = (k: string) => Number(s[k] || 0)
  const gruppi = [
    { k: 'corso', nome: 'In corso', n: v('in_lavorazione') + v('spedita') + v('in_transito') + v('in_consegna'), dett: [['in lavorazione', 'in_lavorazione'], ['spedite', 'spedita'], ['in transito', 'in_transito'], ['in consegna', 'in_consegna']] },
    { k: 'bene', nome: 'Consegnate', n: v('consegnata'), dett: [] as string[][] },
    { k: 'problema', nome: 'Problemi', n: v('in_giacenza') + v('non_consegnato') + v('reso_mittente'), dett: [['resi', 'reso_mittente'], ['in giacenza', 'in_giacenza'], ['non consegnate', 'non_consegnato']] },
    { k: 'fermo', nome: 'Annullate', n: v('annullata') + v('storno_richiesto') + v('annullamento_pending'), dett: [['annullate', 'annullata'], ['storno richiesto', 'storno_richiesto'], ['in annullamento', 'annullamento_pending']] },
  ]
  const tot = gruppi.reduce((a, g) => a + g.n, 0)
  const mesi: any[] = (data?.statsMensili || []).slice(-12)
  const max = Math.max(1, ...mesi.map(m => Number(m.totale || 0)))
  return (
    <section aria-labelledby="pa-t-stati">
      <Testa n="02" id="pa-t-stati" titolo="Stati e mesi" meta="ultimi 30 giorni · ultimi mesi" />
      <div className="pa-due pa-due--6-6">
        <div className="pa-pan gx-vetro">
          <div className="pa-pan__testa"><span>Stato delle spedizioni · 30 giorni</span><a href="/dashboard/spedizioni">Spedizioni<Icona id="i-chevron" /></a></div>
          <div className="pa-grande"><b>{data ? <Conta v={tot}>{intero}</Conta> : '—'}</b><span>spedizioni negli ultimi 30 giorni</span></div>
          <ul className="pa-stati">
            {gruppi.map(g => (
              <li key={g.k}>
                <div className="pa-stati__riga"><i className={'pa-punto pa-punto--' + g.k} /><span>{g.nome}</span><b>{intero(g.n)}</b><em>{tot ? virgola(g.n / tot * 100) + '%' : '—'}</em></div>
                <Tacche quota={tot ? g.n / tot : 0} n={56} tono={g.k} />
                {g.dett.length > 0 && <small>{g.dett.map(([t, k]) => `${t} ${intero(v(k))}`).join(' · ')}</small>}
              </li>
            ))}
          </ul>
        </div>
        <div className="pa-pan gx-vetro">
          <div className="pa-pan__testa"><span>Spedizioni per mese</span><em>il mese in corso fino a oggi</em></div>
          {mesi.length ? (
            <div className="pa-mesi" role="img" aria-label={'Spedizioni per mese: ' + mesi.map(m => `${meseIt(m.mese)} ${m.totale}`).join(', ')}>
              {mesi.map((m, i) => {
                const q = Number(m.totale || 0) / max, ora = i === mesi.length - 1, segmenti = 22
                return (
                  <div key={i} className={'pa-mese' + (ora ? ' pa-mese--ora' : '')}>
                    <b>{intero(Number(m.totale || 0))}</b>
                    <span className="pa-mese__colonna">{Array.from({ length: segmenti }, (_, k) => <i key={k} className={k < Math.max(1, Math.round(q * segmenti)) ? 'pa-su' : undefined} style={{ ['--k' as any]: k + i * 3 }} />)}</span>
                    <span className="pa-mese__nome">{meseIt(m.mese).slice(0, 3)}</span>
                    <small>{euroT(Number(m.importo || 0)).replace(/,\d\d$/, '')}</small>
                  </div>
                )
              })}
            </div>
          ) : <p className="pa-vuoto">{data ? 'Ancora nessun mese da mostrare.' : '…'}</p>}
        </div>
      </div>
    </section>
  )
}

// ── 03 · I soldi, con UN periodo che vale per tutti i riquadri ──
type Periodo = { k: string; da: Date; a: Date; nome: string }
const spostaGiorni = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function periodo(k: string, da?: Date, a?: Date): Periodo {
  const oggi = new Date()
  if (k === 'oggi') return { k, da: oggi, a: oggi, nome: 'oggi' }
  if (k === 'settimana') return { k, da: spostaGiorni(oggi, -((oggi.getDay() + 6) % 7)), a: oggi, nome: 'questa settimana' }
  if (k === 'scorso') { const d = new Date(oggi.getFullYear(), oggi.getMonth() - 1, 1); return { k, da: d, a: new Date(oggi.getFullYear(), oggi.getMonth(), 0), nome: MESI[d.getMonth()] } }
  if (k === 'date' && da && a) return { k, da, a, nome: `dal ${da.getDate()} ${MESI[da.getMonth()].slice(0, 3)} al ${a.getDate()} ${MESI[a.getMonth()].slice(0, 3)}` }
  return { k: 'mese', da: new Date(oggi.getFullYear(), oggi.getMonth(), 1), a: oggi, nome: MESI[oggi.getMonth()] + ' fino a oggi' }
}
const VOCI = [
  { k: 'rettifiche', nome: 'Rettifiche', url: '/api/reports/guadagno-rettifiche', icona: 'i-regola', href: '/dashboard/reports/rettifiche', trama: 'righe-a' },
  { k: 'resi', nome: 'Resi', url: '/api/reports/guadagno-resi', icona: 'i-resi', href: '/dashboard/reports/resi', trama: 'punti' },
  { k: 'giacenze', nome: 'Giacenze', url: '/api/reports/guadagno-giacenze', icona: 'i-magazzino', href: '/dashboard/reports/giacenze', trama: 'righe' },
  { k: 'logistica', nome: 'Logistica', url: '/api/reports/guadagno-logistica', icona: 'i-scatole', href: '/dashboard/logistica/addebiti', trama: 'pieno-t' },
  { k: 'consumabili', nome: 'Consumabili', url: '/api/reports/guadagno-consumabili', icona: 'i-pacco', href: '/dashboard/reports/consumabili', trama: 'punti-t' },
]

function Soldi() {
  // il periodo si sceglie dopo l'apertura: l'«oggi» del server (UTC) e quello del browser possono non coincidere
  const [p, setP] = useState<Periodo | null>(null)
  useEffect(() => { setP(periodo('mese')) }, [])
  const [cal, setCal] = useState(false)
  const q = p ? `?dal=${iso(p.da)}&al=${iso(p.a)}` : null
  const su = (u: string) => (q ? u + q : null)
  const tot = usaJson<any>(su('/api/reports/guadagno-totale'))
  const sped = usaJson<any>(su('/api/reports/guadagno'))
  const voci = [usaJson<any>(su(VOCI[0].url)), usaJson<any>(su(VOCI[1].url)), usaJson<any>(su(VOCI[2].url)), usaJson<any>(su(VOCI[3].url)), usaJson<any>(su(VOCI[4].url))]
  const conGestione = tot && tot.costiGestione !== undefined
  const gest = usaJson<any>(conGestione ? su('/api/costi-gestione') : null)
  // i dati di un periodo arrivano uno alla volta: finché non c'è il totale del periodo nuovo, si vede l'attesa
  const chiave = q || ''
  const parti = [{ k: 'spedizioni', nome: 'Spedizioni', g: Number(sped?.guadagno || 0), trama: 'pieno-a' }, ...VOCI.map((v, i) => ({ k: v.k, nome: v.nome, g: Number(voci[i]?.guadagno || 0), trama: v.trama }))]
  const altre = Number(tot?.guadagno || 0) - parti.reduce((a, x) => a + x.g, 0)
  if (tot && altre > 0.005) parti.push({ k: 'altre', nome: 'Altre voci', g: altre, trama: 'vuoto' })
  const pos = parti.filter(x => x.g > 0.005), somma = pos.reduce((a, x) => a + x.g, 0) || 1
  const margine = tot?.ricavi ? tot.guadagno / tot.ricavi * 100 : null
  return (
    <section aria-labelledby="pa-t-soldi">
      <Testa n="03" id="pa-t-soldi" titolo={<>I soldi <span className="pa-mod__sotto">· {p ? p.nome : '…'}</span></>}>
        <div className="pa-periodo">
          <div className="pa-periodo__scelte gx-vetro gx-pillola" role="group" aria-label="Periodo di tutti i riquadri dei soldi">
            {[['oggi', 'Oggi'], ['settimana', 'Questa settimana'], ['mese', 'Questo mese'], ['scorso', 'Mese scorso']].map(([k, t]) => (
              <button key={k} type="button" aria-pressed={p?.k === k} onClick={() => { setCal(false); setP(periodo(k)) }}>{t}</button>
            ))}
            <button type="button" aria-pressed={p?.k === 'date'} aria-expanded={cal} onClick={() => setCal(c => !c)}><Icona id="i-calendario" />{p?.k === 'date' ? `${p.da.getDate()}/${p.da.getMonth() + 1} – ${p.a.getDate()}/${p.a.getMonth() + 1}` : 'Scegli le date'}</button>
          </div>
          {cal && p && <ScegliDate p={p} chiudi={() => setCal(false)} scegli={x => { setP(x); setCal(false) }} />}
        </div>
      </Testa>
      <p className="pa-nota">Il periodo vale per tutti i riquadri di questa sezione{p ? ` · dal ${p.da.getDate()} ${MESI[p.da.getMonth()].slice(0, 3)} al ${p.a.getDate()} ${MESI[p.a.getMonth()].slice(0, 3)} ${p.a.getFullYear()}` : ''}</p>

      <div className="pa-due pa-due--5-7">
        <div className="pa-pan gx-vetro pa-totale">
          <div className="pa-pan__testa"><span>Guadagno totale</span><a href="/dashboard/statistiche/profitto">Report guadagno<Icona id="i-chevron" /></a></div>
          <b className={'pa-totale__n' + (Number(tot?.guadagno) < 0 ? ' pa-meno' : '')}>{tot ? <Conta v={Number(tot.guadagno || 0)}>{n => <Euro v={n} />}</Conta> : '…'}</b>
          <dl className="pa-letture">
            <div><dt>Incassato</dt><dd>{tot ? euroT(Number(tot.ricavi || 0)) : '…'}</dd></div>
            <div><dt>Costo</dt><dd>{tot ? euroT(Number(tot.costi || 0)) : '…'}</dd></div>
            <div><dt>Margine</dt><dd>{margine === null ? '—' : virgola(margine) + '%'}</dd></div>
          </dl>
          <div className="pa-comp" role="img" aria-label={'Di cosa è fatto il guadagno: ' + pos.map(x => `${x.nome} ${euroT(x.g)}`).join(', ')}>
            <div className="pa-comp__barra">{pos.map(x => <i key={x.k} className={'pa-trama--' + x.trama} style={{ flex: x.g }} title={`${x.nome} ${euroT(x.g)}`} />)}</div>
            <ul>{pos.map(x => <li key={x.k}><i className={'pa-trama--' + x.trama} />{x.nome}<b>{Math.round(x.g / somma * 100)}%</b></li>)}</ul>
          </div>
          {conGestione && (
            <div className="pa-netto">
              <div><span>Costi di gestione</span><b><Euro v={Number(tot.costiGestione || 0)} segno={Number(tot.costiGestione) > 0} /></b></div>
              <div className="pa-netto__utile"><span>Utile netto</span><b className={Number(tot.utileNetto) < 0 ? 'pa-meno' : undefined}><Euro v={Number(tot.utileNetto || 0)} /></b></div>
              <p><Icona id="i-lucchetto" />Queste due righe le vedete solo tu e i tuoi admin</p>
            </div>
          )}
        </div>
        <div className="pa-pan gx-vetro">
          <div className="pa-pan__testa"><span>Guadagno spedizioni</span><em>le rettifiche hanno il loro riquadro</em></div>
          <dl className="pa-letture pa-letture--4">
            <div><dt>Margine</dt><dd className={'pa-letture__grande' + (Number(sped?.guadagno) < 0 ? ' pa-meno' : '')}>{sped ? <Conta v={Number(sped.guadagno || 0)}>{n => <Euro v={n} />}</Conta> : '…'}</dd></div>
            <div><dt>Fatturato</dt><dd>{sped ? euroT(Number(sped.ricavi || 0)) : '…'}</dd></div>
            <div><dt>Costi</dt><dd>{sped ? euroT(Number(sped.costi || 0)) : '…'}</dd></div>
            <div><dt>Media a spedizione</dt><dd>{sped ? euroT(Number(sped.mediaSped || 0)) : '…'}<small>{sped ? `${intero(Number(sped.numSpedizioni || 0))} spedizioni` : ''}</small></dd></div>
          </dl>
          <Traccia serie={sped?.serie || null} chiave={chiave} />
        </div>
      </div>

      <div className={'pa-voci' + (conGestione ? ' pa-voci--6' : '')}>
        {VOCI.map((v, i) => {
          const d = voci[i], g = Number(d?.guadagno || 0)
          return (
            <a key={v.k} className="pa-voce gx-vetro" href={v.href}>
              <span className="pa-voce__testa"><Icona id={v.icona} />{v.nome}</span>
              <b className={g < 0 ? 'pa-meno' : undefined}>{d ? <Conta v={g}>{n => <Euro v={n} />}</Conta> : '…'}</b>
              <small>incassato {d ? euroT(Number(d.ricavi || 0)) : '…'}</small>
              <small>costo {d ? euroT(Number(d.costi || 0)) : '…'}</small>
            </a>
          )
        })}
        {conGestione && (
          <a className="pa-voce pa-voce--gestione gx-vetro" href="/dashboard/costi-gestione">
            <span className="pa-voce__testa"><Icona id="i-costi" />Costi di gestione</span>
            <b>{gest ? <Euro v={Number(gest.totale || 0)} segno={Number(gest.totale) > 0} /> : '…'}</b>
            {gest?.perCategoria?.length
              ? gest.perCategoria.slice(0, 2).map((c: any) => <small key={c.categoria}>{String(c.categoria).toLowerCase()} {euroT(Number(c.importo || 0))}</small>)
              : <small>{gest ? 'nessun costo segnato nel periodo' : '…'}</small>}
          </a>
        )}
      </div>
    </section>
  )
}

// il periodo a scelta: due date, dal e al (fino a oggi)
function ScegliDate({ p, chiudi, scegli }: { p: Periodo; chiudi: () => void; scegli: (p: Periodo) => void }) {
  const [da, setDa] = useState(iso(p.da)), [a, setA] = useState(iso(p.a))
  const box = useRef<HTMLDivElement>(null)
  const oggi = useMemo(() => iso(new Date()), [])
  useEffect(() => {
    const fuori = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.pa-periodo__scelte')) chiudi() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') chiudi() }
    document.addEventListener('mousedown', fuori); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fuori); document.removeEventListener('keydown', esc) }
  }, [chiudi])
  const valido = da && a && da <= a && a <= oggi
  return (
    <div className="pa-date gx-vetro" ref={box} role="dialog" aria-label="Scegli le date">
      <label><span>Dal</span><input type="date" value={da} max={oggi} onChange={e => setDa(e.target.value)} /></label>
      <label><span>Al</span><input type="date" value={a} max={oggi} onChange={e => setA(e.target.value)} /></label>
      <div><button type="button" className="pa-btn" onClick={chiudi}>Annulla</button>
        <button type="button" className="pa-btn pa-btn--pieno" disabled={!valido} onClick={() => valido && scegli(periodo('date', new Date(da + 'T12:00:00'), new Date(a + 'T12:00:00')))}>Applica</button></div>
    </div>
  )
}

// il margine giorno per giorno: una traccia sottile coi nodi, l'ultimo acceso (come le rotte di volo di una console)
function Traccia({ serie, chiave }: { serie: any[] | null; chiave: string }) {
  if (!serie) return <p className="pa-vuoto">…</p>
  if (!serie.length) return <p className="pa-vuoto">Nessuna spedizione nel periodo.</p>
  const W = 700, H = 190, l = 56, r = 16, top = 18, b = 26
  const vals = serie.map(s => Number(s.margine || 0)), mx = Math.max(1, ...vals), mn = Math.min(0, ...vals)
  const passi = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000], tacca = passi.find(x => (mx - mn) / x <= 4) || 50000
  const cima = Math.ceil(mx / tacca) * tacca, fondo = Math.floor(mn / tacca) * tacca
  const X = (i: number) => serie.length === 1 ? (l + W - r) / 2 : l + i * (W - l - r) / (serie.length - 1)
  const Y = (v: number) => top + (1 - (v - fondo) / Math.max(1, cima - fondo)) * (H - top - b)
  const et = (g: string) => (g.length === 7 ? MESI[+g.slice(5, 7) - 1].slice(0, 3) : `${+g.slice(8, 10)}/${+g.slice(5, 7)}`)
  const d = serie.map((s, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(Number(s.margine || 0)).toFixed(1)}`).join('')
  const area = d + `L${X(serie.length - 1).toFixed(1)} ${Y(Math.max(0, fondo)).toFixed(1)}L${X(0).toFixed(1)} ${Y(Math.max(0, fondo)).toFixed(1)}Z`
  const ogni = Math.max(1, Math.ceil(serie.length / 8)), ultimo = serie.length - 1
  return (
    <svg key={chiave} className="pa-traccia" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={'Margine delle spedizioni: ' + serie.map(s => `${et(s.giorno)} ${euroT(Number(s.margine || 0))}`).join('; ')}>
      <defs>
        <pattern id="pa-pp" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1" fill="var(--gx-accento)" opacity=".55" /></pattern>
        <linearGradient id="pa-sotto" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="1" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <mask id="pa-maschera-area"><rect x="0" y="0" width={W} height={H} fill="url(#pa-sotto)" /></mask>
      </defs>
      {Array.from({ length: Math.round((cima - fondo) / tacca) + 1 }, (_, i) => fondo + i * tacca).map(v => (
        <g key={v}><line x1={l} x2={W - r} y1={Y(v)} y2={Y(v)} className={v === 0 ? 'pa-traccia__zero' : 'pa-traccia__riga'} /><text x={l - 10} y={Y(v) + 4} textAnchor="end">{euroT(v).replace(/,00$/, '')}</text></g>
      ))}
      <path d={area} fill="url(#pa-pp)" mask="url(#pa-maschera-area)" className="pa-traccia__area" />
      <path d={d} className="pa-traccia__linea" pathLength={1} />
      {serie.length <= 40 && serie.map((s, i) => <circle key={s.giorno} cx={X(i)} cy={Y(Number(s.margine || 0))} r={i === ultimo ? 4.5 : 2.4} className={'pa-traccia__nodo' + (i === ultimo ? ' pa-traccia__nodo--ultimo' : '')} style={{ animationDelay: (0.5 + i * 0.025).toFixed(2) + 's' }}><title>{et(s.giorno)}: {euroT(Number(s.margine || 0))}</title></circle>)}
      {serie.map((s, i) => (i % ogni === 0 || i === ultimo) && (i === ultimo || ultimo - i >= ogni / 2) ? <text key={'t' + s.giorno} x={X(i)} y={H - 6} textAnchor="middle" className={i === ultimo ? 'pa-traccia__ultima' : undefined}>{et(s.giorno)}</text> : null)}
    </svg>
  )
}

// ── 04 · I saldi aperti: adesso, non cambiano col periodo ──
function Saldi({ data }: { data: any }) {
  const c = data?.creditiDaRecuperare
  const celle = [
    { t: 'Da recuperare a scalare', v: Number(c?.scalare?.totale || 0), s: c ? `${intero(Number(c.scalare?.clienti || 0))} clienti fermi finché non ricaricano` : '', href: '/dashboard/clienti' },
    { t: 'Da recuperare a fattura', v: Number(c?.fattura?.totale || 0), s: c ? `${intero(Number(c.fattura?.clienti || 0))} clienti, spediscono normalmente` : '', href: '/dashboard/fatture' },
    { t: 'Contrassegni da rimettere', v: Number(data?.codDaRimettere || 0), s: 'ai tuoi clienti', href: '/dashboard/contrassegni', positivo: true },
    { t: 'Conto proprio', v: Number(data?.creditoMaster?.proprio || 0), s: 'i tuoi contratti · movimenti', href: '/dashboard/movimenti' },
  ]
  return (
    <section aria-labelledby="pa-t-saldi">
      <Testa n="04" id="pa-t-saldi" titolo="Saldi aperti" meta={<><i className="pa-vivo" />adesso · non cambiano col periodo</>} />
      <div className="pa-saldi gx-vetro">
        {celle.map(x => (
          <a key={x.t} href={x.href} className="pa-saldo">
            <span>{x.t}</span>
            <b className={x.v < -0.004 && !x.positivo ? 'pa-meno' : undefined}>{data ? <Euro v={x.v} /> : '…'}</b>
            <small>{x.s}</small>
          </a>
        ))}
      </div>
    </section>
  )
}

// ── 05 · La rete ──
// il nome del corriere più usato è quello del contratto: se mai contenesse il nome di un fornitore tecnico, si
// mostra il vettore e basta (i fornitori tecnici non compaiono mai a master, agenti e clienti)
const corriere = (nome: string) => (/spediamo|spedisci|easy\s*parcel|\bdva\b/i.test(nome) ? vettoreFisico({ nome_contratto: nome }) : nome)

function Rete({ data, resi }: { data: any; resi: any }) {
  const peggiori: any[] = resi?.peggiori || []
  const mx = Math.max(1, ...peggiori.map(c => Number(c.pct || 0)))
  const numeri = [
    { v: Number(data?.spedizioniTotali || 0), t: 'spedizioni da sempre' },
    { v: Number(data?.clientiTotali || 0), t: 'clienti' },
    { v: Number(data?.sottomaster || 0), t: 'sotto-master' },
  ]
  return (
    <section aria-labelledby="pa-t-rete">
      <Testa n="05" id="pa-t-rete" titolo="La rete" meta="da sempre · resi a 90 giorni" />
      <div className="pa-rete gx-vetro">
        {numeri.map(n => <div key={n.t} className="pa-rete__n"><b>{data ? <Conta v={n.v}>{intero}</Conta> : '—'}</b><span>{n.t}</span></div>)}
        <div className="pa-rete__n pa-rete__n--corriere">
          <b>{data?.topCorriere ? <Conta v={Number(data.topCorriere.n || 0)}>{intero}</Conta> : '—'}</b>
          <span>{data?.topCorriere?.nome ? <>con <em>{corriere(String(data.topCorriere.nome))}</em>, il corriere più usato</> : 'il corriere più usato'}</span>
        </div>
      </div>
      <div className="pa-pan gx-vetro pa-resi">
        <div className="pa-pan__testa"><span>Clienti con più resi · 90 giorni</span><a href="/dashboard/resi/analisi">Analisi resi<Icona id="i-chevron" /></a></div>
        {peggiori.length ? (
          <ol>
            {peggiori.map((c: any, i: number) => (
              <li key={c.id || i}>
                <span className="pa-resi__i">{String(i + 1).padStart(2, '0')}</span>
                <div><b>{c.nome}</b><small>{intero(Number(c.resi || 0))} resi su {intero(Number(c.partite || 0))} partite</small></div>
                <Tacche quota={Number(c.pct || 0) / mx} n={32} tono={c.livello === 'rosso' ? 'problema' : 'corso'} />
                <em className={c.livello === 'rosso' ? 'pa-meno' : undefined}>{virgola(Number(c.pct || 0))}%</em>
              </li>
            ))}
          </ol>
        ) : <p className="pa-vuoto">{resi ? 'Nessun cliente con resi da segnalare.' : '…'}</p>}
      </div>
    </section>
  )
}
