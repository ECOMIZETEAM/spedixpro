'use client'
import { useEffect, useRef, useState } from 'react'
import SelectCercabile from '@/app/components/SelectCercabile'
import SelettoreArticoli, { type RigaArticolo, type ArticoloCat } from '@/app/components/SelettoreArticoli'
import PuntoPosteSelettore, { type PuntoScelto } from '@/app/components/PuntoPosteSelettore'
import InpostLockerPicker, { type InpostPuntoScelto } from '@/app/components/InpostLockerPicker'
import { Icona } from '@/app/components/grafica/icone'
import { isExtraUe } from '@/lib/paesi-ue'
import { PAESI_MONDO } from '@/lib/paesi-elenco'
import { pesiDelModulo, pesiDivisiScritti } from '@/lib/colli-ordine'
import { isoGiorno, primoGiornoDiRitiro } from '@/lib/festivi'
import Calendario from './Calendario'
import Tendina from './Tendina'
import { type Tariffa, chiaveTariffa, codiceProv, iconaCorriere, opzioniIncasso, motivoSpento, euro, kg } from './corrieri'
import './nuova-spedizione.css'

// NUOVA SPEDIZIONE SU UNA PAGINA SOLA (20/11/2026). I soci hanno bocciato la versione a passi: la vogliono come il
// checkout di Shopify, tutto in una pagina. A sinistra le sezioni una sotto l'altra, a destra il riepilogo che resta
// fermo; i corrieri compaiono da soli, coi prezzi, appena i dati bastano. Un componente solo per il portale master e
// per quello cliente: i due moduli di oggi sono copie quasi uguali, e quasi ogni correzione andava fatta due volte.
// Vive solo nella grafica nuova; chi è sulla versione di oggi tiene il modulo di oggi.
//
// LA CREAZIONE NON PARTE DA QUI, PER ORA. Nella prova «Scopri la nuova versione» la pagina si guarda e basta (Lorenzo):
// il tasto porta al modulo di oggi coi dati già scritti. Creare da qui si accende dopo una prova a vuoto sulla rotta vera.

type Portale = 'cliente' | 'master'
type Indirizzo = { nome: string; indirizzo: string; citta: string; provincia: string; cap: string; email: string; telefono: string }
type Destinatario = Indirizzo & { paese: string; note: string; rifOrdine: string; rifDest: string }
interface Collo { lunghezza: string; larghezza: string; altezza: string; peso: string }

const MITT_VUOTO: Indirizzo = { nome: '', indirizzo: '', citta: '', provincia: '', cap: '', email: '', telefono: '' }
const DEST_VUOTO: Destinatario = { ...MITT_VUOTO, paese: 'IT', note: '', rifOrdine: '', rifDest: '' }
const COLLO_VUOTO: Collo = { lunghezza: '', larghezza: '', altezza: '', peso: '' }

// Deposito PuntoPoste preferito (FMP/APT), ricordato per comodità come nel modulo di oggi.
const depSalvato = (): 'FMP' | 'APT' | '' => { try { const v = localStorage.getItem('puntoposte:deposito'); return v === 'FMP' || v === 'APT' ? v : '' } catch { return '' } }
const num = (v: string | number | undefined | null) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
// Chi scrive i pesi in italiano mette la virgola: la si tiene come punto, così il numero è quello scritto.
const decimale = (v: string) => v.replace(',', '.').replace(/[^0-9.]/g, '')
const pieno = (s: string) => String(s || '').trim().length > 0

function mittDaCliente(c: any): Indirizzo {
  // email_mittente e non email: per il conto nato da Shopify l'email del conto è un indirizzo nostro che non riceve posta.
  return { nome: c?.ragione_sociale || '', indirizzo: c?.so_indirizzo || '', citta: c?.so_citta || '', provincia: c?.so_provincia || '', cap: c?.so_cap || '', email: (c?.email_mittente ?? c?.email) || '', telefono: c?.telefono || '' }
}

// I colli per il motore prezzi: ogni collo col suo peso (pesiDelModulo toglie solo l'eccedenza della virgola mobile)
// e le misure di ripiego dove mancano, come il modulo di oggi.
function pacchi(colli: Collo[]) {
  const pesi = pesiDelModulo(colli.map(c => c.peso))
  return colli.map((c, i) => ({ length: num(c.lunghezza) || 20, width: num(c.larghezza) || 15, height: num(c.altezza) || 10, weight: pesi[i] }))
}

export default function PaginaUnica({ portale, prova }: { portale: Portale; prova: boolean }) {
  const master = portale === 'master'

  // ── chi spedisce ──
  const [clienteData, setClienteData] = useState<any>(null)        // portale cliente: il cliente collegato
  const [clienti, setClienti] = useState<any[]>([])                 // portale master: clienti e sotto-master
  const [clienteId, setClienteId] = useState('')                    // master: '' | '__proprio__' | id | 'm:<id>'
  const [mittAzienda, setMittAzienda] = useState<Indirizzo | null>(null)
  const [isAgente, setIsAgente] = useState(false)
  const [mitt, setMitt] = useState<Indirizzo>(MITT_VUOTO)
  const [mittAperto, setMittAperto] = useState(false)
  const [richiediRitiro, setRichiediRitiro] = useState(false)
  const [ritiroData, setRitiroData] = useState(() => isoGiorno(primoGiornoDiRitiro(new Date())))
  const [ritiroOrario, setRitiroOrario] = useState<'mattina' | 'pomeriggio'>('mattina')

  // ── a chi ──
  const [consegnaA, setConsegnaA] = useState<'domicilio' | 'punto'>('domicilio')
  const [dest, setDest] = useState<Destinatario>(DEST_VUOTO)
  const [rifAperti, setRifAperti] = useState(false)
  const [codAlert, setCodAlert] = useState<{ totCod: number; giacenza: number; rifiutati: number } | null>(null)

  // ── cosa ──
  const [colli, setColli] = useState<Collo[]>([COLLO_VUOTO])
  const [pacchiSalvati, setPacchiSalvati] = useState<any[]>([])
  const [catalogo, setCatalogo] = useState<ArticoloCat[]>([])
  const [articoliScelti, setArticoliScelti] = useState<RigaArticolo[]>([])
  const [mostraCatalogo, setMostraCatalogo] = useState(false)
  const [sku, setSku] = useState('')
  const [skuQta, setSkuQta] = useState('1')
  const [skuMsg, setSkuMsg] = useState('')
  const [contenuto, setContenuto] = useState('')
  const [tipoContenuto, setTipoContenuto] = useState('Merce destinata alla vendita')
  const [valoreMerce, setValoreMerce] = useState('')
  const [hscode, setHscode] = useState('')

  // ── servizi ──
  const [codAttivo, setCodAttivo] = useState(false)
  const [codImporto, setCodImporto] = useState('')
  const [incassoModalita, setIncassoModalita] = useState('C')
  const [assAttiva, setAssAttiva] = useState(false)
  const [assValore, setAssValore] = useState('')

  // ── corriere ──
  const [risposta, setRisposta] = useState<{ corpo: string; tariffe: Tariffa[]; errore: string } | null>(null)
  const [riprova, setRiprova] = useState(0)
  const [secondi, setSecondi] = useState(0)
  const [selKey, setSelKey] = useState('')
  const [prezzoCambiato, setPrezzoCambiato] = useState<{ da: number; a: number } | null>(null)
  const prezzoVisto = useRef<{ key: string; tot: number } | null>(null)
  const [extraNomi, setExtraNomi] = useState<string[]>([])
  const [depositoTipo, setDepositoTipo] = useState<'FMP' | 'APT' | ''>('')
  const [puntoArrivo, setPuntoArrivo] = useState<PuntoScelto | null>(null)
  const [inpostPunto, setInpostPunto] = useState<InpostPuntoScelto | null>(null)
  const [corrierePref, setCorrierePref] = useState('')
  const [daOrdine, setDaOrdine] = useState('')

  // ── errori e telefono ──
  const [toccati, setToccati] = useState<Record<string, boolean>>({})
  const [tentato, setTentato] = useState(false)
  const [riepAperto, setRiepAperto] = useState(false)

  // ── suggerimenti (rubriche e comuni) ──
  const [sugg, setSugg] = useState<{ dove: '' | 'mitt' | 'mittCitta' | 'dest' | 'destCitta'; voci: any[] }>({ dove: '', voci: [] })
  const refMitt = useRef<HTMLInputElement>(null)
  const refMittCitta = useRef<HTMLInputElement>(null)
  const refDest = useRef<HTMLInputElement>(null)
  const refDestCitta = useRef<HTMLInputElement>(null)
  async function cerca(dove: typeof sugg.dove, url: string, testo: string) {
    if (testo.trim().length < 2) { setSugg({ dove: '', voci: [] }); return }
    try { const j = await (await fetch(url)).json(); setSugg({ dove, voci: Array.isArray(j) ? j : [] }) } catch { setSugg({ dove: '', voci: [] }) }
  }
  const chiudiSugg = () => setTimeout(() => setSugg({ dove: '', voci: [] }), 200)

  // ── anagrafiche ──
  useEffect(() => {
    if (master) {
      fetch('/api/clienti/lista?conMaster=1').then(r => r.json()).then(d => setClienti(Array.isArray(d) ? d : [])).catch(() => {})
      fetch('/api/permessi').then(r => r.json()).then(d => setIsAgente((d?.ruolo || '') === 'agente')).catch(() => {})
      // Mittente predefinito: l'indirizzo operativo dell'azienda, altrimenti la sede legale.
      fetch('/api/master').then(r => r.json()).then(d => {
        if (!d || d.error) return
        const m = { nome: d.ragione_sociale || '', indirizzo: d.indirizzo_operativo || d.indirizzo || '', citta: d.citta_operativo || d.citta || '', provincia: d.provincia_operativo || d.provincia || '', cap: d.cap_operativo || d.cap || '', email: d.email_sede || d.email_supporto || '', telefono: d.telefono_operativo || d.telefono || '' }
        setMittAzienda(m)
      }).catch(() => {})
    } else {
      fetch('/api/cliente/dati').then(r => r.json()).then(c => { if (!c || c.error) return; setClienteData(c); setMitt(mittDaCliente(c)) }).catch(() => {})
      fetch('/api/cliente/pacchi').then(r => r.json()).then(d => setPacchiSalvati(Array.isArray(d) ? d : [])).catch(() => {})
      fetch('/api/cliente/articoli').then(r => r.json()).then(d => setCatalogo(Array.isArray(d) ? d : [])).catch(() => {})
    }
  }, [master])

  // Master: pacchi salvati e catalogo sono del CLIENTE della spedizione (la spedizione propria e i sotto-master non ne hanno).
  const clienteVero = master && !!clienteId && clienteId !== '__proprio__' && !clienteId.startsWith('m:')
  useEffect(() => {
    if (!master) return
    setArticoliScelti([])
    if (!clienteVero) { setPacchiSalvati([]); setCatalogo([]); return }
    fetch('/api/clienti/' + clienteId + '/pacchi').then(r => r.json()).then(d => setPacchiSalvati(Array.isArray(d) ? d : [])).catch(() => setPacchiSalvati([]))
    fetch(`/api/catalogo?cliente_id=${clienteId}`).then(r => r.json()).then(d => setCatalogo(Array.isArray(d?.articoli) ? d.articoli : [])).catch(() => setCatalogo([]))
  }, [master, clienteId, clienteVero])

  function selezionaCliente(id: string) {
    if (id === '__proprio__') { setClienteId(id); setMitt(mittAzienda || MITT_VUOTO); return }
    const c = clienti.find(x => x.id === id)
    if (!c) { setClienteId(''); setMitt(MITT_VUOTO); return }
    setClienteId(id)
    setMitt({ nome: c.ragione_sociale, indirizzo: c.so_indirizzo || '', citta: c.so_citta || '', provincia: c.so_provincia || '', cap: c.so_cap || '', email: c.email || '', telefono: c.telefono || '' })
  }

  // Aperta dalla matita di un ordine (Importa, Ordini dei negozi): gli stessi parametri del modulo di oggi.
  useEffect(() => {
    if (master) return
    const q = new URLSearchParams(window.location.search)
    if (!q.get('da_ordine') && !q.get('nome')) return
    setDaOrdine(q.get('da_ordine') || '')
    setCorrierePref(q.get('corriere') || '')
    setDest(d => ({ ...d, nome: q.get('nome') || d.nome, indirizzo: q.get('indirizzo') || d.indirizzo, citta: q.get('citta') || d.citta, provincia: q.get('provincia') || d.provincia, cap: q.get('cap') || d.cap, paese: q.get('paese') || d.paese, email: q.get('email') || d.email, telefono: q.get('telefono') || d.telefono, note: q.get('note') || d.note, rifOrdine: q.get('rif') || d.rifOrdine }))
    const n = Math.max(1, parseInt(q.get('colli') || '1') || 1)
    const pesi = q.get('peso') ? pesiDivisiScritti(Number(q.get('peso')), n) : Array.from({ length: n }, () => '')
    let nuovi: Collo[] = pesi.map((peso, i) => i === 0 ? { lunghezza: q.get('l') || '', larghezza: q.get('w') || '', altezza: q.get('h') || '', peso } : { ...COLLO_VUOTO, peso })
    // «Un collo per ogni pezzo» (lib/colli-negozio): ogni collo arriva con le sue misure e il suo peso.
    try {
      const dett = JSON.parse(q.get('colli_dett') || 'null')
      const testo = (x: unknown) => (Number(x) > 0 ? String(x) : '')
      if (Array.isArray(dett) && dett.length > 1) nuovi = dett.map((c: any) => ({ lunghezza: testo(c?.l), larghezza: testo(c?.w), altezza: testo(c?.h), peso: testo(c?.p) }))
    } catch { /* parametro rotto: restano i colli divisi */ }
    setColli(nuovi)
    if (q.get('contenuto')) setContenuto(q.get('contenuto') as string)
    if (q.get('valore')) setValoreMerce(q.get('valore') as string)
    if (num(q.get('contrassegno')) > 0) { setCodAttivo(true); setCodImporto(q.get('contrassegno') as string) }
  }, [master])

  // Codice doganale dalla merce del catalogo, senza sovrascrivere quello scritto a mano.
  useEffect(() => {
    const art = articoliScelti.map(r => catalogo.find(a => a.id === r.id)).find(a => a && (a as any).codice_hs)
    const code = art ? String((art as any).codice_hs).replace(/[^0-9]/g, '') : ''
    if (code) setHscode(prev => prev || code)
  }, [articoliScelti, catalogo])

  // Avviso (non blocca): il destinatario ha rifiutato contrassegni nella rete, cercato per telefono.
  useEffect(() => {
    if ((dest.telefono || '').replace(/[^0-9]/g, '').length < 9) { setCodAlert(null); return }
    const t = setTimeout(async () => {
      try { const j = await (await fetch('/api/spedizioni/check-destinatario?telefono=' + encodeURIComponent(dest.telefono))).json(); setCodAlert(j && j.mostra ? j : null) } catch { setCodAlert(null) }
    }, 500)
    return () => clearTimeout(t)
  }, [dest.telefono])

  // ── i colli ──
  function cambiaCollo(i: number, campo: keyof Collo, val: string) { setColli(prev => prev.map((c, j) => j === i ? { ...c, [campo]: campo === 'peso' ? decimale(val) : val.replace(/[^0-9]/g, '') } : c)) }
  function applicaPacco(p: any) { setColli([{ lunghezza: String(p.lunghezza || ''), larghezza: String(p.larghezza || ''), altezza: String(p.altezza || ''), peso: String(p.peso || '') }]) }
  async function cercaSku() {
    const codice = sku.trim()
    if (!codice || !clienteVero) return
    setSkuMsg('cerco…')
    try {
      const d = await (await fetch(`/api/catalogo?cliente_id=${clienteId}&cerca=${encodeURIComponent(codice)}`)).json()
      const eq = (a: any, b: string) => String(a || '').trim().toUpperCase() === b.toUpperCase()
      const a = (d?.articoli || []).find((x: any) => eq(x.sku, codice) || eq(x.ean13, codice))
      if (!a) { setSkuMsg('non è in catalogo'); return }
      const q = Math.max(1, parseInt(String(skuQta)) || 1)
      const pesoArt = a.peso ? String(+(Number(a.peso) * q).toFixed(3)) : ''
      if (a.lunghezza && a.larghezza && a.altezza) setColli(prev => [{ lunghezza: String(a.lunghezza), larghezza: String(a.larghezza), altezza: String(a.altezza), peso: pesoArt || prev[0]?.peso || '' }])
      else if (pesoArt) setColli(prev => prev.map((c, i) => i === 0 ? { ...c, peso: pesoArt } : c))
      if (!contenuto && a.nome) setContenuto(String(a.nome).slice(0, 60))
      setSkuMsg(`${a.nome || a.sku}${!a.peso ? ' (peso non in catalogo)' : (!a.lunghezza ? ' (misure non in catalogo)' : '')}`)
    } catch { setSkuMsg('non riesco a leggere il catalogo') }
  }

  // ── cosa manca ──
  const estero = dest.paese !== 'IT'
  const errori: Record<string, string> = {}
  const mancanoBrevi: string[] = []
  const manca = (k: string, testo: string, breve: string) => { errori[k] = testo; if (!mancanoBrevi.includes(breve)) mancanoBrevi.push(breve) }
  if (master && !clienteId) manca('cliente', 'Scegli per chi spedisci', 'per chi spedisci')
  if (!pieno(mitt.nome)) manca('mittNome', 'Manca il nome del mittente', "l'indirizzo del mittente")
  if (!pieno(mitt.indirizzo)) manca('mittIndirizzo', "Manca l'indirizzo", "l'indirizzo del mittente")
  if (!pieno(mitt.citta)) manca('mittCitta', 'Manca la città', "l'indirizzo del mittente")
  if (!pieno(mitt.cap)) manca('mittCap', 'Manca il CAP', "l'indirizzo del mittente")
  if (!pieno(mitt.provincia)) manca('mittProvincia', 'Manca la provincia', "l'indirizzo del mittente")
  if (!pieno(dest.nome)) manca('destNome', 'Manca il nome del destinatario', 'il nome del destinatario')
  if (consegnaA === 'domicilio') {
    if (!pieno(dest.indirizzo)) manca('destIndirizzo', "Manca l'indirizzo", "l'indirizzo del destinatario")
    if (!pieno(dest.citta)) manca('destCitta', 'Manca la città', 'la città del destinatario')
    if (!estero && !pieno(dest.provincia)) manca('destProvincia', 'Manca la provincia', 'la provincia del destinatario')
  }
  if (!pieno(dest.cap)) manca('destCap', 'Manca il CAP', 'il CAP del destinatario')
  if (!pieno(dest.telefono)) manca('destTelefono', 'Manca il telefono', 'il telefono del destinatario')
  colli.forEach((c, i) => { if (!(num(c.peso) > 0)) manca('peso' + i, 'Manca il peso', colli.length > 1 ? `il peso del collo ${i + 1}` : 'il peso del collo') })
  const pronto = Object.keys(errori).length === 0
  // Il rosso solo dopo aver lasciato il campo, o dopo aver premuto «Crea»: all'apertura la pagina non è un elenco di errori.
  const errore = (k: string) => (tentato || toccati[k]) ? (errori[k] || '') : ''
  const tocca = (k: string) => () => setToccati(t => t[k] ? t : { ...t, [k]: true })
  const mittCompleto = !Object.keys(errori).some(k => k.startsWith('mitt'))

  // ── i prezzi: da soli, quando si smette di scrivere ──
  const idCliente = master ? clienteId : (clienteData?.id || '')
  // Le note non entrano: il preventivo non le legge, e ricalcolare (per un master con molti contratti anche un minuto)
  // perché si scrive una nota sarebbe solo attesa.
  const corpo = pronto && idCliente ? JSON.stringify({
    clienteId: idCliente,
    packages: pacchi(colli),
    shipFrom: { name: mitt.nome, company: mitt.nome, street1: mitt.indirizzo, street2: '', city: mitt.citta, state: mitt.provincia, postalCode: mitt.cap, country: 'IT', phone: mitt.telefono, email: mitt.email },
    shipTo: { name: dest.nome, company: '', street1: dest.indirizzo, street2: '', city: dest.citta, state: dest.provincia, postalCode: dest.cap, country: dest.paese, phone: dest.telefono, email: dest.email },
    insuranceValue: assAttiva ? num(assValore) : 0, codValue: codAttivo ? num(codImporto) : 0,
    // Qui il punto (PuntoPoste, locker) si sceglie: si vedono anche i contratti a un punto. Le porte automatiche no.
    includiPunto: true,
  }) : ''
  const reqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    if (!corpo) { abortRef.current?.abort(); reqRef.current++; return }
    if (risposta?.corpo === corpo && !risposta.errore) return
    const t = setTimeout(async () => {
      // Una risposta partita prima non deve mai coprire quella dei dati di adesso: la si ferma, e il numero della
      // richiesta scarta comunque quella che arriva tardi.
      abortRef.current?.abort()
      const ac = new AbortController(); abortRef.current = ac
      const id = ++reqRef.current
      let tariffe: Tariffa[] = [], err = ''
      try {
        const res = await fetch('/api/spedizioni/tariffe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo, signal: ac.signal })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data || data.error) err = data?.error || 'I prezzi non sono arrivati: riprova.'
        else if (!Array.isArray(data) || !data.length) err = 'Nessun corriere disponibile per questi dati.'
        else tariffe = data
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        err = 'I prezzi non sono arrivati: controlla la connessione e riprova.'
      }
      if (id !== reqRef.current) return
      setRisposta({ corpo, tariffe, errore: err })
    }, 700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corpo, riprova])

  const aggiornati = !!corpo && risposta?.corpo === corpo
  const inCalcolo = !!corpo && !aggiornati
  // Il tempo che passa mentre si aspetta: per un master con tanti contratti il preventivo dura anche un minuto.
  useEffect(() => {
    if (!inCalcolo) { setSecondi(0); return }
    const dal = Date.now()
    const t = setInterval(() => setSecondi(Math.floor((Date.now() - dal) / 1000)), 1000)
    return () => clearInterval(t)
  }, [inCalcolo, corpo])

  const tariffe = risposta?.tariffe || []
  const visibili = tariffe.filter(t => consegnaA === 'punto' ? (!!t._consegna_punto || !!t._inpost_locker) : (!t._consegna_punto && !t._inpost_locker))
  const spento = (t: Tariffa) => motivoSpento(t, colli.length, codAttivo)
  const selezionabili = visibili.filter(t => !spento(t))
  const minimo = selezionabili.reduce((m, t) => Math.min(m, num(t.total_price)), Infinity)
  const selMostrata = visibili.find(t => chiaveTariffa(t) === selKey) || null
  // Il corriere con cui si crea: SOLO da un preventivo dei dati di adesso. Mentre si ricalcola non c'è, e il tasto è
  // spento: la creazione addebita il maggiore fra il prezzo che ricalcola il server e quello mandato da qui, quindi un
  // preventivo vecchio più alto verrebbe pagato.
  const selected = aggiornati && selMostrata && !spento(selMostrata) ? selMostrata : null

  // Dopo ogni preventivo: il corriere scelto resta, col prezzo nuovo (e lo si dice se è cambiato); se non c'è più si
  // propone il primo, come il modulo di oggi, o quello dell'ordine.
  useEffect(() => {
    if (!aggiornati) return
    const cur = selezionabili.find(t => chiaveTariffa(t) === selKey)
    if (cur) {
      const tot = num(cur.total_price)
      if (prezzoVisto.current?.key === selKey && Math.abs(prezzoVisto.current.tot - tot) >= 0.005) setPrezzoCambiato({ da: prezzoVisto.current.tot, a: tot })
      prezzoVisto.current = { key: selKey, tot }
      return
    }
    const pref = corrierePref ? selezionabili.find(t => t._corriere_id === corrierePref || t.corriere_id === corrierePref) : null
    const primo = pref || selezionabili[0]
    setPrezzoCambiato(null)
    if (primo) { setSelKey(chiaveTariffa(primo)); prezzoVisto.current = { key: chiaveTariffa(primo), tot: num(primo.total_price) } }
    else setSelKey('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [risposta, consegnaA, aggiornati, colli.length, codAttivo])

  function scegli(t: Tariffa) {
    if (spento(t)) return
    const k = chiaveTariffa(t)
    setSelKey(k); setPrezzoCambiato(null)
    prezzoVisto.current = { key: k, tot: num(t.total_price) }
  }

  // Cambiando contratto: servizi, modalità d'incasso e punto si riscelgono (valgono per quel contratto).
  const corriereScelto = selKey.split('|')[0]
  useEffect(() => { setExtraNomi([]); setIncassoModalita('C'); setDepositoTipo(depSalvato()); setPuntoArrivo(null) }, [corriereScelto])

  const accDisponibili = selMostrata?.accessori_disponibili || []
  // Prezzo fisso + % del PREZZO SPEDIZIONE (nolo + fuel + sponda), come dice il listino; non del valore della merce.
  const extraScelti = accDisponibili.filter(a => extraNomi.includes(a.nome))
    .map(a => ({ nome: a.nome, importo: Math.round((num(a.prezzo) + (num(a.perc) / 100) * num(selMostrata?.prezzo_spedizione)) * 100) / 100 }))
  const extraTot = extraScelti.reduce((s, e) => s + e.importo, 0)
  const totale = selMostrata ? num(selMostrata.total_price) + extraTot : 0
  const opzCod = opzioniIncasso(selMostrata)
  const credito = clienteData && clienteData.credito != null ? num(clienteData.credito) : null

  // ── il tasto ──
  // Per ora porta al modulo di oggi coi dati già scritti, con gli stessi parametri della matita di Importa. Il modulo di
  // oggi del master non legge parametri: lì i dati vanno riscritti.
  function urlModuloDiOggi(): string {
    const p = new URLSearchParams({ versione: 'oggi' })
    if (!master) {
      const vals: Record<string, string> = { nome: dest.nome, indirizzo: dest.indirizzo, citta: dest.citta, provincia: dest.provincia, cap: dest.cap, paese: dest.paese, email: dest.email, telefono: dest.telefono, note: dest.note, contenuto, rif: dest.rifOrdine, valore: valoreMerce, da_ordine: daOrdine }
      for (const [k, v] of Object.entries(vals)) if (pieno(v)) p.set(k, v)
      p.set('colli', String(colli.length))
      p.set('peso', String(Math.round(colli.reduce((s, c) => s + num(c.peso), 0) * 1000) / 1000))
      if (colli.length === 1) { const c = colli[0]; if (c.lunghezza) p.set('l', c.lunghezza); if (c.larghezza) p.set('w', c.larghezza); if (c.altezza) p.set('h', c.altezza) }
      else p.set('colli_dett', JSON.stringify(colli.map(c => ({ l: num(c.lunghezza), w: num(c.larghezza), h: num(c.altezza), p: num(c.peso) }))))
      if (codAttivo && num(codImporto) > 0) p.set('contrassegno', String(num(codImporto)))
      if (selected?._corriere_id) p.set('corriere', selected._corriere_id)
    }
    return (master ? '/dashboard' : '/cliente') + '/spedizioni/nuova?' + p.toString()
  }
  function crea() {
    setTentato(true)
    if (!pronto) {
      const primo = Object.keys(errori)[0] || ''
      const sezione = primo === 'cliente' || primo.startsWith('mitt') ? 'ns-mittente' : primo.startsWith('dest') ? 'ns-destinatario' : 'ns-colli'
      document.getElementById(sezione)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    if (!selected) { document.getElementById('ns-corriere')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
    window.location.href = urlModuloDiOggi()
  }

  // ── pezzi ripetuti ──
  const campo = (k: string, etichetta: string, valore: string, onChange: (v: string) => void, extra?: { ref?: React.RefObject<HTMLInputElement | null>; onInput?: (v: string) => void; placeholder?: string; inputMode?: 'decimal' | 'numeric' | 'tel' | 'email'; className?: string; onFocus?: () => void }) => {
    const e = errore(k)
    return (
      <label className={'ns-campo' + (e ? ' ns-campo--errore' : '') + (extra?.className ? ' ' + extra.className : '')}>
        <span className="ns-campo__et">{etichetta}</span>
        <input ref={extra?.ref as any} className="ns-campo__val" value={valore} placeholder={extra?.placeholder} inputMode={extra?.inputMode} autoComplete="off"
          onChange={ev => { onChange(ev.target.value); extra?.onInput?.(ev.target.value) }} onBlur={() => { tocca(k)(); chiudiSugg() }} onFocus={extra?.onFocus}
          aria-invalid={!!e} />
        {e && <span className="ns-campo__err" role="alert">{e}</span>}
      </label>
    )
  }
  const voceSugg = (titolo: string, sotto: string, onScegli: () => void, i: number) => (
    <div key={i} role="option" aria-selected="false" className="ns-tendina__voce" onMouseDown={onScegli}>
      <b>{titolo}</b>{sotto && <span>{sotto}</span>}
    </div>
  )
  const indirizzoBreve = (x: any) => [x.indirizzo, x.citta, x.provincia && `(${x.provincia})`, x.cap].filter(Boolean).join(' ')

  return (
    <div className="ns">
      <button type="button" className="ns-barra-riep" onClick={() => setRiepAperto(v => !v)} aria-expanded={riepAperto}>
        <span><Icona id="i-pacco" />{riepAperto ? 'Nascondi riepilogo' : 'Mostra riepilogo'}</span>
        <b>{selected ? euro(totale) : '—'}</b>
      </button>

      <div className="ns-griglia">
        <div className="ns-colonna">
          <header className="ns-testa">
            <h1 className="ns-titolo">Nuova spedizione</h1>
            <p className="ns-sottotitolo">Tutto in una pagina: compili, i corrieri compaiono con il prezzo, scegli e crei.</p>
          </header>

          {/* ── MITTENTE ── */}
          <section id="ns-mittente" className="ns-sezione" aria-labelledby="ns-h-mitt">
            <div className="ns-sezione__testa">
              <h2 id="ns-h-mitt"><Icona id="i-magazzino" />Mittente</h2>
              {mittCompleto && <button type="button" className="ns-link" onClick={() => setMittAperto(v => !v)}>{mittAperto ? 'Chiudi' : 'Modifica'}</button>}
            </div>
            {master && (
              <div className={'ns-campo ns-campo--select' + (errore('cliente') ? ' ns-campo--errore' : '')} onBlur={tocca('cliente')}>
                <span className="ns-campo__et">Spedisci per</span>
                <SelectCercabile value={clienteId} onChange={(e: any) => selezionaCliente(e.target.value)} className="ns-campo__val">
                  <option value="">— scegli —</option>
                  {!isAgente && <option value="__proprio__">Spedizione propria (nessun cliente)</option>}
                  {clienti.map((c: any) => <option key={c.id} value={c.id}>{c.ragione_sociale}{c.is_master ? ' — sotto-master' : ''}</option>)}
                </SelectCercabile>
                {errore('cliente') && <span className="ns-campo__err" role="alert">{errore('cliente')}</span>}
              </div>
            )}
            {(!master || clienteId) && (mittCompleto && !mittAperto ? (
              <div className="ns-scheda">
                <b>{mitt.nome}</b>
                <span>{mitt.indirizzo}, {mitt.cap} {mitt.citta} ({mitt.provincia})</span>
                {(mitt.telefono || mitt.email) && <span>{[mitt.telefono, mitt.email].filter(Boolean).join(' · ')}</span>}
              </div>
            ) : (
              <div className="ns-campi">
                {campo('mittNome', 'Nome o ragione sociale', mitt.nome, v => setMitt(m => ({ ...m, nome: v })), { ref: refMitt, onInput: v => cerca('mitt', '/api/mittenti/cerca?q=' + encodeURIComponent(v), v) })}
                <Tendina ancora={refMitt} aperta={sugg.dove === 'mitt' && sugg.voci.length > 0}>
                  {sugg.voci.map((c: any, i: number) => voceSugg(c.nome, indirizzoBreve(c), () => { setMitt(m => ({ ...m, nome: c.nome, indirizzo: c.indirizzo || m.indirizzo, citta: c.citta || m.citta, provincia: c.provincia || m.provincia, cap: c.cap || m.cap, email: c.email || m.email, telefono: c.telefono || m.telefono })); setSugg({ dove: '', voci: [] }) }, i))}
                </Tendina>
                {campo('mittIndirizzo', 'Indirizzo', mitt.indirizzo, v => setMitt(m => ({ ...m, indirizzo: v })))}
                <div className="ns-riga3">
                  {campo('mittCap', 'CAP', mitt.cap, v => setMitt(m => ({ ...m, cap: v })), { inputMode: 'numeric' })}
                  {campo('mittCitta', 'Città', mitt.citta, v => setMitt(m => ({ ...m, citta: v })), { ref: refMittCitta, onInput: v => cerca('mittCitta', '/api/comuni?q=' + encodeURIComponent(v), v) })}
                  {campo('mittProvincia', 'Provincia', mitt.provincia, v => setMitt(m => ({ ...m, provincia: v.toUpperCase() })))}
                </div>
                <Tendina ancora={refMittCitta} aperta={sugg.dove === 'mittCitta' && sugg.voci.length > 0} maxAltezza={220}>
                  {sugg.voci.map((c: any, i: number) => voceSugg(c.nome, `(${c.sigla}) ${c.cap}`, () => { setMitt(m => ({ ...m, citta: c.nome, provincia: c.sigla, cap: c.cap })); setSugg({ dove: '', voci: [] }) }, i))}
                </Tendina>
                <div className="ns-riga2">
                  {campo('mittTelefono', 'Telefono', mitt.telefono, v => setMitt(m => ({ ...m, telefono: v })), { inputMode: 'tel' })}
                  {campo('mittEmail', 'Email', mitt.email, v => setMitt(m => ({ ...m, email: v })), { inputMode: 'email' })}
                </div>
              </div>
            ))}

            {/* Il ritiro: col contratto «a deposito» (PuntoPoste) il pacco si porta al punto, e il ritiro non c'è. */}
            {selMostrata?._deposito ? (
              <p className="ns-nota">Con questo contratto il pacco si porta in un Punto Poste o in un Ufficio Postale: il ritiro non serve.</p>
            ) : (
              <div className="ns-gruppo">
                <label className="ns-spunta">
                  <input type="checkbox" checked={richiediRitiro} onChange={e => setRichiediRitiro(e.target.checked)} />
                  <span><b>Prenota il ritiro a questo indirizzo</b><small>Il corriere passa a prendere il pacco.</small></span>
                </label>
                {richiediRitiro && (
                  <div className="ns-ritiro">
                    <Calendario valore={ritiroData} onChange={setRitiroData} />
                    <div className="ns-ritiro__lato">
                      <span className="ns-campo__et">Il corriere passa</span>
                      <b className="ns-ritiro__giorno">{(() => { const t = new Date(ritiroData + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }); return t.charAt(0).toUpperCase() + t.slice(1) })()}</b>
                      <div className="ns-segmenti" role="group" aria-label="Fascia del ritiro">
                        {(['mattina', 'pomeriggio'] as const).map(f => <button key={f} type="button" aria-pressed={ritiroOrario === f} className={ritiroOrario === f ? 'ns-segmenti--su' : ''} onClick={() => setRitiroOrario(f)}>{f === 'mattina' ? 'Mattina' : 'Pomeriggio'}</button>)}
                      </div>
                      <small>Sabato, domenica e festivi il corriere non ritira: quei giorni sono spenti.</small>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── DESTINATARIO ── */}
          <section id="ns-destinatario" className="ns-sezione" aria-labelledby="ns-h-dest">
            <div className="ns-sezione__testa"><h2 id="ns-h-dest"><Icona id="i-percorso" />Destinatario</h2></div>
            <div className="ns-modi" role="radiogroup" aria-label="Dove si consegna">
              {([['domicilio', 'A domicilio', "Il corriere consegna all'indirizzo", 'i-magazzino'], ['punto', 'A un punto', 'Punto Poste, Ufficio Postale o locker', 'i-percorso']] as const).map(([v, t, s, ic]) => (
                <label key={v} className={'ns-modo' + (consegnaA === v ? ' ns-modo--su' : '')}>
                  <input type="radio" name="ns-consegna" checked={consegnaA === v} onChange={() => setConsegnaA(v)} />
                  <Icona id={ic} />
                  <span><b>{t}</b><small>{s}</small></span>
                </label>
              ))}
            </div>
            <div className="ns-campi">
              <label className="ns-campo ns-campo--select">
                <span className="ns-campo__et">Paese</span>
                <select className="ns-campo__val" value={dest.paese} onChange={e => { const paese = e.target.value; setDest(d => ({ ...d, paese, provincia: paese === 'IT' ? (d.paese === 'IT' ? d.provincia : '') : paese })); setSugg({ dove: '', voci: [] }) }}>
                  {PAESI_MONDO.map(p => <option key={p.code} value={p.code}>{p.nome}</option>)}
                </select>
              </label>
              {campo('destNome', 'Nome e cognome o ragione sociale', dest.nome, v => setDest(d => ({ ...d, nome: v })), { ref: refDest, onInput: v => cerca('dest', '/api/destinatari/cerca?q=' + encodeURIComponent(v), v) })}
              <Tendina ancora={refDest} aperta={sugg.dove === 'dest' && sugg.voci.length > 0}>
                {sugg.voci.map((c: any, i: number) => voceSugg(c.nome, indirizzoBreve(c), () => { setDest(d => ({ ...d, nome: c.nome, indirizzo: c.indirizzo || d.indirizzo, citta: c.citta || d.citta, provincia: c.provincia || d.provincia, cap: c.cap || d.cap, email: c.email || d.email, telefono: c.telefono || d.telefono })); setSugg({ dove: '', voci: [] }) }, i))}
              </Tendina>
              {consegnaA === 'domicilio' ? (<>
                {campo('destIndirizzo', 'Indirizzo', dest.indirizzo, v => setDest(d => ({ ...d, indirizzo: v })))}
                <div className="ns-riga3">
                  {campo('destCap', 'CAP', dest.cap, v => setDest(d => ({ ...d, cap: v })))}
                  {campo('destCitta', 'Città', dest.citta, v => setDest(d => ({ ...d, citta: v })), { ref: refDestCitta, onInput: v => cerca('destCitta', '/api/comuni?q=' + encodeURIComponent(v) + '&paese=' + encodeURIComponent(dest.paese), v) })}
                  {campo('destProvincia', estero ? 'Regione (facoltativa)' : 'Provincia', dest.provincia, v => setDest(d => ({ ...d, provincia: estero ? v : v.toUpperCase() })))}
                </div>
                {/* Solo le voci del paese scelto ADESSO: una risposta partita prima di cambiare paese non deve rimettere città
                    italiane su un pacco tedesco. Dove l'archivio ha solo la prima parte del CAP, un CAP già scritto non si accorcia. */}
                <Tendina ancora={refDestCitta} aperta={sugg.dove === 'destCitta' && sugg.voci.some((c: any) => (c.paese || 'IT') === dest.paese)} maxAltezza={220}>
                  {sugg.voci.filter((c: any) => (c.paese || 'IT') === dest.paese).map((c: any, i: number) => voceSugg(c.nome, `(${(c.paese || 'IT') !== 'IT' ? c.provincia : c.sigla}) ${c.cap}${c.parziale ? ' … da completare' : ''}`, () => {
                    if ((c.paese || 'IT') !== 'IT') {
                      const gia = (d: Destinatario) => c.parziale && String(d.cap || '').toUpperCase().replace(/\s/g, '').startsWith(String(c.cap).toUpperCase().replace(/\s/g, ''))
                      setDest(d => ({ ...d, citta: c.nome, cap: gia(d) ? d.cap : c.cap }))
                    } else setDest(d => ({ ...d, citta: c.nome, provincia: c.sigla, cap: c.cap }))
                    setSugg({ dove: '', voci: [] })
                  }, i))}
                </Tendina>
              </>) : (
                campo('destCap', 'CAP (per cercare i punti vicini)', dest.cap, v => setDest(d => ({ ...d, cap: v })), { className: 'ns-campo--corto' })
              )}
              <div className="ns-riga2">
                {campo('destTelefono', 'Telefono', dest.telefono, v => setDest(d => ({ ...d, telefono: v })), { inputMode: 'tel' })}
                {campo('destEmail', selMostrata?._email_obbligatoria || consegnaA === 'punto' ? 'Email (serve per il codice di ritiro)' : 'Email (facoltativa)', dest.email, v => setDest(d => ({ ...d, email: v })), { inputMode: 'email' })}
              </div>
              {consegnaA === 'punto' && (
                <p className="ns-avviso">Il punto si sceglie qui sotto, insieme al corriere. Il corriere manda al destinatario, per SMS ed email, il codice per ritirare o aprire il locker: servono telefono ed email <b>veri del destinatario</b>.</p>
              )}
              {codAlert && (
                <p className="ns-avviso"><b>Attenzione:</b> su {codAlert.totCod} spedizion{codAlert.totCod === 1 ? 'e' : 'i'} in contrassegno questo destinatario ne ha {codAlert.rifiutati > 0 ? `rifiutat${codAlert.rifiutati === 1 ? 'a' : 'e'} ${codAlert.rifiutati}` : 'lasciate in giacenza'}{codAlert.giacenza > 0 && codAlert.rifiutati > 0 ? ` (di cui ${codAlert.giacenza} ora in giacenza)` : ''}. Puoi spedire lo stesso: è solo un avviso.</p>
              )}
              {campo('destNote', 'Note per il corriere (facoltative)', dest.note, v => setDest(d => ({ ...d, note: v })))}
              {rifAperti ? (
                <div className="ns-riga2">
                  {campo('rifOrdine', 'Riferimento ordine (in etichetta)', dest.rifOrdine, v => setDest(d => ({ ...d, rifOrdine: v })))}
                  {master && campo('rifDest', 'Riferimento destinatario', dest.rifDest, v => setDest(d => ({ ...d, rifDest: v })))}
                </div>
              ) : (
                <button type="button" className="ns-link ns-link--sotto" onClick={() => setRifAperti(true)}>{dest.rifOrdine ? `Riferimento ordine: ${dest.rifOrdine}` : 'Aggiungi un riferimento ordine'}</button>
              )}
            </div>
          </section>

          {/* ── COLLI ── */}
          <section id="ns-colli" className="ns-sezione" aria-labelledby="ns-h-colli">
            <div className="ns-sezione__testa">
              <h2 id="ns-h-colli"><Icona id="i-pacco" />Colli</h2>
              {(catalogo.length > 0 || clienteVero) && <button type="button" className="ns-link" onClick={() => setMostraCatalogo(v => !v)}>{mostraCatalogo ? 'Chiudi il catalogo' : 'Dal catalogo'}</button>}
            </div>
            {pacchiSalvati.length > 0 && (
              <div className="ns-chips"><span>Pacchi salvati</span>
                {pacchiSalvati.map((p: any) => <button key={p.id} type="button" className="ns-chip" onClick={() => applicaPacco(p)}><b>{p.nome}</b>{p.peso} kg · {p.lunghezza}×{p.larghezza}×{p.altezza}</button>)}
              </div>
            )}
            {mostraCatalogo && (
              <div className="ns-catalogo">
                {clienteVero && (
                  <div className="ns-sku">
                    <label className="ns-campo"><span className="ns-campo__et">SKU o codice a barre</span><input className="ns-campo__val" value={sku} onChange={e => { setSku(e.target.value); setSkuMsg('') }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); cercaSku() } }} /></label>
                    <label className="ns-campo ns-campo--corto"><span className="ns-campo__et">Quantità</span><input className="ns-campo__val" inputMode="numeric" value={skuQta} onChange={e => setSkuQta(e.target.value.replace(/[^0-9]/g, ''))} /></label>
                    <button type="button" className="ns-tasto2" onClick={cercaSku}>Applica</button>
                    {skuMsg && <span className="ns-nota">{skuMsg}</span>}
                  </div>
                )}
                {catalogo.length > 0 && <SelettoreArticoli articoli={catalogo} valore={articoliScelti} onChange={setArticoliScelti} />}
              </div>
            )}
            <div className="ns-colli">
              {colli.map((c, i) => (
                <div key={i} className="ns-collo">
                  <span className="ns-collo__n">Collo {i + 1}</span>
                  {campo('peso' + i, 'Peso kg', c.peso, v => cambiaCollo(i, 'peso', v), { inputMode: 'decimal', placeholder: '0,0' })}
                  {campo('l' + i, 'Lung. cm', c.lunghezza, v => cambiaCollo(i, 'lunghezza', v), { inputMode: 'numeric', placeholder: '20' })}
                  {campo('w' + i, 'Larg. cm', c.larghezza, v => cambiaCollo(i, 'larghezza', v), { inputMode: 'numeric', placeholder: '15' })}
                  {campo('h' + i, 'Alt. cm', c.altezza, v => cambiaCollo(i, 'altezza', v), { inputMode: 'numeric', placeholder: '10' })}
                  <button type="button" className="ns-togli" disabled={colli.length === 1} onClick={() => setColli(prev => prev.filter((_, j) => j !== i))} aria-label={`Togli il collo ${i + 1}`}><Icona id="i-cestino" /></button>
                </div>
              ))}
            </div>
            <div className="ns-colli__piede">
              <button type="button" className="ns-tasto2" onClick={() => setColli(prev => [...prev, COLLO_VUOTO])}><Icona id="i-pacco" />Aggiungi un collo</button>
              <span className="ns-nota">{colli.length === 1 ? '1 collo' : `${colli.length} colli`} · in tutto <b>{kg(colli.reduce((s, c) => s + num(c.peso), 0))}</b></span>
            </div>
            <p className="ns-nota">Misure vuote: si conta 20×15×10 cm. Scriverle evita le rettifiche dopo.</p>
            <div className="ns-campi">
              {campo('contenuto', 'Contenuto', contenuto, setContenuto)}
              <div className="ns-riga2">
                <label className="ns-campo ns-campo--select">
                  <span className="ns-campo__et">Tipo di merce</span>
                  <select className="ns-campo__val" value={tipoContenuto} onChange={e => setTipoContenuto(e.target.value)}>
                    {['Merce destinata alla vendita', 'Campioni commerciali', 'Documenti', 'Regalo', 'Uso personale'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </label>
                {campo('valore', 'Valore merce €', valoreMerce, v => setValoreMerce(decimale(v)), { inputMode: 'decimal' })}
              </div>
              {estero && campo('hs', 'Codice doganale HS (obbligatorio fuori Italia)', hscode, v => setHscode(v.replace(/[^0-9]/g, '')), { inputMode: 'numeric', placeholder: 'es. 61091000' })}
              {isExtraUe(dest.paese) && <p className="ns-avviso"><b>Fuori dall&apos;Unione europea si passa dalla dogana.</b> Contenuto, valore e codice HS devono essere giusti: la spedizione può non partire subito (a volte servono documenti, es. EORI).</p>}
            </div>
          </section>

          {/* ── SERVIZI ── */}
          <section className="ns-sezione" aria-labelledby="ns-h-serv">
            <div className="ns-sezione__testa"><h2 id="ns-h-serv"><Icona id="i-scudo" />Servizi</h2></div>
            <div className="ns-gruppo">
              <label className="ns-spunta">
                <input type="checkbox" checked={codAttivo} onChange={e => setCodAttivo(e.target.checked)} />
                <span><b>Contrassegno</b><small>Il corriere incassa alla consegna e ti gira l&apos;importo.</small></span>
              </label>
              {codAttivo && (
                <div className="ns-dentro ns-riga2">
                  {campo('cod', 'Importo da incassare €', codImporto, v => setCodImporto(decimale(v)), { inputMode: 'decimal' })}
                  {selMostrata ? (
                    <label className="ns-campo ns-campo--select">
                      <span className="ns-campo__et">Come paga il destinatario</span>
                      <select className="ns-campo__val" value={incassoModalita} onChange={e => setIncassoModalita(e.target.value)} disabled={opzCod.length < 2}>
                        {opzCod.map(([v, l]) => <option key={v} value={v}>{l.charAt(0) + l.slice(1).toLowerCase()}</option>)}
                      </select>
                    </label>
                  ) : <p className="ns-nota">Come può pagare il destinatario dipende dal corriere: lo scegli dopo averlo scelto.</p>}
                </div>
              )}
              <label className="ns-spunta">
                <input type="checkbox" checked={assAttiva} onChange={e => setAssAttiva(e.target.checked)} />
                <span><b>Assicurazione</b><small>Copre il valore dichiarato se il pacco si perde o si rompe.</small></span>
              </label>
              {assAttiva && <div className="ns-dentro">{campo('ass', 'Valore da assicurare €', assValore, v => setAssValore(decimale(v)), { inputMode: 'decimal', className: 'ns-campo--corto' })}</div>}
            </div>
          </section>

          {/* ── CORRIERE ── */}
          <section id="ns-corriere" className="ns-sezione" aria-labelledby="ns-h-corr" aria-busy={inCalcolo}>
            <div className="ns-sezione__testa">
              <h2 id="ns-h-corr"><Icona id="i-camion" />Corriere</h2>
              {inCalcolo && <span className="ns-calcolo" role="status">Calcolo i prezzi…{secondi >= 2 ? ` ${secondi} s` : ''}</span>}
            </div>
            {!pronto ? (
              <p className="ns-vuoto">Per vedere i corrieri e i prezzi manca: {mancanoBrevi.join(', ')}.</p>
            ) : (risposta?.errore && aggiornati) ? (
              <div className="ns-vuoto ns-vuoto--errore"><span>{risposta.errore}</span><button type="button" className="ns-tasto2" onClick={() => setRiprova(n => n + 1)}>Riprova</button></div>
            ) : !tariffe.length ? (
              <div className="ns-gruppo" aria-hidden="true">{[0, 1, 2].map(i => <div key={i} className="ns-corriere ns-corriere--finta"><span className="ns-logo" /><span className="ns-finta" /><span className="ns-finta ns-finta--corta" /></div>)}</div>
            ) : !visibili.length ? (
              <p className="ns-vuoto">{consegnaA === 'punto' ? 'Nessun corriere consegna a un punto per questi dati: servono i contratti PuntoPoste o InPost Locker.' : 'Nessun corriere disponibile per questi dati.'}</p>
            ) : (
              <div className={'ns-gruppo' + (inCalcolo ? ' ns-gruppo--vecchio' : '')} role="radiogroup" aria-labelledby="ns-h-corr">
                {visibili.map(t => {
                  const k = chiaveTariffa(t)
                  const motivo = spento(t)
                  const su = k === selKey && !motivo
                  const logo = iconaCorriere(t.corriere_nome || t.carrierCode || '')
                  const nome = t.corriere_nome || codiceProv(t.carrierCode)
                  return (
                    <div key={k}>
                      <label className={'ns-corriere' + (su ? ' ns-corriere--su' : '') + (motivo ? ' ns-corriere--spento' : '')}>
                        <input type="radio" name="ns-corriere" checked={su} disabled={!!motivo} onChange={() => scegli(t)} />
                        <span className="ns-logo">{logo ? <img src={logo} alt="" /> : <b>{codiceProv(t._corriere_tipo || t.carrierCode)}</b>}</span>
                        <span className="ns-corriere__testo">
                          <b>{nome}{!motivo && num(t.total_price) === minimo && selezionabili.length > 1 && <em className="ns-meglio">Il più conveniente</em>}</b>
                          <small>{motivo || `${String(t.peso_fatturato).replace('.', ',')} kg fatturati${num(t.peso_volume) > t.peso_reale ? ' (volume)' : ''} · zona ${t.zona}`}</small>
                          {!motivo && t.limiti_collo && <small className="ns-attenz">Limiti collo: {t.limiti_collo}</small>}
                          {!motivo && t.avviso_fuori_sagoma && <small className="ns-attenz">{t.avviso_fuori_sagoma}</small>}
                        </span>
                        <span className="ns-prezzo">{motivo ? 'Non disponibile' : euro(num(t.total_price))}</span>
                      </label>
                      {su && (t._deposito || t._consegna_punto || t._inpost_locker || accDisponibili.length > 0) && (
                        <div className="ns-corriere__dentro">
                          {t._deposito && t._corriere_id && (
                            <label className="ns-campo ns-campo--select">
                              <span className="ns-campo__et">Dove porti il pacco</span>
                              <select className="ns-campo__val" value={depositoTipo} onChange={e => { const v = e.target.value as any; setDepositoTipo(v); try { if (v) localStorage.setItem('puntoposte:deposito', v) } catch { } }}>
                                <option value="">Scegli…</option>
                                <option value="APT">Punto Poste (tabaccheria, negozio)</option>
                                <option value="FMP">Ufficio Postale</option>
                              </select>
                            </label>
                          )}
                          {t._consegna_punto && t._corriere_id && (
                            <div><span className="ns-campo__et">Punto di consegna, dove ritira il destinatario</span>
                              <PuntoPosteSelettore corriereId={t._corriere_id} lato="arrivo" tipologia={t._consegna_punto} capIniziale={dest.cap} valore={puntoArrivo} onChange={setPuntoArrivo} /></div>
                          )}
                          {t._inpost_locker && t._corriere_id && (
                            <div><span className="ns-campo__et">Locker, dove ritira il destinatario</span>
                              <InpostLockerPicker corriereId={t._corriere_id} capIniziale={dest.cap} valore={inpostPunto} onSelect={setInpostPunto} /></div>
                          )}
                          {accDisponibili.length > 0 && (<>
                            <span className="ns-campo__et">Servizi del corriere</span>
                            {accDisponibili.map(a => {
                              const imp = Math.round((num(a.prezzo) + (num(a.perc) / 100) * num(t.prezzo_spedizione)) * 100) / 100
                              return (
                                <label key={a.nome} className="ns-extra">
                                  <input type="checkbox" checked={extraNomi.includes(a.nome)} onChange={e => setExtraNomi(prev => e.target.checked ? [...prev, a.nome] : prev.filter(n => n !== a.nome))} />
                                  <span>{a.nome}</span><b>+ {euro(imp)}</b>
                                </label>
                              )
                            })}
                          </>)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <div className="ns-crea">
            {prezzoCambiato && <p className="ns-cambiato" role="status">Il prezzo è cambiato: da {euro(prezzoCambiato.da)} a {euro(prezzoCambiato.a)}.</p>}
            <button type="button" className="ns-crea__tasto" onClick={crea} disabled={inCalcolo}>
              {inCalcolo ? 'Aggiorno i prezzi…' : selected ? `Crea spedizione · ${euro(totale)}` : 'Crea spedizione'}
            </button>
            <p className="ns-nota ns-nota--centro">
              {prova
                ? (master ? 'Nella prova la spedizione si crea dalla pagina di oggi: ti portiamo lì (i dati vanno riscritti).' : 'Nella prova la spedizione si crea dalla pagina di oggi: ti portiamo lì con destinatario, colli e contrassegno già scritti.')
                : 'Per ora la spedizione si crea dalla pagina di oggi: ti portiamo lì.'}
              {' '}Prezzi IVA esclusa.
            </p>
          </div>
        </div>

        {/* ── RIEPILOGO ── */}
        <aside className={'ns-riep' + (riepAperto ? ' ns-riep--aperto' : '')} aria-label="Riepilogo della spedizione">
          <div className="ns-riep__dentro gx-vetro">
            <h2>Riepilogo</h2>
            <div className="ns-rotta">
              <span className="ns-rotta__da" aria-hidden="true" />
              <div><small>Da</small><b>{mitt.nome || '—'}</b><span>{mitt.citta ? `${mitt.citta}${mitt.provincia ? ` (${mitt.provincia})` : ''}` : ''}</span>
                {richiediRitiro && !selMostrata?._deposito && <span>Ritiro {new Date(ritiroData + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })} · {ritiroOrario}</span>}</div>
              <span className="ns-rotta__a" aria-hidden="true" />
              <div><small>{consegnaA === 'punto' ? 'A (ritiro in un punto)' : 'A'}</small><b>{dest.nome || '—'}</b>
                <span>{consegnaA === 'punto' ? (dest.cap ? `CAP ${dest.cap}` : '') : [dest.citta, !estero && dest.provincia ? `(${dest.provincia})` : '', estero ? dest.paese : ''].filter(Boolean).join(' ')}</span></div>
            </div>
            <ul className="ns-riep__colli">
              {colli.map((c, i) => (
                <li key={i}>
                  <span className="ns-riep__icona"><Icona id="i-pacco" /><em>{i + 1}</em></span>
                  <span><b>Collo {i + 1}</b><small>{c.lunghezza && c.larghezza && c.altezza ? `${c.lunghezza}×${c.larghezza}×${c.altezza} cm` : 'misure non scritte (20×15×10)'}</small></span>
                  <span>{num(c.peso) > 0 ? kg(num(c.peso)) : 'manca il peso'}</span>
                </li>
              ))}
            </ul>
            {selMostrata ? (
              <div className={inCalcolo ? 'ns-gruppo--vecchio' : ''}>
                <div className="ns-riep__corriere">
                  <span className="ns-logo">{iconaCorriere(selMostrata.corriere_nome || selMostrata.carrierCode || '') ? <img src={iconaCorriere(selMostrata.corriere_nome || selMostrata.carrierCode || '')!} alt="" /> : <b>{codiceProv(selMostrata._corriere_tipo || selMostrata.carrierCode)}</b>}</span>
                  <span><b>{selMostrata.corriere_nome || codiceProv(selMostrata.carrierCode)}</b><small>{String(selMostrata.peso_fatturato).replace('.', ',')} kg fatturati · zona {selMostrata.zona}</small></span>
                </div>
                <dl className="ns-costi">
                  <div><dt>Trasporto</dt><dd>{euro(num(selMostrata.weight_price || selMostrata.prezzo_spedizione || selMostrata.total_price))}</dd></div>
                  {num(selMostrata.costo_fuel) > 0 && <div><dt>Carburante{selMostrata.fuel_pct ? ` (${String(selMostrata.fuel_pct).replace('.', ',')}%)` : ''}</dt><dd>{euro(num(selMostrata.costo_fuel))}</dd></div>}
                  {num(selMostrata.costo_sponda) > 0 && <div><dt>Sponda</dt><dd>{euro(num(selMostrata.costo_sponda))}</dd></div>}
                  {num(selMostrata.costo_contrassegno) > 0 && <div><dt>Contrassegno</dt><dd>{euro(num(selMostrata.costo_contrassegno))}</dd></div>}
                  {num(selMostrata.costo_assicurazione) > 0 && <div><dt>Assicurazione</dt><dd>{euro(num(selMostrata.costo_assicurazione))}</dd></div>}
                  {extraScelti.map(e => <div key={e.nome}><dt>{e.nome}</dt><dd>{euro(e.importo)}</dd></div>)}
                </dl>
                <div className="ns-totale"><span>Totale</span><b><small>EUR</small>{euro(totale)}</b></div>
                <p className="ns-iva">IVA esclusa</p>
              </div>
            ) : (
              <p className="ns-vuoto">Il prezzo compare qui appena c&apos;è un corriere.</p>
            )}
            {!master && credito != null && (
              <dl className={'ns-credito' + (selected && credito - totale < 0 ? ' ns-credito--basso' : '')}>
                <div><dt>Credito disponibile</dt><dd>{euro(credito)}</dd></div>
                {selected && <div><dt>Dopo questa spedizione</dt><dd>{euro(credito - totale)}</dd></div>}
              </dl>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
