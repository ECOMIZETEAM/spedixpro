'use client'
import { useState, useEffect, useRef } from 'react'
import BarraAvanzamento from '@/app/components/BarraAvanzamento'
import DateRangePicker from '@/app/components/DateRangePicker'
import { giorniFaRoma, giornoRoma } from '@/lib/date-roma'

import { useDialog } from '@/app/components/DialogProvider'
export default function RettificaCostiPage() {
  const dialog = useDialog()
  const [rettifiche, setRettifiche] = useState<any[]>([])
  const [files, setFiles] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [confermando, setConfermando] = useState(false)
  const [cerca, setCerca] = useState('')
  const [fileSelezionato, setFileSelezionato] = useState<string>('')
  const [ricalcolando, setRicalcolando] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)
  // RETTIFICHE ELIMINATE: pagate da me e non recuperate da nessuno (assorbite, caricate e poi cancellate,
  // o solo a mio carico). Si leggono solo quando si apre la sezione: per chi riceve tanto sono migliaia.
  const [elim, setElim] = useState<any>(null)
  const [elimAperta, setElimAperta] = useState(false)
  // Stessi filtri delle altre liste: periodo (calendario), cerca, quante per pagina, pagine.
  const [elimDal, setElimDal] = useState(giorniFaRoma(90))
  const [elimAl, setElimAl] = useState(giornoRoma())
  const [elimCerca, setElimCerca] = useState('')
  const [elimPerPage, setElimPerPage] = useState(10)
  const [elimPagina, setElimPagina] = useState(1)
  const [elimCarico, setElimCarico] = useState(false)

  useEffect(() => {
    caricaFiles()
    caricaRettifiche()
  }, [])

  async function caricaEliminate(dal: string, al: string) {
    setElimCarico(true); setElimPagina(1)
    try {
      const res = await fetch('/api/rettifiche/eliminate?dal=' + dal + '&al=' + al)
      const d = await res.json()
      // 403 = agente: i costi del master non sono roba sua, la sezione sparisce.
      setElim(res.ok ? d : res.status === 403 ? { vietato: true } : { errore: d.error || 'Lettura non riuscita' })
    } catch { setElim({ errore: 'Errore di connessione' }) }
    setElimCarico(false)
  }

  // Si scarica quello che si vede col filtro (tutte le pagine, non solo quella aperta).
  async function scaricaEliminate() {
    if (!elimFiltrate.length) return
    const { utils, writeFile } = await import('xlsx')
    const righe = elimFiltrate.map((r: any) => ({
      'LDV': r.ldv, 'Data': new Date(r.quando).toLocaleDateString('it-IT'), 'Da': r.da,
      'Pagato da te (€)': r.importo, 'Perché non è stata recuperata': r.motivo,
    }))
    const wb = utils.book_new(); utils.book_append_sheet(wb, utils.json_to_sheet(righe), 'Rettifiche eliminate')
    writeFile(wb, `rettifiche-eliminate-${elimDal}_${elimAl}.xlsx`)
  }

  async function caricaFiles() {
    const res = await fetch('/api/rettifiche/files')
    const data = await res.json()
    setFiles(Array.isArray(data) ? data : [])
  }

  async function caricaRettifiche(fileId?: string) {
    setLoading(true)
    const params = new URLSearchParams()
    if (fileId) params.set('fileId', fileId)
    const res = await fetch('/api/rettifiche?' + params.toString())
    const data = await res.json()
    setRettifiche(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  // Anteprima delle RIPESATURE del fornitore: e' un file diverso da quello dei pesi, e la rotta lo
  // riconosce da sola dalle colonne. Qui si tiene il risultato per mostrarlo, senza toccare il
  // flusso del file dei pesi, che continua a funzionare come prima.
  const [avanz, setAvanz] = useState<{fatti:number;totale:number;da:number|null;etichetta:string}|null>(null)
  // Quali gruppi sono aperti. RAGGRUPPATE PER DESTINATARIO DIRETTO: un master vede i suoi
  // sotto-master e i suoi clienti diretti, non l'elenco piatto di tutta la rete sotto. Con 106
  // spedizioni su sei destinatari, l'elenco piatto e' illeggibile e non si capisce chi paga cosa.
  const [aperti, setAperti] = useState<Record<string, boolean>>({})

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    // SUBITO, prima ancora di leggere il file: e' il tratto in cui la schermata sembrava morta.
    setAvanz({ fatti: 0, totale: 0, da: null, etichetta: 'Sto leggendo il file' })
    try {
      const { utils, read } = await import('xlsx')
      const buffer = await file.arrayBuffer()
      const wb = read(buffer)
      // DOVE SONO I DATI. Di norma il primo foglio con l'intestazione nella prima riga. Il file di
      // Poste "Andamento giornaliero XL" (lo carica LOGIXIA per SDA EXPRESS L) no: il primo foglio
      // ("PDB") e' vuoto, i dati stanno nel secondo e l'intestazione e' alla settima riga, sotto un
      // titolo. Letto come gli altri dava zero spedizioni e nessun messaggio — e' successo il 13/10.
      // Si cerca la cella LDV_MADRE nelle prime righe di ogni foglio: se c'e', si legge da li' e si
      // mandano solo le colonne che servono (il foglio PDB ne ha 48, con dati personali). Se non
      // c'e', si fa esattamente come prima, cosi' gli altri file non cambiano. Si leggono TUTTI i
      // fogli che ce l'hanno: oggi il PDB e' vuoto, ma se avesse righe sarebbero misure vere di altre
      // spedizioni, e il motore prezza ognuna sul suo contratto.
      const norm = (v: any) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
      const COLONNE_XL = new Set(['ldvmadre', 'dichiaratopeso', 'rilevatopeso', 'rilevatolarghezza', 'rilevatoprofondita', 'rilevatoprofondit', 'rilevatoaltezza'])
      let righeXL: any[] | null = null
      for (const nome of wb.SheetNames) {
        const foglio = wb.Sheets[nome]
        if (!foglio?.['!ref']) continue
        const area = utils.decode_range(foglio['!ref'])
        let rigaIntestazione = -1
        for (let r = area.s.r; r <= Math.min(area.e.r, area.s.r + 30) && rigaIntestazione < 0; r++) {
          for (let c = area.s.c; c <= area.e.c; c++) {
            const cella = foglio[utils.encode_cell({ r, c })]
            if (cella && norm(cella.w ?? cella.v) === 'ldvmadre') { rigaIntestazione = r; break }
          }
        }
        if (rigaIntestazione < 0) continue
        const lette = utils.sheet_to_json(foglio, { raw: false, range: rigaIntestazione, defval: '' }) as any[]
        const ridotte = lette.map(riga => {
          const o: any = {}
          for (const k of Object.keys(riga)) if (COLONNE_XL.has(norm(k))) o[k] = riga[k]
          return o
        }).filter(o => Object.keys(o).some(k => norm(k) === 'ldvmadre' && String(o[k]).trim()))
        righeXL = [...(righeXL || []), ...ridotte]
      }
      const ws = wb.Sheets[wb.SheetNames[0]]
      // SI LEGGONO I TESTI, NON I NUMERI GIA' INTERPRETATI.
      //
      // Di suo questa libreria converte le celle in numeri usando le convenzioni inglesi: l'importo
      // "1,02" del file del fornitore diventa CENTODUE, perche' legge la virgola come separatore
      // delle migliaia. Il totale del file veniva 35.635 euro invece di 356,35 — cento volte tanto,
      // e nessun errore da nessuna parte.
      // Con raw:false arriva la cella com'e' scritta e i separatori li interpretiamo noi, che
      // sappiamo quali colonne usano la virgola (gli euro) e quali il punto (i chili).
      const righe = righeXL ?? utils.sheet_to_json(ws, { raw: false })
      // Il file XL si manda a pacchetti da DUECENTO (gli altri restano a cinquanta): a ogni
      // richiesta viaggia il file intero (7.291 righe, un mega), e quasi meta' delle spedizioni non
      // si ricalcola nemmeno (misurate non piu' grandi dell'addebitato). Con cinquanta erano 136 viaggi.
      const quante = righeXL ? 200 : 50
      const res = await fetch('/api/rettifiche/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // CINQUANTA PER VOLTA (erano 15). Dal 29/09/2026 il calcolo fa otto righe insieme e costa
        // ~0,8 s a riga invece di 6,3: con pacchetti da 15 il tempo se ne andava nelle andate e
        // ritorni (67 per mille lettere di vettura). Cinquanta stanno abbondantemente dentro il
        // tempo massimo della richiesta e la barra continua a muoversi.
        body: JSON.stringify({ nomeFile: file.name, righe, da: 0, quante })
      })
      const data = await res.json()
      if (data?.tipo === 'ripesature') {
        // UN GESTO SOLO: si mette il file e le rettifiche nascono. Poi si sceglie A CHI e QUALI
        // dalla tabella qui sotto, che e' dove la decisione viene presa davvero.
        // Il passaggio in mezzo — "guarda l'anteprima, poi premi carica" — era una complicazione
        // inutile: la stessa scelta si fa gia' selezionando i gruppi e premendo Conferma, e fino a
        // quel momento non si muove un euro.
        let creati = data.creato || 0, gia = data.giaCaricate || 0, fornitore = data.costoFornitoreScalato || 0
        // IL TUO COSTO: chi ha il contratto paga per primo. Su ogni riga creata c'e' quanto costa a lui
        // (dal file del fornitore, o dal suo listino di costo): si registra alla Conferma, insieme
        // all'addebito a chi sta sotto. Le 'solo a tuo carico' sono quelle dove sotto non c'e' niente.
        let tuoCosto = data.aTuoCarico || 0, soloTue = data.soloATuoCarico || 0
        // Multicollo senza misure collo per collo: NON addebitate (sarebbe meno del dovuto, e
        // l'anti-doppione impedirebbe di correggerle dopo). Le legge il giro di stanotte.
        let attesa = data.attesaMisure || 0
        // File XL di Poste: spedizioni con colli non ancora misurati (si caricano col prossimo file,
        // che e' cumulativo), con piu' righe che colli (da guardare), e LDV senza nessuna misura.
        let incomplete = data.misureIncomplete || 0, inPiu = data.colliInPiu || 0
        // Create a zero: a chi le riceve non costano niente, servono a chi sta sotto (vedi qualcunoSottoDeve).
        let aZero = data.passateAZero || 0
        // Righe del file che non sono spedizioni del portale: il file del corriere copre tutto il
        // contratto, anche le spedizioni fatte altrove (GLS di MULTI, 15/10: 2.657 su 3.232).
        let nonTrovate = data.totali?.nonTrovate || 0
        const senzaMisure = data.senzaMisure || 0   // conta su tutto il file: non si somma a ogni pezzo
        // Righe dove si chiede alla rete piu' del triplo di quanto ha addebitato il corriere: succede
        // quando il collo dichiarato era molto piu' piccolo del vero. Non e' un errore, ma chi paga
        // deve vederle prima di confermare.
        let sopra: any[] = data.sopraIlTriplo || []
        // Senza costo del fornitore: rettifiche oltre il triplo di quanto era stato pagato (e almeno 20 €).
        let sopraPagato: any[] = data.sopraIlTriploPagato || []
        let supEuro = data.supplementiEuro || 0
        let supIgnoti: string[] = data.supplementiSenzaTariffa || []
        let da = (data.da || 0) + (data.quante || 0)
        const totale = data.totaleDaFare ?? 0
        const fileId = data.fileId
        let finito = !!data.finito
        setAvanz({ fatti: da, totale, da: Date.now(), etichetta: 'Sto ricalcolando le spedizioni' })
        while (!finito && da < totale) {
          const r2 = await fetch('/api/rettifiche/upload', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nomeFile: file.name, righe, da, quante, fileId }),
          })
          const d2 = await r2.json()
          if (d2?.error) break
          creati += d2.creato || 0; gia += d2.giaCaricate || 0; fornitore += d2.costoFornitoreScalato || 0
          tuoCosto += d2.aTuoCarico || 0; soloTue += d2.soloATuoCarico || 0
          attesa += d2.attesaMisure || 0; sopra = sopra.concat(d2.sopraIlTriplo || []); sopraPagato = sopraPagato.concat(d2.sopraIlTriploPagato || [])
          incomplete += d2.misureIncomplete || 0; inPiu += d2.colliInPiu || 0; aZero += d2.passateAZero || 0; nonTrovate += d2.totali?.nonTrovate || 0
          supEuro += d2.supplementiEuro || 0; supIgnoti = supIgnoti.concat(d2.supplementiSenzaTariffa || [])
          const avanti = (d2.da || 0) + (d2.quante || 0)
          // Se il segnaposto non si muove il file non finirebbe mai di essere chiesto: meglio
          // fermarsi e dire quante ne sono entrate che restare a girare a vuoto.
          if (avanti <= da) break
          da = avanti
          finito = !!d2.finito
          setAvanz(a => a ? { ...a, fatti: da } : a)
        }
        setAvanz(null)
        setUploading(false)
        if (fileRef.current) fileRef.current.value = ''
        await caricaFiles()
        // ACCUMULA, non sostituisce. Prima si restringeva la vista al SOLO file appena caricato
        // (caricaRettifiche(fileId)) e le rettifiche gia' in attesa da file precedenti — o accettate
        // in "Dal mio network" — sparivano dall'elenco: sembrava che il caricamento le avesse tolte.
        // Come per i contrassegni, dopo l'upload si mostrano TUTTE le pendenti insieme; il singolo
        // file resta rivedibile cliccandolo in "File processati".
        await caricaRettifiche(); setFileSelezionato('')
        await dialog.alert({
          title: 'Rettifiche create',
          message: `Create ${creati} rettifiche su ${totale} spedizioni nel file.`
            + (aZero ? ` Di queste, ${aZero} sono a zero: a chi le riceve non costano niente, ma sotto di lui qualcuno deve ancora pagare la differenza — confermale insieme alle altre, servono a farla arrivare fin lì.` : '')
            + (gia ? ` ${gia} erano già state caricate da un file precedente e sono state saltate.` : '')
            + (nonTrovate ? ` ${nonTrovate} righe del file non corrispondono a spedizioni del portale (fatte altrove, o annullate) e sono state saltate.` : '')
            + (tuoCosto > 0.005 ? ` Il tuo costo su queste rettifiche è € ${tuoCosto.toFixed(2)}: si registra sul tuo credito quando le confermi, insieme all'addebito a chi sta sotto.` : '')
            + (soloTue ? ` ${soloTue} sono solo a tuo carico: sotto non c'è niente da rettificare (chi sta sotto paga già abbastanza), confermandole registri il tuo costo.` : '')
            + (fornitore ? ` € ${fornitore.toFixed(2)} del conto del fornitore, su spedizioni che non diventano rettifiche, sono stati scalati subito dal tuo credito: è la fattura che hai già ricevuto.` : '')
            + (attesa ? ` ${attesa} spedizioni con più colli sono in attesa delle misure collo per collo e NON sono state addebitate: le misure si leggono stanotte, ricarica lo stesso file domani e si caricheranno per intero.` : '')
            + (incomplete ? ` ${incomplete} spedizioni hanno misure solo per una parte dei colli e NON sono state addebitate: entreranno col prossimo file del fornitore, quando avrà misurato tutti i colli.` : '')
            + (inPiu ? ` ${inPiu} spedizioni hanno nel file più righe dei colli spediti: NON sono state addebitate, vanno controllate.` : '')
            + (senzaMisure ? ` ${senzaMisure} spedizioni del file non hanno nessuna misura rilevata e sono state saltate.` : '')
            + (sopra.length ? ` Attenzione: ${sopra.length} rettifiche chiedono più del triplo di quanto ha addebitato il corriere (il collo dichiarato era molto più piccolo del vero) — per esempio ${sopra[0].ldv}, € ${Number(sopra[0].costoFornitore).toFixed(2)} di costo contro € ${Number(sopra[0].differenza).toFixed(2)} da girare. Controllale prima di confermare.` : '')
            + (sopraPagato.length ? ` Attenzione: ${sopraPagato.length} rettifiche chiedono più del triplo di quanto era stato pagato — ${sopraPagato.slice(0, 5).map((x: any) => `${x.ldv} (pagata € ${Number(x.pagato).toFixed(2)}, ora € ${Number(x.differenza).toFixed(2)} in più)`).join(', ')}${sopraPagato.length > 5 ? ' e altre' : ''}. Possono essere vere o un errore del corriere: controllale prima di confermare.` : '')
            + (supEuro ? ` Compresi € ${supEuro.toFixed(2)} di supplementi fissi (fuori sagoma, non sovrapponibile, consegna su appuntamento), che scendono invariati.` : '')
            + (supIgnoti.length ? ` Il corriere ha addebitato anche ${Array.from(new Set(supIgnoti)).join(' e ')}: di questi non conosciamo la tariffa, il costo resta a noi e NON è stato girato — vanno chiesti al corriere.` : '')
            + ' Scegli quali confermare e premi Conferma: fino a quel momento non viene scalato nulla, né a te né a chi sta sotto.',
        })
        return
      }
      setAvanz(null)
      // MAI IN SILENZIO. Un file che non si riesce a leggere, o in cui non si trova nessuna
      // spedizione, compariva in "File processati" con tutti zeri e nessun messaggio: chi carica
      // pensava di aver fatto (LOGIXIA, 13/10/2026, 7.292 righe e zero lette).
      if (data?.error) {
        await dialog.alert({ title: 'File non caricato', message: String(data.error) })
      } else if (data.success && !(Number(data.nProcessate) > 0)) {
        await dialog.alert({
          title: 'Nessuna spedizione riconosciuta',
          message: `Nel file (${righe.length} righe) non è stata riconosciuta nessuna spedizione. Controlla che sia l'export giusto e che non siano state rinominate o tolte colonne.`,
        })
      } else if (data.success && !(Number(data.nTrovate) > 0)) {
        // Lette ma tutte scartate: gia' rettificate, annullate, non trovate o fuori dalla propria
        // rete. Qui il file e' giusto: dire "controlla l'export" farebbe cercare l'errore nel posto sbagliato.
        await dialog.alert({
          title: 'Nessuna nuova rettifica',
          message: `Lette ${Number(data.nProcessate)} spedizioni, nessuna da rettificare: sono già rettificate, annullate, non trovate o fuori dalla tua rete.`,
        })
      }
      if (data.success) {
        await caricaFiles()
        // Anche il file dei pesi: accumula tutte le pendenti, non solo quelle appena caricate.
        await caricaRettifiche(); setFileSelezionato('')
      }
    } catch(err) { await dialog.alert({ title: 'Errore', message: 'Errore nel caricamento del file.' }) }
    setAvanz(null)
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function cancellaRettifiche() {
    if (!selectedIds.length) { await dialog.alert({ title: 'Nessuna selezione', message: 'Seleziona almeno una rettifica.' }); return }
    if (!await dialog.confirm({ title: 'Cancellare le rettifiche?', message: 'Cancellare le ' + selectedIds.length + ' rettifiche selezionate? Non verrà scalato alcun credito.', danger: true, confirmText: 'Cancella' })) return
    const res = await fetch('/api/rettifiche', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rettificaIds: selectedIds })
    })
    const data = await res.json()
    if (data.success) {
      setSelectedIds([])
      await caricaFiles()
      await caricaRettifiche(fileSelezionato || undefined)
    } else { await dialog.alert({ title: 'Errore', message: data.error || 'Cancellazione fallita.' }) }
  }
  // RICALCOLA una riga "da controllare" col listino aggiornato: ri-riprezza SOLO quella riga (stesso
  // motore dell'upload), poi ricarica. Se ora copre il costo fornitore, passa tra le buone. Sulle
  // penali e' rifiutato lato server (non si recupera col listino).
  async function ricalcolaRiga(id: string) {
    setRicalcolando(id)
    try {
      const res = await fetch('/api/rettifiche/ricalcola', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      const d = await res.json()
      if (!res.ok) { await dialog.alert({ title: 'Ricalcola', message: d.error || 'Ricalcolo non riuscito.' }); return }
      await caricaRettifiche(fileSelezionato || undefined)
      await dialog.alert({ title: 'Ricalcolata', message: d.classe === 'buona'
        ? 'Ora il da-girare copre il costo fornitore: la riga e\' passata tra le buone.'
        : `Riprezzata: recuperi € ${Number(d.da_girare).toFixed(2)}, ancora sotto il costo fornitore (mancano € ${Number(d.manca).toFixed(2)}). Aggiorna ancora il listino o decidi di assorbire.` })
    } finally { setRicalcolando('') }
  }
  async function confermaRettifiche() {
    if (!selectedIds.length) { await dialog.alert({ title: 'Nessuna selezione', message: 'Seleziona almeno una rettifica.' }); return }
    // Su ogni riga si registra PRIMA il costo di chi ha il contratto, POI l'addebito a chi sta sotto: e' lui
    // che paga il fornitore. Il totale qui e' un massimo: il costo gia' registrato al caricamento (righe
    // caricate prima del 22/10) non si ripete, e il riepilogo dopo dice quanto e' stato scalato davvero.
    const costoSel = Math.round(rettifiche.filter((r: any) => selectedIds.includes(r.id) && !r.costo_gia_pagato).reduce((t: number, r: any) => t + (Number(r.costo_fornitore) || 0), 0) * 100) / 100
    if (!await dialog.confirm({ title: 'Confermare le rettifiche?', message: 'Confermi le ' + selectedIds.length + ' rettifiche selezionate?'
      + (costoSel > 0.005 ? ' Prima si registra il tuo costo (fino a € ' + costoSel.toFixed(2) + '), poi viene scalato il credito a chi sta sotto.' : ' Il credito verrà scalato a chi sta sotto.'), confirmText: 'Conferma' })) return
    setConfermando(true)
    // A LOTTI, con la barra. Con centinaia di rettifiche (l'harvester ne accumula a migliaia) una
    // sola richiesta ci metteva minuti e rischiava il timeout: si è visto con 694 in attesa. Si
    // mandano a pacchetti da 150 accumulando i risultati; ogni pacchetto è una presa atomica per
    // riga lato server, quindi un'interruzione non ripete gli addebiti già fatti.
    const LOTTO = 150
    const ids = [...selectedIds]
    let rettificate = 0, costiMiei = 0
    const saltate: any[] = []
    let erroreFatale = ''
    setAvanz({ fatti: 0, totale: ids.length, da: Date.now(), etichetta: 'Conferma rettifiche' })
    for (let i = 0; i < ids.length; i += LOTTO) {
      const fetta = ids.slice(i, i + LOTTO)
      try {
        const res = await fetch('/api/rettifiche', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rettificaIds: fetta })
        })
        const data = await res.json()
        if (data.success) {
          rettificate += data.rettificate || 0; costiMiei += data.costiMiei || 0
          if (Array.isArray(data.dettaglio)) saltate.push(...data.dettaglio)
        } else if (res.status !== 404) {
          // 404 = questo pacchetto era già tutto confermato (re-invio): si salta, non è fatale.
          erroreFatale = data.error || 'Conferma non riuscita.'
          break
        }
      } catch {
        erroreFatale = 'Interruzione durante la conferma: riprova — le già confermate non si ripetono.'
        break
      }
      setAvanz(prev => prev ? { ...prev, fatti: Math.min(i + LOTTO, ids.length) } : prev)
    }
    setAvanz(null)
    setConfermando(false)
    if (erroreFatale) { await dialog.alert({ title: 'Errore', message: erroreFatale }); caricaRettifiche(fileSelezionato || undefined); return }
    // SE UNA RIGA NON PASSA, VA DETTO PERCHE' (quasi sempre è una scelta: spedizione in annullo o
    // destinatario non più della rete). Si raggruppano i motivi dei pacchetti in un unico riepilogo.
    const perche = new Map<string, number>()
    for (const s of saltate) perche.set(s.perche, (perche.get(s.perche) || 0) + 1)
    await dialog.alert({
      title: 'Rettifiche confermate',
      message: `${rettificate} rettifiche confermate, credito aggiornato.`
        + (costiMiei > 0.005 ? ` Il tuo costo registrato: € ${costiMiei.toFixed(2)}.` : '')
        + (saltate.length
            ? `\n\nNON confermate: ${saltate.length}.\n`
              + Array.from(perche.entries()).map(([m, n]) => `• ${n} — ${m}`).join('\n')
              + '\n\nRestano in elenco: non sono un errore, aspettano che si sappia come va a finire.'
            : ''),
    })
    setSelectedIds([])
    caricaRettifiche(fileSelezionato || undefined)
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function toggleAll() {
    const visibili = rettificheFiltrate.filter(r => r.stato === 'da_rettificare')
    if (selectedIds.length === visibili.length) setSelectedIds([])
    else setSelectedIds(visibili.map(r => r.id))
  }

  const rettificheFiltrate = cerca
    ? rettifiche.filter(r =>
        r.numero_spedizione?.toLowerCase().includes(cerca.toLowerCase()) ||
        r.clienti?.ragione_sociale?.toLowerCase().includes(cerca.toLowerCase())
      )
    : rettifiche

  // Raggruppa per destinatario (master o cliente), ordinato per addebito. Usato per BUONE e DA CONTROLLARE.
  const raggruppa = (righe: any[]) => {
    const map = new Map<string, { nome: string; tipo: 'master' | 'cliente' | 'proprio'; righe: any[]; totale: number; costo: number }>()
    for (const r of righe) {
      const nome = r.destinatario_nome || '(senza destinatario)'
      const chiave = (r.target_master_id || r.cliente_id || 'x') + '|' + nome
      if (!map.has(chiave)) map.set(chiave, { nome, tipo: (r.destinatario_tipo || 'cliente') as 'master'|'cliente'|'proprio', righe: [], totale: 0, costo: 0 })
      const g = map.get(chiave)!
      g.righe.push(r)
      // Il totale del gruppo è l'ADDEBITO vero: ripesatura (differenza) + supplemento fuori sagoma.
      g.totale += Number(r.differenza || 0) - Number(r.fuori_sagoma || 0)
      if (!r.costo_gia_pagato) g.costo += Number(r.costo_fornitore || 0)
    }
    return [...map.entries()].sort((a, b) => Math.abs(b[1].totale) - Math.abs(a[1].totale))
  }
  // BUONE (il da-girare copre il costo fornitore) in alto, DA CONTROLLARE (sotto-recupero) sotto, col
  // MOTIVO su ogni riga. classe/motivo/manca li calcola la rotta GET (costo_fornitore vs da-girare).
  const rettBuone = rettificheFiltrate.filter((r: any) => r.classe !== 'da_controllare' && r.classe !== 'solo_mio')
  // SOLO A TUO CARICO: chi ha il contratto paga il fornitore, ma sotto di lui nessuno deve niente.
  // Si confermano per registrare il costo; non addebitano nessuno.
  const rettSoloMie = rettificheFiltrate.filter((r: any) => r.classe === 'solo_mio')
  const rettCtrl  = rettificheFiltrate.filter((r: any) => r.classe === 'da_controllare')
  const gruppiBuone = raggruppa(rettBuone)
  const gruppiCtrl  = raggruppa(rettCtrl)
  const gruppiSoloMie = raggruppa(rettSoloMie)
  const costoSoloMie = Math.round(rettSoloMie.filter((r: any) => !r.costo_gia_pagato).reduce((t: number, r: any) => t + (Number(r.costo_fornitore) || 0), 0) * 100) / 100
  const totaleCtrl  = Math.round(rettCtrl.reduce((s: number, r: any) => s + (Number(r.manca) || 0), 0) * 100) / 100

  // Un gruppo (intestazione + righe) → array di <tr>. Stessa resa per entrambe le sezioni.
  const renderGruppo = ([chiave, g]: any) => {
    // QUANTO STAI PER ADDEBITARE A QUESTO CLIENTE: chi seleziona alcune righe di un gruppo vede subito, sulla
    // riga del gruppo, quante sono e la somma (chiesto da Lorenzo il 26/10/2026: "3 selezionate · € 32,30").
    // E' lo stesso addebito della colonna Differenza (ripesatura + supplementi); sul "tuo costo" e' il costo.
    const sel = g.righe.filter((r: any) => selectedIds.includes(r.id))
    const totSel = Math.round(sel.reduce((t: number, r: any) => t + (g.tipo === 'proprio'
      ? (r.costo_gia_pagato ? 0 : Number(r.costo_fornitore || 0))
      : -(Number(r.differenza || 0) - Number(r.fuori_sagoma || 0))), 0) * 100) / 100
    return [(
    <tr key={'g-'+chiave} onClick={()=>setAperti(p=>({...p,[chiave]:!p[chiave]}))}
      style={{background:'#f3f4f6',cursor:'pointer'}}>
      <td style={{padding:'9px 10px',borderBottom:'1px solid #d1d5db'}} onClick={e=>e.stopPropagation()}>
        <input type="checkbox"
          checked={g.righe.filter((r:any)=>r.stato==='da_rettificare').every((r:any)=>selectedIds.includes(r.id)) && g.righe.some((r:any)=>r.stato==='da_rettificare')}
          onChange={e=>{
            const ids = g.righe.filter((r:any)=>r.stato==='da_rettificare').map((r:any)=>r.id)
            setSelectedIds(prev => e.target.checked ? [...new Set([...prev,...ids])] : prev.filter(i=>!ids.includes(i)))
          }}/>
      </td>
      <td colSpan={10} style={{padding:'9px 10px',borderBottom:'1px solid #d1d5db',fontSize:'12.5px',fontWeight:700,color:'#1a1a1a'}}>
        <span style={{display:'inline-block',width:'14px',color:'#6b7280'}}>{aperti[chiave]?'▾':'▸'}</span>
        {g.nome}
        <span style={{fontWeight:400,color:'#6b7280',marginLeft:'8px'}}>
          {g.tipo==='master'?'sotto-master':g.tipo==='proprio'?'il tuo costo':'cliente diretto'} · {g.righe.length} {g.righe.length===1?'rettifica':'rettifiche'}
        </span>
        {sel.length > 0 && (
          <span style={{marginLeft:'10px',fontWeight:700,color:'#ea580c',background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'999px',padding:'2px 10px'}}>
            {sel.length} {sel.length===1?'selezionata':'selezionate'} · € {totSel.toFixed(2)}
          </span>
        )}
        <span style={{float:'right',fontWeight:700,color:g.totale<0?'#dc2626':'#15803d'}}>
          {g.tipo==='proprio' ? <span style={{color:'#475569'}}>tuo costo € {g.costo.toFixed(2)}</span> : <>€ {Math.abs(g.totale).toFixed(2)}{g.costo > 0.005 && <span style={{fontWeight:500,color:'#475569',marginLeft:'8px'}}>· tuo costo € {g.costo.toFixed(2)}</span>}</>}
        </span>
      </td>
    </tr>
  ), ...(aperti[chiave] ? g.righe : []).map((r:any)=>{
    const isSelected = selectedIds.includes(r.id)
    const diff = Number(r.differenza || 0)
    // L'addebito vero = ripesatura + supplementi fissi (fuori sagoma / super gdo / penale BRT: in aggiunta).
    const fs = Number(r.fuori_sagoma || 0)
    const addebito = Math.round((diff - fs) * 100) / 100
    const isDaRett = r.stato === 'da_rettificare'
    const isPenale = String(r.supplementi_nomi||'').toLowerCase().includes('penale')
    const pIni = Number(r.peso_iniziale)||0, pvIni = Number(r.peso_volume_iniziale)||0
    const pRe  = Number(r.peso_reale)||0,    pvRe  = Number(r.peso_volume_reale)||0
    const volIni = r.base_prima ? r.base_prima === 'volume' : pvIni > pIni
    const volRe  = r.base_dopo  ? r.base_dopo  === 'volume' : pvRe > pRe
    const cIni = (on:boolean) => ({padding:'8px 10px', color: on?'#1a1a1a':'#b0b4bb', fontWeight: on?700:400})
    const cRe  = (on:boolean) => ({padding:'8px 10px', color: on?'#dc2626':'#b0b4bb', fontWeight: on?700:400})
    return (
      <tr key={r.id} style={{borderBottom:'1px solid #d1d5db',background:isSelected?'#fff7ed':'#fff'}}>
        <td style={{padding:'8px 10px'}}>
          {isDaRett && <input type="checkbox" checked={isSelected} onChange={()=>toggleSelect(r.id)}/>}
        </td>
        <td style={{padding:'8px 10px',color:'#1a1a1a',fontWeight:'500',fontSize:'12px'}}>{r.clienti?.ragione_sociale || (r.masters?.nome ? ('🏢 ' + r.masters.nome) : '—')}</td>
        <td style={{padding:'8px 10px',color:'#f97316',fontWeight:'600'}}>
          {r.numero_spedizione}
          {r.blocco && (
            <div style={{marginTop:'3px',fontSize:'10.5px',fontWeight:600,color:'#b45309',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:'4px',padding:'2px 6px',display:'inline-block',whiteSpace:'normal',maxWidth:'260px'}}>
              ⏸ {r.blocco}
            </div>
          )}
          {r.nota_peso && (
            <div style={{marginTop:'3px',fontSize:'10.5px',fontWeight:500,color:'#1e40af',background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:'4px',padding:'2px 6px',whiteSpace:'normal',maxWidth:'300px'}}>
              ⓘ {r.nota_peso}
            </div>
          )}
          {fs > 0 && (
            <div style={{marginTop:'3px',fontSize:'10.5px',fontWeight:600,color:'#7c2d12',background:'#ffedd5',border:'1px solid #fdba74',borderRadius:'4px',padding:'2px 6px',display:'inline-block'}}>
              + {r.supplementi_nomi || 'fuori sagoma'} € {fs.toFixed(2)}
            </div>
          )}
          {r.classe==='da_controllare' && r.motivo && (
            <div style={{marginTop:'3px',fontSize:'10.5px',fontWeight:500,color:'#92400e',background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:'4px',padding:'3px 7px',whiteSpace:'normal',maxWidth:'380px'}}>
              ⚠️ {r.motivo}
              {!isPenale && isDaRett && (
                <button onClick={()=>ricalcolaRiga(r.id)} disabled={ricalcolando===r.id}
                  style={{marginLeft:'8px',padding:'2px 9px',background:'#f97316',color:'#fff',border:'none',borderRadius:'4px',fontSize:'10.5px',fontWeight:700,cursor:'pointer',opacity:ricalcolando===r.id?0.6:1}}>
                  {ricalcolando===r.id?'Ricalcolo…':'🔄 Ricalcola'}
                </button>
              )}
            </div>
          )}
        </td>
        <td style={cIni(!volIni)}>{pIni.toFixed(2)}</td>
        <td style={cIni(volIni)}>{pvIni.toFixed(2)}</td>
        <td style={cRe(!volRe)}>{pRe.toFixed(2)}</td>
        <td style={cRe(volRe)}>{pvRe.toFixed(2)} kg</td>
        <td style={{padding:'8px 10px',color:'#1a1a1a'}}>{Number(r.costo_iniziale).toFixed(4)}</td>
        <td style={{padding:'8px 10px',color:'#1a1a1a'}}>{Number(r.costo_finale).toFixed(4)}</td>
        <td style={{padding:'8px 10px'}}>
          {r.classe==='solo_mio' ? (
            <span style={{color:'#475569',fontWeight:500,fontSize:'11px'}}>— niente da rettificare sotto</span>
          ) : r.stato==='ok' ? (
            <span style={{color:'#16a34a',fontWeight:'700'}}>{addebito.toFixed(4)}</span>
          ) : addebito !== 0 ? (
            <span style={{color:addebito<0?'#dc2626':'#16a34a',fontWeight:'700'}}>{addebito.toFixed(4)}</span>
          ) : (
            // A ZERO E' VOLUTA: questo livello non deve niente, ma piu' sotto qualcuno si' (qualcunoSottoDeve),
            // e la riga serve a far arrivare la rettifica fin li'. Prima uno zero non poteva nascere e qui si
            // scriveva "Errore!": il 15/10 Wave le ha viste cosi' e sembrava un guasto.
            <span title="Questo livello non deve niente, ma più sotto qualcuno sì: confermala insieme alle altre, serve a far arrivare la rettifica fin lì. Non viene scalato nulla."
              style={{color:'#475569',fontWeight:'700'}}>
              {addebito.toFixed(4)} <span style={{fontWeight:500,fontSize:'10.5px'}}>· passa a chi sta sotto</span>
            </span>
          )}
        </td>
        {/* A TUO CARICO: quanto costa a chi ha il contratto (fattura del fornitore, o il suo listino di costo
            sul peso nuovo meno quanto aveva gia' pagato). Si registra alla Conferma, prima dell'addebito sotto. */}
        <td style={{padding:'8px 10px',color:'#475569',fontWeight:600}}>{Number(r.costo_fornitore) > 0.005
          ? (r.costo_gia_pagato ? <span title="La fattura del fornitore per questa riga è già registrata sul tuo credito: alla conferma non si ripaga." style={{fontWeight:500,fontSize:'11px'}}>{Number(r.costo_fornitore).toFixed(2)} · già pagato</span> : Number(r.costo_fornitore).toFixed(2))
          : '—'}</td>
      </tr>
    )
  })]
  }

  // RETTIFICHE ELIMINATE: filtro "cerca" (LDV, da chi, motivo), totali sul filtrato, pagine.
  const elimQ = elimCerca.trim().toLowerCase()
  const elimFiltrate: any[] = (elim?.righe || []).filter((r: any) => !elimQ
    || String(r.ldv || '').toLowerCase().includes(elimQ) || String(r.da || '').toLowerCase().includes(elimQ)
    || String(r.motivo || '').toLowerCase().includes(elimQ))
  const elimTotale = Math.round(elimFiltrate.reduce((t: number, r: any) => t + Number(r.importo || 0), 0) * 100) / 100
  const elimPerMotivo = Array.from(elimFiltrate.reduce((m: Map<string, { n: number; euro: number }>, r: any) => {
    const v = m.get(r.motivo) || { n: 0, euro: 0 }; v.n++; v.euro += Number(r.importo || 0); return m.set(r.motivo, v)
  }, new Map<string, { n: number; euro: number }>()))
  const elimTotPagine = Math.max(1, Math.ceil(elimFiltrate.length / elimPerPage))
  const elimPagCorr = Math.min(elimPagina, elimTotPagine)
  const elimVisibili = elimFiltrate.slice((elimPagCorr - 1) * elimPerPage, elimPagCorr * elimPerPage)

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Importa file</h1>
      </div>

      {/* RIPESATURE DEL FORNITORE — riconosciute dal file, non da una voce di menu a parte.
          L'importo NON scende uguale lungo la catena: ogni livello viene riprezzato sul proprio
          listino con il collo vero, per questo c'e' una riga per livello. Al detentore del
          contratto puo' costare un euro e al cliente due e settanta, ed e' giusto cosi'.
          Per ora si guarda soltanto: nessuna rettifica creata, nessun credito toccato. */}
      {avanz && (
        <div style={{marginBottom:'16px'}}>
          <BarraAvanzamento fatti={avanz.fatti} totale={avanz.totale} iniziatoIl={avanz.da}
            etichetta={avanz.etichetta}
            sottotitolo="Ogni spedizione viene riprezzata sul listino di ciascun livello." />
        </div>
      )}


      {/* Upload + File processati */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:'16px',marginBottom:'16px'}}>
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px'}}>
          <div style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a',marginBottom:'4px'}}>1. Seleziona file <span style={{color:'#1a1a1a',fontWeight:'400',fontSize:'11px'}}>(*max 5.000 righe)</span></div>
          <div style={{fontSize:'12px',color:'#1a1a1a',marginBottom:'8px',fontWeight:'600',marginTop:'12px'}}>File: XLS, XLSX, CSV</div>
          <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx" onChange={uploadFile}
            style={{fontSize:'12px',marginBottom:'12px',display:'block',color:'#1a1a1a'}}/>
          <button onClick={()=>fileRef.current?.click()} disabled={uploading}
            style={{padding:'7px 16px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:'pointer',opacity:uploading?0.7:1}}>
            {uploading?'Caricamento...':'Carica file peso/volume'}
          </button>
        </div>

        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>File processati</div>
          {!files.length ? (
            <div style={{padding:'20px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'13px'}}>Nessun file caricato</div>
          ) : (
            <div style={{overflowX:'auto' as const, maxHeight:'340px', overflowY:'auto' as const}}>
              <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'12px'}}>
                <thead><tr style={{background:'#f9fafb'}}>
                  {['#','File','Data caricamento','N. Tot Spedizioni','N. processate','N. trovate','N. scartati','N. da rettificare'].map(h=>(
                    <th key={h} style={{textAlign:'left' as const,padding:'7px 10px',fontSize:'10px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap' as const}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {files.map((f:any)=>(
                    <tr key={f.id} style={{borderBottom:'1px solid #d1d5db',cursor:'pointer',background:fileSelezionato===f.id?'#fff7ed':'#fff'}}
                      onClick={()=>{setFileSelezionato(f.id);caricaRettifiche(f.id)}}>
                      <td style={{padding:'7px 10px',color:'#1a1a1a'}}>{f.numero}</td>
                      <td style={{padding:'7px 10px',color:'#f97316',fontWeight:'500',maxWidth:'200px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' as const}}>{f.nome_file}</td>
                      <td style={{padding:'7px 10px',color:'#1a1a1a',whiteSpace:'nowrap' as const}}>{new Date(f.created_at).toLocaleString('it-IT')}</td>
                      <td style={{padding:'7px 10px',color:'#1a1a1a'}}>{f.n_tot_spedizioni}</td>
                      <td style={{padding:'7px 10px',color:'#1a1a1a'}}>{f.n_processate}</td>
                      <td style={{padding:'7px 10px',color:'#1a1a1a'}}>{f.n_trovate}</td>
                      <td style={{padding:'7px 10px',color:'#1a1a1a'}}>{f.n_scartati}</td>
                      <td style={{padding:'7px 10px',fontWeight:'700',color:'#f97316'}}>{f.n_da_rettificare}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Tabella rettifiche */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:'14px',fontWeight:'700',color:'#1a1a1a'}}>
            {fileSelezionato ? 'Spedizioni del file' : 'Rettifiche in attesa'}
            <span style={{fontSize:'12px',color:'#1a1a1a',fontWeight:'400',marginLeft:'8px'}}>({rettificheFiltrate.length} righe)</span>
            {fileSelezionato && <button onClick={()=>{setFileSelezionato('');caricaRettifiche()}}
              style={{marginLeft:'10px',fontSize:'11px',color:'#f97316',background:'none',border:'none',cursor:'pointer',textDecoration:'underline',padding:0,fontWeight:600}}>mostra tutte</button>}
          </span>
          <div style={{display:'flex',gap:'10px',alignItems:'center'}}>
            <button onClick={confermaRettifiche} disabled={confermando||selectedIds.length===0}
              style={{padding:'7px 16px',background:selectedIds.length>0?'#f97316':'#e5e7eb',color:selectedIds.length>0?'#fff':'#9ca3af',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:selectedIds.length>0?'pointer':'not-allowed'}}>
              {confermando?'Conferma...':'Conferma rettifiche' + (selectedIds.length>0?' ('+selectedIds.length+')':'')}
            </button>
            <button onClick={cancellaRettifiche} disabled={selectedIds.length===0}
              style={{padding:'7px 16px',background:selectedIds.length>0?'#fef2f2':'#e5e7eb',color:selectedIds.length>0?'#dc2626':'#9ca3af',border:selectedIds.length>0?'1px solid #fecaca':'1px solid #e5e7eb',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:selectedIds.length>0?'pointer':'not-allowed'}}>
              Cancella selezionati
            </button>
          </div>
        </div>
        <div style={{padding:'8px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <span style={{fontSize:'12px',color:'#1a1a1a'}}>Mostra</span>
            <select style={{padding:'3px 8px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',color:'#1a1a1a',background:'#fff'}}><option>50</option><option>100</option></select>
            <span style={{fontSize:'12px',color:'#1a1a1a'}}>elementi</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'12px',color:'#1a1a1a'}}>Cerca:</span>
            <input value={cerca} onChange={e=>setCerca(e.target.value)}
              style={{padding:'4px 8px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',width:'180px',color:'#1a1a1a'}}/>
          </div>
        </div>
        <div style={{padding:'7px 16px',borderBottom:'1px solid #f0f0f0',fontSize:'11px',color:'#8a8a8a',lineHeight:1.5}}>
          In grassetto <strong style={{color:'#1a1a1a'}}>il peso su cui si paga davvero</strong>: di norma il maggiore fra reale e volume, ma sul <strong style={{color:'#1a1a1a'}}>peso reale</strong> quando il collo sta nella scatola agevolata del contratto. In <strong style={{color:'#dc2626'}}>rosso</strong> il peso dopo la ripesatura. Se il collo misurato esce dalla scatola si passa al volume: lo trovi scritto sulla riga. La colonna <strong style={{color:'#1a1a1a'}}>Differenza</strong> è quanto recuperi.
        </div>

        {loading ? (
          <div style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a'}}>Caricamento...</div>
        ) : !rettificheFiltrate.length ? (
          <div style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'13px'}}>
            {/* Le rettifiche non arrivano solo da un file: quelle accettate in "Dal mio network"
                non ne hanno uno, e "Carica un file per vedere le spedizioni" faceva pensare che
                fossero sparite. */}
            {fileSelezionato ? 'Nessuna rettifica trovata' : 'Nessuna rettifica in attesa. Ne arrivano caricando un file del corriere, oppure caricandole da "Dal mio network".'}
          </div>
        ) : (
          <div style={{overflowX:'auto' as const}}>
            <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'12px'}}>
              <thead><tr style={{background:'#f9fafb'}}>
                <th style={{padding:'8px 10px',borderBottom:'1px solid #d1d5db',width:'36px'}}>
                  <input type="checkbox"
                    checked={selectedIds.length===rettificheFiltrate.filter(r=>r.stato==='da_rettificare').length&&rettificheFiltrate.filter(r=>r.stato==='da_rettificare').length>0}
                    onChange={toggleAll}/>
                </th>
                {['Cliente','N. Spedizione','Peso iniziale','Peso/volume iniziale','Peso reale','Peso/volume reale','Costo iniziale','Costo finale','Differenza','A tuo carico'].map(h=>(
                  <th key={h} style={{textAlign:'left' as const,padding:'8px 10px',fontSize:'10px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap' as const}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {/* BUONE in alto (il da-girare copre il costo del corriere) — poi DA CONTROLLARE. */}
                {gruppiBuone.length > 0 && (
                  <tr key="sez-buone" style={{background:'#dcfce7'}}>
                    <td colSpan={11} style={{padding:'10px 12px',fontWeight:800,fontSize:'12.5px',color:'#166534'}}>
                      ✅ Buone — il da-girare copre il costo del corriere, pronte da confermare <span style={{fontWeight:600}}>({rettBuone.length})</span>
                    </td>
                  </tr>
                )}
                {gruppiBuone.flatMap(renderGruppo)}
                {gruppiCtrl.length > 0 && (
                  <tr key="sez-ctrl" style={{background:'#fef3c7'}}>
                    <td colSpan={11} style={{padding:'10px 12px',fontWeight:800,fontSize:'12.5px',color:'#92400e'}}>
                      ⚠️ Da controllare — qui recuperi MENO del costo del corriere <span style={{fontWeight:600}}>({rettCtrl.length})</span>
                      {totaleCtrl > 0.01 && <span style={{float:'right'}}>mancano € {totaleCtrl.toFixed(2)}</span>}
                    </td>
                  </tr>
                )}
                {gruppiCtrl.flatMap(renderGruppo)}
                {gruppiSoloMie.length > 0 && (
                  <tr key="sez-solo-mie" style={{background:'#f1f5f9'}}>
                    <td colSpan={11} style={{padding:'10px 12px',fontWeight:800,fontSize:'12.5px',color:'#334155'}}>
                      Solo a tuo carico — sotto non c'è niente da rettificare: confermandole registri il tuo costo <span style={{fontWeight:600}}>({rettSoloMie.length})</span>
                      {costoSoloMie > 0.005 && <span style={{float:'right'}}>€ {costoSoloMie.toFixed(2)}</span>}
                    </td>
                  </tr>
                )}
                {gruppiSoloMie.flatMap(renderGruppo)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* RETTIFICHE ELIMINATE — quello che ti e' stato scalato e che non hai girato a nessuno. */}
      {!elim?.vietato && (
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden',marginTop:'16px'}}>
        <div onClick={()=>{ const apri = !elimAperta; setElimAperta(apri); if (apri && !elim) caricaEliminate(elimDal, elimAl) }}
          style={{padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',borderBottom:elimAperta?'1px solid #d1d5db':'none'}}>
          <span style={{fontSize:'14px',fontWeight:'700',color:'#1a1a1a'}}>
            <span style={{display:'inline-block',width:'14px',color:'#6b7280'}}>{elimAperta?'▾':'▸'}</span>
            Rettifiche eliminate
            <span style={{fontSize:'12px',color:'#6b7280',fontWeight:400,marginLeft:'8px'}}>pagate da te e non recuperate da clienti o sotto-master</span>
          </span>
          {elim?.righe && <span style={{fontSize:'13px',fontWeight:700,color:'#dc2626'}}>{elimFiltrate.length} · € {elimTotale.toFixed(2)}</span>}
        </div>
        {elimAperta && (
          <div>
            <div style={{padding:'12px 16px',display:'flex',gap:'12px',flexWrap:'wrap',alignItems:'flex-end',borderBottom:'1px solid #f0f0f0'}}>
              <div style={{flex:'0 0 auto'}}>
                <label style={{fontSize:'11px',fontWeight:'600',color:'#999',textTransform:'uppercase',letterSpacing:'0.4px',display:'block',marginBottom:'4px'}}>Periodo</label>
                <DateRangePicker dal={elimDal} al={elimAl} onChange={(d,a)=>{ setElimDal(d); setElimAl(a); caricaEliminate(d, a) }}/>
              </div>
              <div style={{minWidth:'200px',flex:'1 1 200px'}}>
                <label style={{fontSize:'11px',fontWeight:'600',color:'#999',textTransform:'uppercase',letterSpacing:'0.4px',display:'block',marginBottom:'4px'}}>Cerca</label>
                <input value={elimCerca} onChange={e=>{ setElimCerca(e.target.value); setElimPagina(1) }} placeholder="N. spedizione, da chi, motivo..."
                  style={{padding:'8px 10px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',width:'100%',color:'#1a1a1a',background:'#fff',boxSizing:'border-box'}}/>
              </div>
              <button onClick={scaricaEliminate} disabled={!elimFiltrate.length}
                style={{padding:'8px 14px',background:'#fff',color:'#1a1a1a',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',fontWeight:600,cursor:elimFiltrate.length?'pointer':'not-allowed'}}>
                ⬇ Scarica
              </button>
            </div>
            {elimCarico ? (
              <div style={{padding:'24px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'13px'}}>Caricamento...</div>
            ) : elim?.errore ? (
              <div style={{padding:'24px',textAlign:'center' as const,color:'#dc2626',fontSize:'13px'}}>{elim.errore}</div>
            ) : !elimFiltrate.length ? (
              <div style={{padding:'24px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'13px'}}>{elimQ ? 'Nessuna rettifica corrisponde alla ricerca.' : 'Nessuna rettifica pagata e non recuperata in questo periodo.'}</div>
            ) : (
              <>
                <div style={{padding:'8px 16px',fontSize:'12px',color:'#475569',lineHeight:1.6,display:'flex',justifyContent:'space-between',gap:'12px',flexWrap:'wrap'}}>
                  <div>
                    {elimPerMotivo.map(([m, v]: any) => (
                      <div key={m}>• {m}: <strong>{v.n}</strong> · € {Number(v.euro).toFixed(2)}</div>
                    ))}
                  </div>
                  <span style={{color:'#666'}}>
                    Mostra{' '}
                    <select value={elimPerPage} onChange={e=>{ setElimPerPage(Number(e.target.value)); setElimPagina(1) }}
                      style={{padding:'3px 6px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',color:'#1a1a1a',background:'#fff'}}>
                      <option value={10}>10</option><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option>
                    </select>{' '}elementi
                  </span>
                </div>
                <div style={{overflowX:'auto' as const}}>
                  <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'12px'}}>
                    <thead><tr style={{background:'#f9fafb'}}>
                      {['LDV','Data','Da','Pagato da te','Perché'].map(h=>(
                        <th key={h} style={{textAlign:'left' as const,padding:'7px 10px',fontSize:'10px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap' as const}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {elimVisibili.map((r:any)=>(
                        <tr key={r.id} style={{borderBottom:'1px solid #e5e7eb'}}>
                          <td style={{padding:'7px 10px',color:'#f97316',fontWeight:600}}>{r.ldv}</td>
                          <td style={{padding:'7px 10px',color:'#1a1a1a',whiteSpace:'nowrap' as const}}>{new Date(r.quando).toLocaleDateString('it-IT')}</td>
                          <td style={{padding:'7px 10px',color:'#1a1a1a'}}>{r.da}</td>
                          <td style={{padding:'7px 10px',color:'#dc2626',fontWeight:700}}>€ {Number(r.importo).toFixed(2)}</td>
                          <td style={{padding:'7px 10px',color:'#475569'}}>{r.motivo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderTop:'1px solid #e5e7eb',flexWrap:'wrap',gap:'8px'}}>
                  <span style={{fontSize:'12px',color:'#666'}}>{(elimPagCorr - 1) * elimPerPage + 1}-{Math.min(elimPagCorr * elimPerPage, elimFiltrate.length)} di {elimFiltrate.length}</span>
                  <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
                    <button onClick={()=>setElimPagina(p=>Math.max(1,p-1))} disabled={elimPagCorr<=1} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:elimPagCorr<=1?'default':'pointer',color:elimPagCorr<=1?'#ccc':'#1a1a1a'}}>Precedente</button>
                    {Array.from({length: elimTotPagine}, (_,i)=>i+1).filter(n => n===1 || n===elimTotPagine || Math.abs(n-elimPagCorr)<=2).map((n,idx,arr)=>(
                      <span key={n} style={{display:'flex',alignItems:'center'}}>
                        {idx>0 && arr[idx-1] !== n-1 && <span style={{padding:'0 4px',color:'#bbb',fontSize:'12px'}}>{'…'}</span>}
                        <button onClick={()=>setElimPagina(n)} style={{minWidth:'30px',padding:'5px 8px',border:'1px solid',borderColor:n===elimPagCorr?'#f97316':'#d1d5db',borderRadius:'5px',background:n===elimPagCorr?'#f97316':'#fff',color:n===elimPagCorr?'#fff':'#1a1a1a',fontSize:'12px',fontWeight:n===elimPagCorr?'700':'400',cursor:'pointer'}}>{n}</button>
                      </span>
                    ))}
                    <button onClick={()=>setElimPagina(p=>Math.min(elimTotPagine,p+1))} disabled={elimPagCorr>=elimTotPagine} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:elimPagCorr>=elimTotPagine?'default':'pointer',color:elimPagCorr>=elimTotPagine?'#ccc':'#1a1a1a'}}>Successivo</button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  )
}