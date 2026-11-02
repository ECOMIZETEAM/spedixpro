'use client'
import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useDialog } from '@/app/components/DialogProvider'
import type { LetturaCompensazione } from '@/lib/compensazione-brt'
import { destinaContrassegni, FILE_CONTRASSEGNI, type Destino, type EsitoContrassegno, type SpedizioneMoove } from '@/lib/contrassegni-gestionali'
import { FORMATI, riconosciFormato, type SpedizioneEsterna } from '@/lib/gestionali-esterni'
import { C, carta, cifre, euro, r2, Icona, Tessera, Pillola } from '@/app/dashboard/spedizioni/controllo-fattura/ui'

/* CHECK CONTRASSEGNI. Il detentore carica la compensazione contrassegni di BRT (il PDF): si vede quali contrassegni
 * sono spedizioni Moove — vanno in Distinte contrassegni, con la stessa rotta del file del corriere — e per quelli
 * creati con un altro gestionale si scarica il file da caricare là, nel suo tracciato. Il gestionale che vuole la
 * lettera di vettura ha bisogno anche del suo export spedizioni: nel PDF di BRT la lettera di vettura non c'è.
 * Qui non si salva niente: il PDF lo legge il server e torna indietro, gli export restano nel browser. */

type Compensazione = LetturaCompensazione & { nome: string; moove: Record<string, SpedizioneMoove>; contrattiBrt: number }
type FileExport = { nome: string; spedizioni: SpedizioneEsterna[] }
type Filtro = 'tutti' | Destino
type EsitoInvio = { nuovi: number; euro: number; giaInSosta: number; giaInDistinta: number; scartati: { ldv: string; motivo: string }[]; problemi: string[] }

const DESTINI: Record<Destino, { nome: string; colore: string; fondo: string; orlo: string }> = {
  moove: { nome: 'Spedizione Moove', colore: C.verde, fondo: C.verdeTenue, orlo: C.verdeOrlo },
  riferimento: { nome: 'File col riferimento', colore: C.arancioScuro, fondo: C.arancioTenue, orlo: C.arancioOrlo },
  ldv: { nome: 'File con lettera di vettura', colore: C.arancioScuro, fondo: C.arancioTenue, orlo: C.arancioOrlo },
  sistemare: { nome: 'Da sistemare', colore: C.rosso, fondo: C.rossoTenue, orlo: C.rossoOrlo },
}
const BLOCCO_INVIO = 200
const dataIt = (iso: string) => iso.split('-').reverse().join('/')
const bottone = (primario: boolean) => ({ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
  border: primario ? 'none' : `1px solid ${C.filo}`, background: primario ? C.arancio : '#fff', color: primario ? '#fff' : C.testo } as const)

export default function CheckContrassegni() {
  const dialog = useDialog()
  const [comp, setComp] = useState<Compensazione | null>(null)
  const [esportati, setEsportati] = useState<FileExport[]>([])
  const [leggo, setLeggo] = useState(false)
  const [trascina, setTrascina] = useState(false)
  const [filtro, setFiltro] = useState<Filtro>('tutti')
  const [invio, setInvio] = useState<'in corso' | EsitoInvio | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const esiti = useMemo(() => comp ? destinaContrassegni(comp.righe, comp.moove, esportati.flatMap(e => e.spedizioni)) : [], [comp, esportati])
  const di = (d: Destino) => esiti.filter(e => e.destino === d)
  const somma = (l: EsitoContrassegno[]) => r2(l.reduce((s, e) => s + e.riga.importo, 0))
  const sommaRighe = somma(esiti)
  const dataReg = comp?.righe[0]?.dataRegistrazione || ''

  // Il PDF lo legge il server (pdfjs); gli export si leggono qui, come in Controllo fattura.
  async function leggiPdf(f: File): Promise<any> {
    const b = new Uint8Array(await f.arrayBuffer()); let bin = ''
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return fetch('/api/contrassegni/compensazione-brt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pdfBase64: btoa(bin) }) })
      .then(r => r.json()).catch(() => ({ error: 'Errore di connessione' }))
  }

  async function caricaFile(lista: File[]) {
    if (fileRef.current) fileRef.current.value = ''
    const pdf = lista.find(f => /\.pdf$/i.test(f.name))
    const altri = lista.filter(f => !/\.pdf$/i.test(f.name))
    for (const f of altri) {
      const XLSX = await import('xlsx')
      let grezze: Record<string, any>[] = []
      try { const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' }); grezze = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }) } catch { /* sotto */ }
      const formato = grezze.length ? riconosciFormato(Object.keys(grezze[0])) : null
      if (!formato) {
        await dialog.alert({ title: 'File non riconosciuto', message: `Non riconosco le colonne di "${f.name}". Qui servono il PDF della compensazione contrassegni di BRT e, per i contrassegni che vogliono la lettera di vettura, l'export spedizioni del gestionale, con queste colonne: ${FORMATI.map(x => x.descrizione).join('; ')}. Se il tuo gestionale ne usa altre, mandaci un esempio e lo aggiungiamo.` })
        continue
      }
      const spedizioni = grezze.map(formato.leggi).filter(s => s.ldv)
      setEsportati(prev => prev.some(x => x.nome === f.name) ? prev : [...prev, { nome: f.name, spedizioni }])
    }
    if (!pdf) {
      if (!comp && !altri.length) await dialog.alert({ title: 'Manca il PDF', message: 'Il check parte dal PDF "Compensazione contrassegni cliente" che manda BRT.' })
      return
    }
    setLeggo(true)
    const d = await leggiPdf(pdf)
    setLeggo(false)
    if (d.error) { await dialog.alert({ title: 'PDF non letto', message: d.error }); return }
    setComp({ ...d, nome: pdf.name }); setFiltro('tutti'); setInvio(null)
  }

  async function scarica(tipo: 'riferimento' | 'ldv') {
    const XLSX = await import('xlsx')
    const t = FILE_CONTRASSEGNI[tipo]
    const ws = XLSX.utils.aoa_to_sheet([t.colonne, ...di(tipo).map(t.riga)])
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, t.foglio)
    XLSX.writeFile(wb, `contrassegni-${dataIt(dataReg).replace(/\//g, '-')}-${tipo === 'ldv' ? 'lettera-di-vettura' : 'riferimento-mittente'}.xlsx`)
  }

  // I contrassegni Moove passano dalla stessa rotta del file del corriere: finiscono fra i "Contrassegni da
  // caricare" con le sue guardie (già in sosta, già in una mia distinta, fuori dalla rete). Rimandarli non
  // duplica niente. L'importo è quello compensato da BRT, che è quello che scende al cliente.
  async function mandaInDistinte() {
    if (!comp) return
    const moove = di('moove')
    if (!await dialog.confirm({ title: 'Mandare in Distinte contrassegni?', confirmText: 'Manda',
      message: `${moove.length} contrassegni Moove (${euro(somma(moove))}) vanno fra i "Contrassegni da caricare" di Distinte contrassegni. Da lì li carichi ai clienti, come quelli del file del corriere.` })) return
    setInvio('in corso')
    const righe = moove.map(e => ({ ldv: e.moove!.numero, importocod: e.riga.importo }))
    const es: EsitoInvio = { nuovi: 0, euro: 0, giaInSosta: 0, giaInDistinta: 0, scartati: [], problemi: [] }
    const agg = { righeFile: righe.length, spedizioniProcessate: 0, codFile: 0, codSistema: 0, codDaPagare: 0, errori: 0 }
    for (let i = 0; i < righe.length; i += BLOCCO_INVIO) {
      const d = await fetch('/api/contrassegni/upload-cod', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nomeFile: comp.nome, righe: righe.slice(i, i + BLOCCO_INVIO), scriviLog: false }) })
        .then(r => r.json()).catch(() => ({ error: 'errore di rete' }))
      if (!d.success) { es.problemi.push(d.error || 'blocco non caricato'); continue }
      es.nuovi += d.spedizioniProcessate || 0; es.euro += Number(d.codDaPagare || 0)
      es.giaInSosta += d.giaInSosta || 0; es.giaInDistinta += d.giaInDistinta || 0
      if (Array.isArray(d.erroriDettaglio)) es.scartati.push(...d.erroriDettaglio)
      agg.spedizioniProcessate += d.spedizioniProcessate || 0; agg.codFile += Number(d.codFile || 0)
      agg.codSistema += Number(d.codSistema || 0); agg.codDaPagare += Number(d.codDaPagare || 0); agg.errori += d.errori || 0
    }
    // Una riga in "File processati" di Distinte contrassegni, come per i file caricati da là.
    await fetch('/api/contrassegni/upload-cod', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nomeFile: comp.nome, soloLog: agg }) }).catch(() => null)
    es.euro = r2(es.euro)
    setInvio(es)
  }

  const dropzone = (grande: boolean, testo: string, sotto: string) => (
    <div role="button" tabIndex={0} onClick={() => fileRef.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click() }}
      onDragOver={e => { e.preventDefault(); if (!leggo) setTrascina(true) }} onDragLeave={() => setTrascina(false)}
      onDrop={e => { e.preventDefault(); setTrascina(false); const l = Array.from(e.dataTransfer.files || []); if (l.length && !leggo) caricaFile(l) }}
      style={grande
        ? { ...carta, borderRadius: 16, border: `2px dashed ${trascina ? C.arancio : '#d0d5dd'}`, background: trascina ? C.arancioTenue : '#fff', padding: '48px 24px', textAlign: 'center', cursor: 'pointer' }
        : { border: `1.5px dashed ${trascina ? C.arancio : '#d0d5dd'}`, background: trascina ? C.arancioTenue : C.fondoTenue, borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
      {grande ? (<>
        <span style={{ width: 64, height: 64, borderRadius: 18, background: C.arancioTenue, color: C.arancio, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${C.arancioOrlo}` }}>
          <Icona nome="carica" size={30} />
        </span>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 16 }}>{leggo ? 'Leggo il PDF…' : testo}</div>
        <div style={{ fontSize: 13.5, color: C.attenuato, marginTop: 6 }}>{sotto}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 18 }}>
          <Pillola colore={C.attenuato} fondo={C.fondoTenue} orlo={C.filo}>PDF "Compensazione contrassegni cliente" di BRT</Pillola>
          <Pillola colore={C.attenuato} fondo={C.fondoTenue} orlo={C.filo}>Export spedizioni dell'altro gestionale, se vuole la lettera di vettura</Pillola>
        </div>
      </>) : (<>
        <Tessera nome="carica" colore={C.arancioScuro} fondo="#fff" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{testo}</div>
          <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 2 }}>{sotto}</div>
        </div>
      </>)}
    </div>
  )

  const testata = (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 20 }}>
      <Tessera nome="euro" colore={C.arancio} fondo={C.arancioTenue} />
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.testo, margin: 0, letterSpacing: '-.01em' }}>Check contrassegni</h1>
        <p style={{ fontSize: 13.5, color: C.attenuato, margin: '4px 0 0', maxWidth: 680, lineHeight: 1.5 }}>
          Carica la compensazione contrassegni di BRT: ti dico quali sono spedizioni Moove, da mandare in Distinte contrassegni,
          e per quelle fatte con un altro gestionale ti preparo il file da caricare là.
        </p>
      </div>
    </div>
  )
  const input = <input ref={fileRef} type="file" multiple accept=".pdf,.PDF,application/pdf,.xlsx,.xls,.csv" style={{ display: 'none' }}
    onChange={e => { const l = Array.from(e.target.files || []); if (l.length) caricaFile(l) }} />

  if (!comp) return (
    <div style={{ color: C.testo }}>
      {testata}{input}
      {dropzone(true, 'Trascina qui la compensazione contrassegni di BRT', 'il PDF e, se ce l\'hai, l\'export spedizioni dell\'altro gestionale: insieme, o scegli i file dal computer')}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 16 }}>
        {[
          ['pacco', 'Spedizioni Moove', 'Si riconoscono dal riferimento che Moove manda a BRT: le mandi in Distinte contrassegni e da lì le carichi ai clienti.'],
          ['fattura', 'File col riferimento', 'Per il gestionale che dà a BRT il numero d\'ordine come riferimento: riferimento mittente, importo e destinatario, tutto dal PDF.'],
          ['etichetta', 'File con lettera di vettura', 'Per il gestionale che vuole la lettera di vettura e l\'importo: la lettera di vettura si prende dal suo export spedizioni.'],
        ].map(([ic, t, d]) => (
          <div key={t} style={{ ...carta, padding: 16, display: 'flex', gap: 12 }}>
            <Tessera nome={ic} colore={C.testo} fondo={C.fondoTenue} />
            <div><div style={{ fontSize: 13.5, fontWeight: 700 }}>{t}</div><div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 3, lineHeight: 1.45 }}>{d}</div></div>
          </div>
        ))}
      </div>
    </div>
  )

  const moove = di('moove'), perRif = di('riferimento'), perLdv = di('ldv'), daSistemare = di('sistemare')
  const tornaTotale = comp.totale != null && Math.abs(comp.totale - sommaRighe) < 0.005
  const servonoLdv = daSistemare.filter(e => !/^\d{15}$/.test(e.riga.rifNumerico))
  const filtrati = filtro === 'tutti' ? esiti : esiti.filter(e => e.destino === filtro)

  return (
    <div style={{ color: C.testo }}>
      {testata}{input}

      {/* ── IL PDF CARICATO ── */}
      <div style={{ ...carta, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
        <Tessera nome="fattura" colore={C.arancio} fondo={C.arancioTenue} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Compensazione contrassegni BRT del {dataIt(dataReg)}</div>
          <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 2 }}>{comp.nome}{comp.cliente ? ` · cliente ${comp.cliente}` : ''} · {comp.righe.length} contrassegni</div>
        </div>
        <button onClick={() => fileRef.current?.click()} style={{ ...bottone(false), padding: '8px 13px', fontSize: 13, fontWeight: 600 }}>
          <Icona nome="carica" size={16} /> Carica un altro PDF o un export
        </button>
      </div>
      {tornaTotale ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: C.verde, background: C.verdeTenue, border: `1px solid ${C.verdeOrlo}`, borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
          <Icona nome="spunta" size={16} /> Le {comp.righe.length} righe tornano col totale compensato stampato da BRT ({euro(comp.totale!)}).
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: C.ambra, background: C.ambraTenue, border: `1px solid ${C.ambraOrlo}`, borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
          <Icona nome="avviso" size={16} /> Le righe lette sommano {euro(sommaRighe)}{comp.totale != null ? `, BRT stampa ${euro(comp.totale)} di totale compensato: manca qualcosa, controlla il PDF prima di usare i file.` : ': nel PDF non trovo il totale compensato da confrontare.'}
        </div>
      )}
      {comp.righeNonLette.map((l, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: C.ambra, background: C.ambraTenue, border: `1px solid ${C.ambraOrlo}`, borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
          <Icona nome="avviso" size={16} /> Riga del PDF non letta: «{l}»
        </div>
      ))}
      {!comp.contrattiBrt && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: C.attenuato, background: C.fondoTenue, borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
          <Icona nome="avviso" size={16} /> Non hai contratti BRT tuoi in Moove: nessun contrassegno di questo PDF può essere una spedizione Moove.
        </div>
      )}

      {/* ── I NUMERI ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
        {[
          { ic: 'euro', t: 'Compensati da BRT', v: euro(comp.totale ?? sommaRighe), n: `${comp.righe.length} contrassegni`, c: C.testo },
          { ic: 'pacco', t: 'Spedizioni Moove', v: euro(somma(moove)), n: `${moove.length} contrassegni`, c: moove.length ? C.verde : C.testo },
          { ic: 'fattura', t: 'File col riferimento', v: euro(somma(perRif)), n: `${perRif.length} contrassegni`, c: C.testo },
          { ic: 'etichetta', t: 'File con lettera di vettura', v: euro(somma(perLdv)), n: `${perLdv.length} contrassegni`, c: C.testo },
          { ic: 'avviso', t: 'Da sistemare', v: euro(somma(daSistemare)), n: daSistemare.length ? `${daSistemare.length} contrassegni` : 'nessuno', c: daSistemare.length ? C.rosso : C.testo },
        ].map(k => (
          <div key={k.t} style={{ ...carta, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: C.attenuato }}><Icona nome={k.ic} size={15} /> {k.t}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: k.c, marginTop: 8, letterSpacing: '-.02em', ...cifre }}>{k.v}</div>
            <div style={{ fontSize: 12, color: C.attenuato, marginTop: 2 }}>{k.n}</div>
          </div>
        ))}
      </div>

      {/* ── COSA FARE ── */}
      {moove.length > 0 && (
        <div style={{ ...carta, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12, borderColor: C.verdeOrlo }}>
          <Tessera nome="pacco" colore={C.verde} fondo={C.verdeTenue} />
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{moove.length} contrassegni sono spedizioni Moove</div>
            <div style={{ fontSize: 12.5, color: '#475467', marginTop: 2, lineHeight: 1.45 }}>
              {invio && invio !== 'in corso'
                ? <>Mandati: {invio.nuovi} nuovi fra i Contrassegni da caricare ({euro(invio.euro)}){invio.giaInSosta ? `, ${invio.giaInSosta} c'erano già` : ''}{invio.giaInDistinta ? `, ${invio.giaInDistinta} già in una tua distinta` : ''}{invio.scartati.length ? `, ${invio.scartati.length} scartati (${invio.scartati.slice(0, 3).map(s => `${s.ldv}: ${s.motivo}`).join('; ')})` : ''}{invio.problemi.length ? `. Non riuscito: ${invio.problemi.join('; ')}` : ''}. <Link href="/dashboard/contrassegni/distinte" style={{ color: C.arancioScuro, fontWeight: 700 }}>Vai a Distinte contrassegni</Link></>
                : 'Mandali in Distinte contrassegni: finiscono fra i Contrassegni da caricare, e da lì li carichi ai clienti come quelli del file del corriere.'}
            </div>
          </div>
          {(!invio || invio === 'in corso') && (
            <button onClick={mandaInDistinte} disabled={invio === 'in corso'} style={{ ...bottone(true), opacity: invio === 'in corso' ? 0.6 : 1 }}>
              <Icona nome="freccia" size={16} /> {invio === 'in corso' ? 'Mando…' : 'Manda in Distinte contrassegni'}
            </button>
          )}
        </div>
      )}
      {([['riferimento', perRif], ['ldv', perLdv]] as const).filter(([, l]) => l.length > 0).map(([tipo, l]) => (
        <div key={tipo} style={{ ...carta, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12, background: C.arancioTenue, borderColor: C.arancioOrlo }}>
          <Tessera nome={tipo === 'ldv' ? 'etichetta' : 'fattura'} colore={C.arancioScuro} fondo="#fff" />
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{l.length} contrassegni per il gestionale che vuole {FILE_CONTRASSEGNI[tipo].descrizione}</div>
            <div style={{ fontSize: 12.5, color: '#475467', marginTop: 2, lineHeight: 1.45 }}>
              Il file ha le colonne che vuole lui ({FILE_CONTRASSEGNI[tipo].colonne.join(', ')}) e l'importo compensato da BRT: caricalo là. Totale {euro(somma(l))}.
            </div>
          </div>
          <button onClick={() => scarica(tipo)} style={bottone(true)}><Icona nome="scarica" size={16} /> Scarica il file</button>
        </div>
      ))}
      {servonoLdv.length > 0 && !esportati.length && (
        <div style={{ ...carta, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{servonoLdv.length} contrassegni vogliono la lettera di vettura</div>
          <div style={{ fontSize: 12.5, color: C.attenuato, marginBottom: 10, lineHeight: 1.45 }}>
            Hanno il riferimento corto che mette il gestionale che numera le sue spedizioni ({servonoLdv.slice(0, 4).map(e => e.riga.rifNumerico).join(', ')}{servonoLdv.length > 4 ? '…' : ''}). Nel PDF di BRT la lettera di vettura non c'è: carica l'export spedizioni di quel gestionale, che copra i giorni di questi pacchi, e la prendo da lì.
          </div>
          {dropzone(false, 'Carica l\'export spedizioni del gestionale', 'Trascina qui il file Excel, o clicca per sceglierlo. Si abbina per destinatario, importo del contrassegno e data.')}
        </div>
      )}
      {esportati.map(x => (
        <div key={x.nome} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: C.attenuato, background: C.fondoTenue, borderRadius: 10, padding: '9px 12px', marginBottom: 12 }}>
          <Icona nome="fattura" size={16} />
          <span style={{ flex: 1 }}>Export <b style={{ color: C.testo }}>{x.nome}</b>: {x.spedizioni.length.toLocaleString('it-IT')} spedizioni, {x.spedizioni.filter(s => s.contrassegno > 0).length.toLocaleString('it-IT')} con contrassegno</span>
          <button onClick={() => setEsportati(prev => prev.filter(y => y.nome !== x.nome))}
            style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${C.filo}`, background: '#fff', fontSize: 12.5, fontWeight: 600, color: C.attenuato, cursor: 'pointer' }}>Togli</button>
        </div>
      ))}

      {/* ── I CONTRASSEGNI, UNO PER UNO ── */}
      <div style={{ ...carta, overflow: 'hidden' }}>
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.filo}` }}>
          <div style={{ display: 'inline-flex', background: C.fondoTenue, border: `1px solid ${C.filo}`, borderRadius: 10, padding: 3, flexWrap: 'wrap' }}>
            {([['tutti', 'Tutti', esiti.length], ['moove', 'Moove', moove.length], ['riferimento', 'Col riferimento', perRif.length], ['ldv', 'Con lettera di vettura', perLdv.length], ['sistemare', 'Da sistemare', daSistemare.length]] as [Filtro, string, number][]).map(([k, l, n]) => (
              <button key={k} onClick={() => setFiltro(k)}
                style={{ padding: '6px 11px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  background: filtro === k ? '#fff' : 'transparent', color: filtro === k ? C.testo : C.attenuato, boxShadow: filtro === k ? '0 1px 3px rgba(16,24,40,.12)' : 'none' }}>
                {l} <span style={{ color: C.attenuato, fontWeight: 500, marginLeft: 3 }}>{n}</span>
              </button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: C.fondoTenue, color: C.attenuato, fontSize: 11.5, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '.03em' }}>
              {['Spedizione BRT', 'Destinatario', 'Riferimento mittente', 'Importo', 'Dove va'].map((h, i) => (
                <th key={h} style={{ padding: '10px 12px', fontWeight: 600, textAlign: i === 3 ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtrati.map(e => {
                const r = e.riga, d = DESTINI[e.destino]
                const diverso = e.moove && Math.abs(e.moove.contrassegno - r.importo) > 0.005
                return (
                  <tr key={`${r.filiale}-${r.serie}-${r.numero}-${r.numeroRegistrazione}`} style={{ borderTop: `1px solid ${C.filo}`, verticalAlign: 'top' }}>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }}>{r.filiale} {r.serie} {r.numero}</div>
                      <div style={{ fontSize: 12, color: C.attenuato }}>del {dataIt(r.data)}</div>
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{r.destinatario}</td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }}>{r.rifNumerico || '—'}</div>
                      {r.rifAlfabetico && <div style={{ fontSize: 12, color: C.attenuato }}>{r.rifAlfabetico}</div>}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', ...cifre }}>{euro(r.importo)}</td>
                    <td style={{ padding: '10px 12px', minWidth: 260, maxWidth: 460 }}>
                      <Pillola colore={d.colore} fondo={d.fondo} orlo={d.orlo}>{d.nome}</Pillola>
                      {e.moove && <div style={{ fontSize: 12, color: C.attenuato, marginTop: 4 }}>
                        LDV <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{e.moove.numero}</span>
                        {diverso && <span style={{ color: C.ambra, fontWeight: 600 }}> · a sistema il contrassegno è {euro(e.moove.contrassegno)}: scende al cliente quello versato da BRT</span>}
                      </div>}
                      {e.esterna && <div style={{ fontSize: 12, color: C.attenuato, marginTop: 4 }}>
                        LDV <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{e.esterna.ldv}</span>{e.esterna.cliente ? ` · ${e.esterna.cliente}` : ''}{e.esterna.data ? ` · creata il ${e.esterna.data}` : ''}
                      </div>}
                      {e.motivo && <div style={{ fontSize: 12, color: '#475467', marginTop: 4, lineHeight: 1.45 }}>{e.motivo}</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
