'use client'
import { useMemo, useRef, useState } from 'react'
import { useDialog } from '@/app/components/DialogProvider'
import { descriviVoce, KG_PER_M3_BRT, type RigaFatturaBrt } from '@/lib/fattura-brt'
import { FORMATI, riconosciFormato, abbinaEsterne, righeRettificheEsterne, type FormatoEsterno, type SpedizioneEsterna, type AbbinataEsterna } from '@/lib/gestionali-esterni'
import { C, carta, cifre, euro, conSegno, kg, r2, Icona, Tessera, Pillola } from './ui'

/* LE SPEDIZIONI DELLA FATTURA FATTE CON UN ALTRO GESTIONALE. Il detentore carica l'export spedizioni di
 * quel gestionale (uno o più file): le righe che Moove non ha trovato si abbinano lì, si vede dove ha perso,
 * e si scarica il file di rettifiche nel formato di quel gestionale, da caricare là. Qui non si muove un
 * euro e non si salva niente: tutto resta nel browser, sul file che il detentore ha in mano. */

type FileCaricato = { nome: string; formato: FormatoEsterno; spedizioni: SpedizioneEsterna[] }
type Filtro = 'perdita' | 'tutte' | 'rettifica' | 'rientri'
const PER_PAGINA = 50

// Perché BRT l'ha tassata così: pesata, misurata, o il volume scritto sulla bolla; poi l'arrotondamento.
function comeTassata(r: RigaFatturaBrt) {
  const m = r.pesoMisurato ?? r.pesoTassato   // le righe salvate nello storico prima del 02/11 non l'hanno
  const tassata = Math.abs(r.pesoTassato - m) > 0.001 ? `, tassata ${kg(r.pesoTassato)}` : ''
  if (r.pesoRilevato >= m - 0.001 && r.pesoRilevato > r.pesoDichiarato + 0.001) return `pesata ${kg(r.pesoRilevato)}${tassata}`
  if (r.volumeRilevato * KG_PER_M3_BRT >= m - 0.001 && r.volumeRilevato > 0) return `misurata ${r.volumeRilevato.toLocaleString('it-IT')} m³ = ${kg(m)}${tassata}`
  if (r.volumeFatturare * KG_PER_M3_BRT >= m - 0.001) return `volume in bolla ${r.volumeFatturare.toLocaleString('it-IT')} m³ = ${kg(m)}${tassata}`
  return `tassata ${kg(r.pesoTassato)}`
}
const vociDi = (r: RigaFatturaBrt) => [
  ...(r.nolo ? [`nolo ${euro(r.nolo)}`] : []),
  ...r.voci.filter(v => Math.abs(v.importo) >= 0.005).map(v => `${descriviVoce(v.sigla).nome} ${euro(v.importo)}`),
].join(' + ')

export type EsternoIniziale = { nome: string; formatoId: string; spedizioni: SpedizioneEsterna[] }

export default function AltriGestionali({ righe, numeroFattura, iniziali }: { righe: RigaFatturaBrt[]; numeroFattura: string; iniziali?: EsternoIniziale[] }) {
  const dialog = useDialog()
  const [file, setFile] = useState<FileCaricato[]>(() => (iniziali || [])
    .map(x => ({ nome: x.nome, formato: FORMATI.find(f => f.id === x.formatoId)!, spedizioni: x.spedizioni })).filter(x => x.formato))
  const [filtro, setFiltro] = useState<Filtro>('perdita')
  const [pagina, setPagina] = useState(1)
  const [trascina, setTrascina] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Ogni file abbina solo le righe che i file prima non hanno preso: la stessa riga non finisce in due posti.
  const esiti = useMemo(() => {
    let resto = righe
    return file.map(f => {
      const a = abbinaEsterne(resto, f.spedizioni)
      resto = a.nonAbbinate
      return { ...f, ...a, disponibili: resto.length + a.abbinate.reduce((n, x) => n + (x.andata ? 1 : 0) + x.rientri.length, 0) }
    })
  }, [righe, file])
  const nonAbbinate = esiti.length ? esiti[esiti.length - 1].nonAbbinate : righe
  const totaleNonAbbinate = r2(nonAbbinate.reduce((s, r) => s + r.totale, 0))

  async function carica(f: File) {
    if (inputRef.current) inputRef.current.value = ''
    const XLSX = await import('xlsx')
    let grezze: Record<string, any>[] = []
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' })
      grezze = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
    } catch { /* sotto: file non letto */ }
    const formato = grezze.length ? riconosciFormato(Object.keys(grezze[0])) : null
    if (!formato) {
      await dialog.alert({ title: 'File non riconosciuto', message: `Non riconosco le colonne di "${f.name}". Serve l'export spedizioni del gestionale, con queste colonne: `
        + FORMATI.map(x => x.descrizione).join('; ') + '. Se il tuo gestionale ne usa altre, mandaci un esempio e lo aggiungiamo.' })
      return
    }
    if (file.some(x => x.nome === f.name)) { await dialog.alert({ title: 'File già caricato', message: `"${f.name}" è già fra i file abbinati.` }); return }
    setFile(prev => [...prev, { nome: f.name, formato, spedizioni: grezze.map(formato.leggi).filter(s => s.ldv) }])
    setPagina(1)
  }

  async function scaricaRettifiche(e: (typeof esiti)[number]) {
    const XLSX = await import('xlsx')
    const t = e.formato.rettifiche
    const ws = XLSX.utils.aoa_to_sheet([t.colonne, ...righeRettificheEsterne(e.abbinate).map(t.riga)])
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, t.foglio)
    XLSX.writeFile(wb, `rettifiche-fattura-${numeroFattura}-${e.nome.replace(/\.[^.]+$/, '')}.xlsx`)
  }

  const tutte = esiti.flatMap(e => e.abbinate)
  const passa = (a: AbbinataEsterna, f: Filtro) => f === 'tutte' ? true
    : f === 'perdita' ? (a.margineAndata ?? 0) < -0.005 || a.brtRientri > 0
    : f === 'rettifica' ? a.daRettificare : a.rientri.length > 0
  const filtrate = tutte.filter(a => passa(a, filtro))
    .sort((a, b) => ((a.margineAndata ?? 0) - a.brtRientri) - ((b.margineAndata ?? 0) - b.brtRientri))
  const pagine = Math.max(1, Math.ceil(filtrate.length / PER_PAGINA))
  const pag = Math.min(pagina, pagine)

  const dropzone = (piccola: boolean) => (
    <div onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setTrascina(true) }} onDragLeave={() => setTrascina(false)}
      onDrop={e => { e.preventDefault(); setTrascina(false); const f = e.dataTransfer.files?.[0]; if (f) carica(f) }}
      style={{ border: `1.5px dashed ${trascina ? C.arancio : '#d0d5dd'}`, background: trascina ? C.arancioTenue : C.fondoTenue, borderRadius: 12,
        padding: piccola ? '12px 14px' : '22px 18px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
      <Tessera nome="carica" colore={C.arancioScuro} fondo="#fff" />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{piccola ? 'Aggiungi l\'export di un altro gestionale' : 'Carica l\'export spedizioni del gestionale'}</div>
        <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 2 }}>Trascina qui il file Excel, o clicca per sceglierlo. Le spedizioni si abbinano per lettera di vettura.</div>
      </div>
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) carica(f) }} />
    </div>
  )

  return (
    <div style={{ ...carta, padding: '16px 18px', marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
        <Tessera nome="pacco" colore={C.ambra} fondo={C.ambraTenue} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Spedizioni fatte con un altro gestionale</div>
          <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 2, lineHeight: 1.5, maxWidth: 820 }}>
            {righe.length.toLocaleString('it-IT')} righe della fattura ({euro(r2(righe.reduce((s, r) => s + r.totale, 0)))}) non sono spedizioni Moove.
            Se le hai create con un altro gestionale, carica il suo export spedizioni: le abbino, ti dico dove hai perso e ti preparo il file di rettifiche
            nel formato di quel gestionale, da caricare là. Qui non si addebita niente.
          </div>
        </div>
      </div>

      {!esiti.length && dropzone(false)}

      {esiti.map(e => {
        const andate = e.abbinate.filter(a => a.andata)
        const brtAndate = r2(andate.reduce((s, a) => s + a.brtAndata, 0))
        const prezzo = r2(andate.reduce((s, a) => s + a.sped.prezzoCliente, 0))
        const margine = r2(prezzo - brtAndate)
        const inPerdita = andate.filter(a => (a.margineAndata ?? 0) < -0.005).length
        const conRientri = e.abbinate.filter(a => a.rientri.length)
        const rientri = r2(conRientri.reduce((s, a) => s + a.brtRientri, 0))
        const rett = righeRettificheEsterne(e.abbinate)
        const multi = e.abbinate.filter(a => a.daRettificare && a.multicollo).length
        const righeAbbinate = e.abbinate.reduce((n, a) => n + (a.andata ? 1 : 0) + a.rientri.length, 0)
        return (
          <div key={e.nome} style={{ border: `1px solid ${C.filo}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <Icona nome="fattura" size={17} colore={C.attenuato} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{e.nome}</div>
                <div style={{ fontSize: 12, color: C.attenuato }}>{e.formato.descrizione} · {e.spedizioni.length.toLocaleString('it-IT')} spedizioni nel file</div>
              </div>
              <button onClick={() => { setFile(prev => prev.filter(x => x.nome !== e.nome)); setPagina(1) }}
                style={{ padding: '6px 11px', borderRadius: 8, border: `1px solid ${C.filo}`, background: '#fff', fontSize: 12.5, fontWeight: 600, color: C.attenuato, cursor: 'pointer' }}>Togli</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 12 }}>
              {[
                { t: 'Abbinate', v: `${righeAbbinate} di ${e.disponibili}`, n: 'righe della fattura', c: C.testo },
                { t: 'Andate: BRT', v: euro(brtAndate), n: `${andate.length} spedizioni`, c: C.testo },
                { t: 'Andate: pagato dai clienti', v: euro(prezzo), n: 'prezzo nel gestionale, contrassegno compreso', c: C.testo },
                { t: 'Margine sulle andate', v: conSegno(margine), n: inPerdita ? `${inPerdita} spedizioni in perdita` : 'nessuna in perdita', c: margine < -0.005 ? C.rosso : C.verde },
                { t: 'Resi e giacenze', v: euro(rientri), n: conRientri.length ? `${conRientri.length} spedizioni: l'export non dice se li hai fatti pagare` : 'nessuno', c: rientri ? C.ambra : C.testo },
              ].map(k => (
                <div key={k.t} style={{ background: C.fondoTenue, borderRadius: 10, padding: '11px 12px' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: C.attenuato }}>{k.t}</div>
                  <div style={{ fontSize: 19, fontWeight: 700, color: k.c, marginTop: 4, ...cifre }}>{k.v}</div>
                  <div style={{ fontSize: 11.5, color: C.attenuato, marginTop: 1, lineHeight: 1.35 }}>{k.n}</div>
                </div>
              ))}
            </div>

            {rett.length > 0 && (
              <div style={{ background: C.arancioTenue, border: `1px solid ${C.arancioOrlo}`, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Tessera nome="bilancia" colore={C.arancioScuro} fondo="#fff" />
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{rett.length} rettifiche di peso pronte per questo gestionale</div>
                  <div style={{ fontSize: 12.5, color: '#475467', marginTop: 2, lineHeight: 1.45 }}>
                    BRT le ha tassate più del peso su cui il gestionale ha fatto il prezzo. Il file ha le colonne che vuole lui
                    ({e.formato.rettifiche.colonne.join(', ')}), col peso tassato da BRT: caricalo là, e lì si ricalcola il prezzo al cliente.
                    {multi > 0 && ` ${multi} multicollo restano fuori: la fattura dà il peso totale e il file lo vuole collo per collo, vanno fatti a mano.`}
                  </div>
                </div>
                <button onClick={() => scaricaRettifiche(e)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, border: 'none', fontSize: 13.5, fontWeight: 700, background: C.arancio, color: '#fff', cursor: 'pointer' }}>
                  <Icona nome="scarica" size={16} /> Scarica il file di rettifiche
                </button>
              </div>
            )}
          </div>
        )
      })}

      {esiti.length > 0 && nonAbbinate.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, fontSize: 12.5, color: C.attenuato, background: C.fondoTenue, borderRadius: 9, padding: '9px 11px', marginBottom: 10, lineHeight: 1.45 }}>
            <Icona nome="avviso" size={16} />
            <span>
              {nonAbbinate.length === 1 ? '1 riga' : `${nonAbbinate.length} righe`} ({euro(totaleNonAbbinate)}) non trova{nonAbbinate.length === 1 ? '' : 'no'} la spedizione in nessun file:{' '}
              {nonAbbinate.slice(0, 6).map(r => `${r.tipoBolla === 'F1' ? 'andata' : r.tipoBolla.startsWith('A') ? 'reso' : 'bolla accessoria'} ${r.segnacollo} (${r.tipoBolla.startsWith('A') ? r.mittente : r.destinatario}, ${euro(r.totale)})`).join('; ')}
              {nonAbbinate.length > 6 ? '…' : ''}. Di solito è un pacco partito in un periodo che l'export non copre.
            </span>
          </div>
          {dropzone(true)}
        </div>
      )}
      {esiti.length > 0 && !nonAbbinate.length && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: C.verde, marginBottom: 12 }}><Icona nome="spunta" size={16} /> Tutte le righe hanno trovato la loro spedizione.</div>
      )}

      {tutte.length > 0 && (
        <div style={{ border: `1px solid ${C.filo}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.filo}` }}>
            <div style={{ display: 'inline-flex', background: C.fondoTenue, border: `1px solid ${C.filo}`, borderRadius: 10, padding: 3, flexWrap: 'wrap' }}>
              {([['perdita', 'Con perdita'], ['tutte', 'Tutte'], ['rettifica', 'Da rettificare'], ['rientri', 'Resi e giacenze']] as [Filtro, string][]).map(([k, l]) => (
                <button key={k} onClick={() => { setFiltro(k); setPagina(1) }}
                  style={{ padding: '6px 11px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    background: filtro === k ? '#fff' : 'transparent', color: filtro === k ? C.testo : C.attenuato, boxShadow: filtro === k ? '0 1px 3px rgba(16,24,40,.12)' : 'none' }}>
                  {l} <span style={{ color: C.attenuato, fontWeight: 500, marginLeft: 3 }}>{tutte.filter(a => passa(a, k)).length}</span>
                </button>
              ))}
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: C.fondoTenue, color: C.attenuato, fontSize: 11.5, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '.03em' }}>
                {['Lettera di vettura', 'Destinazione', 'Peso gestionale → BRT', 'BRT', 'Pagato dal cliente', 'Margine', 'Perché'].map((h, i) => (
                  <th key={h} style={{ padding: '10px 12px', fontWeight: 600, textAlign: i >= 3 && i <= 5 ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filtrate.slice((pag - 1) * PER_PAGINA, pag * PER_PAGINA).map(a => {
                  const r = a.andata
                  const netto = r2((a.margineAndata ?? 0) - a.brtRientri)
                  return (
                    <tr key={a.sped.ldv} style={{ borderTop: `1px solid ${C.filo}`, verticalAlign: 'top' }}>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }}>{a.sped.ldv}</div>
                        <div style={{ fontSize: 12, color: C.attenuato }}>{a.sped.cliente} · {a.sped.data}</div>
                        {a.sped.stato && <div style={{ marginTop: 3 }}><Pillola colore={C.attenuato} fondo={C.fondoTenue} orlo={C.filo}>{a.sped.stato}</Pillola></div>}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 600 }}>{a.sped.citta}</div>
                        <div style={{ fontSize: 12, color: C.attenuato }}>{a.sped.cap} · {a.sped.provincia}</div>
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {a.pesoBrt != null
                          ? <>{kg(a.sped.peso)} <span style={{ color: C.attenuato }}>→</span> <b style={{ color: a.daRettificare ? C.rosso : C.testo }}>{kg(a.pesoBrt)}</b></>
                          : <span style={{ color: C.attenuato }}>andata in un'altra fattura</span>}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap', ...cifre }}>
                        <div style={{ fontWeight: 700 }}>{euro(r2(a.brtAndata + a.brtRientri))}</div>
                        {a.andata && a.brtRientri > 0 && <div style={{ fontSize: 12, color: C.ambra, whiteSpace: 'nowrap' }}>+ resi e giacenze {euro(r2(a.brtRientri))}</div>}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap', ...cifre }}>{a.andata ? euro(a.sped.prezzoCliente) : <span style={{ color: C.attenuato }}>—</span>}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <Pillola colore={netto < -0.005 ? C.rosso : C.verde} fondo={netto < -0.005 ? C.rossoTenue : C.verdeTenue} orlo={netto < -0.005 ? C.rossoOrlo : C.verdeOrlo}>{conSegno(netto)}</Pillola>
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12.5, color: '#475467', lineHeight: 1.5, minWidth: 280 }}>
                        {r && <div>Andata: {vociDi(r)}.{a.daRettificare ? ` BRT l'ha ${comeTassata(r)}, il gestionale aveva ${kg(a.sped.peso)}.` : ''}</div>}
                        {a.rientri.map(x => (
                          <div key={x.segnacollo + x.numeroSpedizione}>{x.tipoBolla.startsWith('A') ? 'Reso al mittente' : 'Bolla accessoria (giacenza)'}: {vociDi(x)}.</div>
                        ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {pagine > 1 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', padding: '10px 12px', borderTop: `1px solid ${C.filo}`, fontSize: 12.5, color: C.attenuato }}>
              <button disabled={pag <= 1} onClick={() => setPagina(pag - 1)} style={{ padding: '5px 10px', borderRadius: 7, border: `1px solid ${C.filo}`, background: '#fff', cursor: pag <= 1 ? 'default' : 'pointer' }}>‹</button>
              pagina {pag} di {pagine}
              <button disabled={pag >= pagine} onClick={() => setPagina(pag + 1)} style={{ padding: '5px 10px', borderRadius: 7, border: `1px solid ${C.filo}`, background: '#fff', cursor: pag >= pagine ? 'default' : 'pointer' }}>›</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
