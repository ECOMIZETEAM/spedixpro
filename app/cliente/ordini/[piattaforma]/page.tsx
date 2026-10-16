'use client'
import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { chiaveDestinatario, destinatarioDaEcommerce, gruppiStessoDestinatario } from '@/lib/destinatario-chiave'
import { useParams, useRouter } from 'next/navigation'
import DateRangePicker from '@/app/components/DateRangePicker'
import { useDialog } from '@/app/components/DialogProvider'
import PagaConCarta from '@/app/cliente/PagaConCarta'
import { useFiltriPersistenti } from '@/lib/use-filtri-persistenti'
import { numeriOrdine, numeroOrdineCorrisponde } from '@/lib/numero-ordine-negozio'
import AzzeraFiltri from '@/app/components/AzzeraFiltri'
import { useAnteprimaPrezzi, chiediPrezzi, scegliTariffa, euro, eUnRifiuto, testoDelRifiuto, type RigaPrezzo } from '@/app/cliente/anteprima-prezzi'

// Il prezzo si calcola per gli ordini della pagina a schermo e per quelli selezionati, fino a questo
// tetto: chi seleziona centinaia di ordini vede il totale sui primi, e al clic si prezzano tutti.
const PREZZI_SELEZIONATI = 200

const NOMI: Record<string,string> = { shopify:'Shopify', prestashop:'PrestaShop', woocommerce:'WooCommerce' }
const ACCENT = '#f97316'
const BORDER = '#e8e8e8'

const lbl: React.CSSProperties = { fontSize:'11px', fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.3px', marginBottom:'6px', display:'block' }
const inp: React.CSSProperties = { width:'100%', boxSizing:'border-box', padding:'9px 10px', fontSize:'13px', border:'1px solid '+BORDER, borderRadius:'8px', background:'#fff', color:'#1a1a1a', outline:'none' }
const field: React.CSSProperties = { flex:'1 1 160px', minWidth:'150px' }
const card: React.CSSProperties = { background:'#fff', border:'1px solid '+BORDER, borderRadius:'10px', padding:'18px' }
const th: React.CSSProperties = { padding:'11px 14px', color:'#6b7280', fontSize:'11px', fontWeight:700, textTransform:'uppercase', letterSpacing:'.3px', whiteSpace:'nowrap', userSelect:'none' }
const td: React.CSSProperties = { padding:'12px 14px', fontSize:'13px', color:'#1a1a1a', borderTop:'1px solid #f0f0f0', verticalAlign:'middle' }
// Etichettina della SECONDA riga (valori sotto: articoli/importi/tags): piccola e tenue, non deve pesare.
const secLbl: React.CSSProperties = { fontSize:'10px', textTransform:'uppercase', letterSpacing:'0.3px', color:'#9ca3af', fontWeight:700, marginRight:'5px' }

function fmtData(v:any){
  if(!v) return '—'
  const d = new Date(v)
  if(isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('it-IT')+' '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})
}
// Data REALE dell'ordine (non quella di import): eBay=raw.creationDate, WooCommerce=raw.date_created,
// Shopify=raw.created_at. Prima usava o.created_at (= quando è stato sincronizzato) → il filtro periodo
// mostrava tutto sotto la data di import invece delle date vere degli ordini.
function getData(o:any){
  const r = o.raw || {}
  return o.data_ordine || r.creationDate || r.date_created || r.created_at || r.createdDate || r.create_time || o.created_at || o.creato_il || null
}
function getTags(o:any){ const t = o.tags ?? o.raw?.tags; return Array.isArray(t)?t.join(', '):(t||'') }
function labelPag(s:any){ const m:Record<string,string>={ paid:'Pagato', pending:'In attesa', refunded:'Rimborsato', partially_paid:'Parziale', voided:'Annullato' }; return m[s]||s||'—' }
function coloriPag(s:any){ if(s==='paid') return {bg:'#dcfce7',fg:'#166534'}; if(s==='refunded'||s==='voided') return {bg:'#fee2e2',fg:'#991b1b'}; return {bg:'#fef3c7',fg:'#92400e'} }

export default function OrdiniPage() {
  const params = useParams()
  const router = useRouter()
  const dialog = useDialog()
  const piattaforma = String(params.piattaforma || 'shopify')
  const nome = NOMI[piattaforma] || piattaforma

  const [ordini, setOrdini] = useState<any[]>([])
  const [integrazioni, setIntegrazioni] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sincronizzando, setSincronizzando] = useState(false)
  const [msg, setMsg] = useState('')
  // eBay: "prepara i già-spediti come da spedire". La scelta si RICORDA (localStorage), così il
  // venditore non deve rimetterla a ogni sync. Init SSR-safe (niente window sul server).
  const [giaSpediti, setGiaSpediti] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('ebay_giaSpediti') === '1')

  // Filtri persistenti: non si azzerano cambiando pagina o dopo un'azione (localStorage, prefisso 'flt:ordini-cliente:*').
  const [fStore, setFStore] = useFiltriPersistenti('ordini-cliente:store', '')
  const [fStatoPag, setFStatoPag] = useFiltriPersistenti('ordini-cliente:statoPag', '')
  const [fStatoEv, setFStatoEv] = useFiltriPersistenti('ordini-cliente:statoEv', 'da_spedire')   // default: solo i NON evasi (da spedire). "Tutti" mostra anche gli spediti.
  const [fPaese, setFPaese] = useFiltriPersistenti('ordini-cliente:paese', '')
  const [fNum, setFNum] = useFiltriPersistenti('ordini-cliente:num', '')
  const [fSku, setFSku] = useFiltriPersistenti('ordini-cliente:sku', '')
  const [fTags, setFTags] = useFiltriPersistenti('ordini-cliente:tags', '')
  const [fArch, setFArch] = useFiltriPersistenti('ordini-cliente:arch', false)
  const [fDa, setFDa] = useFiltriPersistenti('ordini-cliente:da', '')
  const [fA, setFA] = useFiltriPersistenti('ordini-cliente:a', '')
  // DUE DATE, due compiti. Data ordine (sopra): decide cosa si importa con Sincronizza e cosa si vede.
  // Data spedizione: quando la spedizione l'abbiamo creata NOI — solo filtro di lista, nessuna chiamata
  // ai negozi. Vuota = non filtra (gli ordini da spedire una data di spedizione non ce l'hanno ancora).
  const [fSpDa, setFSpDa] = useFiltriPersistenti('ordini-cliente:spDa', '')
  const [fSpA, setFSpA] = useFiltriPersistenti('ordini-cliente:spA', '')

  const [search, setSearch] = useFiltriPersistenti('ordini-cliente:cerca', '')
  const [perPage, setPerPage] = useFiltriPersistenti('ordini-cliente:perPage', 10)
  const [page, setPage] = useState(1)
  const [sel, setSel] = useState<Record<string,boolean>>({})
  const [sort, setSort] = useState<{k:string,d:1|-1}|null>(null)
  const [soloDoppi, setSoloDoppi] = useState(false)

  const [spedisciCon, setSpedisciCon] = useState('auto')
  const [sms, setSms] = useState('no')
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [articoliCat, setArticoliCat] = useState<any[]>([])   // catalogo SKU -> peso/misure
  const [pacchi, setPacchi] = useState<any[]>([])             // pacchi predefiniti (SKU -> scatola)
  // Per l'anteprima del prezzo: si calcola solo quando catalogo, pacchi e mittente sono arrivati.
  const [articoliPronti, setArticoliPronti] = useState(false)
  const [pacchiPronti, setPacchiPronti] = useState(false)
  const [mittente, setMittente] = useState<{ cap: string; provincia: string } | null>(null)
  // 'incompleto' (mancano CAP o provincia della sede operativa) e 'fallito' (lettura non riuscita)
  // si dicono in due modi diversi: nel secondo caso il profilo puo' essere a posto.
  const [statoMittente, setStatoMittente] = useState<'attesa' | 'ok' | 'incompleto' | 'fallito'>('attesa')

  // IL NEGOZIO SELEZIONATO DEVE ESSERE DI QUESTA PIATTAFORMA.
  //
  // Il filtro negozio e' persistente in localStorage e la chiave e' la STESSA per tutte le
  // piattaforme ('ordini-cliente:store'): scegli un negozio sulla pagina eBay, passi a WooCommerce, e
  // quell'id eBay e' ancora nello stato. La tendina mostra "Tutti" — l'id non e' fra le sue opzioni —
  // quindi sembra tutto a posto, ma fa due danni insieme:
  //  · il filtro qui sotto confronta integrazione_id e nasconde OGNI riga -> "Nessun dato disponibile";
  //  · Sincronizza manda quell'id, il server cerca (id + piattaforma) e risponde 404 "Integrazione non
  //    trovata".
  // E' il motivo per cui "oggi va e domani no": dipende solo da dove hai toccato il filtro l'ultima
  // volta. Vale anche per un negozio RICOLLEGATO, che cambia id e lascia il vecchio salvato.
  //
  // Non basta cambiare la chiave per piattaforma: l'hook, quando per la chiave nuova non trova nulla
  // salvato, TIENE il valore precedente. L'unico controllo che regge e' questo — l'id vale solo se e'
  // fra i negozi caricati per questa piattaforma.
  const fStoreValido = (fStore && integrazioni.some((i:any)=>i.id===fStore)) ? fStore : ''
  // E si ripulisce anche il salvato, cosi' il problema non si ripresenta al ricaricamento della pagina.
  // Solo a elenco CARICATO: durante il caricamento e' vuoto e cancellerebbe una scelta valida.
  useEffect(()=>{
    if (fStore && integrazioni.length > 0 && !integrazioni.some((i:any)=>i.id===fStore)) setFStore('')
  }, [fStore, integrazioni, setFStore])

  async function carica() {
    setLoading(true)
    const [ord, integr] = await Promise.all([
      fetch('/api/ordini/lista?piattaforma='+piattaforma).then(r=>r.json()).catch(()=>[]),
      fetch('/api/integrazioni/lista').then(r=>r.json()).catch(()=>[]),
    ])
    setOrdini(Array.isArray(ord)?ord:[])
    const listaIntegr = Array.isArray(integr) ? integr : (integr?.integrazioni || [])
    setIntegrazioni(listaIntegr.filter((i:any)=>i.piattaforma===piattaforma))
    setLoading(false)
  }
  useEffect(()=>{ carica() }, [piattaforma])
  // Il mittente entra nel prezzo (supplemento di origine). Gli stessi due campi della sede operativa
  // che «Spedisci selezionati» mette nel mittente della spedizione.
  function leggiMittente() {
    setStatoMittente('attesa')
    fetch('/api/cliente/dati').then(r=>r.json()).then(c=>{
      if (!c || c.error) throw new Error('lettura mittente')
      const cap=c.so_cap||'', provincia=c.so_provincia||''
      setMittente(cap&&provincia?{cap,provincia}:null)
      setStatoMittente(cap&&provincia?'ok':'incompleto')
    }).catch(()=>setStatoMittente('fallito'))
  }
  useEffect(()=>{
    fetch('/api/cliente/articoli').then(r=>r.json()).then(d=>setArticoliCat(Array.isArray(d)?d:[])).catch(()=>{}).finally(()=>setArticoliPronti(true))
    fetch('/api/cliente/pacchi').then(r=>r.json()).then(d=>setPacchi(Array.isArray(d)?d:[])).catch(()=>{}).finally(()=>setPacchiPronti(true))
    leggiMittente()
  }, [])

  // SKU -> peso/misure (catalogo articoli) e SKU -> pacco (scatola). eBay/PrestaShop arrivano con
  // grammi=0: senza questo il peso restava sempre 1kg (non si poteva cambiare fascia). Priorità peso:
  // articolo(SKU) > pacco(SKU) > grammi del file > 1kg.
  const skuToArt = useMemo(()=>{ const m=new Map<string,any>(); for(const a of articoliCat){ const k=String(a.sku||'').trim().toLowerCase(); if(k) m.set(k,a) } return m }, [articoliCat])
  const skuToPacco = useMemo(()=>{ const m=new Map<string,any>(); for(const p of pacchi) for(const s of String(p.sku||'').split(/[\s,;]+/)){ const k=s.trim().toLowerCase(); if(k) m.set(k,p) } return m }, [pacchi])
  function risolviPeso(o:any){
    const arts = Array.isArray(o.articoli)?o.articoli:[]
    const sku0 = String(arts[0]?.sku||'').trim().toLowerCase()
    const art = sku0 ? skuToArt.get(sku0) : null
    const pacco = sku0 ? skuToPacco.get(sku0) : null
    let peso = (art && Number(art.peso)>0) ? Number(art.peso)
      : (pacco && Number(pacco.peso)>0) ? Number(pacco.peso)
      : (arts.reduce((s:number,a:any)=>s+(Number(a.grammi)||0)*(Number(a.quantita)||1),0)/1000)
    // Nessuna fonte per il peso (ne' catalogo, ne' pacco, ne' grammi dal negozio): si spedisce su 1 kg.
    const pesoStimato = !(peso>0)
    if (pesoStimato) peso = 1
    const box = pacco ? {l:pacco.lunghezza,w:pacco.larghezza,h:pacco.altezza}
      : (art && (Number(art.lunghezza)||Number(art.larghezza)||Number(art.altezza))) ? {l:art.lunghezza,w:art.larghezza,h:art.altezza}
      : {l:20,w:15,h:10}
    return { peso: Math.max(0.01, peso), l:Number(box.l)||20, w:Number(box.w)||15, h:Number(box.h)||10, pesoStimato }
  }
  useEffect(()=>{ fetch('/api/cliente/corrieri').then(r=>r.json()).then(d=>setCorrieri(Array.isArray(d?.corrieri)?d.corrieri:[])).catch(()=>{}) }, [])

  async function sincronizza() {
    const attiva = integrazioni.find((i:any)=>i.stato==='attivo')
    const id = fStoreValido || attiva?.id
    if (!id) { setMsg('Nessun negozio '+nome+' collegato'); return }
    setSincronizzando(true); setMsg('')
    try {
      // IL PERIODO SCELTO IN PAGINA DECIDE COSA SI IMPORTA: se metti "oggi", Sincronizza scarica SOLO
      // oggi; "ultimi 30 giorni" -> quelli. Se non hai scelto date, default agli ultimi 30 giorni,
      // cosi' il primo sync non parte vuoto. (Prima si mandava un'unione fissa >=30gg che ignorava il
      // selettore: mettere "oggi" scaricava comunque tutto il mese.)
      const trentaGiorniFa = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
      const oggi = new Date().toISOString().slice(0, 10)
      const res = await fetch('/api/integrazioni/'+piattaforma+'/sync', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          integrazione_id: id,
          dal: fDa || trentaGiorniFa,
          al: fA || oggi,
          // Solo eBay: prepara i già-spediti (vedi lib/ebaySync).
          ...(piattaforma === 'ebay' ? { importaGiaSpediti: giaSpediti } : {}),
        })
      })
      const d = await res.json()
      if (d.error) setMsg('Errore: '+d.error)
      // Messaggio chiaro: quanti dei sincronizzati sono GIA' SPEDITI (sul negozio) e quanti DA SPEDIRE,
      // così non sembra un bug quando si sincronizzano N ordini ma la lista "Da spedire" resta a 0
      // (i recenti sono spesso già spediti sul negozio). Fallback su "(letti N)" se la piattaforma non manda ancora il dettaglio.
      else setMsg('Sincronizzati '+d.importati+' ordini'
        + ((d.spediti!==undefined || d.daSpedire!==undefined)
            ? ' ('+(d.spediti||0)+' già spediti · '+(d.daSpedire||0)+' da spedire)'
            : (d.letti!==undefined?' (letti '+d.letti+')':''))
        // Ordini che il negozio ha annullato o rimborsato dopo l'import: escono dai "Da spedire".
        + (d.annullati ? ' · '+d.annullati+(d.annullati===1?' annullato':' annullati')+' sul negozio' : '')
        // Permessi mancanti sulla chiave del negozio: va detto qui, dove si guarda dopo aver premuto.
        + (d.avviso ? ' — ⚠ '+d.avviso : ''))
      carica()
    } catch { setMsg('Errore di connessione') }
    setSincronizzando(false)
  }

  function creaSpedizione(o:any) {
    const d = o.destinatario || {}
    const rp = risolviPeso(o)
    const qs = new URLSearchParams({
      da_ordine: o.id,
      nome: d.nome||'', indirizzo: d.indirizzo||'', citta: d.citta||'',
      provincia: d.provincia||'', cap: d.cap||'', paese: d.paese||'IT',
      email: d.email||'', telefono: d.telefono||'',
      peso: String(rp.peso), l: String(rp.l), w: String(rp.w), h: String(rp.h),
      // IL RIFERIMENTO E' IL NUMERO D'ORDINE COM'E' SCRITTO SUL NEGOZIO, cancelletto compreso.
      // Prima lo si toglieva: sull'etichetta compariva "1019" mentre sul negozio l'ordine si chiama
      // "#1019", e chi cerca un ordine cerca il nome che vede. La guardia anti-doppione se lo
      // aspetta gia' in questa forma (lib/rif-ordine.ts: /^#?\d{3,}$/ "Shopify #1234").
      rif: String(o.numero_ordine || o.ordine_esterno_id || ''),
      // CONTENUTO E VALORE: li mandava gia' "Spedisci selezionati", non questo percorso. Stessa
      // azione, due comportamenti diversi — e chi apriva il modulo trovava il contenuto vuoto,
      // che per i servizi internazionali e' anche un blocco alla creazione.
      contenuto: (Array.isArray(o.articoli) ? o.articoli : []).map((a:any)=>a.nome).filter(Boolean).join(', ').slice(0,100),
      valore: String(o.totale || ''),
      // La nota dell'ordine sono le istruzioni per il corriere: si portano dietro.
      note: String(o.nota || ''),
    })
    if (spedisciCon && spedisciCon !== 'auto') qs.set('corriere', spedisciCon)
    const cod = codDaOrdine(o)
    if (cod > 0) qs.set('contrassegno', String(cod))
    router.push('/cliente/spedizioni/nuova?'+qs.toString())
  }

  const paesi = useMemo(()=>Array.from(new Set(ordini.map(o=>o.destinatario?.paese).filter(Boolean))), [ordini])
  const statiPag = useMemo(()=>Array.from(new Set(ordini.map(o=>o.stato_pagamento).filter(Boolean))), [ordini])

  // CHI HA PIU' DI UN ORDINE DA SPEDIRE. Stessa chiave dell'unione: se la pagina la calcolasse a
  // modo suo, proporrebbe accoppiate che poi l'unione rifiuta.
  const gruppi = useMemo(() => gruppiStessoDestinatario(
    ordini.filter((o:any) => !o.spedizione_id && o.stato !== 'unito' && o.stato !== 'annullato')
      .map((o:any) => ({ id: o.id, chiave: chiaveDestinatario(destinatarioDaEcommerce(o)) }))
  ), [ordini])
  const gruppoDi = (o:any): string[] | undefined =>
    (!o.spedizione_id && o.stato !== 'unito' && o.stato !== 'annullato') ? gruppi.get(chiaveDestinatario(destinatarioDaEcommerce(o))) : undefined
  const quantiDoppi = useMemo(() => ordini.filter((o:any) => gruppoDi(o)).length, [ordini, gruppi])

  const filtrati = useMemo(()=>{
    let arr = ordini.filter(o=>{
      if (soloDoppi && !gruppoDi(o)) return false
      const d = o.destinatario || {}
      if (fStoreValido && o.integrazione_id !== fStoreValido) return false
      if (fStatoPag && o.stato_pagamento !== fStatoPag) return false
      if (fStatoEv && o.stato !== fStatoEv) return false
      if (fPaese && d.paese !== fPaese) return false
      // Su PrestaShop vale anche l'ID numerico, non solo il riferimento a lettere.
      if (fNum && !numeroOrdineCorrisponde(o, piattaforma, fNum)) return false
      if (fSku) {
        const arts = Array.isArray(o.articoli)?o.articoli:[]
        if (!arts.some((a:any)=>String(a.sku||'').toLowerCase().includes(fSku.toLowerCase()))) return false
      }
      if (fTags && !getTags(o).toLowerCase().includes(fTags.toLowerCase())) return false
      if (fArch && !o.archiviato) return false
      if (fDa || fA) {
        const t = getData(o); const ts = t?new Date(t).getTime():0
        if (fDa && ts < new Date(fDa).getTime()) return false
        if (fA && ts > new Date(fA).getTime()+86400000) return false
      }
      if (fSpDa || fSpA) {
        // Senza una spedizione nostra non c'e' data di spedizione: con questo filtro attivo l'ordine esce.
        if (!o.data_spedizione) return false
        const ts = new Date(o.data_spedizione).getTime()
        if (fSpDa && ts < new Date(fSpDa).getTime()) return false
        if (fSpA && ts > new Date(fSpA).getTime()+86400000) return false
      }
      if (search) {
        const blob = (numeriOrdine(o, piattaforma).join(' ')+' '+(d.nome||'')+' '+(d.citta||'')+' '+(d.email||'')).toLowerCase()
        if (!blob.includes(search.toLowerCase())) return false
      }
      return true
    })
    if (sort) {
      const acc:Record<string,(o:any)=>any> = {
        data:o=>new Date(getData(o)||0).getTime(),
        numero_ordine:o=>String(o.numero_ordine||''),
        destinatario:o=>String(o.destinatario?.nome||''),
        stato_pagamento:o=>String(o.stato_pagamento||''),
        stato:o=>String(o.stato||''),
        totale:o=>Number(o.totale||0),
      }
      const f = acc[sort.k]; if(f){ arr=[...arr].sort((a,b)=>{ const x=f(a),y=f(b); return x<y?-1*sort.d:x>y?1*sort.d:0 }) }
    } else {
      // Default: ordina per DATA REALE dell'ordine (più recente in alto), non per data di import
      arr = [...arr].sort((a,b)=> new Date(getData(b)||0).getTime() - new Date(getData(a)||0).getTime())
    }
    return arr
  // fStoreValido, non fStore: l'elenco negozi arriva DOPO i filtri, quindi la validita' dell'id puo'
  // cambiare senza che fStore si muova. Con la dipendenza sbagliata il filtro resterebbe indietro.
  }, [ordini, piattaforma, fStoreValido, fStatoPag, fStatoEv, fPaese, fNum, fSku, fTags, fArch, fDa, fA, fSpDa, fSpA, search, sort, soloDoppi, gruppi])

  const totale = filtrati.length
  const nPagine = Math.max(1, Math.ceil(totale/perPage))
  const start = (page-1)*perPage
  const pagina = filtrati.slice(start, start+perPage)
  useEffect(()=>{ setPage(1) }, [fStoreValido,fStatoPag,fStatoEv,fPaese,fNum,fSku,fTags,fArch,fDa,fA,fSpDa,fSpA,search,perPage])

  const idsPagina = pagina.map(o=>o.id)
  const tuttiSel = idsPagina.length>0 && idsPagina.every(id=>sel[id])
  function toggleTutti(){ const n={...sel}; if(tuttiSel){idsPagina.forEach(id=>delete n[id])} else {idsPagina.forEach(id=>n[id]=true)}; setSel(n) }
  function toggleUno(id:string){ setSel(s=>({...s,[id]:!s[id]})) }
  const nSel = Object.values(sel).filter(Boolean).length

  function ordina(k:string){ setSort(s=> s&&s.k===k ? {k,d:(s.d===1?-1:1) as 1|-1} : {k,d:1}) }
  function frecc(k:string){ if(!sort||sort.k!==k) return '↕'; return sort.d===1?'↑':'↓' }

  const [spedendo, setSpedendo] = useState(false)
  // Carrello: credito insufficiente per l'intero lotto → "Paga con la carta" per il mancante.
  // Il lotto già preparato (tariffe calcolate) resta qui, così il pagamento non lo ricalcola.
  const [creditoKO, setCreditoKO] = useState<{ mancante: number; costo: number; credito: number } | null>(null)
  const lottoRef = useRef<{ preparati: any[]; errori: string[]; shipFrom: any; cliId: string } | null>(null)

  // ── ANTEPRIMA DEL PREZZO DI SPEDIZIONE ──────────────────────────────────────────────────────
  // Il prezzo si vedeva solo dopo aver spedito. Ora per ogni ordine a schermo (e per quelli
  // selezionati) si mostra quanto verra' addebitato col contratto scelto in «Spedisci con».
  //
  // CHI SI SPEDISCE DA QUI, e chi no — una regola sola per l'anteprima e per «Spedisci selezionati»:
  // se fossero due, il totale mostrato conterebbe ordini che poi il pulsante salta.
  const ordiniPerId = useMemo(()=>new Map<string,any>(ordini.map((o:any)=>[o.id,o])), [ordini])
  // Fuori i gia' spediti DA NOI (hanno la spedizione collegata) e quelli UNITI a un altro ordine: un
  // ordine assorbito parte dentro il pacco del capofila, spedirlo da solo sarebbe un doppione.
  // Fuori anche gli ANNULLATI SUL NEGOZIO (annullati o rimborsati dopo che li avevamo importati): in
  // un invio di massa nessuno li guarda uno per uno, e partirebbe merce per un ordine che non c'e' piu'.
  // Dalla riga si possono ancora spedire, uno alla volta, se il negoziante sa quello che fa.
  const spedibileInMassa = (o:any) => !!o && o.stato !== 'unito' && o.stato !== 'annullato' && !(o.stato==='spedito' && o.spedizione_id)
  // Cosa manca per spedirlo da qui (si completa dal modulo «Crea spedizione» della riga).
  function motivoFuoriMassa(o:any): string | null {
    const d = o.destinatario || {}
    if (!d.nome || !d.indirizzo || !d.citta || !d.cap) return 'destinatario incompleto'
    // TELEFONO DEL DESTINATARIO: si dice PRIMA, non a meta' lotto.
    //
    // Diversi corrieri lo pretendono (senza, la creazione risponde 400) perche' serve al fattorino
    // per la consegna. Il negozio online quasi mai lo rende obbligatorio alla cassa, quindi
    // l'ordine arriva senza. Finora il controllo scattava solo a spedizione gia' avviata: il
    // cliente vedeva un errore secco su una riga a meta' di un lotto, senza capire cosa fare.
    // Qui si dice cosa manca e dove metterlo: il pulsante "Crea spedizione" della riga apre il
    // modulo gia' compilato, e li' il numero si aggiunge a mano.
    if (String(d.telefono||'').replace(/[^0-9]/g,'').length < 6) return 'manca il telefono del destinatario (il corriere lo richiede) — usa "Crea spedizione" sulla riga e aggiungilo'
    return null
  }
  // Tutto cio' che entra nel prezzo di un ordine. Da QUESTO oggetto nascono sia la riga
  // dell'anteprima sia destinazione e collo mandati alla creazione.
  function rigaPrezzoDi(o:any): RigaPrezzo {
    const d = o.destinatario || {}
    const rp = risolviPeso(o)   // peso+misure dal catalogo SKU/pacco (fallback grammi/1kg)
    const arts = Array.isArray(o.articoli)?o.articoli:[]
    return {
      id: o.id,
      cap: d.cap, citta: d.citta, provincia: d.provincia||'', paese: d.paese||'IT',
      collo: { length:rp.l, width:rp.w, height:rp.h, weight:rp.peso },
      contrassegno: codDaOrdine(o),
      haContenuto: !!arts.map((a:any)=>a.nome).join(', ').slice(0,100).trim(),
    }
  }
  const prezzabile = (o:any) => spedibileInMassa(o) && !motivoFuoriMassa(o)
  const selezionatiPrezzabili = Object.keys(sel).filter(id=>sel[id]).map(id=>ordiniPerId.get(id)).filter((o:any)=>o && prezzabile(o))
  // L'ordine di questo elenco e' l'ordine in cui i prezzi vengono chiesti: PRIMA la pagina a schermo
  // (e' quella che il cliente sta guardando), poi il resto dei selezionati.
  const daPrezzare: any[] = []
  const inAnteprima = new Set<string>()
  for (const o of pagina) { if (prezzabile(o)) { inAnteprima.add(o.id); daPrezzare.push(o) } }
  // Il TOTALE si fa sui primi PREZZI_SELEZIONATI selezionati, sempre gli stessi qualunque pagina sia
  // a schermo: un totale che cambia girando pagina, a selezione ferma, non e' un totale.
  const nelTotale = new Set<string>()
  for (const o of selezionatiPrezzabili.slice(0, PREZZI_SELEZIONATI)) {
    nelTotale.add(o.id)
    if (!inAnteprima.has(o.id)) { inAnteprima.add(o.id); daPrezzare.push(o) }
  }
  // Peso e misure arrivano da catalogo e pacchi, il mittente dal profilo: finche' non ci sono tutti
  // non si calcola, altrimenti uscirebbe un prezzo su 1 kg che un attimo dopo cambia da solo.
  const anteprimaPronta = !loading && articoliPronti && pacchiPronti && !!mittente
  const anteprima = useAnteprimaPrezzi(daPrezzare.map(rigaPrezzoDi), mittente, anteprimaPronta && !spedendo)

  // TOTALE dei selezionati col contratto scelto. E' la somma di cio' che e' a schermo: al clic i
  // prezzi vengono ricalcolati e, se sono cambiati, lo si chiede prima di spedire.
  let totaleSpedizioni = 0, selInCalcolo = 0, selSenzaPrezzo = 0
  for (const o of selezionatiPrezzabili) {
    if (!nelTotale.has(o.id)) continue
    const e = anteprima.leggi(rigaPrezzoDi(o))
    if (!e || e.stato === 'calcolo') { selInCalcolo++; continue }
    const t = e.stato === 'ok' ? scegliTariffa(e.tariffe, spedisciCon) : null
    if (t) totaleSpedizioni += t.prezzo; else selSenzaPrezzo++
  }
  totaleSpedizioni = Math.round(totaleSpedizioni*100)/100
  const selFuoriTotale = selezionatiPrezzabili.length - nelTotale.size

  // La voce «Costo spedizione» nella seconda riga dell'ordine. null = niente da mostrare.
  function costoSpedizione(o:any): any {
    if (!spedibileInMassa(o)) return null
    const motivo = motivoFuoriMassa(o)
    if (motivo) return <span title={motivo} style={{color:'#b45309'}}>{motivo.split(' — ')[0].split(' (')[0]}</span>
    if (!anteprimaPronta) return null   // il motivo, se c'e', e' scritto accanto al totale
    const rp = rigaPrezzoDi(o)
    const e = anteprima.leggi(rp)
    if (!e || e.stato === 'calcolo') return <span style={{color:'#9ca3af'}}>calcolo…</span>
    // Il motivo si mostra PER INTERO: nel messaggio sulla citta' la parte utile e' in fondo (i nomi
    // giusti per quel CAP), e un taglio la lascerebbe solo nel suggerimento al passaggio.
    if (e.stato === 'errore') return (
      <span style={{color:'#b45309'}}>
        {e.errore}
        {e.riprovabile ? <>{' '}<button onClick={()=>anteprima.riprova([o.id])} disabled={spedendo} style={{background:'none',border:'none',padding:0,color:'#ea580c',fontWeight:600,fontSize:'inherit',cursor:'pointer',textDecoration:'underline'}}>Riprova</button></> : null}
      </span>
    )
    const t = scegliTariffa(e.tariffe, spedisciCon)
    const elenco = e.tariffe.map(x=>x.nome+'  '+euro(x.prezzo)).join('\n')
    if (!t) return <span title={'Con il contratto scelto questo ordine non si può spedire.\nDisponibili per questo ordine:\n'+elenco} style={{color:'#b91c1c',fontWeight:600}}>non disponibile con il contratto scelto</span>
    const c = rp.collo
    return (
      <span title={'Calcolato su '+c.weight+' kg, '+c.length+'×'+c.width+'×'+c.height+' cm.\nÈ l\'importo che ti verrà addebitato alla creazione. Se il corriere rileva peso o misure diversi può seguire un conguaglio.'
        + (e.tariffe.length>1 ? '\n\nTutti i contratti per questo ordine:\n'+elenco : '')}>
        <span style={{fontWeight:700,color:'#1a1a1a'}}>{euro(t.prezzo)}</span>
        <span style={{color:'#6b7280',marginLeft:'6px'}}>{t.nome}</span>
        {risolviPeso(o).pesoStimato && <span style={{color:'#b45309',marginLeft:'6px'}}>· su 1 kg: peso non indicato</span>}
      </span>
    )
  }

  // CONTRASSEGNO dall'ordine del marketplace: eBay = paymentMethod CASH_ON_DELIVERY/PICKUP;
  // Woo = payment_method 'cod'; PrestaShop = modulo cashondelivery. Importo = totale ordine.
  function codDaOrdine(o:any): number {
    // Il contrassegno lo calcola ORA IL SERVER (/api/ordini/lista): qui il campo `raw` non arriva
    // mai, quindi il vecchio controllo su o.raw dava sempre 0 e l'importo andava messo a mano.
    if (o.cod != null) return Number(o.cod) || 0
    const r = o.raw || {}
    const pm = JSON.stringify([r.paymentSummary?.payments, r.payment_method, r.payment, r.module] || '')
    if (/cash_on_delivery|cash_on_pickup|"cod"|cashondelivery|contrassegno/i.test(pm)) return Number(o.totale || r.total || 0) || 0
    return 0
  }

  async function spedisciSelezionati(){
    if (spedendo) return   // guardia doppio-submit: un secondo click prima del re-render poteva partire due volte
    const ids = Object.keys(sel).filter(id=>sel[id])
    if (ids.length===0){ setMsg('Seleziona almeno un ordine'); return }
    setSpedendo(true)
    setCreditoKO(null)
    const errori: string[] = []
    try {
      const cli = await fetch('/api/cliente/dati').then(r=>r.json())
      if (!cli || cli.error) { setMsg('Errore: dati cliente non disponibili'); setSpedendo(false); return }
      const shipFrom = { name:cli.ragione_sociale||'', company:cli.ragione_sociale||'', street1:cli.so_indirizzo||'', street2:'', city:cli.so_citta||'', state:cli.so_provincia||'', postalCode:cli.so_cap||'', country:'IT', phone:cli.telefono||'', email:cli.email||'' }
      // SENZA INDIRIZZO DI PARTENZA NON SI SPEDISCE: si dice qui, una volta, con parole chiare.
      //
      // Il mittente si costruisce dalla sede operativa del cliente. Se manca, la creazione risponde
      // 400 "Provincia mittente obbligatoria" — un messaggio che non dice ne' di chi sia la
      // provincia ne' dove metterla, e per giunta lo dice una volta per ogni riga del lotto. Chi
      // arriva qui appena registrato (l'app dello store crea l'account da sola) si trova quel muro
      // senza nessuna indicazione.
      if (!shipFrom.street1 || !shipFrom.city || !shipFrom.postalCode || !shipFrom.state) {
        setMsg('Manca l\'indirizzo di partenza del tuo magazzino (via, città, CAP, provincia): è il mittente di ogni spedizione. Scrivi al tuo referente per farlo completare, poi riprova.')
        setSpedendo(false); return
      }
      if (String(shipFrom.phone||'').replace(/[^0-9]/g,'').length < 6) {
        setMsg('Manca il tuo numero di telefono: alcuni corrieri lo richiedono per il ritiro. Scrivi al tuo referente per farlo aggiungere, poi riprova.')
        setSpedendo(false); return
      }

      // ── PRE-PASSAGGIO: i prezzi di TUTTO il lotto, RICALCOLATI ORA, e il contratto di ogni ordine.
      //    Serve il TOTALE del lotto (per il pagamento unico) e a chiedere i prezzi una volta sola
      //    (il ciclo di creazione riusa queste scelte). Le righe scartate finiscono in `errori`.
      //
      //    Si ricalcola anche se i prezzi sono gia' a schermo: nel frattempo possono essere cambiati
      //    listino, contratti in pausa, dati dell'ordine — e la creazione addebita il MAGGIORE fra il
      //    suo calcolo e l'importo che riceve da qui, quindi un prezzo di qualche minuto fa
      //    resterebbe addebitato. I prezzi vengono dalla stessa funzione con cui la creazione
      //    addebita (lib/anteprima-prezzi.ts): prima passavano dal preventivo, che e' un altro calcolo.
      const daSpedire: { id:string; o:any; num:string; arts:any[]; rp:RigaPrezzo }[] = []
      for (const id of ids) {
        const o = ordiniPerId.get(id)
        // Salta i GIÀ SPEDITI DA NOI (hanno la spedizione Moove collegata) e gli UNITI. Un ordine
        // "spedito" solo sul marketplace (es. import eBay dei già-evasi: stato spedito ma senza
        // spedizione_id) va comunque spedibile — l'ha segnato spedito il venditore, non l'abbiamo
        // spedito noi.
        // Gli UNITI prima non erano distinti: selezionati (col filtro di evasione su «Tutti»)
        // sarebbero partiti come un pacco in piu', doppione del capofila. Ora si saltano, e lo si
        // dice: il pulsante conta N selezionati, e senza una riga di spiegazione ne partirebbero N-1.
        if (o && o.stato === 'unito') { errori.push((o.numero_ordine || id)+': unito a un altro ordine, parte col capofila'); continue }
        if (o && o.stato === 'annullato') { errori.push((o.numero_ordine || id)+': annullato sul negozio, non spedito'); continue }
        if (!spedibileInMassa(o)) continue
        const num = o.numero_ordine || id
        const motivo = motivoFuoriMassa(o)
        if (motivo) { errori.push(num+': '+motivo); continue }
        daSpedire.push({ id, o, num, arts: Array.isArray(o.articoli)?o.articoli:[], rp: rigaPrezzoDi(o) })
      }
      setMsg('Calcolo prezzi 0/'+daSpedire.length+'…')
      const mittentePrezzi = { cap: shipFrom.postalCode, provincia: shipFrom.state }
      // Il mittente e' appena stato RILETTO dal profilo: se e' diverso da quello con cui la pagina
      // si era aperta (sede cambiata o completata nel frattempo), da qui in poi vale questo. Senza,
      // i prezzi rimessi a schermo qui sotto verrebbero scartati (sono firmati col mittente nuovo,
      // la pagina li cercherebbe col vecchio) e l'avviso "indirizzo di partenza" resterebbe.
      if (!mittente || mittente.cap !== mittentePrezzi.cap || mittente.provincia !== mittentePrezzi.provincia) {
        setMittente(mittentePrezzi); setStatoMittente('ok')
      }
      let prezzi: Awaited<ReturnType<typeof chiediPrezzi>>
      try {
        prezzi = await chiediPrezzi(daSpedire.map(x=>x.rp), mittentePrezzi,
          (fatte, tutte)=>setMsg('Calcolo prezzi '+fatte+'/'+tutte+'…'))
      } catch (e: any) {
        // Un inciampo di rete non deve far saltare gli ordini: ci si ferma prima di toccarli.
        // Se invece il server ha RIFIUTATO (es. inserimento non consentito a questo cliente) si
        // mostra il suo motivo: "riprova tra poco" manderebbe il cliente a riprovare per niente.
        setMsg((eUnRifiuto(e) ? testoDelRifiuto(e) : 'Non sono riuscito a calcolare i prezzi: riprova tra poco.')+' Nessuna spedizione è stata creata.')
        setSpedendo(false); return
      }

      const preparati: any[] = []
      // Ordini il cui prezzo (o contratto) e' diverso da quello che il cliente aveva a schermo.
      const cambiati: string[] = []
      for (const x of daSpedire) {
        const esito = prezzi.get(x.id)
        if (!esito || !esito.tariffe.length) { errori.push(x.num+': '+(esito?.errore || 'nessuna tariffa')); continue }
        const t = scegliTariffa(esito.tariffe, spedisciCon)
        if (!t) { errori.push(x.num+': corriere scelto non disponibile per questa destinazione'); continue }

        const visto = anteprima.leggi(x.rp)
        const tVista = visto?.stato === 'ok' ? scegliTariffa(visto.tariffe, spedisciCon) : null
        if (tVista && (tVista.corriere_id !== t.corriere_id || Math.abs(tVista.prezzo - t.prezzo) >= 0.005)) {
          cambiati.push(x.num+': da '+euro(tVista.prezzo)+' a '+euro(t.prezzo)+(tVista.corriere_id !== t.corriere_id ? ' con '+t.nome : ''))
        }

        // Destinazione e collo vengono dallo STESSO oggetto usato per l'anteprima (rigaPrezzoDi): cio'
        // che e' stato prezzato e' cio' che si spedisce.
        const d = x.o.destinatario || {}
        const c = x.rp.collo
        const shipTo = { name:d.nome, company:'', street1:d.indirizzo, street2:'', city:x.rp.citta, state:x.rp.provincia, postalCode:x.rp.cap, country:x.rp.paese, phone:d.telefono||'', email:d.email||'' }
        preparati.push({ id:x.id, o:x.o, num:x.num, arts:x.arts, rp:{ peso:c.weight, l:c.length, w:c.width, h:c.height }, packages:[c], shipTo, t })
      }
      // I prezzi appena ricalcolati tornano a schermo (il confronto qui sopra e' gia' fatto, su
      // quelli che il cliente vedeva): se da qui si esce senza spedire — Annulla, credito
      // insufficiente — elenco e totale devono mostrare questi, non quelli di prima.
      anteprima.registra(daSpedire.map(x=>x.rp), mittentePrezzi, prezzi)

      // IL PREZZO E' CAMBIATO RISPETTO A QUELLO MOSTRATO: si chiede prima di addebitare.
      if (cambiati.length) {
        const prosegui = await dialog.confirm({
          title: cambiati.length === 1 ? 'Un prezzo è cambiato' : cambiati.length+' prezzi sono cambiati',
          message: (
            <div>
              Rispetto a quanto vedevi in elenco, il prezzo aggiornato è diverso:
              <ul style={{margin:'8px 0 0',paddingLeft:'18px'}}>
                {cambiati.slice(0,8).map((c,i)=><li key={i}>{c}</li>)}
                {cambiati.length>8 ? <li>… e altri {cambiati.length-8}</li> : null}
              </ul>
            </div>
          ),
          confirmText: 'Spedisci ai prezzi aggiornati',
        })
        if (!prosegui) { setMsg(''); setSpedendo(false); return }
      }

      // ── TOTALE del lotto e CANCELLO credito: come il server, il blocco vale SOLO per il credito a
      //    scalare (chi fattura a mensile va sotto zero ed è normale). Se non basta, chiedo UN
      //    pagamento per il mancante e riprovo il lotto — senza ricalcolare le tariffe.
      const totale = Math.round(preparati.reduce((s,p)=>s+(Number(p.t.prezzo)||0),0)*100)/100
      const credito = Number(cli?.credito||0)
      if (preparati.length && String(cli?.tipo_contratto||'')==='credito_scalare' && credito < totale) {
        lottoRef.current = { preparati, errori, shipFrom, cliId: cli.id }
        const mancante = Math.max(0, Math.ceil((totale-credito)*100)/100)
        setCreditoKO({ mancante, costo: totale, credito })
        setSpedendo(false)
        return
      }

      await eseguiCreazioneLotto(preparati, errori, shipFrom, cli.id)
      return
    } catch { errori.push('errore imprevisto') }
    setSel({})
    setMsg('Errori: '+errori.join(' | '))
    setSpedendo(false)
    carica()
  }

  // Crea le spedizioni del lotto già preparato (tariffe scelte nel pre-passaggio). Chiamato subito
  // se il credito basta, oppure dopo "Paga con la carta" (riusa lo stesso lotto, niente ricalcolo).
  async function eseguiCreazioneLotto(preparati: any[], errori: string[], shipFrom: any, cliId: string) {
    setSpedendo(true)
    let okCount = 0
    for (let i=0;i<preparati.length;i++){
      const { id, o, num, arts, rp, packages, shipTo, t } = preparati[i]
      setMsg('Spedizione '+num+'… ('+(i+1)+'/'+preparati.length+')')
      // Dogana (estero): il codice HS viene dal CATALOGO tramite lo SKU dell'ordine — lo stesso da cui
      // arrivano peso e misure. Prima merce che ce l'ha; se nessuna, il backend prova l'auto-ricerca TARIC.
      const esteroOrd = String(shipTo?.country || 'IT').toUpperCase() !== 'IT'
      const hscodeOrd = esteroOrd
        ? String((arts.map((a:any)=>skuToArt.get(String(a.sku||'').trim().toLowerCase())).find((x:any)=>x && x.codice_hs)?.codice_hs) || '').replace(/[^0-9]/g,'')
        : ''
      try {
        const creaRes = await fetch('/api/spedizioni/crea', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            // L'importo e' quello appena calcolato dal server con la funzione dell'addebito: la
            // creazione lo ricalcola comunque e addebita il maggiore dei due, che ora coincidono.
            // (Qui si mandavano anche sigla e codice contratto del preventivo e una quotazione: la
            // creazione non li legge, usa solo l'id del contratto.)
            clienteId:cliId, totalPrice:Number(t.prezzo).toFixed(2),
            _corriere_id: t.corriere_id,
            packages, colliDettaglio:[{lunghezza:String(rp.l),larghezza:String(rp.w),altezza:String(rp.h)}],
            // La nota dell'ordine e il numero COM'E' SCRITTO SUL NEGOZIO (cancelletto compreso):
            // stessi valori del percorso "Crea spedizione", che e' la stessa azione fatta su una riga
            // sola. Finora questo ramo mandava sempre notes:'' e toglieva il cancelletto.
            shipFrom, shipTo, notes:String(o.nota||''), insuranceValue:0, codValue: codDaOrdine(o),
            _daImport: true,   // città dal negozio: il server la normalizza al nome ufficiale (non la blocca) sui CAP con zona speciale
            rifOrdine: String(o.numero_ordine || o.ordine_esterno_id || num || ''),
            contenuto: arts.map((a:any)=>a.nome).join(', ').slice(0,100), tipoContenuto:'Merce destinata alla vendita', valoreMerce:String(o.totale||''), hscode: hscodeOrd
          })
        }).then(r=>r.json()).catch(()=>null)
        if (creaRes?.gia_spedito) {
          // Gia' spedito (la guardia server ha impedito il doppione): collego l'ordine alla spedizione
          // esistente e lo conto come riuscito, non come errore.
          await fetch('/api/ordini/segna-spedito', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ ordine_id:id, spedizione_id:creaRes.gia_spedito_id||null })
          }).catch(()=>{})
          okCount++; continue
        }
        if (!creaRes || creaRes.error) { errori.push(num+': '+(creaRes?.error||'errore creazione')); continue }
        // SCARICO DAL MAGAZZINO, in automatico. Qui non serve una tendina come nelle pagine di
        // spedizione a mano: l'ordine SA GIA' cosa contiene — SKU e quantita' arrivano da Shopify o
        // da Amazon — e lo SKU e' gia' quello con cui si agganciano peso e misure dal catalogo.
        // Chi non ha quello SKU a catalogo semplicemente non scarica niente: nessun danno.
        // Se fallisce non si blocca l'ordine: la spedizione c'e' e il magazzino si corregge.
        const righeMagazzino = arts
          .map((a:any)=>({ art: skuToArt.get(String(a.sku||'').trim().toLowerCase()), q: Math.max(1, parseInt(String(a.quantita))||1) }))
          .filter((r:any)=>r.art?.id)
          .map((r:any)=>({ articolo_id: r.art.id, quantita: r.q }))
        if (righeMagazzino.length && creaRes.spedizioneId) {
          await fetch('/api/spedizioni/articoli', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ spedizione_id: creaRes.spedizioneId, articoli: righeMagazzino })
          }).catch(()=>{})
        }

        await fetch('/api/ordini/segna-spedito', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ ordine_id:id, spedizione_id:creaRes.spedizioneId||null })
        }).catch(()=>{})
        okCount++
      } catch { errori.push(num+': errore imprevisto') }
    }
    lottoRef.current = null
    setSel({})
    setMsg('Spedite '+okCount+' spedizioni'+(errori.length?' — Errori: '+errori.join(' | '):''))
    setSpedendo(false)
    carica()
  }
  // UNISCE PIU' ORDINI IN UN PACCO SOLO, se vanno tutti alla stessa identica persona.
  // La verifica dell'identita' la fa il server, che e' l'unico posto da cui non si puo' scappare:
  // qui si chiede e basta. Se i dati non combaciano risponde di no e non unisce niente.
  const [unendo, setUnendo] = useState(false)
  async function unisciSelezionati(){
    const ids = Object.keys(sel).filter(id=>sel[id])
    if (ids.length < 2) { await dialog.alert({ title:'Servono almeno due ordini', message:'Seleziona due o piu\' ordini dello stesso destinatario.' }); return }
    const ok = await dialog.confirm({ title:'Unire gli ordini?', message:`Unire ${ids.length} ordini in un pacco solo? Si uniscono soltanto se i dati del destinatario sono identici. Gli ordini restano tutti in elenco: quelli assorbiti vengono segnati come uniti.`, confirmText:'Unisci' })
    if (!ok) return
    setUnendo(true)
    try {
      const r = await fetch('/api/ordini/unisci', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tipo:'ecommerce', ids }) })
      const d = await r.json()
      if (d.error) await dialog.alert({ title:'Non uniti', message: d.error })
      else { await dialog.alert({ title:'Ordini uniti', message:`${d.uniti} ordini uniti nell'ordine ${d.numero || ''}: ${d.articoli} articoli, € ${Number(d.totale).toFixed(2)}. Ora spedisci quello.` }); setSel({}); carica() }
    } catch { await dialog.alert({ title:'Errore', message:'Errore di connessione.' }) }
    setUnendo(false)
  }

  async function cancellaSelezionati(){
    const ids = Object.keys(sel).filter(id=>sel[id])
    if (ids.length===0){ setMsg('Seleziona almeno un ordine'); return }
    const ok = await dialog.confirm({ title:'Eliminare gli ordini?', message:`Elimini ${ids.length} ordini selezionati? L'operazione non è reversibile.`, confirmText:'Elimina', danger:true })
    if (!ok) return
    const res = await fetch('/api/ordini/elimina', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ids }) })
    const j = await res.json().catch(()=>({}))
    if (!res.ok || j.error) { setMsg('Errore eliminazione: '+(j.error||('HTTP '+res.status))); return }
    setSel({})
    setMsg((j.eliminati ?? ids.length)+' ordini eliminati')
    carica()
  }

  const Th = ({k, children, right}:{k?:string, children:any, right?:boolean}) => (
    <th style={{...th, cursor:k?'pointer':'default', textAlign:right?'right':'left'}} onClick={k?()=>ordina(k):undefined}>
      {children}{k && <span style={{marginLeft:'6px',color:'#c4c4c4'}}>{frecc(k)}</span>}
    </th>
  )

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px',gap:'12px',flexWrap:'wrap'}}>
        <h1 style={{fontSize:'24px',fontWeight:800,color:'#1a1a1a',margin:0}}>Ordini da {nome}</h1>
        <button onClick={sincronizza} disabled={sincronizzando} style={{background:ACCENT,color:'#fff',border:'none',borderRadius:'8px',padding:'10px 18px',fontSize:'13px',fontWeight:700,cursor:sincronizzando?'default':'pointer',opacity:sincronizzando?.6:1}}>
          {sincronizzando ? 'Sincronizzazione…' : '↻ Sincronizza ordini'}
        </button>
      </div>

      {msg && <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'8px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#ea580c'}}>{msg}</div>}

      {/* Carrello: credito insufficiente per l'intero lotto → pagamento unico con la carta */}
      {creditoKO && (
        <PagaConCarta
          mancante={creditoKO.mancante} costo={creditoKO.costo} credito={creditoKO.credito}
          onPagato={()=>{ setCreditoKO(null); const l=lottoRef.current; if(l) eseguiCreazioneLotto(l.preparati, l.errori, l.shipFrom, l.cliId) }}
        />
      )}

      <div style={{...card, marginBottom:'20px'}}>
        <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a',marginBottom:'16px'}}>▾ Filtri</div>
        <div style={{display:'flex',gap:'14px',flexWrap:'wrap',marginBottom:'14px'}}>
          <div><label style={lbl}>Data ordine</label>
            <DateRangePicker dal={fDa} al={fA} onChange={(d,a)=>{setFDa(d);setFA(a)}} />
          </div>
          <div><label style={lbl}>Data spedizione</label>
            {/* Il selettore, montato senza date, si imposta da solo su OGGI: sempre montato, questo filtro
                partirebbe attivo e nasconderebbe tutti gli ordini da spedire. Finche' non lo si sceglie
                resta il bottone "Qualsiasi"; la × lo toglie. */}
            {(fSpDa || fSpA)
              ? <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}>
                  <DateRangePicker dal={fSpDa} al={fSpA} onChange={(d,a)=>{setFSpDa(d);setFSpA(a)}} />
                  <button type="button" title="Togli il filtro per data di spedizione" onClick={()=>{setFSpDa('');setFSpA('')}} style={{border:'1px solid #d1d5db',background:'#fff',borderRadius:'6px',padding:'6px 10px',cursor:'pointer',color:'#6b7280',fontSize:'13px'}}>×</button>
                </span>
              : <button type="button" onClick={()=>{const n=new Date(); const g=n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0'); setFSpDa(g); setFSpA(g)}} style={{padding:'7px 12px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#6b7280',background:'#fff',cursor:'pointer',whiteSpace:'nowrap'}}>📅 Qualsiasi ▾</button>}
          </div>
          {piattaforma === 'ebay' && (<>
            <label title="Se i tuoi ordini eBay risultano già 'spediti' perché li segni tu appena arrivano, attivalo: entrano tra i «da spedire» e puoi creare l'etichetta." style={{display:'inline-flex',alignItems:'center',gap:'7px',fontSize:'12.5px',color:'#374151',cursor:'pointer',alignSelf:'flex-end',paddingBottom:'8px',maxWidth:'280px'}}>
              <input type="checkbox" checked={giaSpediti} onChange={e=>{const v=e.target.checked; setGiaSpediti(v); try{localStorage.setItem('ebay_giaSpediti', v?'1':'0')}catch{}}} />
              Prepara anche gli ordini già segnati <b>spediti</b> su eBay
            </label>
          </>)}
          <div style={field}><label style={lbl}>{nome} Store</label>
            <select value={fStoreValido} onChange={e=>setFStore(e.target.value)} style={inp}>
              <option value="">Tutti</option>
              {integrazioni.map(i=><option key={i.id} value={i.id}>{i.nome_negozio||i.identificativo||i.id}</option>)}
            </select>
          </div>
          <div style={field}><label style={lbl}>Stato pagamento</label>
            <select value={fStatoPag} onChange={e=>setFStatoPag(e.target.value)} style={inp}>
              <option value="">Tutti</option>
              {statiPag.map(s=><option key={s} value={s}>{labelPag(s)}</option>)}
            </select>
          </div>
          <div style={field}><label style={lbl}>Stato evasione</label>
            <select value={fStatoEv} onChange={e=>setFStatoEv(e.target.value)} style={inp}>
              <option value="">Tutti</option>
              <option value="da_spedire">Da spedire</option>
              <option value="spedito">Spedito</option>
              {(fStatoEv==='annullato' || ordini.some((o:any)=>o.stato==='annullato')) && <option value="annullato">Annullato sul negozio</option>}
            </select>
          </div>
          <div style={field}><label style={lbl}>Paese</label>
            <select value={fPaese} onChange={e=>setFPaese(e.target.value)} style={inp}>
              <option value="">Tutti</option>
              {paesi.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div style={{display:'flex',gap:'14px',flexWrap:'wrap',alignItems:'flex-end'}}>
          <div style={field}><label style={lbl}>N. Ordine</label><input value={fNum} onChange={e=>setFNum(e.target.value)} style={inp} placeholder="es. 1024"/></div>
          <div style={field}><label style={lbl}>SKU</label><input value={fSku} onChange={e=>setFSku(e.target.value)} style={inp}/></div>
          <div style={field}><label style={lbl}>Tags</label><input value={fTags} onChange={e=>setFTags(e.target.value)} style={inp}/></div>
          <label style={{...field, display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:'#1a1a1a',cursor:'pointer',paddingBottom:'9px'}}>
            <input type="checkbox" checked={fArch} onChange={e=>setFArch(e.target.checked)} style={{accentColor:ACCENT,width:'16px',height:'16px'}}/> Ordini Archiviati
          </label>
          <AzzeraFiltri prefix="ordini-cliente" style={{padding:'9px 14px',alignSelf:'flex-end'}} />
        </div>
      </div>

      <div style={{...card, padding:0, overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap',padding:'16px 18px',borderBottom:'1px solid #f0f0f0'}}>
          <span style={{fontSize:'13px',fontWeight:700,color:'#6b7280'}}>Spedisci con:</span>
          <select value={spedisciCon} onChange={e=>setSpedisciCon(e.target.value)} style={{...inp,width:'auto',minWidth:'260px'}}>
            <option value="auto">Assegnazione automatica (prezzo minore)</option>
            {/* Niente contratti "a un punto" (richiedono di scegliere il punto per ogni ordine). */}
            {corrieri.filter((c:any)=>!c.punto).map((c:any)=><option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <span style={{fontSize:'13px',fontWeight:700,color:'#6b7280'}}>Notifiche SMS</span>
          <select value={sms} onChange={e=>setSms(e.target.value)} style={{...inp,width:'auto',minWidth:'80px'}}>
            <option value="no">No</option><option value="si">Sì</option>
          </select>
          <div style={{flex:1}}/>
          {/* PERCHE' NON SI VEDONO I PREZZI: va detto in chiaro, non in un suggerimento al passaggio. */}
          {!loading && ordini.length>0 && statoMittente==='incompleto' && (
            <span style={{fontSize:'13px',color:'#b45309'}}>Per vedere i prezzi serve l'indirizzo di partenza del tuo magazzino (CAP e provincia): scrivi al tuo referente per farlo completare.</span>
          )}
          {!loading && ordini.length>0 && statoMittente==='fallito' && (
            <span style={{fontSize:'13px',color:'#b45309'}}>
              Non sono riuscito a leggere il tuo indirizzo di partenza, quindi i prezzi non sono calcolati.{' '}
              <button onClick={leggiMittente} style={{background:'none',border:'none',padding:0,color:'#ea580c',fontWeight:600,fontSize:'13px',cursor:'pointer',textDecoration:'underline'}}>Riprova</button>
            </span>
          )}
          {anteprimaPronta && selezionatiPrezzabili.length>0 && (
            <span style={{fontSize:'13px',color:'#6b7280'}}>
              Totale spedizione previsto <b style={{color:'#1a1a1a'}}>{euro(totaleSpedizioni)}</b>
              {selInCalcolo>0 ? <span style={{color:'#9ca3af'}}> (calcolo in corso…)</span> : null}
              {selSenzaPrezzo>0 ? <span style={{color:'#b45309'}}> · {selSenzaPrezzo} senza prezzo</span> : null}
              {selFuoriTotale>0 ? <span style={{color:'#9ca3af'}}> · sui primi {PREZZI_SELEZIONATI}: {selFuoriTotale} ordini non inclusi</span> : null}
            </span>
          )}
          <button onClick={spedisciSelezionati} disabled={spedendo} style={{opacity:spedendo?.6:1,background:'#f97316',color:'#fff',border:'none',borderRadius:'8px',padding:'9px 16px',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>Spedisci selezionati{nSel>0?' ('+nSel+')':''}</button>
          <button onClick={unisciSelezionati} disabled={unendo} style={{opacity:unendo?.6:1,background:'#fff7ed',color:'#ea580c',border:'1px solid #fed7aa',borderRadius:'8px',padding:'9px 16px',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>{unendo?'Unione…':'Unisci selezionati'}{nSel>1?' ('+nSel+')':''}</button>
          <button onClick={cancellaSelezionati} style={{background:'#dc2626',color:'#fff',border:'none',borderRadius:'8px',padding:'9px 16px',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>Cancella selezionati</button>
        </div>

        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'10px',padding:'14px 18px'}}>
          <div style={{fontSize:'13px',color:'#6b7280'}}>Mostra&nbsp;
            <select value={perPage} onChange={e=>setPerPage(Number(e.target.value))} style={{...inp,width:'auto',display:'inline-block',padding:'5px 8px'}}>
              {[10,25,50,100].map(n=><option key={n} value={n}>{n}</option>)}
            </select>&nbsp;elementi
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'16px',flexWrap:'wrap'}}>
            {/* Ordina per: le colonne "valore" (pagamento/totale) stanno nella seconda riga e non hanno
                più l'header cliccabile — qui non si perde il loro ordinamento. Pilota lo stesso stato `sort`. */}
            <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
              <span style={{fontSize:'13px',color:'#6b7280'}}>Ordina:</span>
              <select value={sort?.k||''} onChange={e=>{const k=e.target.value; setSort(k?{k,d:(sort?.d ?? 1) as 1|-1}:null)}} style={{...inp,width:'auto',display:'inline-block',padding:'6px 8px'}}>
                <option value="">Data (recente)</option>
                <option value="data">Data</option>
                <option value="numero_ordine">ID Ordine</option>
                <option value="destinatario">Destinatario</option>
                <option value="stato_pagamento">Stato pagamento</option>
                <option value="stato">Stato evasione</option>
                <option value="totale">Totale</option>
              </select>
              <button onClick={()=>setSort(s=> s ? {k:s.k,d:(s.d===1?-1:1) as 1|-1} : {k:'data',d:1})} title="Inverti ordine (crescente/decrescente)" style={{...inp,width:'auto',padding:'6px 10px',cursor:'pointer',fontWeight:700}}>{sort?(sort.d===1?'↑':'↓'):'↕'}</button>
            </div>
            <div style={{fontSize:'13px',color:'#6b7280'}}>Cerca:&nbsp;
              <input value={search} onChange={e=>setSearch(e.target.value)} style={{...inp,width:'auto',display:'inline-block',padding:'6px 10px'}}/>
              {quantiDoppi>0 && (
                <button onClick={()=>setSoloDoppi(v=>!v)}
                  title="Chi ha piu' di un ordine da spedire: uniscili in un pacco solo"
                  style={{marginLeft:'8px',background:soloDoppi?'#f97316':'#fff',color:soloDoppi?'#fff':'#c2410c',border:'1px solid '+(soloDoppi?'#f97316':'#fdba74'),borderRadius:'8px',padding:'6px 10px',fontSize:'12px',fontWeight:600,cursor:'pointer'}}>
                  👥 Stesso destinatario ({quantiDoppi})
                </button>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{padding:'40px',textAlign:'center',color:'#999'}}>Caricamento…</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:'#f9fafb',textAlign:'left'}}>
                <th style={{...th,width:'40px'}}><input type="checkbox" checked={tuttiSel} onChange={toggleTutti} style={{accentColor:ACCENT,width:'16px',height:'16px'}}/></th>
                <Th k="data">Data e Ora</Th>
                <Th k="numero_ordine">ID Ordine</Th>
                <Th k="destinatario">Destinatario</Th>
                <Th k="stato">Stato</Th>
                <Th right>Azioni</Th>
              </tr></thead>
              <tbody>
                {pagina.length===0 ? (
                  <tr><td colSpan={6} style={{...td,textAlign:'center',color:'#999',padding:'40px'}}>Nessun dato disponibile nella tabella</td></tr>
                ) : pagina.map((o:any)=>{
                  const d = o.destinatario||{}; const cp = coloriPag(o.stato_pagamento)
                  const isSel = !!sel[o.id]
                  const arts = Array.isArray(o.articoli)?o.articoli:[]
                  const cod = codDaOrdine(o)
                  const costoSped = costoSpedizione(o)
                  // Valori della SECONDA riga (articoli/importi/tags), come array così i divisori verticali
                  // saltano i campi assenti (tags/n.spedizione) senza lasciare linee a vuoto.
                  const secItems: { l:any; v:any }[] = [
                    ...(arts.length ? [{ l:'Articoli', v:(
                      <span style={{display:'inline-flex',alignItems:'center',gap:'12px',flexWrap:'wrap' as const}}>
                        {arts.map((a:any,i:number)=>(
                          <span key={i} style={{display:'inline-flex',alignItems:'center',gap:'6px'}}>
                            {a.immagine
                              ? <img src={a.immagine} alt="" style={{width:'26px',height:'26px',objectFit:'cover',borderRadius:'5px',border:'1px solid #e8e8e8',flexShrink:0}}/>
                              : <span style={{width:'26px',height:'26px',borderRadius:'5px',border:'1px solid #e8e8e8',background:'#f9fafb',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:'13px',flexShrink:0}}>📦</span>}
                            <span style={{color:'#1a1a1a',fontWeight:600}}>{a.quantita}× {a.nome}{a.sku?' · '+a.sku:''}</span>
                          </span>
                        ))}
                      </span>
                    )}] : []),
                    { l:'Pagamento', v:<span style={{fontSize:'11px',fontWeight:600,padding:'2px 8px',borderRadius:'999px',background:cp.bg,color:cp.fg}}>{labelPag(o.stato_pagamento)}</span> },
                    { l:'Totale', v:<span style={{fontWeight:700,color:'#1a1a1a'}}>{o.totale?Number(o.totale).toFixed(2):'—'} {o.valuta||''}{cod>0 && <span title="Ordine in contrassegno: l'importo verrà applicato alla spedizione" style={{marginLeft:'6px',fontSize:'10px',fontWeight:700,padding:'2px 6px',borderRadius:'999px',background:'#fff7ed',color:'#c2410c',border:'1px solid #fed7aa'}}>COD</span>}
                      {/* NON PAGATO E SENZA METODO DI PAGAMENTO: qui si perdono soldi in silenzio.
                          Il contrassegno lo riconosciamo dal metodo che il negozio ci dice (per un
                          ordine passato dalla cassa Shopify arriva "Cash on Delivery (COD)", e lo
                          leggiamo). Ma un ordine creato a mano nel pannello del negozio, o pagato
                          "piu' tardi" senza scegliere un metodo, arriva SENZA nessun metodo: noi non
                          possiamo sapere se e' in contrassegno, e mettere l'importo a indovinare
                          sarebbe peggio (si chiederebbero soldi al destinatario di un ordine gia'
                          pagato). Prima non si diceva niente e l'ordine partiva come prepagato: chi
                          spediva scopriva di non aver incassato a consegna avvenuta. */}
                      {cod===0 && ['pending','unpaid','partially_paid','authorized'].includes(String(o.stato_pagamento||'')) && <span title={"Il negozio non indica il metodo di pagamento di quest'ordine, e risulta non pagato. Se e' in contrassegno l'importo NON viene applicato da solo: apri \u00ab Crea spedizione \u00bb su questa riga e scrivilo a mano, altrimenti il pacco parte come prepagato e non incassi niente alla consegna."} style={{marginLeft:'6px',fontSize:'10px',fontWeight:700,padding:'2px 6px',borderRadius:'999px',background:'#fffbeb',color:'#b45309',border:'1px solid #fde68a',cursor:'help'}}>contrassegno? da verificare</span>}</span> },
                    // Quanto costera' spedirlo, PRIMA di spedire. "Totale" qui sopra e' il valore della merce.
                    ...(costoSped != null ? [{ l:'Costo spedizione', v:costoSped }] : []),
                    ...(getTags(o) ? [{ l:'Tags', v:<span style={{color:'#6b7280'}}>{getTags(o)}</span> }] : []),
                    ...(o.data_spedizione ? [{ l:'Spedito il', v:<span style={{color:'#6b7280'}}>{fmtData(o.data_spedizione)}</span> }] : []),
                    ...(o.spedizione_id ? [{ l:'N. Spedizione', v:<span style={{color:'#6b7280'}}>{String(o.spedizione_id).slice(0,8)}</span> }] : []),
                  ]
                  return (
                  <Fragment key={o.id}>
                  <tr style={{background:isSel?'#fff7ed':'#fff'}}>
                    <td style={{...td,borderTop:'none',padding:'9px 12px 3px'}}><input type="checkbox" checked={isSel} onChange={()=>toggleUno(o.id)} style={{accentColor:ACCENT,width:'16px',height:'16px'}}/></td>
                    <td style={{...td,borderTop:'none',padding:'9px 12px 3px',color:'#6b7280',whiteSpace:'nowrap'}}>{fmtData(getData(o))}</td>
                    <td style={{...td,borderTop:'none',padding:'9px 12px 3px',fontWeight:600}}>{o.numero_ordine}</td>
                    <td style={{...td,borderTop:'none',padding:'9px 12px 3px'}}>{d.nome||'—'}{(()=>{ const g=gruppoDi(o); if(!g) return null; const tutti=g.every(id=>sel[id]); return (
                      <button onClick={()=>setSel(prev=>{ const n={...prev}; g.forEach(id=>{ if(tutti) delete n[id]; else n[id]=true }); return n })}
                        title={tutti?'Togli la selezione':'Seleziona tutti i suoi ordini, poi premi Unisci'}
                        style={{marginLeft:'6px',background:'#fff7ed',color:'#c2410c',border:'1px solid #fdba74',borderRadius:'999px',padding:'1px 8px',fontSize:'11px',fontWeight:700,cursor:'pointer'}}>
                        {g.length} ordini{tutti?' ✓':''}
                      </button>) })()}<div style={{fontSize:'11px',color:'#999'}}>{d.citta}{d.provincia?' ('+d.provincia+')':''} {d.paese||''}</div></td>
                    <td style={{...td,borderTop:'none',padding:'9px 12px 3px'}}><span title={o.stato==='annullato'?'Sul negozio questo ordine non è più valido (annullato o rimborsato) dopo che era stato importato':undefined} style={{fontSize:'11px',fontWeight:600,padding:'3px 9px',borderRadius:'999px',whiteSpace:'nowrap',background:o.stato==='spedito'?'#dcfce7':o.stato==='annullato'?'#f3f4f6':'#fef3c7',color:o.stato==='spedito'?'#166534':o.stato==='annullato'?'#4b5563':'#92400e'}}>{o.stato==='spedito'?'Spedito':o.stato==='annullato'?'Annullato sul negozio':'Da spedire'}</span></td>
                    <td style={{...td,borderTop:'none',padding:'9px 12px 3px',textAlign:'right',whiteSpace:'nowrap'}}>
                      {/* "Spedito" solo se lo abbiamo spedito NOI (ha la spedizione Moove): allora niente
                          ri-spedizione. Se è "spedito" solo sul marketplace (import eBay dei già-evasi,
                          senza spedizione_id) mostro comunque "Crea spedizione" → si fa l'etichetta e nel
                          form si può modificare l'ordine. */}
                      {(o.stato!=='spedito' || !o.spedizione_id)
                        ? <button onClick={()=>creaSpedizione(o)} title={o.stato==='spedito'?'Già segnato spedito sul marketplace: crea comunque l\'etichetta e modifica i dati nel form':o.stato==='annullato'?'Attenzione: sul negozio questo ordine risulta annullato o rimborsato':undefined} style={{background:'#fff7ed',color:'#ea580c',border:'1px solid #fed7aa',borderRadius:'6px',padding:'6px 12px',fontSize:'12px',fontWeight:600,cursor:'pointer'}}>Crea spedizione</button>
                        : <span style={{display:'inline-flex',flexDirection:'column',alignItems:'flex-end',gap:'3px'}}>
                            <span style={{color:'#166534',fontSize:'12px',fontWeight:600}}>✓ Spedito</span>
                            {/* Write-back allo store fallito (es. chiavi negozio in sola lettura): il tracking
                                NON e' arrivato al negozio ne' al compratore. Prima "✓ Spedito" lo nascondeva. */}
                            {o.fulfillment_stato==='errore' && <span title={o.fulfillment_errore || 'Il tracking non e\' stato inviato al negozio: verifica che le chiavi API del negozio siano in lettura E SCRITTURA (read-write).'} style={{color:'#b45309',fontSize:'10px',fontWeight:700,padding:'2px 6px',borderRadius:'999px',background:'#fffbeb',border:'1px solid #fde68a',cursor:'help',whiteSpace:'nowrap'}}>⚠ Store non aggiornato</span>}
                            {/* ASPETTARE NON E' UN GUASTO, e non deve avere il colore del guasto.
                                'attesa' = l'ordine e' trattenuto sul negozio (blocco antifrode,
                                richiesta del compratore): tocca al negoziante sbloccarlo, noi
                                riproviamo da soli. 'esterno' = la merce sta in un magazzino gestito
                                da un servizio di evasione del negozio, che registra lui l'evasione.
                                Con l'arancione dell'errore il negoziante andava a cercare un guasto
                                nostro che non c'e'. */}
                            {(o.fulfillment_stato==='attesa' || o.fulfillment_stato==='esterno') && <span title={o.fulfillment_errore || ''} style={{color:'#1d4ed8',fontSize:'10px',fontWeight:700,padding:'2px 6px',borderRadius:'999px',background:'#eff6ff',border:'1px solid #bfdbfe',cursor:'help',whiteSpace:'nowrap'}}>{o.fulfillment_stato==='attesa' ? '⏳ In attesa dal negozio' : 'ℹ Evasione del magazzino esterno'}</span>}
                          </span>}
                    </td>
                  </tr>
                  <tr style={{background:isSel?'#fff7ed':'#fff',borderBottom:'2px solid #cbd5e1'}}>
                    <td colSpan={6} style={{padding:'4px 12px 10px 44px',borderTop:'1px solid #f1f2f4'}}>
                      <div style={{display:'flex',flexWrap:'wrap' as const,alignItems:'center',rowGap:'4px',fontSize:'12px',color:'#374151'}}>
                        {secItems.map((it,i)=>(
                          <span key={i} style={{display:'inline-flex',alignItems:'baseline',gap:'4px',padding:'0 14px',borderLeft:i>0?'1px solid #e5e7eb':'none'}}>
                            <span style={secLbl}>{it.l}</span>{it.v}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                  </Fragment>)
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'10px',padding:'14px 18px',borderTop:'1px solid #f0f0f0'}}>
          <div style={{fontSize:'13px',color:'#6b7280'}}>Risultati da {totale===0?0:start+1} a {Math.min(start+perPage,totale)} di {totale} elementi</div>
          <div style={{display:'flex',gap:'8px'}}>
            <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page<=1} style={{background:'#fff',border:'1px solid '+BORDER,borderRadius:'6px',padding:'7px 14px',fontSize:'13px',cursor:page<=1?'default':'pointer',opacity:page<=1?.5:1}}>Precedente</button>
            <span style={{fontSize:'13px',color:'#6b7280',padding:'7px 4px'}}>{page} / {nPagine}</span>
            <button onClick={()=>setPage(p=>Math.min(nPagine,p+1))} disabled={page>=nPagine} style={{background:'#fff',border:'1px solid '+BORDER,borderRadius:'6px',padding:'7px 14px',fontSize:'13px',cursor:page>=nPagine?'default':'pointer',opacity:page>=nPagine?.5:1}}>Successivo</button>
          </div>
        </div>
      </div>
    </div>
  )
}
