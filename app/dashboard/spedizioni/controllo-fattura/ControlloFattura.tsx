'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import BarraAvanzamento from '@/app/components/BarraAvanzamento'
import { useDialog } from '@/app/components/DialogProvider'
import { leggiFatturaBrt, descriviVoce, pesoTassatoBrt, KG_PER_M3_BRT, sigleSconosciute, type RigaFatturaBrt } from '@/lib/fattura-brt'
import { riepilogaFattura, daGirare, type EsitoPagina } from '@/lib/controllo-fattura-riepilogo'
import { eGls, espandiRigaGls, righeControlloGls, ricalcolaCarburanteGls, type ParteAllinea, type RigaFatturaGls } from '@/lib/fattura-gls'
import { C, carta, cifre, euro, conSegno, kg, r2, coloreImporto, Icona, Tessera, Pillola } from './ui'
import AltriGestionali, { type EsternoIniziale, type EsternoSalvato } from './AltriGestionali'

/* CONTROLLO FATTURA CORRIERE. Il detentore carica la fattura di BRT (il file TIVAF) o il PDF di GLS (borderò
 * settimanale o allegato della fattura, lib/fattura-gls) e vede spedizione per
 * spedizione quanto ha fatturato BRT, quanto Moove gli ha registrato come costo, e il perché di ogni
 * differenza: peso rimisurato, voci che il listino non ha, listino non allineato, spedizioni annullate che
 * BRT ha fatturato lo stesso.
 *
 * L'addebito ai clienti NON si fa qui: le differenze di peso si mandano alla Rettifica Costi come un file
 * "solo pesi", e lì si confermano come ogni altra rettifica. Una porta sola per i soldi dei pesi. */

export type EsitoControllo = EsitoPagina
type Contratto = { id: string; nome: string; attivo: boolean; tipo?: 'brt' | 'gls' }
// Quello che il PDF di GLS dice oltre alle righe: tracciato, periodo, carburante per contratto e quello del
// listino. Si salva con la fattura (riepilogo.gls), così l'avviso sul carburante resta anche riaprendola.
type InfoGls = {
  tracciato: 'bordero' | 'allegato'; titolo: string; dal: string | null; al: string | null
  totaleCliente: number | null; carburanteListino: number | null
  contratti: { codice: string; righe: number; nolo: number; carburante: number | null; percentuale: number | null; quadra: boolean }[]
}
type GruppoGls = 'contestare' | 'clienti' | 'chiarire' | 'listino'
// A che punto è una voce di "Cosa fare" (riepilogo.stati della fattura, rotta analizza).
// 'tentato': mandata alla Rettifica ma non creata (nota = perché, listino = quello da correggere, se è quello).
type StatoSalvato = { stato: 'contestato' | 'accreditato' | 'respinto' | 'chiesto' | 'risposto' | 'fatto' | 'girato' | 'assorbito' | 'fatturato' | 'tentato'; il: string; nota?: string; importo?: number; numero?: string; listino?: { id: string; nome: string; di: string }; storia?: { stato: string; il: string }[] }
type FatturaStorico = {
  id: string; corriere_id: string | null; nome_contratto: string; numero_fattura: string; etichetta: string | null; data_fattura: string | null; nome_file: string | null
  righe: number; andate: number; totale_corriere: number; costo_moove: number; differenza: number; non_trovate: number; totale_non_trovate: number
  da_girare: number; euro_da_girare: number; rettifiche_file_id: string | null; created_at: string
  girate: { inviate: number; confermate: number; euroConfermati: number; euroInAttesa: number; spedizioni?: string[] } | null; aTuoCarico: number
  noteDiCredito?: number; inAttesa?: number
  riepilogo?: { fileEsterni?: { nome: string; righe: number; il: string }[] } | null
}
type Filtro = 'perdita' | 'tutte' | 'peso' | 'supplemento' | 'voce' | 'tariffa' | 'annullata' | 'non_trovata' | 'rientri' | 'carburante' | 'storico'

// Pacchetti da 200: il listino si rifà con la funzione dell'addebito (~0,1 s a destinazione), così ogni
// richiesta resta lontana dal tempo massimo anche sulle fatture dei detentori grandi.
const PACCHETTO = 200
const PER_PAGINA = 50

const FASCE = [3, 5, 10, 20, 30, 50, 100]
const fascia = (p: number) => { const f = FASCE.find(x => p <= x); return f ? `fino a ${f} kg` : 'oltre 100 kg' }

const motiviDi = (cr: string): Record<string, { nome: string; icona: string }> => ({
  peso: { nome: `Peso o volume rimisurato da ${cr}`, icona: 'bilancia' },
  supplemento: { nome: 'Supplementi previsti dal tuo listino', icona: 'pacco' },
  voce: { nome: cr === 'GLS' ? 'Varie e servizi di GLS' : `Voci ${cr} che il listino non ha`, icona: 'etichetta' },
  tariffa: { nome: `Listino non allineato a ${cr}`, icona: 'cursori' },
  annullata: { nome: `Annullate in Moove, fatturate da ${cr}`, icona: 'annullata' },
  non_calcolabile: { nome: 'Destinazione senza prezzo nel listino', icona: 'avviso' },
  carburante: { nome: 'Carburante oltre il listino', icona: 'carburante' },
  storico: { nome: 'Costo registrato con il listino di allora', icona: 'storico' },
})

// I quattro gesti possibili su una differenza GLS (lib/controllo-fattura-gls), nell'ordine in cui si fanno.
const GRUPPI_GLS: { k: GruppoGls; titolo: string; sotto: string; icona: string; colore: string; fondo: string; orlo: string }[] = [
  { k: 'contestare', titolo: 'Da contestare a GLS', sotto: 'GLS ha messo più di quanto prevede il tuo contratto', icona: 'avviso', colore: C.rosso, fondo: C.rossoTenue, orlo: C.rossoOrlo },
  { k: 'clienti', titolo: 'Da girare ai clienti', sotto: 'Voci vere di GLS che in creazione non si sapevano', icona: 'bilancia', colore: C.arancioScuro, fondo: C.arancioTenue, orlo: C.arancioOrlo },
  { k: 'chiarire', titolo: 'Da chiarire con GLS', sotto: 'GLS non scrive cosa sono: chiedile prima di pagarle o girarle', icona: 'domanda', colore: C.ambra, fondo: C.ambraTenue, orlo: C.ambraOrlo },
  { k: 'listino', titolo: 'Da sistemare in Moove', sotto: 'Il costo registrato in Moove non è quello di GLS', icona: 'cursori', colore: C.testo, fondo: C.fondoTenue, orlo: C.filo },
]
const pct = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 2 }) + '%'
// Cosa vuol dire, in una riga, ogni motivo che non è una voce di GLS (quelle hanno la loro nota).
const NOTE_GLS: Record<string, string> = {
  'peso:clienti': 'Con «Manda alla Rettifica», qui sotto, diventano rettifiche da confermare.',
  'peso:listino': 'GLS ha tassato meno del peso registrato in Moove.',
  'storico:listino': 'Il tuo listino è cambiato dopo: queste spedizioni sono state pagate col listino di allora.',
  'tariffa:listino': 'A parità di peso il costo registrato in Moove non è quello che chiede GLS.',
  'carburante:listino': 'In quella zona il tuo listino non ha carburante, GLS sì.',
  'annullata:contestare': 'Annullate e rimborsate in Moove, ma GLS le ha fatturate.',
  'non_calcolabile:listino': 'Il listino non ha un prezzo per quella zona o fascia.',
}
// Una riga di "Cosa allineare nel listino" per GLS: le parti uguali (stesso listino, zona, voce e valori) sommate.
type GruppoAllinea = { chiave: string; listino: string; zona: string; voce: ParteAllinea['voce']; valListino: number; valGls: number; zonaGls?: string; n: number; euro: number; pesoMin: number; pesoMax: number; luoghi: string[] }
// Cosa c'è scritto nel listino e cosa chiede GLS, con le parole di chi lo deve correggere.
function descriviAllinea(a: GruppoAllinea): string {
  const pesi = a.pesoMin === a.pesoMax ? `a ${kg(a.pesoMin)}` : `da ${kg(a.pesoMin)} a ${kg(a.pesoMax)}`
  // Il prezzo di GLS è quello di un'altra zona del listino: è la zona da allargare, non il prezzo da cambiare.
  if (a.voce === 'nolo' && a.zonaGls) return `Pacchi ${pesi}: GLS chiede il prezzo della tua zona ${a.zonaGls}${Number.isFinite(a.valGls) ? ` (${euro(a.valGls)})` : ''}, per Moove sono zona ${a.zona}. GLS li tassa come ${a.zonaGls}: sono quelle località da aggiungere alla zona ${a.zonaGls}, non il prezzo da cambiare.`
  if (a.voce === 'nolo') return `Nolo ${pesi}: nel listino ${euro(a.valListino)}, GLS chiede ${euro(a.valGls)}.`
  if (a.voce === 'contrassegno') return `Diritto di contrassegno: nel listino ${euro(a.valListino)}, GLS chiede ${euro(a.valGls)}.`
  if (a.voce === 'carburante') return `Carburante: in questa zona il listino non ne ha, GLS lo mette (${pct(a.valGls)} sul nolo).`
  return `Altre differenze ${pesi} (supplementi del listino che GLS non chiede, o il contrario): in media ${euro(r2(a.euro / a.n))} a spedizione.`
}
const dataIt = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString('it-IT') : ''
// Il numero della fattura BRT si scrive "n. 68967"; quello del documento GLS è già una frase.
const nDoc = (x: string) => /^\d/.test(x) ? `n. ${x}` : x

export default function ControlloFattura({ iniziale }: { iniziale?: { contratti: Contratto[]; esiti: EsitoControllo[]; nomeFile: string; storico?: FatturaStorico[]; esterni?: EsternoIniziale[]; gls?: InfoGls; fatturaId?: string; rettificheInviate?: boolean; perche?: Record<string, { motivo: string; listino: boolean }> } }) {
  const dialog = useDialog()
  const [contratti, setContratti] = useState<Contratto[] | null>(iniziale?.contratti ?? null)
  const [contrattoId, setContrattoId] = useState(iniziale?.contratti?.[0]?.id ?? '')
  const [nomeFile, setNomeFile] = useState(iniziale?.nomeFile ?? '')
  const [esiti, setEsiti] = useState<EsitoControllo[]>(iniziale?.esiti ?? [])
  const [avvisi, setAvvisi] = useState<string[]>([])
  const [avanz, setAvanz] = useState<{ fatti: number; totale: number; da: number; etichetta: string } | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('perdita')
  const [cerca, setCerca] = useState('')
  const [pagina, setPagina] = useState(1)
  const [perPagina, setPerPagina] = useState(PER_PAGINA)
  const [inviando, setInviando] = useState(false)
  const [trascina, setTrascina] = useState(false)
  // Da `iniziale` solo nelle pagine di prova: una fattura già aperta, con le rettifiche già mandate.
  const [fatturaId, setFatturaId] = useState<string | null>(iniziale?.fatturaId ?? null)
  const [rettificheInviate, setRettificheInviate] = useState(iniziale?.rettificheInviate ?? false)
  const [storico, setStorico] = useState<FatturaStorico[] | null>(iniziale?.storico ?? null)
  const [rinomina, setRinomina] = useState<{ id: string; valore: string } | null>(null)
  const [etichettaAperta, setEtichettaAperta] = useState<string | null>(null)
  // La legenda delle sigle letta dal PDF della fattura (se caricato), e cosa ha detto il confronto col file.
  const [legenda, setLegenda] = useState<Record<string, string> | null>(null)
  const [notePdf, setNotePdf] = useState<string[]>([])
  const [infoGls, setInfoGls] = useState<InfoGls | null>(iniziale?.gls ?? null)
  // Una voce GLS scelta nel riquadro "cosa fare": la tabella mostra solo le spedizioni che ce l'hanno.
  const [voceScelta, setVoceScelta] = useState<string | null>(null)
  const [stati, setStati] = useState<Record<string, StatoSalvato>>({})
  const [esterniSalvati, setEsterniSalvati] = useState<Record<string, EsternoSalvato>>({})
  // Cresce quando si torna sulla scheda: il perché delle non girate si rifà (il listino può essere stato corretto).
  const [ritorni, setRitorni] = useState(0)
  const pdfRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Il corriere della pagina: quello della fattura aperta, altrimenti quello del contratto scelto.
  const contrattoSel = contratti?.find(c => c.id === contrattoId)
  const gls = esiti.length ? eGls(esiti[0].riga) : contrattoSel?.tipo === 'gls'
  const cr = gls ? 'GLS' : 'BRT'
  const MOTIVI = useMemo(() => motiviDi(cr), [cr])

  // Con la fattura aperta lo storico dice anche su quali sue spedizioni ci sono rettifiche (per le non girate).
  const caricaStorico = (aperta: string | null = fatturaId) => fetch('/api/fatture-corriere/storico' + (aperta ? '?aperta=' + encodeURIComponent(aperta) : '')).then(r => r.json()).then(d => setStorico(d.fatture || [])).catch(() => setStorico([]))
  useEffect(() => {
    if (iniziale) return
    fetch('/api/fatture-corriere/analizza').then(r => r.json()).then(d => {
      const c = d.contratti || []
      setContratti(c); if (c.length === 1) setContrattoId(c[0].id)
    }).catch(() => setContratti([]))
    caricaStorico()
    // LA FATTURA APERTA STA NELL'INDIRIZZO (?fattura=…). Prima viveva solo nella pagina: Wave il 25/11 mandava le
    // differenze alla Rettifica, andava a confermarle, tornava indietro (o ricaricava) e la fattura non c'era più,
    // da riaprire o ricaricare da capo. Ora si riapre da sola, in silenzio: se nel frattempo non c'è più, niente.
    const daRiaprire = new URLSearchParams(window.location.search).get('fattura')
    if (daRiaprire) apriFattura(daRiaprire, true)
  }, [iniziale])

  // L'indirizzo segue la fattura aperta (solo a controllo finito: setFatturaId arriva dopo la chiusura). Il primo
  // giro si salta, se no toglierebbe il ?fattura= prima che la fattura si riapra.
  const primoGiroIndirizzo = useRef(true)
  useEffect(() => {
    if (iniziale) return
    if (primoGiroIndirizzo.current) { primoGiroIndirizzo.current = false; return }
    const u = new URL(window.location.href)
    if (fatturaId) u.searchParams.set('fattura', fatturaId); else u.searchParams.delete('fattura')
    window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash)
  }, [fatturaId, iniziale])

  // LO STATO DELLE RETTIFICHE MANDATE SI AGGIORNA DA SOLO quando si torna su questa scheda: le rettifiche si
  // confermano in Rettifica Costi (che ora si apre in un'altra scheda), e tornando qui si vede subito quante
  // sono confermate. Lo stesso fa il tasto "Aggiorna". Lo stato viene dallo storico (girate per fattura).
  const [aggiornando, setAggiornando] = useState(false)
  const aggiornaStato = async () => { setAggiornando(true); await caricaStorico(); setAggiornando(false) }
  useEffect(() => {
    if (iniziale || !fatturaId || !rettificheInviate) return
    // Scheda che torna visibile, o finestra che torna in primo piano (Rettifica Costi in un'altra finestra).
    const torna = () => { if (document.visibilityState === 'visible') { caricaStorico(); setRitorni(n => n + 1) } }
    document.addEventListener('visibilitychange', torna); window.addEventListener('focus', torna)
    return () => { document.removeEventListener('visibilitychange', torna); window.removeEventListener('focus', torna) }
  }, [iniziale, fatturaId, rettificheInviate])

  async function apriFattura(id: string, daIndirizzo = false) {
    const d = await fetch('/api/fatture-corriere/storico?fattura=' + id).then(r => r.json()).catch(() => ({ error: 'Errore di connessione' }))
    if (d.error) {
      if (daIndirizzo) { const u = new URL(window.location.href); u.searchParams.delete('fattura'); window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash); return }
      await dialog.alert({ title: 'Fattura non aperta', message: d.error }); return
    }
    setFatturaId(id); setNomeFile(d.fattura.nome_file || ''); setEtichettaAperta(d.fattura.etichetta || null)
    // Mandate col pulsante, o già girate con un file proprio dalla pagina Rettifica.
    setRettificheInviate(!!d.fattura.rettifiche_file_id || !!d.fattura.riepilogo?.rettificheEsterne?.ids?.length)
    setLegenda(d.fattura.riepilogo?.legenda || null); setNotePdf([]); setInfoGls(d.fattura.riepilogo?.gls || null); setVoceScelta(null); setStati(d.fattura.riepilogo?.stati || {}); setEsterniSalvati(d.fattura.riepilogo?.esterni || {})
    if (d.fattura.corriere_id) setContrattoId(d.fattura.corriere_id)
    // Le fatture salvate prima del 02/11 hanno il peso tassato senza l'arrotondamento di BRT: si rifà qui dai
    // quattro pesi della riga, così il file di rettifiche esce col peso che BRT ha davvero tassato (3, non 2,8).
    setEsiti((d.esiti || []).map((e: EsitoControllo) => {
      const r: any = e.riga
      if (eGls(r)) return e   // GLS non arrotonda come BRT: il peso salvato è quello del PDF
      const m = r.pesoMisurato ?? Math.max(r.pesoDichiarato, r.pesoRilevato, r.volumeFatturare * KG_PER_M3_BRT, r.volumeRilevato * KG_PER_M3_BRT)
      return { ...e, riga: { ...r, pesoMisurato: m, pesoTassato: pesoTassatoBrt(m) } }
    }))
    setAvvisi([]); setPagina(1); setFiltro('perdita'); setCerca('')
    if (!daIndirizzo) window.scrollTo({ top: 0, behavior: 'smooth' })
    caricaStorico(id)   // com'è andata la Rettifica di questa fattura, spedizione per spedizione
  }
  const chiudiFattura = () => { setEsiti([]); setFatturaId(null); setNomeFile(''); setAvvisi([]); setRettificheInviate(false); setEtichettaAperta(null); setLegenda(null); setNotePdf([]); setInfoGls(null); setVoceScelta(null); setStati({}); setEsterniSalvati({}) }

  // IL PDF DELLA FATTURA: lo legge il server (legenda, numero, totali); qui si confronta col file.
  async function base64(f: File) {
    const b = new Uint8Array(await f.arrayBuffer()); let bin = ''
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return btoa(bin)
  }
  async function leggiPdf(f: File): Promise<any> {
    return fetch('/api/fatture-corriere/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pdfBase64: await base64(f) }) })
      .then(r => r.json()).catch(() => ({ error: 'Errore di connessione' }))
  }
  // Cosa dice il PDF rispetto al file: note (in verde) e avvisi (in giallo). Se è di un'altra fattura non si usa.
  function esitoPdf(p: any, righe: RigaFatturaBrt[]): { legenda: Record<string, string> | null; note: string[]; avvisi: string[] } {
    if (p.error) return { legenda: null, note: [], avvisi: [`PDF non letto: ${p.error}`] }
    if (p.numeroFattura && p.numeroFattura !== righe[0].numeroFattura)
      return { legenda: null, note: [], avvisi: [`Il PDF è della fattura n. ${p.numeroFattura}, il file della n. ${righe[0].numeroFattura}: il PDF non l'ho usato.`] }
    const note: string[] = [], avv: string[] = []
    const tot = righe.reduce((s, r) => s + r.totale, 0)
    if (p.totale != null && Math.abs(p.totale - tot) < 0.0015) note.push(`PDF della fattura letto: ${Object.keys(p.legenda || {}).length} sigle in legenda, e il totale torna con il file al millesimo (${euro(r2(tot))}).`)
    else if (p.totale != null) avv.push(`Il totale del PDF (${euro(r2(p.totale))}) non torna con il file (${euro(r2(tot))}): controlla che file e PDF siano della stessa fattura.`)
    for (const n of p.nuove || []) note.push(`Sigla nuova letta dalla legenda BRT: "${n.sigla}" = ${n.nome}.`)
    for (const c of p.cambiate || []) avv.push(`BRT ha cambiato la sigla "${c.sigla}": nel PDF c'è "${c.ora}", finora era "${c.prima}".`)
    return { legenda: Object.keys(p.legenda || {}).length ? p.legenda : null, note, avvisi: avv }
  }
  const avvisoSigle = (righe: RigaFatturaBrt[], leg: Record<string, string> | null) => {
    const ignote = sigleSconosciute(righe, leg)
    return ignote.length ? [`Nella fattura ci sono sigle che non conosciamo (${ignote.map(s => `"${s}"`).join(', ')}): aggiungi il PDF della fattura, BRT ci stampa la legenda.`] : []
  }
  // Il PDF aggiunto a fattura già aperta: la legenda si salva con la fattura.
  async function aggiungiPdf(f: File) {
    if (pdfRef.current) pdfRef.current.value = ''
    const righe = esiti.map(e => e.riga)
    const r = esitoPdf(await leggiPdf(f), righe)
    setAvvisi(prev => [...prev.filter(a => !a.startsWith('Nella fattura ci sono sigle') && !a.startsWith('PDF non letto') && !a.startsWith('Il PDF è della fattura')), ...r.avvisi, ...avvisoSigle(righe, r.legenda)])
    setNotePdf(r.note)
    if (!r.legenda) return
    setLegenda(r.legenda)
    if (fatturaId) await fetch('/api/fatture-corriere/analizza', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fatturaId, legenda: r.legenda }) }).catch(() => null)
  }

  // L'export di un altro gestionale appena abbinato: si salva con la fattura (cosa ne è uscito, non il file), così il
  // conto del documento sa quanto hanno pagato quei clienti anche riaprendola.
  async function registraEsterno(x: EsternoSalvato) {
    if (!fatturaId) return
    const d: any = await fetch('/api/fatture-corriere/analizza', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fatturaId, esterno: x }) })
      .then(r => r.json()).catch(() => ({ error: 'Errore di connessione' }))
    if (d.error) { setAvvisi(a => [...a, `L'export «${x.nome}» non si è salvato con la fattura: ${d.error}`]); return }
    setEsterniSalvati(d.esterni || {})
  }
  // Scaricare il file di rettifiche per un altro gestionale è un'azione: da qui la fattura resta nello storico.
  async function registraFileEsterno(x: { nome: string; righe: number }) {
    if (!fatturaId) return
    await fetch('/api/fatture-corriere/analizza', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fatturaId, fileEsterno: x }) }).catch(() => null)
    caricaStorico()
  }

  // Il nome che il detentore dà alla fattura nello storico; vuoto = torna il numero di BRT.
  async function salvaNome() {
    if (!rinomina) return
    const { id, valore } = rinomina
    const d = await fetch('/api/fatture-corriere/storico', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fattura: id, etichetta: valore }) })
      .then(r => r.json()).catch(() => ({ error: 'Errore di connessione' }))
    if (d.error) { await dialog.alert({ title: 'Nome non salvato', message: d.error }); return }
    setStorico(prev => (prev || []).map(f => f.id === id ? { ...f, etichetta: d.etichetta } : f))
    if (fatturaId === id) setEtichettaAperta(d.etichetta)
    setRinomina(null)
  }

  async function caricaFile(lista: File[]) {
    if (fileRef.current) fileRef.current.value = ''
    if (contrattoSel?.tipo === 'gls') { await caricaGls(lista); return }
    // Il TIVAF (.csv) e, se c'è, il PDF della fattura: possono arrivare insieme.
    const file = lista.find(f => /\.csv$/i.test(f.name)), pdf = lista.find(f => /\.pdf$/i.test(f.name))
    if (!file) {
      if (pdf && esiti.length) { await aggiungiPdf(pdf); return }
      await dialog.alert({ title: 'Manca il file TIVAF', message: 'Il controllo parte dal file TIVAF (.csv) di BRT. Il PDF della fattura si aggiunge insieme, per leggere la legenda delle sigle.' }); return
    }
    if (!contrattoId) { await dialog.alert({ title: 'Scegli il contratto', message: 'Prima scegli il contratto BRT a cui si riferisce la fattura.' }); return }
    // BRT scrive il file in ISO-8859-1: letto come UTF-8, le accentate dei destinatari diventerebbero rombi.
    const testo = new TextDecoder('iso-8859-1').decode(await file.arrayBuffer())
    const { righe, errori } = leggiFatturaBrt(testo)
    if (!righe.length) { await dialog.alert({ title: 'File non letto', message: errori.join(' ') || 'Nessuna riga nel file.' }); return }
    const pdfLetto = pdf ? esitoPdf(await leggiPdf(pdf), righe) : { legenda: null, note: [], avvisi: [] }
    chiudiFattura()
    setLegenda(pdfLetto.legenda); setNotePdf(pdfLetto.note)
    setNomeFile(file.name + (pdf ? ` + ${pdf.name}` : '')); setAvvisi([...errori, ...pdfLetto.avvisi, ...avvisoSigle(righe, pdfLetto.legenda)]); setPagina(1); setFiltro('perdita'); setCerca('')
    await controlla(righe, { numeroFattura: righe[0].numeroFattura, dataFattura: righe[0].dataFattura, nomeFile: file.name, legenda: pdfLetto.legenda || undefined })
  }

  // GLS manda solo PDF: lo legge il server, che torna le righe già nel formato del controllo, il periodo e il
  // carburante (del PDF e del listino del contratto).
  async function caricaGls(lista: File[]) {
    const pdf = lista.find(f => /\.pdf$/i.test(f.name))
    if (!pdf) { await dialog.alert({ title: 'Serve il PDF di GLS', message: 'GLS manda il borderò settimanale e l\'allegato della fattura in PDF: caricane uno.' }); return }
    setAvanz({ fatti: 0, totale: 1, da: Date.now(), etichetta: 'Leggo il PDF di GLS' }); setNomeFile(pdf.name)
    const d = await fetch('/api/fatture-corriere/gls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pdfBase64: await base64(pdf), contrattoId }) })
      .then(r => r.json()).catch(() => ({ error: 'Errore di connessione' }))
    setAvanz(null)
    if (d.error || !d.righe?.length) { setNomeFile(''); await dialog.alert({ title: 'PDF non letto', message: d.error || 'Nel PDF non ci sono spedizioni.' }); return }
    chiudiFattura()
    const info: InfoGls = { tracciato: d.tracciato, titolo: d.titolo, dal: d.dal, al: d.al, totaleCliente: d.totaleCliente, carburanteListino: d.carburanteListino, contratti: d.contratti }
    setInfoGls(info); setNomeFile(pdf.name)
    setAvvisi([...(d.errori || []), ...(d.avvisi || [])]); setPagina(1); setFiltro('perdita'); setCerca('')
    const righe = righeControlloGls({ al: d.al, cliente: d.cliente, righe: d.righe.map(espandiRigaGls),
      contratti: d.contratti.map((c: any) => ({ codice: c.codice, percentualeCarburante: c.percentuale, carburante: c.carburante })) }, d.numero)
    await controlla(righe, { numeroFattura: d.numero, dataFattura: d.al, nomeFile: pdf.name, gls: info })
  }

  // Le righe a pacchetti verso il server, che le confronta e le salva nello storico. Uguale per BRT e GLS.
  async function controlla(righe: RigaFatturaBrt[], testata: { numeroFattura: string; dataFattura: string | null; nomeFile: string; legenda?: Record<string, string>; gls?: InfoGls }, rifai = false) {
    const tutti: EsitoControllo[] = []
    const inizio = Date.now()
    let id: string | null = null
    setAvanz({ fatti: 0, totale: righe.length, da: inizio, etichetta: 'Confronto la fattura con le tue spedizioni' })
    for (let i = 0; i < righe.length; i += PACCHETTO) {
      const res: Response = await fetch('/api/fatture-corriere/analizza', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id
          ? { fatturaId: id, righe: righe.slice(i, i + PACCHETTO) }
          : { contrattoId, righe: righe.slice(i, i + PACCHETTO), testata, ...(rifai ? { rifai: true } : {}) }),
      })
      const d: any = await res.json().catch(() => ({ error: 'Risposta non valida' }))
      // La stessa fattura già controllata, con qualcosa già fatto: si sceglie se riaprire quella salvata o rifarla
      // con le regole di oggi. Prima si riapriva e basta: il 25/11 Wave aveva l'allegato GLS di ottobre salvato
      // prima delle correzioni del giorno e non c'era modo di rifarlo.
      if (d.giaCaricata) {
        setAvanz(null)
        const doc = `${gls ? 'Il documento' : 'La fattura'} ${nDoc(testata.numeroFattura)}`
        const rifare = await dialog.confirm({
          title: `${gls ? 'Documento già controllato' : 'Fattura già controllata'}`,
          message: `${doc} l'hai già controllat${gls ? 'o' : 'a'} il ${new Date(d.giaCaricata.il).toLocaleDateString('it-IT')}. Lo riapro com'era, o lo rifaccio con le regole di oggi? `
            + 'Rifacendolo, quello che hai già fatto resta: le rettifiche già mandate restano collegate, e rimandandole quelle già create vengono saltate.',
          confirmText: 'Rifallo con le regole di oggi', cancelText: 'Riapri com\'era',
        })
        if (rifare && !rifai) return controlla(righe, testata, true)
        await apriFattura(d.giaCaricata.id); return
      }
      // A metà: si ferma e lo dice. Un controllo parziale presentato come completo farebbe credere che
      // le spedizioni mancanti non ci siano. Nello storico resta "in corso" e ricaricando riparte da capo.
      if (!res.ok || d.error) {
        setAvanz(null)
        await dialog.alert({ title: 'Controllo interrotto', message: `${d.error || 'Errore'} — controllate ${tutti.length} righe su ${righe.length}. Ricarica il file: riparte da capo.` })
        setEsiti(tutti); return
      }
      id = d.fatturaId
      tutti.push(...d.esiti)
      setAvanz({ fatti: Math.min(i + PACCHETTO, righe.length), totale: righe.length, da: inizio, etichetta: 'Confronto la fattura con le tue spedizioni' })
    }
    // I totali dello storico li rifà il server dalle righe salvate. Dice anche se le differenze sono già nella
    // Rettifica (fattura rifatta, o già girate da un file): allora il riquadro mostra com'è andata, non il pulsante.
    const chiusa: any = await fetch('/api/fatture-corriere/analizza', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fatturaId: id, chiudi: true }) }).then(r => r.json()).catch(() => null)
    setFatturaId(id); setAvanz(null); setEsiti(tutti); setRettificheInviate(!!chiusa?.rettificheInviate); setStati(chiusa?.stati || {}); setEsterniSalvati(chiusa?.esterni || {})
    caricaStorico(id)
  }

  const trovate = useMemo(() => esiti.filter(e => e.spedizione), [esiti])
  // I rientri delle spedizioni fatte altrove li racconta la sezione degli altri gestionali.
  const rientriMoove = useMemo(() => trovate.filter(e => !e.riga.andata), [trovate])
  const daRettificare = useMemo(() => esiti.filter(daGirare), [esiti])
  // Com'è andata la Rettifica della fattura aperta: mandate, confermate, da confermare (dallo storico).
  const girateAperta = storico?.find(f => f.id === fatturaId)?.girate ?? null
  // LE DA GIRARE RIMASTE FUORI DALLA RETTIFICA, una per una e col perché. La Rettifica dice solo quante ne ha
  // scartate: il 25/11 Wave leggeva "1 non è diventata una rettifica" e in Rettifica Costi non c'era niente da
  // cercare (la NI665520237: GLS 130 kg, e il listino che Wave fa al sotto-master arriva a 50).
  const nonGirate = useMemo(() => {
    const fatte = girateAperta?.spedizioni
    if (!rettificheInviate || !fatte) return []
    return daRettificare.filter(e => !fatte.includes(e.spedizione!.id))
  }, [rettificheInviate, girateAperta, daRettificare])
  const [perche, setPerche] = useState<Record<string, { motivo: string; listino: boolean; listinoDaCorreggere?: { id: string; nome: string; di: string } }>>(iniziale?.perche ?? {})
  const chiaveNonGirate = nonGirate.map(e => e.spedizione!.id).join(',')
  useEffect(() => {
    if (iniziale || !fatturaId || !nonGirate.length) return
    let vivo = true
    fetch('/api/fatture-corriere/analizza', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fatturaId, perche: nonGirate.map(e => ({ id: e.spedizione!.id, peso: r2(e.riga.pesoTassato) })) }) })
      .then(r => r.json()).then(d => { if (vivo && Array.isArray(d.perche)) setPerche(Object.fromEntries(d.perche.map((x: any) => [x.id, { motivo: String(x.motivo || ''), listino: !!x.listino, ...(x.listinoDaCorreggere ? { listinoDaCorreggere: x.listinoDaCorreggere } : {}) }]))) })
      .catch(() => null)
    return () => { vivo = false }
  }, [iniziale, fatturaId, chiaveNonGirate, ritorni])
  const arriviResiFuori = useMemo(() => esiti.filter(e => !e.spedizione && !e.riga.andata).length, [esiti])
  const totali = useMemo(() => riepilogaFattura(esiti), [esiti])

  // COSA ALLINEARE NEL LISTINO: a parità di peso, di quanto il listino si scosta da BRT, per zona e fascia.
  // Solo dove le spedizioni sono almeno tre: un caso isolato non è una regola da correggere.
  const allineare = useMemo(() => {
    const g = new Map<string, { zona: string; fascia: string; n: number; tariffa: number }>()
    for (const e of trovate) {
      // GLS: lo scarto col listino di OGGI (che fa il costo delle prossime), non col costo registrato allora.
      const scarto = eGls(e.riga) ? (e.scartoListino ?? 0) : (e.motivi.find(m => m.tipo === 'tariffa')?.importo ?? 0)
      if (Math.abs(scarto) < 0.01 || !e.zona) continue
      const k = e.zona + '|' + fascia(e.riga.pesoTassato)
      const v = g.get(k) || { zona: e.zona, fascia: fascia(e.riga.pesoTassato), n: 0, tariffa: 0 }
      v.n++; v.tariffa += scarto; g.set(k, v)
    }
    return Array.from(g.values()).filter(v => v.n >= 3).sort((a, b) => Math.abs(b.tariffa) - Math.abs(a.tariffa))
  }, [trovate])

  // GLS, LISTINO PER LISTINO (lib/fattura-gls, AllineaGls): quale listino, quale zona, quale voce, cosa c'è
  // scritto e cosa chiede GLS. "Italia fino a 5 kg: più alto di 1,80 €" non diceva a Wave quale dei suoi tre
  // listini GLS toccare né cosa scriverci (Lorenzo, 25/11). Qui niente soglia di tre spedizioni: una voce del
  // listino sbagliata lo è anche su un pacco solo. I documenti salvati prima non hanno il dettaglio: per quelli
  // resta la tabella per zona e fascia.
  const allineareGls = useMemo(() => {
    if (!gls || !trovate.some(e => e.allinea) && trovate.some(e => Math.abs(e.scartoListino ?? 0) >= 0.01)) return null
    const g = new Map<string, GruppoAllinea>()
    for (const e of trovate) for (const p of e.allinea?.parti || []) {
      const a = e.allinea!
      // "Altro" ha valori diversi riga per riga: si somma per listino e zona.
      // Una zona vista diversa da GLS è una riga sola per listino, qualunque sia la fascia di peso.
      const valori = p.voce === 'altro' || p.zonaGls ? '' : `${p.listino}|${p.gls}`
      const chiave = [a.listino, a.zona, p.voce, valori, p.zonaGls || ''].join('|')
      const v = g.get(chiave) || { chiave, listino: a.listino, zona: a.zona, voce: p.voce, valListino: p.listino, valGls: p.gls, zonaGls: p.zonaGls, n: 0, euro: 0, pesoMin: Infinity, pesoMax: 0, luoghi: [] }
      if (p.zonaGls && Math.abs(v.valGls - p.gls) >= 0.005) v.valGls = NaN   // fasce diverse: prezzi diversi
      v.n++; v.euro = r2(v.euro + p.euro); v.pesoMin = Math.min(v.pesoMin, a.peso); v.pesoMax = Math.max(v.pesoMax, a.peso)
      if (a.luogo && v.luoghi.length < 6 && !v.luoghi.includes(a.luogo)) v.luoghi.push(a.luogo)
      g.set(chiave, v)
    }
    return Array.from(g.values()).filter(v => Math.abs(v.euro) >= 0.01).sort((a, b) => Math.abs(b.euro) - Math.abs(a.euro))
  }, [trovate, gls])
  const [tuttiAllinea, setTuttiAllinea] = useState(false)

  const passa = (e: EsitoControllo, f: Filtro) => {
    if (voceScelta && !e.motivi.some(m => (m.voce || `${m.tipo}:${m.gruppo}`) === voceScelta)) return false
    if (f === 'tutte') return true
    if (f === 'perdita') return (e.differenza ?? 0) > 0.005
    if (f === 'non_trovata') return !e.spedizione
    if (f === 'rientri') return !e.riga.andata
    return e.motivi.some(m => m.tipo === f && Math.abs(m.importo) >= 0.01)
  }
  const conteggi = useMemo(() => {
    const out = {} as Record<Filtro, number>
    for (const f of ['perdita', 'tutte', 'peso', 'supplemento', 'voce', 'tariffa', 'annullata', 'non_trovata', 'rientri', 'carburante', 'storico'] as Filtro[]) out[f] = esiti.filter(e => passa(e, f)).length
    return out
  }, [esiti, voceScelta])
  const filtrate = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    return esiti.filter(e => passa(e, filtro) && (!q || [e.riga.segnacollo, e.riga.rifNumerico, e.spedizione?.numero, e.spedizione?.chi, e.riga.destinatario, e.riga.localita, e.riga.cap]
      .some(x => String(x || '').toLowerCase().includes(q))))
      .sort((a, b) => (b.differenza ?? b.brt) - (a.differenza ?? a.brt))
  }, [esiti, filtro, cerca, voceScelta])

  // GLS: COSA FARE, voce per voce. Le differenze raggruppate per gesto (contestare, girare, chiarire,
  // sistemare) e dentro per voce, con quante spedizioni e quanti euro, e dove sono (le località).
  const cosaFare = useMemo(() => {
    if (!gls) return null
    // Il carburante oltre il contratto si conta sul documento intero (riquadro rosso in alto): quello delle
    // sole spedizioni Moove ne è una parte, e sommato di nuovo lo conterebbe due volte.
    const docSopra = !!infoGls?.contratti.some(c => c.percentuale != null && infoGls.carburanteListino != null && c.percentuale > infoGls.carburanteListino + 0.25)
    const g = new Map<GruppoGls, Map<string, { nome: string; tipo: string; gruppo: GruppoGls; voce: string | null; n: number; euro: number; nota: string; dove: Set<string>; cod: number }>>()
    for (const e of esiti) for (const m of e.motivi) {
      if (!m.gruppo || Math.abs(m.importo) < 0.005) continue
      if (docSopra && m.tipo === 'carburante' && m.gruppo === 'contestare') continue
      const k = m.voce || `${m.tipo}:${m.gruppo}`
      const mappa = g.get(m.gruppo) || new Map(); g.set(m.gruppo, mappa)
      const v = mappa.get(k) || { nome: m.voce || MOTIVI[m.tipo]?.nome || m.tipo, tipo: m.tipo, gruppo: m.gruppo, voce: m.voce || null, n: 0, euro: 0,
        nota: m.voce ? m.testo.split(': ').slice(1).join(': ') : (NOTE_GLS[`${m.tipo}:${m.gruppo}`] || ''), dove: new Set<string>(), cod: 0 }
      v.n++; v.euro = r2(v.euro + m.importo)
      if ((e.spedizione?.contrassegno || 0) > 0) v.cod++
      if (e.riga.localita && v.dove.size < 6) v.dove.add(e.riga.localita.replace(/\b\w/g, c => c.toUpperCase()))
      mappa.set(k, v)
    }
    return g
  }, [esiti, gls, MOTIVI, infoGls])
  // Il carburante oltre il contratto sulle sole spedizioni Moove: si scrive sotto quello del documento.
  const carburanteMoove = useMemo(() => {
    const l = esiti.flatMap(e => e.motivi.filter(m => m.tipo === 'carburante' && m.gruppo === 'contestare'))
    return { n: l.length, euro: r2(l.reduce((t, m) => t + m.importo, 0)) }
  }, [esiti])

  // ARRIVI E RESI PAGATI PIÙ DELLE PARTENZE (Lorenzo, 25/11: "qui paga più di quanto deve! sono tutte fascia fino a
  // 5 kg"). Il riferimento si legge dalle partenze dello stesso documento: il nolo che il corriere chiede in Italia a
  // quel peso (fra i noli il cui intervallo di pesi lo comprende, il più frequente, se almeno 5 partenze). Senza
  // partenze di quel peso (l'arrivo da 303,9 kg di ottobre) non si confronta: meglio niente che un numero inventato.
  // Va contestato: se il contratto prevede un prezzo diverso per gli arrivi lo dirà il corriere, e la voce si chiude.
  const arriviSopra = useMemo(() => {
    if (!gls) return null
    const estero = (r: any) => /parcel/i.test(String(r.servizio || ''))
    const fasce = new Map<number, { min: number; max: number; n: number }>()
    for (const e of esiti) {
      const r: any = e.riga
      if (!r.andata || estero(r) || !(r.nolo > 0)) continue
      const f = fasce.get(r.nolo) || { min: Infinity, max: 0, n: 0 }
      f.min = Math.min(f.min, r.pesoTassato); f.max = Math.max(f.max, r.pesoTassato); f.n++; fasce.set(r.nolo, f)
    }
    const righe: { e: EsitoControllo; riferimento: number; inPiu: number }[] = []
    for (const e of esiti) {
      const r: any = e.riga
      if (r.andata || estero(r) || !(r.nolo > 0)) continue
      const cand = Array.from(fasce.entries()).filter(([, f]) => f.n >= 5 && f.min <= r.pesoTassato + 1e-9 && r.pesoTassato <= f.max + 1e-9).sort((a, b) => b[1].n - a[1].n)
      if (cand.length && r.nolo > cand[0][0] + 0.005) righe.push({ e, riferimento: cand[0][0], inPiu: r2(r.nolo - cand[0][0]) })
    }
    return righe.length ? { righe, euro: r2(righe.reduce((t, x) => t + x.inPiu, 0)), noli: Array.from(new Set(righe.map(x => x.e.riga.nolo))), riferimenti: Array.from(new Set(righe.map(x => x.riferimento))) } : null
  }, [esiti, gls])

  // Il carburante di tutto il documento contro quello del listino: anche sulle spedizioni fuori Moove,
  // perché è GLS che lo conta su tutto il nolo, ed è tutto da contestare.
  const carburanteGls = useMemo(() => {
    if (!infoGls) return []
    return infoGls.contratti.filter(c => c.percentuale != null && c.nolo > 0).map(c => {
      const listino = infoGls.carburanteListino
      const sopra = listino != null && c.percentuale! > listino + 0.25
      return { ...c, listino, sopra, inPiu: sopra ? r2(c.nolo * (c.percentuale! - listino!) / 100) : 0 }
    })
  }, [infoGls])

  // IL CONTO DEL DOCUMENTO. Lorenzo, 25/11: "alla fine di tutti i giochi lui deve capire che ha pagato ad esempio
  // 2700 € e ha fatturato 3000 € per un guadagno di 300 €... appena non ha più operazioni da fare deve avere il quadro
  // completo di quello che ha speso e di quello che ha guadagnato". Uscito: quanto il corriere ha scalato per questo
  // documento, meno le note di credito ricevute. Entrato: quanto hanno pagato a te i clienti e i sotto-master delle
  // spedizioni Moove (movimenti, rettifiche già confermate comprese, all'ultimo controllo), quelli dell'altro gestionale
  // (dall'export), e le spedizioni fuori da tutto fatte pagare a mano. E cosa resta da fare, voce per voce, prima che
  // il conto sia definitivo. Per ora solo GLS: BRT, Poste e UPS arriveranno con lo stesso ragionamento.
  const conto = useMemo(() => {
    if (!gls || !esiti.length) return null
    const st = (k: string) => stati[k]?.stato
    const pagato = r2(infoGls?.totaleCliente ?? totali.totaleCorriere)
    const note = r2(Object.values(stati).filter(x => x.stato === 'accreditato').reduce((t, x) => t + (x.importo || 0), 0))
    const moove = r2(esiti.filter(e => e.spedizione && e.riga.andata && e.incasso).reduce((t, e) => t + e.incasso!.importo, 0))
    const altro = r2(Object.values(esterniSalvati).reduce((t, x) => t + (x.prezzoClienti || 0), 0))
    const aMano = r2(Object.entries(stati).filter(([k, x]) => k.startsWith('fuori:') && x.stato === 'fatturato').reduce((t, [, x]) => t + (x.importo || 0), 0))
    const incassato = r2(moove + altro + aMano)
    const speso = r2(pagato - note)
    // Le spedizioni fuori Moove: con l'export, quelle che non ha trovato; senza, tutte (manca il loro incasso).
    const abbinate = new Set(Object.values(esterniSalvati).flatMap(x => x.abbinate || []))
    const fuori = esiti.filter(e => !e.spedizione && e.riga.andata)
    const senzaExport = !Object.keys(esterniSalvati).length
    const daFare: { testo: string; euro?: number }[] = []
    const voce = (k: string, nome: string, gruppo: GruppoGls, euroV: number) => {
      const s = st(k)
      if (gruppo === 'contestare') {
        if (!s) daFare.push({ testo: `Contestare a ${cr}: ${nome}`, euro: euroV })
        else if (s === 'contestato') daFare.push({ testo: `Aspettare la risposta di ${cr}: ${nome}`, euro: euroV })
        else if (s === 'respinto') daFare.push({ testo: `${cr} ha respinto «${nome}»: assorbire o girare ai clienti`, euro: euroV })
        else if (s === 'tentato') daFare.push({ testo: `Girare ai clienti «${nome}»: la Rettifica non l'ha creata, vedi il perché`, euro: euroV })
      } else if (gruppo === 'chiarire') {
        if (!s) daFare.push({ testo: `Chiedere a ${cr}: ${nome}`, euro: euroV })
        else if (s === 'chiesto') daFare.push({ testo: `Aspettare la risposta di ${cr}: ${nome}`, euro: euroV })
      } else if (gruppo === 'listino') { if (!s) daFare.push({ testo: `Sistemare in Moove: ${nome}`, euro: euroV }) }
      else if (!s) daFare.push({ testo: `Girare ai clienti: ${nome}`, euro: euroV })
      else if (s === 'tentato') daFare.push({ testo: `Girare ai clienti «${nome}»: la Rettifica non l'ha creata, vedi il perché`, euro: euroV })
    }
    for (const c of carburanteGls.filter(c => c.sopra)) voce(`carburante-doc:${c.codice}`, `carburante al ${pct(c.percentuale!)} invece del ${pct(c.listino!)}`, 'contestare', c.inPiu)
    if (arriviSopra) voce('arrivi-sopra', 'arrivi e resi pagati più delle partenze', 'contestare', arriviSopra.euro)
    for (const [g, m] of cosaFare || new Map()) for (const [k, v] of m) {
      if (v.tipo === 'peso') continue   // i pesi hanno le loro righe qui sotto
      voce(`${g}|${k}`, v.nome, g, v.euro)
    }
    if (daRettificare.length && !rettificheInviate) daFare.push({ testo: `Mandare alla Rettifica ${daRettificare.length === 1 ? '1 differenza' : `${daRettificare.length} differenze`} di peso`, euro: r2(daRettificare.reduce((t, e) => t + (e.motivi.find(m => m.tipo === 'peso')?.importo || 0), 0)) })
    if (nonGirate.length) daFare.push({ testo: `${nonGirate.length} differenz${nonGirate.length === 1 ? 'a' : 'e'} di peso non girat${nonGirate.length === 1 ? 'a' : 'e'}: vedi il perché e rimanda`, euro: r2(nonGirate.reduce((t, e) => t + (e.motivi.find(m => m.tipo === 'peso')?.importo || 0), 0)) })
    if (girateAperta && girateAperta.inviate > girateAperta.confermate) daFare.push({ testo: `Confermare ${girateAperta.inviate - girateAperta.confermate} rettifiche in Rettifica Costi`, euro: girateAperta.euroInAttesa })
    if (senzaExport && fuori.length) daFare.push({ testo: `Caricare l'export dell'altro gestionale: ${fuori.length} spedizioni fuori Moove, di cui manca l'incasso`, euro: r2(fuori.reduce((t, e) => t + e.brt, 0)) })
    else for (const e of fuori.filter(e => !abbinate.has(e.riga.segnacollo) && !st(`fuori:${e.riga.segnacollo}`))) daFare.push({ testo: `Dire chi ha pagato la ${e.riga.segnacollo} (${e.riga.destinatario || e.riga.localita})`, euro: e.brt })
    for (const x of Object.values(esterniSalvati)) if (x.rettifiche > 0 && st(`esterno:${x.nome}`) !== 'fatto') daFare.push({ testo: `Caricare nel gestionale le ${x.rettifiche} rettifiche di «${x.nome}»` })
    return { pagato, note, speso, moove, altro, aMano, incassato, guadagno: r2(incassato - speso), daFare, senzaExport: senzaExport && fuori.length > 0 }
  }, [gls, esiti, stati, infoGls, totali, esterniSalvati, carburanteGls, arriviSopra, cosaFare, daRettificare, rettificheInviate, nonGirate, girateAperta, cr])
  const pagine = Math.max(1, Math.ceil(filtrate.length / perPagina))
  const pag = Math.min(pagina, pagine)
  const visibili = filtrate.slice((pag - 1) * perPagina, pag * perPagina)
  // CON UN FILTRO, LA RIGA PARLA SOLO DI QUELLO (Lorenzo, 27/11: "su carburante ci deve stare solo carburante e non
  // anche la voce entro le 12"). Sotto "Carburante" la NI665518064 mostrava +42,31 € e il motivo "Entro ore 12" da
  // 42 €: il carburante era 0,31. Si mostrano i motivi del filtro (o della voce scelta in "Cosa fare") e la loro
  // somma; il resto della differenza resta scritto sotto, e la stessa spedizione si ritrova sotto l'altro filtro.
  const TIPI_FILTRO = ['peso', 'supplemento', 'voce', 'tariffa', 'annullata', 'carburante', 'storico']
  const motiviMostrati = (e: EsitoControllo) => voceScelta ? e.motivi.filter(m => (m.voce || `${m.tipo}:${m.gruppo}`) === voceScelta)
    : TIPI_FILTRO.includes(filtro) ? e.motivi.filter(m => m.tipo === filtro) : e.motivi

  // L'INVIO ALLA RETTIFICA, comune a pesi e voci: lo stesso formato e lo stesso giro della pagina Rettifica (lettera
  // di vettura e peso, più `supplemento` e `voce` per le voci del corriere: lib/ripesature, file "solo pesi"), a
  // pacchetti, coi controlli del motore delle rettifiche. Il peso come NUMERO: la Rettifica legge i chili col punto
  // decimale e un numero lo prende così com'è. Alla fine la fattura ricorda il file (lo storico conta il girato).
  async function inviaAllaRettifica(righe: { ldv: string; peso: number; supplemento?: number; voce?: string }[], nome: string) {
    const quante = 50
    let da = 0, fileId: string | undefined, creati = 0, gia = 0, nonTrovate = 0, supplementiDopo = 0, fuoriCatena = 0, errore = ''
    const inizio = Date.now()
    setInviando(true)
    setAvanz({ fatti: 0, totale: righe.length, da: inizio, etichetta: 'Creo le rettifiche' })
    while (da < righe.length) {
      const res = await fetch('/api/rettifiche/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nomeFile: nome, righe, da, quante, fileId }),
      })
      const d = await res.json().catch(() => ({ error: 'Risposta non valida' }))
      if (d?.error) { errore = d.error; break }
      if (d?.tipo !== 'ripesature') { errore = 'La Rettifica non ha riconosciuto le righe come file di pesi.'; break }
      creati += d.creato || 0; gia += d.giaCaricate || 0; nonTrovate += d.totali?.nonTrovate || 0; supplementiDopo += d.supplementiArrivatiDopo || 0; fuoriCatena += d.fuoriCatena || 0
      fileId = d.fileId || fileId
      const avanti = (d.da || 0) + (d.quante || 0)
      if (avanti <= da) break
      da = avanti
      setAvanz({ fatti: Math.min(da, righe.length), totale: righe.length, da: inizio, etichetta: 'Creo le rettifiche' })
      if (d.finito) break
    }
    setAvanz(null); setInviando(false)
    // Si collega solo un file che ha creato qualcosa: il 27/11 l'invio dell'Oversize di Wave (0 rettifiche, catena
    // ferma a 130 kg) ha preso il posto del file con le 9 rettifiche vere di ottobre.
    if (fileId && fatturaId && creati + supplementiDopo > 0) {
      await fetch('/api/fatture-corriere/analizza', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fatturaId, rettificheFileId: fileId }) }).catch(() => null)
      setRettificheInviate(true); caricaStorico()
    }
    return { fileId, creati, gia, nonTrovate, supplementiDopo, fuoriCatena, errore }
  }
  // Quello che la Rettifica ha fatto, detto com'è. "Rettifiche create · Create 0 rettifiche su 1" il 27/11 ha fatto
  // credere a Wave di aver girato l'Oversize, e la voce ancora da mandare sembrava un errore.
  const esitoInvio = async (x: Awaited<ReturnType<typeof inviaAllaRettifica>>, totale: number) => {
    const fatte = x.creati + x.supplementiDopo
    const fuori = x.fuoriCatena ? ` ${x.fuoriCatena === 1 ? '1 non è diventata una rettifica' : `${x.fuoriCatena} non sono diventate rettifiche`}: a quel peso la catena dei prezzi si ferma, nel listino di chi sta sotto manca la fascia. Il perché e il listino da correggere li trovi sulla voce.` : ''
    return dialog.alert({
      title: x.errore ? 'Invio interrotto' : fatte ? 'Rettifiche create' : 'Nessuna rettifica creata',
      message: (x.errore ? x.errore + ' — ' : '') + (fatte ? `Create ${fatte} rettifich${fatte === 1 ? 'a' : 'e'} su ${totale} spedizion${totale === 1 ? 'e' : 'i'}.` : `Su ${totale} spedizion${totale === 1 ? 'e' : 'i'} la Rettifica non ha creato niente.`)
        + (x.supplementiDopo ? ` Di queste ${x.supplementiDopo} su spedizioni già rettificate per il peso: si aggiunge solo il supplemento.` : '')
        + fuori
        + (x.gia > x.supplementiDopo ? ` ${x.gia - x.supplementiDopo} erano già state mandate e sono state saltate.` : '')
        + (x.nonTrovate ? ` ${x.nonTrovate} non sono state trovate dalla Rettifica.` : '')
        + (fatte ? ' Le trovi in Rettifica Costi (il tasto qui sotto la apre in un\'altra scheda, questa resta aperta): controllale e premi Conferma.' : ' In Rettifica Costi non c\'è niente da confermare.'),
    })
  }

  // `lista`: di solito tutte quelle da girare; "Rimanda le non girate" passa solo quelle rimaste senza rettifica.
  async function mandaAllaRettifica(lista: EsitoControllo[] = daRettificare) {
    const euroPeso = r2(lista.reduce((s, e) => s + (e.motivi.find(m => m.tipo === 'peso')?.importo || 0), 0))
    const ok = await dialog.confirm({
      title: 'Mandare le differenze di peso alla Rettifica?',
      message: `${lista.length} spedizion${lista.length === 1 ? 'e' : 'i'} che ${cr} ha tassato più del peso registrato in Moove (col tuo listino ${euro(euroPeso)} in più). `
        + `Diventano rettifiche "da confermare" nella pagina Rettifica Costi, col peso tassato da ${cr}: lì ognuno paga col proprio listino, `
        + 'cliente o sotto-master che sia. Finché non le confermi non si muove un euro. Le spedizioni già rettificate vengono saltate.',
      confirmText: 'Manda alla Rettifica',
    })
    if (!ok) return
    const righe = lista.map(e => ({ ldv: e.spedizione!.numero, peso: r2(e.riga.pesoTassato) }))
    const x = await inviaAllaRettifica(righe, `${gls ? '' : 'Fattura '}${cr} ${esiti[0]?.riga.numeroFattura || ''} - differenze di peso`)
    await esitoInvio(x, righe.length)
  }

  // UN SUPPLEMENTO FISSO AI CLIENTI, SPEDIZIONE PER SPEDIZIONE: alla Rettifica come il fuori sagoma, ognuno lungo la
  // catena paga lo stesso importo, col nome della voce. Serve alle voci del corriere da girare (l'Oversize, la Zona
  // ZTL: Lorenzo, 25/11 "l'oversize come lo addebita?") e al carburante oltre il contratto che il corriere non ha
  // accreditato ("oppure può rettificare i clienti di quelle spedizioni al 12% per recuperare i soldi"). Il peso è
  // quello di Moove, salvo che il corriere abbia anche tassato di più: allora quello del corriere, e la stessa
  // rettifica porta peso e supplemento.
  async function mandaSupplementi(chiave: string, nomeVoce: string, lista: { e: EsitoControllo; importo: number }[], spiega: string) {
    const valide = lista.filter(x => x.e.spedizione && x.e.riga.andata && x.e.spedizione.stato !== 'annullata' && x.importo > 0.005)
    if (!valide.length) { await dialog.alert({ title: 'Niente da girare', message: 'Nessuna spedizione Moove su cui girare questa voce.' }); return }
    const totale = r2(valide.reduce((t, x) => t + x.importo, 0))
    const ok = await dialog.confirm({
      title: `Girare «${nomeVoce}» ai clienti?`,
      message: `${valide.length} spedizion${valide.length === 1 ? 'e' : 'i'}, ${euro(totale)} in tutto. ${spiega} Diventano rettifiche "da confermare" in Rettifica Costi: `
        + `chi ha spedito (cliente o sotto-master) paga lo stesso importo. Finché non le confermi non si muove un euro.`,
      confirmText: 'Manda alla Rettifica',
    })
    if (!ok) return
    const righe = valide.map(({ e, importo }) => {
      const conPeso = e.motivi.some(x => x.tipo === 'peso' && x.gruppo === 'clienti' && x.importo > 0.005)
      const peso = conPeso || !(e.spedizione!.peso > 0) ? r2(e.riga.pesoTassato) : e.spedizione!.peso
      return { ldv: e.spedizione!.numero, peso, supplemento: r2(importo), voce: nomeVoce }
    })
    const x = await inviaAllaRettifica(righe, `${cr} ${esiti[0]?.riga.numeroFattura || ''} - ${nomeVoce}`)
    if (!x.errore && x.creati + x.supplementiDopo > 0) await segnaStato(chiave, 'girato', { nota: `${x.creati + x.supplementiDopo} rettifiche in Rettifica Costi`, importo: totale })
    else if (!x.errore) {
      // Niente creato: la voce lo dice, col perché della prima spedizione (la stessa domanda del riquadro "da girare":
      // la catena dei prezzi a quel peso) e il listino da correggere, se è quello.
      const d: any = await fetch('/api/fatture-corriere/analizza', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fatturaId, perche: valide.slice(0, 5).map(({ e }, i) => ({ id: e.spedizione!.id, peso: righe[i].peso })) }) }).then(r => r.json()).catch(() => ({}))
      const p = Array.isArray(d.perche) ? d.perche[0] : null
      await segnaStato(chiave, 'tentato', { importo: totale, nota: p?.motivo || (x.fuoriCatena ? 'a quel peso la catena dei prezzi si ferma: nel listino di chi sta sotto manca la fascia' : 'la Rettifica non ha trovato niente da chiedere'),
        ...(p?.listinoDaCorreggere ? { listino: p.listinoDaCorreggere } : {}) })
    }
    await esitoInvio(x, righe.length)
  }
  // Le voci del corriere da girare (gruppo "clienti", non i pesi): una voce, tutte le sue spedizioni.
  async function mandaVoceAllaRettifica(chiave: string, k: string) {
    const lista = esiti.map(e => ({ e, m: e.motivi.find(m => m.gruppo === 'clienti' && m.tipo !== 'peso' && (m.voce || `${m.tipo}:${m.gruppo}`) === k) }))
      .filter((x): x is { e: EsitoControllo; m: NonNullable<typeof x.m> } => !!x.m)
    await mandaSupplementi(chiave, lista[0]?.m.voce || k, lista.map(x => ({ e: x.e, importo: x.m.importo })), `È la voce che ${cr} ha messo sulle spedizioni.`)
  }
  // Il carburante oltre il contratto, quando il corriere non l'ha accreditato: la parte in più di ogni spedizione
  // Moove (il motivo "carburante" della riga) ai clienti.
  async function carburanteAiClienti(chiave: string) {
    const lista = esiti.flatMap(e => e.motivi.filter(m => m.tipo === 'carburante' && m.gruppo === 'contestare').map(m => ({ e, importo: m.importo })))
    await mandaSupplementi(chiave, 'Carburante oltre il contratto', lista, `${cr} ha applicato un carburante più alto del contratto e non l'ha accreditato: la parte in più di ogni spedizione.`)
  }

  // RIFARE IL DOCUMENTO APERTO CON LE REGOLE DI OGGI, dalle righe già salvate: non serve il file. Il 25/11 Wave
  // riapriva l'allegato GLS di ottobre dallo storico e vedeva sempre la copia di prima delle correzioni: per
  // rifarlo avrebbe dovuto ricaricare il PDF e sapere di doverlo fare. Le righe salvate sono quelle lette dal file
  // (per GLS il carburante si ripartisce di nuovo, quello stampato è nel riepilogo). Le azioni restano (rotta).
  async function rifaiConRegoleDiOggi() {
    if (!fatturaId || !esiti.length || avanz) return
    const ok = await dialog.confirm({
      title: 'Rifare il controllo con le regole di oggi?',
      message: `Rifaccio i conti ${gls ? 'di questo documento' : 'di questa fattura'} sulle righe già salvate, con le regole di oggi: non serve ricaricare il file. `
        + 'Quello che hai già fatto resta: le rettifiche già mandate restano collegate, e rimandandole quelle già create vengono saltate.',
      confirmText: 'Rifallo',
    })
    if (!ok) return
    let righe: RigaFatturaBrt[] = esiti.map(e => e.riga)
    if (gls && infoGls?.contratti?.length) righe = ricalcolaCarburanteGls(righe as RigaFatturaGls[], infoGls.contratti.map(c => ({ codice: c.codice, percentualeCarburante: c.percentuale, carburante: c.carburante })))
    setAvvisi([]); setPagina(1); setVoceScelta(null)
    await controlla(righe, { numeroFattura: righe[0].numeroFattura, dataFattura: righe[0].dataFattura, nomeFile, legenda: legenda || undefined, gls: infoGls || undefined }, true)
  }

  // A CHE PUNTO È OGNI VOCE DI "COSA FARE" (Lorenzo, 25/11: "un bottone che dice ok contestato, ok GLS mi ha fatto
  // la nota di credito e via dicendo... devi andare avanti con il pensiero"). Si segna qui, lo salva la rotta con la
  // fattura (riepilogo.stati) e lo storico lo ricorda: le note di credito ricevute e le voci che aspettano GLS.
  async function segnaStato(chiave: string, stato: StatoSalvato['stato'] | null, extra: { nota?: string; importo?: number; numero?: string; listino?: { id: string; nome: string; di: string } } = {}) {
    if (!fatturaId) return
    const d: any = await fetch('/api/fatture-corriere/analizza', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fatturaId, statoVoce: { chiave, stato, ...extra } }) }).then(r => r.json()).catch(() => ({ error: 'Errore di connessione' }))
    if (d.error) { await dialog.alert({ title: 'Non salvato', message: d.error }); return }
    setStati(d.stati || {}); caricaStorico()
  }
  // L'importo come lo scrive una persona: "185,24", "1.234,56" o "185.24".
  const leggiEuro = (x: string) => { const t = String(x).trim().replace(/\s|€/g, ''); const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); return Number.isFinite(n) ? n : NaN }
  async function notaDiCredito(chiave: string, proposto: number) {
    const numero = await dialog.prompt({ title: `Nota di credito di ${cr}`, message: `Il numero della nota di credito, come è scritto sul documento di ${cr}.`, placeholder: 'es. NC 1234', confirmText: 'Avanti' })
    if (numero == null) return
    const imp = await dialog.prompt({ title: `Quanto ti ha accreditato ${cr}?`, message: `Hai contestato ${euro(proposto)}: scrivi l'importo della nota di credito (anche se è diverso).`, defaultValue: proposto.toFixed(2).replace('.', ','), confirmText: 'Salva' })
    if (imp == null) return
    const importo = leggiEuro(imp)
    if (!(importo >= 0)) { await dialog.alert({ title: 'Importo non valido', message: 'Scrivi un importo in euro, per esempio 185,24.' }); return }
    await segnaStato(chiave, 'accreditato', { numero, importo })
  }
  const dataBreve = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
  // La riga di stato sotto una voce: cosa è stato fatto, e il prossimo passo, fino all'esito finale. Lorenzo, 25/11:
  // "lui dopo la risposta di GLS scriverà ok questi soldi li ho recuperati oppure no, GLS non ha accettato e quindi
  // assorbe lui, oppure può rettificare i clienti". Ogni voce finisce in uno di questi: accreditata (nota di
  // credito), girata ai clienti, assorbita, fatta (listino sistemato, file caricato), fatturata (a chi e quanto).
  //   gruppo 'fuori'   → una spedizione della fattura che non è né in Moove né nell'export dell'altro gestionale
  //   gruppo 'esterno' → il file di rettifiche scaricato per l'altro gestionale: caricato là, o no
  function rigaStato(gruppo: GruppoGls | 'fuori' | 'esterno', chiave: string, proposto: number, peso = false) {
    // I pesi da girare hanno il loro riquadro (Manda alla Rettifica); quelli tassati di meno non chiedono niente.
    if (!fatturaId || peso) return null
    const st = stati[chiave]
    const tasto = (testo: string, fai: () => void, forte = false) => (
      <button key={testo} onClick={e => { e.stopPropagation(); fai() }}
        style={{ padding: '4px 9px', borderRadius: 7, border: `1px solid ${forte ? C.arancio : C.filo}`, background: forte ? C.arancio : '#fff', color: forte ? '#fff' : C.testo, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>{testo}</button>
    )
    const verde = (t: string) => <Pillola key={t} colore={C.verde} fondo={C.verdeTenue} orlo={C.verdeOrlo}>{t}</Pillola>
    const giallo = (t: string) => <Pillola key={t} colore={C.ambra} fondo={C.ambraTenue} orlo={C.ambraOrlo}>{t}</Pillola>
    const grigio = (t: string) => <Pillola key={t} colore={C.attenuato} fondo={C.fondoTenue} orlo={C.filo}>{t}</Pillola>
    const annulla = st ? tasto('Annulla', () => segnaStato(chiave, null)) : null
    const assorbo = () => segnaStato(chiave, 'assorbito', { importo: proposto })
    const respinta = async () => { const n = await dialog.prompt({ title: `Respinta da ${cr}`, message: `Cosa ha risposto ${cr}? (facoltativo)`, confirmText: 'Salva' }); if (n != null) segnaStato(chiave, 'respinto', { nota: n }) }
    const risposta = async () => { const n = await dialog.prompt({ title: `Cosa ha risposto ${cr}?`, message: 'Cos\'è questa voce secondo il corriere: resta scritto qui per la prossima volta.', confirmText: 'Salva' }); if (n) segnaStato(chiave, 'risposto', { nota: n }) }
    const fatturata = async () => {
      const chi = await dialog.prompt({ title: 'A chi l\'hai fatta pagare?', message: 'Il cliente a cui l\'hai fatturata fuori da Moove.', confirmText: 'Avanti' })
      if (chi == null) return
      const imp = await dialog.prompt({ title: 'Quanto gli hai fatto pagare?', message: `${cr} te l'ha fatta pagare ${euro(proposto)}.`, defaultValue: proposto.toFixed(2).replace('.', ','), confirmText: 'Salva' })
      if (imp == null) return
      const importo = leggiEuro(imp)
      if (!(importo >= 0)) { await dialog.alert({ title: 'Importo non valido', message: 'Scrivi un importo in euro, per esempio 493,86.' }); return }
      await segnaStato(chiave, 'fatturato', { nota: chi, importo })
    }
    // Mandata alla Rettifica ma non creata: il perché, il listino da correggere (si apre in un'altra scheda), e di
    // nuovo il tasto per mandarla, o assorbirla.
    const nonCreata = (riprova: () => void) => [
      <Pillola key="nc" colore={C.rosso} fondo={C.rossoTenue} orlo={C.rossoOrlo}>{`Non creata il ${dataBreve(st!.il)}`}</Pillola>,
      ...(st?.listino ? [<a key="cl" href={`/dashboard/listini/clienti/${st.listino.id}`} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
        style={{ padding: '4px 9px', borderRadius: 7, border: `1px solid ${C.arancioOrlo}`, background: C.arancioTenue, color: C.arancioScuro, fontSize: 11.5, fontWeight: 700, textDecoration: 'none' }}>
        Correggi il listino «{st.listino.nome}» di {st.listino.di}</a>] : []),
      tasto('Riprova', riprova, true), tasto('Assorbo io', assorbo), annulla,
      ...(st?.nota ? [<div key="perche" style={{ flexBasis: '100%', fontSize: 11.5, color: '#475467', lineHeight: 1.4 }}>{st.nota}</div>] : []),
    ]
    // Il carburante oltre il contratto si può girare ai clienti; le altre voci contestate (annullate fatturate,
    // arrivi pagati più delle partenze) non sono spedizioni da ripassare a qualcuno.
    const giroPossibile = chiave.startsWith('carburante-doc:') || chiave === 'contestare|carburante:contestare'
    const parti = gruppo === 'contestare'
      ? !st ? [tasto('Segna contestata', () => segnaStato(chiave, 'contestato'), true)]
        : st.stato === 'contestato' ? [giallo(`Contestata il ${dataBreve(st.il)}`), tasto('Nota di credito ricevuta', () => notaDiCredito(chiave, proposto), true), tasto('Respinta', respinta), annulla]
        : st.stato === 'accreditato' ? [verde(`Recuperata: nota di credito${st.numero ? ' ' + st.numero : ''} ${euro(st.importo || 0)}, il ${dataBreve(st.il)}`), annulla]
        : st.stato === 'respinto' ? [<Pillola key="r" colore={C.rosso} fondo={C.rossoTenue} orlo={C.rossoOrlo}>{`Respinta il ${dataBreve(st.il)}${st.nota ? ': ' + st.nota : ''}`}</Pillola>,
            ...(giroPossibile ? [tasto('Giro ai clienti', () => carburanteAiClienti(chiave), true)] : []), tasto('Assorbo io', assorbo, !giroPossibile), annulla]
        : st.stato === 'girato' ? [verde(`Respinta, girata ai clienti il ${dataBreve(st.il)}${st.nota ? ' · ' + st.nota : ''}`), annulla]
        : st.stato === 'tentato' ? nonCreata(() => carburanteAiClienti(chiave))
        : [grigio(`Respinta, assorbita da te (${euro(st.importo ?? proposto)})`), annulla]
      : gruppo === 'chiarire'
        ? !st ? [tasto(`Chiesta a ${cr}`, () => segnaStato(chiave, 'chiesto'), true)]
          : st.stato === 'chiesto' ? [giallo(`Chiesta il ${dataBreve(st.il)}`), tasto(`Risposta di ${cr}`, risposta, true), annulla]
          : [verde(`${cr}: ${st.nota || 'ha risposto'} (${dataBreve(st.il)})`), annulla]
        : gruppo === 'listino'
          ? !st ? [tasto('Fatto', () => segnaStato(chiave, 'fatto'))] : [verde(`Fatto il ${dataBreve(st.il)}`), annulla]
          : gruppo === 'fuori'
            ? !st ? [tasto('L\'ho fatta pagare', fatturata, true), tasto('Assorbo io', assorbo)]
              : st.stato === 'fatturato' ? [verde(`Fatta pagare a ${st.nota || '?'}: ${euro(st.importo || 0)}`), annulla]
              : [grigio(`Assorbita da te (${euro(st.importo ?? proposto)})`), annulla]
            : gruppo === 'esterno'
              ? !st ? [tasto('Fatto: caricato nel gestionale', () => segnaStato(chiave, 'fatto'), true)] : [verde(`Caricato nel gestionale il ${dataBreve(st.il)}`), annulla]
              : !st ? [tasto('Manda alla Rettifica', () => mandaVoceAllaRettifica(chiave, chiave.slice(gruppo.length + 1)), true)]
                : st.stato === 'tentato' ? nonCreata(() => mandaVoceAllaRettifica(chiave, chiave.slice(gruppo.length + 1)))
                : st.stato === 'assorbito' ? [grigio(`Assorbita da te (${euro(st.importo ?? proposto)})`), annulla]
                : [verde(`Mandata alla Rettifica il ${dataBreve(st.il)}${st.nota ? ' · ' + st.nota : ''}`), annulla]
    return <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 7 }}>{parti}</div>
  }

  // LA CONTESTAZIONE PRONTA DA MANDARE: il testo (copiato, da incollare nella mail al corriere) e l'Excel con le
  // spedizioni contestate. Il carburante oltre il contratto si conta su tutto il documento, come lo conta GLS.
  async function preparaContestazione() {
    const docSopra = carburanteGls.some(c => c.sopra)
    const doc = infoGls?.titolo || `fattura ${esiti[0]?.riga.numeroFattura || ''}`
    const cliente = esiti[0]?.riga.codiceCliente
    const punti: string[] = []
    let totale = 0
    for (const c of carburanteGls.filter(c => c.sopra)) {
      punti.push(`Carburante applicato al ${pct(c.percentuale!)} invece del ${pct(c.listino!)} previsto dal contratto ${c.codice}: ${euro(c.carburante || 0)} su ${euro(c.nolo)} di nolo, al ${pct(c.listino!)} sarebbero ${euro(r2(c.nolo * c.listino! / 100))}. Da accreditare ${euro(c.inPiu)}.`)
      totale += c.inPiu
    }
    if (arriviSopra) {
      punti.push(`Arrivi e resi fatturati con un nolo più alto delle partenze dello stesso peso (${arriviSopra.noli.map(n => euro(n)).join(' / ')} invece di ${arriviSopra.riferimenti.map(n => euro(n)).join(' / ')}): ${arriviSopra.righe.map(x => x.e.riga.segnacollo).join(', ')}. Da accreditare ${euro(arriviSopra.euro)} di nolo.`)
      totale += arriviSopra.euro
    }
    const righe = esiti.flatMap(e => e.motivi.filter(m => m.gruppo === 'contestare' && !(docSopra && m.tipo === 'carburante')).map(m => ({ e, m })))
    const perTipo = new Map<string, { n: number; euro: number }>()
    for (const { m } of righe) { const v = perTipo.get(m.tipo) || { n: 0, euro: 0 }; v.n++; v.euro = r2(v.euro + m.importo); perTipo.set(m.tipo, v) }
    for (const [t, v] of perTipo) { punti.push(`${MOTIVI[t]?.nome || t}: ${v.n} spedizion${v.n === 1 ? 'e' : 'i'}, ${euro(v.euro)} (elenco allegato).`); totale += v.euro }
    if (!punti.length) return
    const testo = `Buongiorno,\ncontestiamo ${doc}${cliente ? ` (cliente ${cliente})` : ''}:\n` + punti.map((p, i) => `${i + 1}) ${p}`).join('\n')
      + `\nTotale da accreditare: ${euro(r2(totale))}. In allegato l'elenco delle spedizioni.\nRestiamo in attesa della nota di credito.`
    const { utils, writeFile } = await import('xlsx')
    const wb = utils.book_new()
    utils.book_append_sheet(wb, utils.json_to_sheet(testo.split('\n').map(r => ({ Contestazione: r }))), 'Contestazione')
    const foglio = [
      ...righe.map(({ e, m }) => ({ e, importo: m.importo, motivo: m.testo })),
      ...(arriviSopra?.righe || []).map(x => ({ e: x.e, importo: x.inPiu, motivo: `${x.e.riga.tipoBolla}: nolo ${euro(x.e.riga.nolo)}, alle partenze dello stesso peso ${euro(x.riferimento)}` })),
    ]
    if (foglio.length) utils.book_append_sheet(wb, utils.json_to_sheet(foglio.map(({ e, importo, motivo }) => ({
      [gls ? 'Tracking GLS' : 'Segnacollo']: e.riga.segnacollo, 'Data': e.riga.dataRitiro || '', 'Destinatario': e.riga.destinatario, 'Località': e.riga.localita,
      [`Fatturato ${cr} (€)`]: e.brt, 'Contestato (€)': importo, 'Motivo': motivo,
    }))), 'Spedizioni')
    writeFile(wb, `contestazione-${cr.toLowerCase()}-${(esiti[0]?.riga.numeroFattura || 'documento').replace(/[^\w-]+/g, '-')}.xlsx`)
    let copiato = false
    try { await navigator.clipboard.writeText(testo); copiato = true } catch { /* il testo resta nel primo foglio dell'Excel */ }
    await dialog.alert({ title: 'Contestazione pronta', message: (copiato ? 'Il testo è copiato: incollalo nella mail a ' + cr + ' e allega l\'Excel appena scaricato. ' : 'Il testo è nel primo foglio dell\'Excel appena scaricato. ')
      + 'Quando l\'hai mandata, premi «Segna contestata» sulle voci: poi segni la nota di credito quando arriva.' })
  }

  // L'EXCEL DELLA TABELLA, filtro compreso. Con un filtro (o una voce scelta in "Cosa fare") il file parla solo di
  // quella voce: Lorenzo, 27/11 "wave manda il file carburante solo con la voce carburante e non anche con la voce
  // entro le 12". Fuori i motivi e le voci del corriere che non c'entrano, e al posto della differenza intera
  // l'importo di quella voce. Senza filtro, tutto come prima.
  async function scaricaExcel() {
    const { utils, writeFile } = await import('xlsx')
    const filtrato = !!voceScelta || TIPI_FILTRO.includes(filtro)
    const nomeFiltro = voceScelta
      ? ((cosaFare && Array.from(cosaFare.values()).flatMap(m => Array.from(m.entries())).find(([k]) => k === voceScelta)?.[1].nome) || voceScelta)
      : MOTIVI[filtro]?.nome || filtro
    // Le voci del corriere che c'entrano col filtro: per il carburante solo il carburante.
    const vociDi = (e: EsitoControllo) => filtrato && filtro === 'carburante' && !voceScelta
      ? e.riga.voci.filter(v => descriviVoce(v.sigla, legenda).categoria === 'carburante')
      : e.riga.voci
    const righe = filtrate.map(e => {
      const mm = motiviMostrati(e)
      return {
        [gls ? 'Tracking GLS' : 'Segnacollo BRT']: e.riga.segnacollo, 'Spedizione Moove': e.spedizione?.numero || '', 'Chi ha spedito': e.spedizione?.chi || '',
        'Destinazione': gls ? e.riga.localita : `${e.riga.cap} ${e.riga.localita} (${e.riga.provincia})`, [gls ? 'Tipo' : 'Bolla']: e.riga.tipoBolla,
        'Peso Moove (kg)': e.spedizione?.peso ?? '', [`Peso tassato ${cr} (kg)`]: r2(e.riga.pesoTassato),
        [`Nolo ${cr} (€)`]: e.riga.nolo,
        [`Voci ${cr}`]: vociDi(e).map(v => `${descriviVoce(v.sigla, legenda).nome} ${v.importo.toFixed(2)}`).join(' + '),
        ...(filtrato
          ? { [`${nomeFiltro} (€)`]: r2(mm.reduce((t, m) => t + m.importo, 0)) }
          : { [`${cr} (€)`]: e.brt, 'Costo Moove (€)': e.moove ?? '', [`Listino al peso ${cr} (€)`]: e.listino ?? '', 'Differenza (€)': e.differenza ?? '',
              ...(gls ? { 'Contratto': e.contratto || '', 'Ha pagato': e.incasso?.chi || '', 'Il cliente ti ha pagato (€)': e.incasso?.importo ?? '',
                [`Ti resta dopo ${cr} (€)`]: e.incasso && e.riga.andata ? r2(e.incasso.importo - e.brt) : '' } : {}) }),
        'Perché': e.spedizione ? mm.map(m => m.testo).join(' | ') : 'Non trovata in Moove',
      }
    })
    const wb = utils.book_new(); utils.book_append_sheet(wb, utils.json_to_sheet(righe), filtrato ? nomeFiltro.slice(0, 31) : 'Controllo fattura')
    const nomeFile = (esiti[0]?.riga.numeroFattura || 'export') + (filtrato ? '-' + nomeFiltro : '')
    writeFile(wb, `controllo-fattura-${cr.toLowerCase()}-${nomeFile.replace(/[^\w-]+/g, '-')}.xlsx`)
  }

  const scegliFile = () => { if (!avanz) fileRef.current?.click() }
  const contrattoNome = contrattoSel?.nome
  const diff = totali.differenza
  const conRisultati = esiti.length > 0 && !avanz
  const maxMotivo = Math.max(0.01, ...Object.values(totali.perMotivo).map(v => Math.abs(v.euro)))

  // ── TESTATA: titolo e contratto, sempre visibili ──
  const testata = (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <Tessera nome="fattura" colore={C.arancio} fondo={C.arancioTenue} />
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.testo, margin: 0, letterSpacing: '-.01em' }}>Controllo fattura corriere</h1>
          <p style={{ fontSize: 13.5, color: C.attenuato, margin: '4px 0 0', maxWidth: 640, lineHeight: 1.5 }}>
            Confronta la fattura del corriere (BRT o GLS) con le tue spedizioni: dove hai speso più del previsto, perché, e cosa girare ai clienti.
          </p>
        </div>
      </div>
      {!!contratti?.length && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, ...carta, borderRadius: 10, padding: '6px 6px 6px 12px', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.attenuato, textTransform: 'uppercase', letterSpacing: '.04em' }}>Contratto</span>
          <select value={contrattoId} onChange={e => setContrattoId(e.target.value)} disabled={!!avanz}
            style={{ padding: '7px 30px 7px 10px', border: `1px solid ${C.filo}`, borderRadius: 8, fontSize: 13.5, fontWeight: 600, color: C.testo, background: C.fondoTenue, cursor: 'pointer', minWidth: 0, maxWidth: '100%', textOverflow: 'ellipsis' }}>
            {contratti.length > 1 && <option value="">Scegli…</option>}
            {contratti.map(c => <option key={c.id} value={c.id}>{c.nome}{c.attivo ? '' : ' (non attivo)'}</option>)}
          </select>
        </label>
      )}
    </div>
  )

  if (contratti && !contratti.length) {
    return (
      <div>
        {testata}
        <div style={{ ...carta, padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex' }}><Tessera nome="pacco" colore={C.attenuato} fondo={C.fondoTenue} /></div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.testo, marginTop: 12 }}>Nessun contratto BRT o GLS tuo</div>
          <div style={{ fontSize: 13, color: C.attenuato, marginTop: 4 }}>La fattura del corriere la controlla chi ha il contratto col corriere: qui compaiono i contratti BRT e GLS diretti che detieni.</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ color: C.testo }}>
      {testata}
      <input ref={fileRef} type="file" multiple accept=".csv,.CSV,text/csv,.pdf,.PDF,application/pdf" style={{ display: 'none' }}
        onChange={e => { const l = Array.from(e.target.files || []); if (l.length) caricaFile(l) }} />
      <input ref={pdfRef} type="file" accept=".pdf,.PDF,application/pdf" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) aggiungiPdf(f) }} />

      {/* ── CARICAMENTO: area grande, si trascina o si clicca ── */}
      {!conRisultati && (<>
        <div
          role="button" tabIndex={0} onClick={scegliFile} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') scegliFile() }}
          onDragOver={e => { e.preventDefault(); if (!avanz) setTrascina(true) }}
          onDragLeave={() => setTrascina(false)}
          onDrop={e => { e.preventDefault(); setTrascina(false); const l = Array.from(e.dataTransfer.files || []); if (l.length && !avanz) caricaFile(l) }}
          style={{
            ...carta, borderRadius: 16, border: `2px dashed ${trascina ? C.arancio : '#d0d5dd'}`, background: trascina ? C.arancioTenue : '#fff',
            padding: avanz ? '28px 28px' : '48px 24px', textAlign: 'center', cursor: avanz ? 'default' : 'pointer', transition: 'all .15s',
          }}>
          {avanz ? (
            <div style={{ maxWidth: 620, margin: '0 auto', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <Tessera nome="fattura" colore={C.arancio} fondo={C.arancioTenue} />
                <div><div style={{ fontWeight: 700, fontSize: 14 }}>{nomeFile}</div><div style={{ fontSize: 12.5, color: C.attenuato }}>Contratto {contrattoNome}</div></div>
              </div>
              <BarraAvanzamento fatti={avanz.fatti} totale={avanz.totale} iniziatoIl={avanz.da} etichetta={avanz.etichetta} />
            </div>
          ) : (<>
            <span style={{ width: 64, height: 64, borderRadius: 18, background: C.arancioTenue, color: C.arancio, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${C.arancioOrlo}` }}>
              <Icona nome="carica" size={30} />
            </span>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 16 }}>{gls ? 'Trascina qui il PDF di GLS' : 'Trascina qui la fattura BRT'}</div>
            <div style={{ fontSize: 13.5, color: C.attenuato, marginTop: 6 }}>{gls
              ? 'il borderò settimanale o l\'allegato della fattura: si riconoscono da soli. Del borderò vale l\'ultimo, che contiene i precedenti'
              : 'il file TIVAF (.csv) e, se ce l\'hai, anche il PDF della fattura: insieme, o scegli i file dal computer'}</div>
            <button type="button" onClick={e => { e.stopPropagation(); scegliFile() }}
              style={{ marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 10, border: 'none', background: C.arancio, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', boxShadow: '0 1px 2px rgba(16,24,40,.1)' }}>
              <Icona nome="carica" size={17} /> Scegli i file
            </button>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 18 }}>
              {gls ? (<>
                <Pillola colore={C.attenuato} fondo={C.fondoTenue} orlo={C.filo}>Borderò spedizioni (CLI_…_BOF_…pdf)</Pillola>
                <Pillola colore={C.attenuato} fondo={C.fondoTenue} orlo={C.filo}>Allegato della fattura (Allegato_…pdf)</Pillola>
              </>) : (<>
                <Pillola colore={C.attenuato} fondo={C.fondoTenue} orlo={C.filo}>Dettaglio fattura BRT "TIVAF", file .csv</Pillola>
                <Pillola colore={C.attenuato} fondo={C.fondoTenue} orlo={C.filo}>PDF della fattura: per leggere la legenda delle sigle</Pillola>
              </>)}
              {contrattoNome && <Pillola colore={C.arancioScuro} fondo={C.arancioTenue} orlo={C.arancioOrlo}>Contratto {contrattoNome}</Pillola>}
            </div>
          </>)}
        </div>

        {!avanz && !!storico?.length && (
          <div style={{ ...carta, marginTop: 16, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', borderBottom: `1px solid ${C.filo}` }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Fatture controllate</div>
                <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 2 }}>Mese per mese: quanto ha fatturato il corriere, quanto hai girato ai clienti e quanto è rimasto a te. Restano qui le fatture su cui hai fatto qualcosa: differenze mandate alla Rettifica o file di rettifiche scaricato per un altro gestionale.</div>
              </div>
              <div style={{ fontSize: 12.5, color: C.attenuato, ...cifre }}>
                Totale a tuo carico: <b style={{ color: coloreImporto(storico.reduce((t, f) => t + f.aTuoCarico, 0)), fontSize: 14 }}>{conSegno(r2(storico.reduce((t, f) => t + f.aTuoCarico, 0)))}</b>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ background: C.fondoTenue }}>
                  {[['Mese', 'left'], ['Fattura', 'left'], ['Fatturato', 'right'], ['Costo in Moove', 'right'], ['Differenza', 'right'], ['Girato ai clienti', 'right'], ['A tuo carico', 'right'], ['', 'right']].map(([h, a], i) => (
                    <th key={i} style={{ padding: '9px 14px', fontSize: 11.5, fontWeight: 600, color: C.attenuato, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', textAlign: a as any, borderBottom: `1px solid ${C.filo}` }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{storico.map((f, i) => (
                  <tr key={f.id} style={{ borderTop: i ? `1px solid ${C.filo}` : 'none' }}>
                    <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 700, textTransform: 'capitalize' }}>{f.data_fattura ? new Date(f.data_fattura).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }) : '—'}</div>
                      <div style={{ fontSize: 12, color: C.attenuato, marginTop: 2 }}>{f.nome_contratto}</div>
                    </td>
                    <td style={{ padding: '11px 14px', minWidth: 220 }}>
                      {rinomina?.id === f.id ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input autoFocus value={rinomina.valore} maxLength={80} placeholder={nDoc(f.numero_fattura)}
                            onChange={e => setRinomina({ id: f.id, valore: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter') salvaNome(); if (e.key === 'Escape') setRinomina(null) }}
                            style={{ flex: 1, minWidth: 140, padding: '6px 9px', border: `1px solid ${C.arancioOrlo}`, borderRadius: 8, fontSize: 13, fontWeight: 600, color: C.testo, outline: 'none' }} />
                          <button onClick={salvaNome} style={{ padding: '6px 10px', borderRadius: 8, border: 'none', background: C.arancio, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Salva</button>
                          <button onClick={() => setRinomina(null)} style={{ padding: '6px 9px', borderRadius: 8, border: `1px solid ${C.filo}`, background: '#fff', color: C.attenuato, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Annulla</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontWeight: 600 }}>{f.etichetta || nDoc(f.numero_fattura)}</span>
                          <button onClick={() => setRinomina({ id: f.id, valore: f.etichetta || '' })} title="Dai un nome a questa fattura"
                            style={{ display: 'inline-flex', padding: 3, borderRadius: 6, border: 'none', background: 'transparent', color: C.attenuato, cursor: 'pointer' }}>
                            <Icona nome="matita" size={14} />
                          </button>
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: C.attenuato, marginTop: 2 }}>{f.etichetta ? `${nDoc(f.numero_fattura)} · ` : ''}{f.righe.toLocaleString('it-IT')} righe{f.non_trovate ? ` · ${f.non_trovate} fuori Moove` : ''}</div>
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 600, ...cifre }}>{euro(Number(f.totale_corriere))}</td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', ...cifre }}>{euro(Number(f.costo_moove))}</td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 600, color: coloreImporto(Number(f.differenza)), ...cifre }}>{conSegno(Number(f.differenza))}</td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', ...cifre }}>
                      {f.girate ? (<>
                        <div style={{ fontWeight: 600 }}>{euro(f.girate.euroConfermati)}</div>
                        {f.girate.euroInAttesa > 0.005 && <div style={{ fontSize: 12, color: C.ambra, marginTop: 2 }}>{euro(f.girate.euroInAttesa)} da confermare</div>}
                      </>) : f.da_girare ? <span style={{ fontSize: 12, color: C.ambra }}>{f.da_girare} da mandare</span> : !f.riepilogo?.fileEsterni?.length ? <span style={{ color: '#98a2b3' }}>—</span> : null}
                      {!!f.riepilogo?.fileEsterni?.length && (
                        <div style={{ fontSize: 12, color: C.attenuato, marginTop: 2 }}>
                          {/* Lo stesso file scaricato due volte conta una: vale l'ultimo download per nome. */}
                          {Array.from(new Map(f.riepilogo.fileEsterni.map(x => [x.nome, x.righe || 0])).values()).reduce((n, x) => n + x, 0).toLocaleString('it-IT')} rettifiche nel file per il gestionale
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', ...cifre }}>
                      <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 8, fontWeight: 700, color: coloreImporto(f.aTuoCarico), background: f.aTuoCarico > 0.005 ? C.rossoTenue : f.aTuoCarico < -0.005 ? C.verdeTenue : C.fondoTenue }}>{conSegno(f.aTuoCarico)}</span>
                      {/* Le note di credito valgono su tutto il documento: si dicono a parte, non si tolgono qui sopra. */}
                      {!!f.noteDiCredito && <div style={{ fontSize: 12, color: C.verde, marginTop: 3 }}>{euro(f.noteDiCredito)} di note di credito</div>}
                      {!!f.inAttesa && <div style={{ fontSize: 12, color: C.ambra, marginTop: 2 }}>{f.inAttesa} {f.inAttesa === 1 ? 'voce aspetta' : 'voci aspettano'} il corriere</div>}
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                      <button onClick={() => apriFattura(f.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 8, border: `1px solid ${C.filo}`, background: '#fff', fontSize: 12.5, fontWeight: 600, color: C.testo, cursor: 'pointer' }}>
                        Apri <Icona nome="freccia" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

        {!avanz && !storico?.length && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12, marginTop: 16 }}>
            {[
              ['bilancia', 'Peso rimisurato', `${cr} ha pesato o misurato il pacco più del dichiarato: la differenza si gira al cliente con la Rettifica.`],
              ...(gls ? [['carburante', 'Carburante', 'Se GLS mette una percentuale più alta di quella del tuo listino, lo vedi in alto con quanto hai pagato in più.']]
                : [['pacco', 'Supplementi', 'Fuori misura e gli altri supplementi che BRT mette dopo: se nel tuo listino hanno un prezzo, sono previsti.']]),
              ['etichetta', gls ? 'Varie e servizi' : 'Voci fuori listino', gls ? 'Ogni varia e servizio di GLS col suo nome, e cosa farne: girarla, contestarla o chiederla a GLS.' : 'Le voci di BRT che nel tuo listino non hanno un prezzo, o la parte che il prezzo non copre.'],
              ['cursori', 'Listino da allineare', `A parità di peso, dove il tuo listino è più basso (o più alto) di quanto chiede ${cr}.`],
              ['annullata', 'Annullate ma fatturate', `Spedizioni annullate e rimborsate in Moove che ${cr} ti ha fatturato lo stesso.`],
            ].map(([ic, t, d]) => (
              <div key={t} style={{ ...carta, padding: 16, display: 'flex', gap: 12 }}>
                <Tessera nome={ic} colore={C.testo} fondo={C.fondoTenue} />
                <div><div style={{ fontSize: 13.5, fontWeight: 700 }}>{t}</div><div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 3, lineHeight: 1.45 }}>{d}</div></div>
              </div>
            ))}
          </div>
        )}
      </>)}

      {notePdf.map((a, i) => (
        <div key={'n' + i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: C.verde, background: C.verdeTenue, border: `1px solid ${C.verdeOrlo}`, borderRadius: 10, padding: '10px 12px', marginTop: 12 }}>
          <Icona nome="spunta" size={16} /> {a}
        </div>
      ))}
      {avvisi.map((a, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: C.ambra, background: C.ambraTenue, border: `1px solid ${C.ambraOrlo}`, borderRadius: 10, padding: '10px 12px', marginTop: 12 }}>
          <Icona nome="avviso" size={16} /> {a}
        </div>
      ))}

      {conRisultati && (<>
        {/* ── LA FATTURA CARICATA ── */}
        <div style={{ ...carta, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
          <Tessera nome="fattura" colore={C.arancio} fondo={C.arancioTenue} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              {etichettaAperta ? <>{etichettaAperta} <span style={{ fontWeight: 500, color: C.attenuato }}>· </span></> : null}
              {gls ? (infoGls?.titolo || esiti[0].riga.numeroFattura)
                : <>Fattura BRT n. {esiti[0].riga.numeroFattura}{esiti[0].riga.dataFattura ? ` del ${new Date(esiti[0].riga.dataFattura).toLocaleDateString('it-IT')}` : ''}</>}
            </div>
            <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 2 }}>
              {nomeFile} · {esiti.length.toLocaleString('it-IT')} righe: {totali.andate.toLocaleString('it-IT')} spedizioni e {totali.rientri} {gls ? 'arrivi e resi' : 'rientri'} · contratto {contrattoNome}
              {!(storico || []).some(f => f.id === fatturaId) && <> · resta nello storico se mandi le differenze alla Rettifica o scarichi il file per il gestionale</>}
            </div>
          </div>
          <button onClick={chiudiFattura} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 9, border: `1px solid ${C.filo}`, background: '#fff', fontSize: 13, fontWeight: 600, color: C.testo, cursor: 'pointer' }}>
            <Icona nome="fattura" size={16} /> Tutte le fatture
          </button>
          {fatturaId && (
            <button onClick={rifaiConRegoleDiOggi} disabled={!!avanz} title="Rifà i conti sulle righe già salvate, senza ricaricare il file: quello che hai già fatto resta"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 9, border: `1px solid ${C.filo}`, background: '#fff', fontSize: 13, fontWeight: 600, color: C.testo, cursor: avanz ? 'default' : 'pointer' }}>
              <Icona nome="storico" size={16} /> Rifai con le regole di oggi
            </button>
          )}
          <button onClick={scegliFile} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 9, border: `1px solid ${C.filo}`, background: '#fff', fontSize: 13, fontWeight: 600, color: C.testo, cursor: 'pointer' }}>
            <Icona nome="carica" size={16} /> Carica un'altra fattura
          </button>
          {!legenda && !gls && (
            <button onClick={() => pdfRef.current?.click()} title="Dal PDF leggo la legenda delle sigle e controllo che i totali tornino"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 9, border: `1px solid ${C.arancioOrlo}`, background: C.arancioTenue, fontSize: 13, fontWeight: 600, color: C.arancioScuro, cursor: 'pointer' }}>
              <Icona nome="fattura" size={16} /> Aggiungi il PDF
            </button>
          )}
        </div>

        {/* Un documento GLS controllato prima del 25/11: niente dettaglio dei listini e carburante a quattro decimali.
            Lo si dice e si offre di rifarlo, invece di lasciarlo com'è senza che nessuno lo sappia. */}
        {gls && fatturaId && allineareGls === null && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: C.ambra, background: C.ambraTenue, border: `1px solid ${C.ambraOrlo}`, borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
            <Icona nome="storico" size={16} />
            <span style={{ flex: 1, minWidth: 220 }}>Questo documento è stato controllato con le regole di prima: «Cosa allineare nel listino» non dice quale listino e il carburante non è diviso al centesimo. Rifallo per vedere tutto aggiornato: quello che hai già fatto resta.</span>
            <button onClick={rifaiConRegoleDiOggi} disabled={!!avanz}
              style={{ padding: '8px 13px', borderRadius: 9, border: `1px solid ${C.ambraOrlo}`, background: '#fff', fontSize: 13, fontWeight: 700, color: C.ambra, cursor: avanz ? 'default' : 'pointer' }}>
              Rifai con le regole di oggi
            </button>
          </div>
        )}

        {/* ── GLS: IL CARBURANTE. Il contratto ha la sua percentuale (nel listino); se GLS ne mette di più si
            dice qui, in alto, con quanto si è pagato in più su tutto il documento (Lorenzo, 24/11). ── */}
        {/* Tutto in regola: una riga sola, verde. Un avviso si guadagna il riquadro solo se c'è da fare qualcosa. */}
        {gls && carburanteGls.length > 0 && carburanteGls.every(c => !c.sopra && c.listino != null) && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: C.verde, background: C.verdeTenue, border: `1px solid ${C.verdeOrlo}`, borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
            <Icona nome="carburante" size={16} />
            Carburante: GLS {carburanteGls.map(c => `${pct(c.percentuale!)}${carburanteGls.length > 1 ? ` (contratto ${c.codice})` : ''}`).join(' e ')}, il tuo listino {pct(carburanteGls[0].listino!)}: torna.
          </div>
        )}
        {gls && !carburanteGls.every(c => !c.sopra && c.listino != null) && carburanteGls.map(c => (
          <div key={c.codice} style={{ ...carta, padding: '14px 16px', marginBottom: 12, display: 'flex', gap: 12, alignItems: 'flex-start',
            ...(c.sopra ? { background: C.rossoTenue, borderColor: C.rossoOrlo } : c.listino == null ? { background: C.ambraTenue, borderColor: C.ambraOrlo } : {}) }}>
            <Tessera nome="carburante" colore={c.sopra ? C.rosso : c.listino == null ? C.ambra : C.verde} fondo="#fff" />
            <div style={{ flex: 1, minWidth: 240 }}>
              {c.sopra ? (<>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: C.rosso }}>Carburante al {pct(c.percentuale!)} invece del {pct(c.listino!)}: {euro(c.inPiu)} pagati in più</div>
                <div style={{ fontSize: 12.5, color: '#475467', marginTop: 3, lineHeight: 1.5 }}>
                  Contratto GLS {c.codice}: {euro(c.carburante!)} di carburante su {euro(c.nolo)} di nolo. Al {pct(c.listino!)} del tuo listino sarebbero {euro(r2(c.nolo * c.listino! / 100))}.
                  {' '}Va contestato a GLS: conta tutte le {c.righe.toLocaleString('it-IT')} spedizioni del documento, anche quelle fatte fuori Moove.
                </div>
              </>) : c.listino == null ? (
                <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ambra }}>Carburante GLS {pct(c.percentuale!)} (contratto {c.codice}): nel tuo listino non trovo la percentuale da confrontare.</div>
              ) : (
                <div style={{ fontSize: 13.5, fontWeight: 600, color: C.verde }}>Carburante GLS {pct(c.percentuale!)} sul nolo (contratto {c.codice}), il tuo listino {pct(c.listino)}: torna.</div>
              )}
            </div>
          </div>
        ))}
        {gls && infoGls && infoGls.contratti.length > 0 && infoGls.contratti.every(c => c.quadra) && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: C.verde, background: C.verdeTenue, border: `1px solid ${C.verdeOrlo}`, borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
            <Icona nome="spunta" size={16} />
            Letto tutto: le {esiti.length.toLocaleString('it-IT')} righe tornano coi totali stampati da GLS{infoGls.totaleCliente != null ? `, ${euro(infoGls.totaleCliente)} con il carburante` : ''}{infoGls.tracciato === 'bordero' ? ' (è quanto GLS scala dal credito prepagato)' : ''}.
          </div>
        )}

        {/* ── I NUMERI ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 14 }}>
          {[
            { ic: 'fattura', t: gls && infoGls?.tracciato === 'bordero' ? 'Addebitato da GLS' : `Fatturato da ${cr}`, v: euro(totali.totaleCorriere), n: `${esiti.length.toLocaleString('it-IT')} righe ${gls && infoGls?.tracciato === 'bordero' ? 'nel borderò' : 'in fattura'}`, c: C.testo },
            { ic: 'euro', t: 'Costo registrato in Moove', v: euro(totali.costoMoove), n: `sulle ${trovate.length.toLocaleString('it-IT')} spedizioni trovate`, c: C.testo },
            { ic: 'sale', t: 'Differenza', v: conSegno(diff), n: !trovate.length ? 'nessuna spedizione di Moove da confrontare' : diff > 0.005 ? `${cr} ti costa più di quanto vedi` : diff < -0.005 ? 'vedi un costo più alto del vero' : 'torna al centesimo', c: coloreImporto(diff), evid: trovate.length > 0 },
            { ic: 'bilancia', t: 'Da girare ai clienti', v: String(daRettificare.length), n: `spedizioni col peso ${cr} più alto`, c: daRettificare.length ? C.arancioScuro : C.testo },
            // GLS: arrivi e resi al mittente hanno un numero loro, che in Moove non c'è: non sono "spedite fuori".
            gls
              ? { ic: 'pacco', t: 'Non trovate in Moove', v: String(totali.nonTrovate), n: totali.nonTrovate ? `${(totali.nonTrovate - arriviResiFuori).toLocaleString('it-IT')} spedizioni fuori dal portale${arriviResiFuori ? `, ${arriviResiFuori} arrivi e resi` : ''}` : 'tutte abbinate', c: totali.nonTrovate ? C.ambra : C.testo }
              : { ic: 'pacco', t: 'Non trovate in Moove', v: String(totali.nonTrovate), n: totali.nonTrovate ? `${euro(totali.totaleNonTrovate)} spedite fuori dal portale` : 'tutte abbinate', c: totali.nonTrovate ? C.ambra : C.testo },
          ].map(k => (
            <div key={k.t} style={{ ...carta, padding: 16, ...(k.evid ? { borderColor: diff > 0.005 ? C.rossoOrlo : C.verdeOrlo, background: diff > 0.005 ? C.rossoTenue : C.verdeTenue } : {}) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: C.attenuato }}><Icona nome={k.ic} size={15} /> {k.t}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: k.c, marginTop: 8, letterSpacing: '-.02em', ...cifre }}>{k.v}</div>
              <div style={{ fontSize: 12, color: C.attenuato, marginTop: 2 }}>{k.n}</div>
            </div>
          ))}
        </div>

        {/* ── IL CONTO DEL DOCUMENTO: uscito, entrato, guadagno, e cosa manca perché sia definitivo ── */}
        {conto && (
          <div style={{ ...carta, padding: '16px 18px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Il conto del documento</div>
                <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 2 }}>Quanto hai pagato a {cr}, quanto ti hanno pagato i tuoi clienti, quanto ti resta</div>
              </div>
              {conto.daFare.length === 0
                ? <Pillola colore={C.verde} fondo={C.verdeTenue} orlo={C.verdeOrlo}>Tutto fatto: il conto è definitivo</Pillola>
                : <Pillola colore={C.ambra} fondo={C.ambraTenue} orlo={C.ambraOrlo}>{conto.daFare.length} cos{conto.daFare.length === 1 ? 'a' : 'e'} da fare</Pillola>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 10, marginTop: 12 }}>
              {[
                { t: `Pagato a ${cr}`, v: euro(conto.speso), n: conto.note ? `${euro(conto.pagato)} meno ${euro(conto.note)} di note di credito` : 'quanto ha scalato per questo documento', c: C.testo },
                { t: 'Ti hanno pagato', v: euro(conto.incassato), n: [`spedizioni Moove ${euro(conto.moove)}`, conto.altro ? `altro gestionale ${euro(conto.altro)}` : '', conto.aMano ? `fatte pagare a mano ${euro(conto.aMano)}` : ''].filter(Boolean).join(' · '), c: C.testo },
                // Senza l'incasso delle spedizioni fuori Moove il risultato non è vero: si dice "per ora", in giallo.
                { t: conto.senzaExport ? 'Per ora (manca un incasso)' : conto.guadagno >= 0 ? 'Ti resta' : 'Ci perdi', v: conSegno(conto.guadagno), n: conto.senzaExport ? 'manca l\'incasso delle spedizioni fuori Moove: carica l\'export' : conto.daFare.length ? 'può cambiare: ci sono cose da fare' : 'definitivo', c: conto.senzaExport ? C.ambra : conto.guadagno >= 0 ? C.verde : C.rosso },
              ].map(k => (
                <div key={k.t} style={{ background: C.fondoTenue, borderRadius: 10, padding: '11px 13px', minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.attenuato }}>{k.t}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: k.c, marginTop: 4, ...cifre }}>{k.v}</div>
                  <div style={{ fontSize: 11.5, color: C.attenuato, marginTop: 2, lineHeight: 1.35 }}>{k.n}</div>
                </div>
              ))}
            </div>
            {conto.daFare.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Da fare</div>
                <div style={{ display: 'grid', gap: 4 }}>
                  {conto.daFare.map((d, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5, lineHeight: 1.4 }}>
                      <span style={{ color: C.ambra }}>•</span>
                      <span style={{ flex: 1, minWidth: 0 }}>{d.testo}</span>
                      {d.euro != null && <span style={{ color: C.attenuato, whiteSpace: 'nowrap', ...cifre }}>{euro(d.euro)}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── GLS: COSA FARE, VOCE PER VOCE. GLS sulla riga scrive solo l'importo: qui ogni voce ha il suo nome,
            quante sono, dove, e in quale dei quattro gesti cade. Un clic filtra la tabella sotto. ── */}
        {gls && cosaFare && cosaFare.size > 0 && (
          <div style={{ ...carta, padding: '16px 18px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Cosa fare, voce per voce</div>
                <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 2 }}>Sulle spedizioni trovate in Moove. Clicca una voce per vedere le sue spedizioni.</div>
              </div>
              {voceScelta && (
                <button onClick={() => setVoceScelta(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 8, border: `1px solid ${C.filo}`, background: '#fff', fontSize: 12.5, fontWeight: 600, color: C.testo, cursor: 'pointer' }}>
                  Togli il filtro «{cosaFare && Array.from(cosaFare.values()).flatMap(m => Array.from(m.entries())).find(([k]) => k === voceScelta)?.[1].nome}»
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12, marginTop: 14 }}>
              {GRUPPI_GLS.map(gr => {
                const voci = Array.from((cosaFare.get(gr.k) || new Map()).entries()).sort((a, b) => Math.abs(b[1].euro) - Math.abs(a[1].euro))
                const extra = gr.k === 'contestare' ? carburanteGls.filter(c => c.sopra) : []
                const arrivi = gr.k === 'contestare' ? arriviSopra : null
                const totale = r2(voci.reduce((t, [, v]) => t + v.euro, 0) + extra.reduce((t, c) => t + c.inPiu, 0) + (arrivi?.euro || 0))
                return (
                  <div key={gr.k} style={{ border: `1px solid ${gr.orlo}`, background: gr.fondo, borderRadius: 12, padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: gr.colore }}>
                      <Icona nome={gr.icona} size={17} />
                      <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>{gr.titolo}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, ...cifre }}>{voci.length || extra.length || arrivi ? conSegno(totale) : '—'}</span>
                    </div>
                    <div style={{ fontSize: 12, color: C.attenuato, marginTop: 3, lineHeight: 1.4 }}>{gr.sotto}</div>
                    <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                      {extra.map(c => (
                        <div key={'c' + c.codice} style={{ background: '#fff', borderRadius: 9, padding: '8px 10px', border: `1px solid ${C.filo}` }}>
                          <div style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                            <span style={{ flex: 1, fontWeight: 600 }}>Carburante al {pct(c.percentuale!)} (listino {pct(c.listino!)})</span>
                            <span style={{ fontWeight: 700, ...cifre }}>{euro(c.inPiu)}</span>
                          </div>
                          <div style={{ fontSize: 11.5, color: C.attenuato, marginTop: 2 }}>
                            Contratto {c.codice}, tutte le {c.righe.toLocaleString('it-IT')} spedizioni del documento{carburanteMoove.n ? `; di questi, ${euro(carburanteMoove.euro)} sulle ${carburanteMoove.n} spedizioni Moove` : ''}
                          </div>
                          {rigaStato('contestare', `carburante-doc:${c.codice}`, c.inPiu)}
                        </div>
                      ))}
                      {arrivi && (
                        <div style={{ background: '#fff', borderRadius: 9, padding: '8px 10px', border: `1px solid ${C.filo}` }}>
                          <div style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                            <span style={{ flex: 1, fontWeight: 600 }}>Arrivi e resi pagati più delle partenze</span>
                            <span style={{ color: C.attenuato, ...cifre }}>{arrivi.righe.length}</span>
                            <span style={{ fontWeight: 700, minWidth: 70, textAlign: 'right', ...cifre }}>{conSegno(arrivi.euro)}</span>
                          </div>
                          <div style={{ fontSize: 11.5, color: C.attenuato, marginTop: 2, lineHeight: 1.4 }}>
                            {cr} chiede {arrivi.noli.map(n => euro(n)).join(' / ')} di nolo, alle partenze dello stesso peso {arrivi.riferimenti.map(n => euro(n)).join(' / ')}: {arrivi.righe.map(x => `${x.e.riga.segnacollo} ${kg(x.e.riga.pesoTassato)}`).join(', ')}.
                            Se il contratto non prevede un prezzo diverso per gli arrivi, va contestato.
                          </div>
                          {rigaStato('contestare', 'arrivi-sopra', arrivi.euro)}
                        </div>
                      )}
                      {voci.map(([k, v]) => (
                        <div key={k} style={{ background: voceScelta === k ? '#fff' : 'rgba(255,255,255,.7)', borderRadius: 9, padding: '8px 10px',
                            border: `1px solid ${voceScelta === k ? gr.colore : C.filo}`, boxShadow: voceScelta === k ? '0 1px 3px rgba(16,24,40,.12)' : 'none' }}>
                        {/* La voce filtra le spedizioni; sotto, il suo stato (contestata, chiesta, fatta…). */}
                        <button onClick={() => { setVoceScelta(voceScelta === k ? null : k); setFiltro('tutte'); setPagina(1) }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: C.testo, font: 'inherit' }}>
                          <div style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                            <span style={{ flex: 1, fontWeight: 600 }}>{v.nome}</span>
                            <span style={{ color: C.attenuato, ...cifre }}>{v.n}</span>
                            <span style={{ fontWeight: 700, minWidth: 70, textAlign: 'right', ...cifre }}>{conSegno(v.euro)}</span>
                          </div>
                          {(v.nota || (gr.k === 'chiarire' && v.dove.size > 0)) && (
                            <div style={{ fontSize: 11.5, color: C.attenuato, marginTop: 2, lineHeight: 1.4 }}>
                              {v.nota}
                              {/* Un indizio per chiederla a GLS: dove sono, e se sono tutte in contrassegno. */}
                              {gr.k === 'chiarire' && v.cod === v.n && v.n > 1 ? <b style={{ fontWeight: 600, color: C.ambra }}> Tutte in contrassegno.</b> : null}
                              {gr.k === 'chiarire' && v.dove.size > 0 ? <span style={{ display: 'block', marginTop: 1 }}>{Array.from(v.dove).join(', ')}{v.n > v.dove.size ? '…' : ''}</span> : null}
                            </div>
                          )}
                        </button>
                        {rigaStato(gr.k, `${gr.k}|${k}`, v.euro, v.tipo === 'peso')}
                        </div>
                      ))}
                      {!voci.length && !extra.length && !arrivi && <div style={{ fontSize: 12.5, color: C.attenuato }}>Niente.</div>}
                      {gr.k === 'contestare' && (voci.length > 0 || extra.length > 0 || !!arrivi) && (
                        <button onClick={preparaContestazione}
                          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '8px 12px', borderRadius: 9, border: `1px solid ${gr.orlo}`, background: '#fff', color: gr.colore, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                          <Icona nome="scarica" size={15} /> Prepara la contestazione
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── PERCHÉ E COSA CORREGGERE ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', gap: 12, marginBottom: 14 }}>
          <div style={{ ...carta, padding: '16px 18px', minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Dove nasce la differenza</div>
            <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 2, marginBottom: 12 }}>Somma per motivo, sulle spedizioni trovate in Moove</div>
            {Object.entries(totali.perMotivo).sort((a, b) => b[1].euro - a[1].euro).map(([k, v]) => (
              <div key={k} style={{ padding: '9px 0', borderTop: `1px solid ${C.filo}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: C.attenuato, display: 'inline-flex' }}><Icona nome={MOTIVI[k]?.icona || 'avviso'} size={17} /></span>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{MOTIVI[k]?.nome || k}</span>
                  <span style={{ fontSize: 12, color: C.attenuato, ...cifre }}>{v.n} sped.</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: coloreImporto(v.euro), minWidth: 90, textAlign: 'right', ...cifre }}>{conSegno(r2(v.euro))}</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: C.fondoTenue, marginTop: 7, marginLeft: 27 }}>
                  <div style={{ height: 6, borderRadius: 3, width: `${Math.max(2, Math.abs(v.euro) / maxMotivo * 100)}%`, background: v.euro > 0.005 ? '#f97066' : '#47cd89' }} />
                </div>
                {k === 'voce' && Object.entries(totali.perVoce).sort((a, b) => b[1].euro - a[1].euro).map(([s, w]) => (
                  <div key={s} style={{ display: 'flex', fontSize: 12.5, color: C.attenuato, marginTop: 5, marginLeft: 27 }}>
                    <span style={{ flex: 1 }}>{gls ? s : <>{descriviVoce(s, legenda).nome} <span style={{ opacity: .7 }}>· sigla "{s}"</span></>}</span>
                    <span style={{ ...cifre }}>{w.n} · {euro(r2(w.euro))}</span>
                  </div>
                ))}
              </div>
            ))}
            {!Object.keys(totali.perMotivo).length && (trovate.length
              ? <div style={{ fontSize: 13, color: C.verde, display: 'flex', gap: 6, alignItems: 'center' }}><Icona nome="spunta" size={16} /> Nessuna differenza: la fattura torna con Moove.</div>
              : <div style={{ fontSize: 13, color: C.attenuato, display: 'flex', gap: 6, alignItems: 'center' }}><Icona nome="pacco" size={16} /> Nessuna spedizione di questa fattura è in Moove: le trovi qui sotto, fra quelle fatte con un altro gestionale.</div>)}
            {rientriMoove.length > 0 && (
              <div style={{ display: 'flex', gap: 8, fontSize: 12.5, color: C.attenuato, background: C.fondoTenue, borderRadius: 9, padding: '9px 11px', marginTop: 10 }}>
                <Icona nome="rientro" size={16} /> {rientriMoove.length} rientri di spedizioni Moove per {euro(r2(rientriMoove.reduce((s, e) => s + e.riga.totale, 0)))}: non si confrontano col nolo dell'andata, il reso si addebita col suo flusso.
              </div>
            )}
          </div>

          <div style={{ ...carta, padding: '16px 18px', minWidth: 0, overflowX: 'auto' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Cosa allineare nel listino</div>
            {allineareGls ? (<>
              <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 2, marginBottom: 10 }}>Il tuo listino di oggi contro quello che GLS ha chiesto, allo stesso peso: quale listino, quale voce, cosa c'è scritto e cosa scriverci</div>
              {allineareGls.length ? (
                <div>
                  {(tuttiAllinea ? allineareGls : allineareGls.slice(0, 8)).map(a => (
                    <div key={a.chiave} style={{ borderTop: `1px solid ${C.filo}`, padding: '9px 0', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13 }}><b>{a.listino || 'Listino'}</b> <span style={{ color: C.attenuato }}>· {a.zona || 'zona ?'}</span></div>
                        <div style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.4 }}>{descriviAllinea(a)}</div>
                        {a.luoghi.length > 0 && <div style={{ fontSize: 11.5, color: C.attenuato, marginTop: 2, overflowWrap: 'anywhere' }}>{a.n > a.luoghi.length ? 'Per esempio: ' : 'Dove: '}{a.luoghi.join(' · ')}</div>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: coloreImporto(a.euro), ...cifre }}>{conSegno(a.euro)}</div>
                        <div style={{ fontSize: 11.5, color: C.attenuato, ...cifre }}>{a.n} sped.</div>
                      </div>
                    </div>
                  ))}
                  {allineareGls.length > 8 && (
                    <button onClick={() => setTuttiAllinea(v => !v)} style={{ background: 'none', border: 'none', padding: '6px 0 0', color: C.testo, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
                      {tuttiAllinea ? 'Mostra meno' : `Mostra tutte (${allineareGls.length})`}
                    </button>
                  )}
                </div>
              ) : <div style={{ fontSize: 13, color: C.attenuato }}>Il tuo listino di oggi dice quello che chiede GLS.</div>}
              <div style={{ fontSize: 12, color: C.attenuato, marginTop: 10, lineHeight: 1.45 }}>
                In rosso il listino dice meno di GLS: Moove registra un costo più basso del vero e il margine che leggi è gonfiato. In verde dice di più: il costo in Moove è più alto del vero e il margine sembra più basso. Il confronto è col listino di oggi: se l'hai cambiato dopo queste spedizioni, ti dice se adesso è giusto.
              </div>
            </>) : (<>
            <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 2, marginBottom: 12 }}>A parità di peso: scarto medio fra il tuo listino e {cr}, per zona e fascia (almeno 3 spedizioni)</div>
            {allineare.length ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ color: C.attenuato, fontSize: 11.5, textAlign: 'left' }}>
                  <th style={{ fontWeight: 600, padding: '0 0 6px' }}>Zona e fascia</th><th style={{ fontWeight: 600, padding: '0 0 6px', textAlign: 'right' }}>Sped.</th>
                  <th style={{ fontWeight: 600, padding: '0 0 6px', textAlign: 'right' }}>Listino vs {cr}</th><th style={{ fontWeight: 600, padding: '0 0 6px', textAlign: 'right' }}>Totale</th>
                </tr></thead>
                <tbody>{allineare.slice(0, 8).map(a => (
                  <tr key={a.zona + a.fascia} style={{ borderTop: `1px solid ${C.filo}` }}>
                    <td style={{ padding: '9px 0' }}><b>{a.zona}</b> <span style={{ color: C.attenuato }}>{a.fascia}</span></td>
                    <td style={{ padding: '9px 0', textAlign: 'right', ...cifre }}>{a.n}</td>
                    <td style={{ padding: '9px 0', textAlign: 'right' }}>
                      {a.tariffa > 0
                        ? <Pillola colore={C.rosso} fondo={C.rossoTenue} orlo={C.rossoOrlo}>più basso di {euro(r2(a.tariffa / a.n))}</Pillola>
                        : <Pillola colore={C.verde} fondo={C.verdeTenue} orlo={C.verdeOrlo}>più alto di {euro(r2(-a.tariffa / a.n))}</Pillola>}
                    </td>
                    <td style={{ padding: '9px 0', textAlign: 'right', fontWeight: 700, color: coloreImporto(a.tariffa), ...cifre }}>{conSegno(r2(a.tariffa))}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <div style={{ fontSize: 13, color: C.attenuato }}>Nessuno scarto ricorrente fra listino e {cr}.</div>}
            <div style={{ fontSize: 12, color: C.attenuato, marginTop: 10, lineHeight: 1.45 }}>
              "Più basso" vuol dire che il listino ti fa vedere un costo minore di quello vero: il margine che leggi è gonfiato. "Più alto" il contrario.
            </div>
            </>)}
          </div>
        </div>

        {/* ── DA GIRARE AI CLIENTI: l'unico gesto che porta a muovere soldi, con scritto cosa fa ── */}
        {daRettificare.length > 0 && (
          <div style={{ ...carta, background: C.arancioTenue, borderColor: C.arancioOrlo, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
            <Tessera nome="bilancia" colore={C.arancioScuro} fondo="#fff" />
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                {daRettificare.length} spedizion{daRettificare.length === 1 ? 'e' : 'i'} da girare ai clienti
                <span style={{ color: C.arancioScuro, marginLeft: 8, ...cifre }}>{conSegno(r2(daRettificare.reduce((s, e) => s + (e.motivi.find(m => m.tipo === 'peso')?.importo || 0), 0)))}</span>
              </div>
              <div style={{ fontSize: 12.5, color: '#475467', marginTop: 3, lineHeight: 1.45 }}>
                {rettificheInviate && girateAperta
                  ? <>
                      <b>{girateAperta.inviate} rettifich{girateAperta.inviate === 1 ? 'a' : 'e'}</b> su {daRettificare.length} spedizion{daRettificare.length === 1 ? 'e' : 'i'}:{' '}
                      <b style={{ color: C.verde }}>{girateAperta.confermate} confermat{girateAperta.confermate === 1 ? 'a' : 'e'}</b>{girateAperta.confermate ? ` (${euro(girateAperta.euroConfermati)} girati)` : ''}
                      {girateAperta.inviate - girateAperta.confermate > 0 && <>, <b style={{ color: C.arancioScuro }}>{girateAperta.inviate - girateAperta.confermate} da confermare</b> ({euro(girateAperta.euroInAttesa)}) in Rettifica Costi</>}.
                      {/* Quali e perché, qui sotto; senza l'elenco delle spedizioni rettificate, solo quante. */}
                      {nonGirate.length > 0
                        ? (nonGirate.length === 1 ? ' 1 non è stata girata: qui sotto quale e perché.' : ` ${nonGirate.length} non sono state girate: qui sotto quali e perché.`)
                        : !girateAperta.spedizioni && girateAperta.inviate < daRettificare.length
                          ? ` ${daRettificare.length - girateAperta.inviate} non sono diventate rettifiche (già rettificate o scartate dalla Rettifica).` : ''}
                      {' '}Si aggiorna da solo quando torni su questa pagina.
                    </>
                  : rettificheInviate
                    ? 'Le hai già mandate alla Rettifica: le trovi in Rettifica Costi, da confermare. Rimandarle non le raddoppia, quelle già create vengono saltate.'
                    : `${cr} le ha tassate più del peso registrato in Moove. Diventano rettifiche da confermare in Rettifica Costi, ognuno paga col proprio listino: finché non le confermi non si muove nulla.`}
              </div>
              {nonGirate.length > 0 && (
                <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                  {nonGirate.map(e => {
                    const sp = e.spedizione!, p = perche[sp.id], imp = e.motivi.find(m => m.tipo === 'peso')?.importo || 0
                    return (
                      <div key={sp.id} style={{ fontSize: 12.5, lineHeight: 1.45, background: '#fff', border: `1px solid ${C.arancioOrlo}`, borderRadius: 9, padding: '8px 10px', minWidth: 0, overflowWrap: 'anywhere' }}>
                        <b>Non girata: {sp.numero}</b> <span style={{ color: C.attenuato }}>· {sp.chi} · Moove {kg(sp.peso)}, {cr} {kg(e.riga.pesoTassato)}</span>{' '}
                        · <b style={{ color: C.rosso, ...cifre }}>{conSegno(imp)}</b> <span style={{ color: C.attenuato }}>per ora a tuo carico</span>
                        <div style={{ color: '#475467', marginTop: 2 }}>{p ? p.motivo : 'Cerco perché la Rettifica non l\'ha creata…'}</div>
                        {/* Il listino da correggere si apre in un'altra scheda: tornando qui il perché si rifà da solo, e si rimanda. */}
                        {p?.listinoDaCorreggere && (
                          <a href={`/dashboard/listini/clienti/${p.listinoDaCorreggere.id}`} target="_blank" rel="noopener"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, padding: '5px 10px', borderRadius: 8, border: `1px solid ${C.arancioOrlo}`, background: C.arancioTenue, color: C.arancioScuro, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
                            Correggi il listino «{p.listinoDaCorreggere.nome}» di {p.listinoDaCorreggere.di} <Icona nome="freccia" size={13} />
                          </a>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            {rettificheInviate ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {nonGirate.length > 0 && (
                  <button onClick={() => mandaAllaRettifica(nonGirate)} disabled={inviando}
                    title="Dopo aver sistemato il listino: rimanda alla Rettifica solo quelle non girate"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, border: 'none', fontSize: 13.5, fontWeight: 700, background: C.arancio, color: '#fff', cursor: inviando ? 'default' : 'pointer' }}>
                    Rimanda {nonGirate.length === 1 ? 'la non girata' : `le ${nonGirate.length} non girate`}
                  </button>
                )}
                <button onClick={aggiornaStato} disabled={aggiornando}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, border: `1px solid ${C.arancioOrlo}`, fontSize: 13.5, fontWeight: 600, background: 'transparent', color: C.arancioScuro, cursor: aggiornando ? 'default' : 'pointer' }}>
                  {aggiornando ? 'Aggiorno…' : 'Aggiorna'}
                </button>
                {/* In un'altra scheda: qui il controllo resta aperto, e tornando si aggiorna da solo. */}
                <a href="/dashboard/spedizioni/rettifica" target="_blank" rel="noopener"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, border: `1px solid ${C.arancioOrlo}`, fontSize: 13.5, fontWeight: 700, background: '#fff', color: C.arancioScuro, textDecoration: 'none' }}>
                  Apri Rettifica Costi <Icona nome="freccia" size={16} />
                </a>
              </div>
            ) : (
              <button onClick={() => mandaAllaRettifica()} disabled={inviando}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, border: 'none', fontSize: 13.5, fontWeight: 700, background: C.arancio, color: '#fff', cursor: inviando ? 'default' : 'pointer', boxShadow: '0 1px 2px rgba(16,24,40,.1)' }}>
                Manda alla Rettifica <Icona nome="freccia" size={16} />
              </button>
            )}
          </div>
        )}

        {/* ── LE SPEDIZIONI FATTE ALTROVE: si abbinano all'export di quel gestionale ── */}
        {totali.nonTrovate > 0 && (
          <AltriGestionali righe={esiti.filter(e => !e.spedizione).map(e => e.riga)} righeFattura={esiti.map(e => e.riga)} salvati={esterniSalvati} onAbbinato={registraEsterno}
            azioniRiga={r => rigaStato('fuori', `fuori:${r.segnacollo}`, r.totale)} azioniFile={nome => rigaStato('esterno', `esterno:${nome}`, 0)} numeroFattura={esiti[0]?.riga.numeroFattura || ''} iniziali={iniziale?.esterni} onScaricato={registraFileEsterno} legenda={legenda} corriere={cr} />
        )}

        {/* ── LE SPEDIZIONI ── */}
        <div style={{ ...carta, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderBottom: `1px solid ${C.filo}` }}>
            <div style={{ display: 'inline-flex', background: C.fondoTenue, border: `1px solid ${C.filo}`, borderRadius: 10, padding: 3, flexWrap: 'wrap' }}>
              {([['perdita', 'Con perdita'], ['tutte', 'Tutte'], ['peso', 'Peso'], ['carburante', 'Carburante'], ['supplemento', 'Supplementi'], ['voce', 'Voci'], ['tariffa', 'Listino'], ['storico', 'Listino di allora'], ['annullata', 'Annullate'], ['non_trovata', 'Non trovate'], ['rientri', gls ? 'Arrivi e resi' : 'Rientri']] as [Filtro, string][])
                .filter(([k]) => k === 'perdita' || k === 'tutte' || conteggi[k] > 0)
                .map(([k, l]) => (
                  <button key={k} onClick={() => { setFiltro(k); setPagina(1) }}
                    style={{ padding: '6px 11px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      background: filtro === k ? '#fff' : 'transparent', color: filtro === k ? C.testo : C.attenuato, boxShadow: filtro === k ? '0 1px 3px rgba(16,24,40,.12)' : 'none' }}>
                    {l} <span style={{ fontSize: 11.5, color: filtro === k ? C.arancioScuro : C.attenuato, marginLeft: 3, ...cifre }}>{conteggi[k]}</span>
                  </button>
                ))}
            </div>
            <div style={{ flex: '1 1 240px', display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${C.filo}`, borderRadius: 10, padding: '0 10px', color: C.attenuato }}>
              <Icona nome="cerca" size={16} />
              <input value={cerca} onChange={e => { setCerca(e.target.value); setPagina(1) }} placeholder={gls ? 'Cerca spedizione, tracking, cliente, località' : 'Cerca spedizione, segnacollo, cliente, località'}
                style={{ flex: 1, border: 'none', outline: 'none', padding: '8px 0', fontSize: 13.5, color: C.testo, background: 'transparent' }} />
            </div>
            <button onClick={scaricaExcel} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 10, border: `1px solid ${C.filo}`, background: '#fff', fontSize: 13, fontWeight: 600, color: C.testo, cursor: 'pointer' }}>
              <Icona nome="scarica" size={16} /> Excel
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.fondoTenue, textAlign: 'left' }}>
                  {/* GLS: anche quanto ha pagato chi sta sotto e cosa resta dopo GLS (Lorenzo, 25/11: per ogni spedizione
                      "quanto ha pagato lui, il cliente e quanto gli ha fatto pagare GLS"). */}
                  {(gls
                    ? [['Spedizione', 'left'], ['Destinazione', 'left'], [`Peso Moove → ${cr}`, 'left'], [`${cr} ti chiede`, 'right'], ['Costo in Moove', 'right'], ['Differenza', 'right'], ['Il cliente ti ha pagato', 'right'], ['Ti resta', 'right'], ['Perché', 'left']]
                    : [['Spedizione', 'left'], ['Destinazione', 'left'], [`Peso Moove → ${cr}`, 'left'], [cr, 'right'], ['Moove', 'right'], ['Differenza', 'right'], ['Perché', 'left']]).map(([h, a]) => (
                    <th key={h} style={{ padding: '10px 14px', fontSize: 11.5, fontWeight: 600, color: C.attenuato, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', textAlign: a as any, borderBottom: `1px solid ${C.filo}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibili.map((e, i) => {
                  const cresce = !!e.spedizione && e.riga.pesoTassato > e.spedizione.peso + 0.005
                  return (
                    <tr key={e.riga.segnacollo + e.riga.rifNumerico + i} style={{ borderTop: i ? `1px solid ${C.filo}` : 'none', verticalAlign: 'top' }}>
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 700, color: e.spedizione ? C.arancioScuro : C.testo, fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', fontSize: 12.5 }}>{e.spedizione?.numero || e.riga.segnacollo || '—'}</div>
                        <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 3 }}>{e.spedizione?.chi || 'Non in Moove'}</div>
                        {e.contratto && <div style={{ fontSize: 11.5, color: C.attenuato, marginTop: 1 }}>{e.contratto}</div>}
                        <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                          {!e.riga.andata && <Pillola colore={C.attenuato} fondo={C.fondoTenue} orlo={C.filo}>{gls ? e.riga.tipoBolla : 'Rientro'}</Pillola>}
                          {e.spedizione?.stato === 'annullata' && <Pillola colore={C.rosso} fondo={C.rossoTenue} orlo={C.rossoOrlo}>Annullata</Pillola>}
                          {!e.spedizione && <Pillola colore={C.ambra} fondo={C.ambraTenue} orlo={C.ambraOrlo}>Non trovata</Pillola>}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {/* La località la scrive il corriere; se nel file manca si prende quella della spedizione. GLS non
                            stampa CAP e provincia. */}
                        <div style={{ fontWeight: 600 }}>{e.riga.localita || e.spedizione?.citta || '—'}</div>
                        <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 2 }}>{[e.riga.cap, e.riga.provincia, e.zona && e.zona !== 'Italia' ? e.zona : '', gls && e.riga.rifAlfabetico && e.riga.rifAlfabetico !== '0' ? `rif. ${e.riga.rifAlfabetico}` : ''].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', ...cifre }}>
                        <span style={{ color: C.attenuato }}>{e.spedizione ? kg(e.spedizione.peso) : '—'}</span>
                        <span style={{ margin: '0 6px', color: '#98a2b3' }}>→</span>
                        <b style={{ color: cresce ? C.rosso : C.testo }}>{kg(r2(e.riga.pesoTassato))}</b>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap', ...cifre }}>
                        <div style={{ fontWeight: 600 }}>{euro(e.brt)}</div>
                        <div style={{ fontSize: 11.5, color: C.attenuato, marginTop: 2 }}>nolo {euro(e.riga.nolo)}</div>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap', ...cifre }}>{e.moove != null ? euro(e.moove) : <span style={{ color: '#98a2b3' }}>—</span>}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {e.differenza != null
                          ? (() => {
                              // Col filtro, la differenza di quel motivo; quella intera resta scritta sotto.
                              const mm = motiviMostrati(e), parziale = mm.length !== e.motivi.length
                              const v = parziale ? r2(mm.reduce((t, m) => t + m.importo, 0)) : e.differenza
                              return <>
                                <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 8, fontWeight: 700, fontSize: 13, ...cifre, color: coloreImporto(v),
                                  background: v > 0.005 ? C.rossoTenue : v < -0.005 ? C.verdeTenue : C.fondoTenue }}>{conSegno(v)}</span>
                                {parziale && <div style={{ fontSize: 11.5, color: C.attenuato, marginTop: 3, ...cifre }}>in tutto {conSegno(e.differenza)}</div>}
                              </>
                            })()
                          : <span style={{ color: '#98a2b3' }}>—</span>}
                      </td>
                      {gls && (<>
                        <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap', ...cifre }}>
                          {e.incasso ? <><div style={{ fontWeight: 600 }}>{euro(e.incasso.importo)}</div>
                            {e.incasso.chi !== e.spedizione?.chi && <div style={{ fontSize: 11.5, color: C.attenuato, marginTop: 2 }}>{e.incasso.chi}</div>}</>
                            : <span style={{ color: '#98a2b3' }}>—</span>}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {e.incasso && e.riga.andata
                            ? (() => { const resta = r2(e.incasso.importo - e.brt); return <span style={{ fontWeight: 700, fontSize: 13, color: resta < -0.005 ? C.rosso : C.verde, ...cifre }}>{conSegno(resta)}</span> })()
                            : <span style={{ color: '#98a2b3' }}>—</span>}
                        </td>
                      </>)}
                      <td style={{ padding: '12px 14px', minWidth: 340, maxWidth: 520 }}>
                        {!e.spedizione ? <span style={{ color: C.attenuato, fontSize: 12.5 }}>{gls
                            ? `Nessuna spedizione dei tuoi contratti col tracking ${e.riga.segnacollo || '—'}${e.riga.rifAlfabetico && e.riga.rifAlfabetico !== '0' ? ` (riferimento ${e.riga.rifAlfabetico})` : ''}.`
                            : `Nessuna spedizione dei tuoi contratti con riferimento ${e.riga.rifNumerico || '—'} o segnacollo ${e.riga.segnacollo || '—'}.`}</span>
                          : !e.riga.andata ? <span style={{ color: C.attenuato, fontSize: 12.5 }}>{gls && e.riga.tipoBolla === 'Arrivo' ? 'Arrivo: pacco in entrata, non si confronta col nolo di un\'andata.' : 'Rientro: il reso si addebita col suo flusso.'}</span>
                          : e.motivi.length ? motiviMostrati(e).map((m, j) => (
                            <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: j ? 7 : 0 }}>
                              <span style={{ color: coloreImporto(m.importo), marginTop: 1 }}><Icona nome={MOTIVI[m.tipo]?.icona || 'avviso'} size={15} /></span>
                              <span style={{ fontSize: 12.5, lineHeight: 1.45, color: '#344054' }}>
                                <b style={{ color: coloreImporto(m.importo), ...cifre }}>{conSegno(m.importo)}</b> {m.testo}
                              </span>
                            </div>
                          ))
                          : <span style={{ color: C.verde, fontSize: 12.5, display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icona nome="spunta" size={15} /> {Math.abs(e.differenza ?? 0) >= 0.005 ? 'Torna, a meno di un centesimo di arrotondamento' : 'Torna al centesimo'}</span>}
                      </td>
                    </tr>
                  )
                })}
                {!visibili.length && (
                  <tr><td colSpan={gls ? 9 : 7} style={{ padding: '36px 16px', textAlign: 'center', color: C.attenuato }}>
                    {filtro === 'perdita' ? 'Nessuna spedizione in perdita: su questa fattura non hai speso più di quanto vedi in Moove.' : 'Nessuna riga con questo filtro.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {filtrate.length > 10 && (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px', borderTop: `1px solid ${C.filo}`, fontSize: 13, color: C.attenuato }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>{((pag - 1) * perPagina + 1).toLocaleString('it-IT')}–{Math.min(pag * perPagina, filtrate.length).toLocaleString('it-IT')} di {filtrate.length.toLocaleString('it-IT')}</span>
                {/* Righe per pagina (Lorenzo, 27/11): 10, 25, 50, 100. */}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  Righe per pagina
                  <span style={{ display: 'inline-flex', background: C.fondoTenue, border: `1px solid ${C.filo}`, borderRadius: 9, padding: 2 }}>
                    {[10, 25, 50, 100].map(n => (
                      <button key={n} onClick={() => { setPerPagina(n); setPagina(1) }}
                        style={{ padding: '4px 9px', borderRadius: 7, border: 'none', background: perPagina === n ? '#fff' : 'transparent', boxShadow: perPagina === n ? '0 1px 2px rgba(16,24,40,.1)' : 'none', fontSize: 12.5, fontWeight: perPagina === n ? 700 : 500, color: perPagina === n ? C.testo : C.attenuato, cursor: 'pointer', ...cifre }}>{n}</button>
                    ))}
                  </span>
                </span>
              </div>
              {pagine > 1 && <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pag <= 1} style={{ padding: '7px 12px', border: `1px solid ${C.filo}`, borderRadius: 9, background: '#fff', fontWeight: 600, color: pag <= 1 ? '#98a2b3' : C.testo, cursor: pag <= 1 ? 'default' : 'pointer' }}>Precedente</button>
                <button onClick={() => setPagina(p => Math.min(pagine, p + 1))} disabled={pag >= pagine} style={{ padding: '7px 12px', border: `1px solid ${C.filo}`, borderRadius: 9, background: '#fff', fontWeight: 600, color: pag >= pagine ? '#98a2b3' : C.testo, cursor: pag >= pagine ? 'default' : 'pointer' }}>Successiva</button>
              </div>}
            </div>
          )}
        </div>
      </>)}
    </div>
  )
}
