'use client'
import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useDialog } from '@/app/components/DialogProvider'
import SelettoreArticoli, { type RigaArticolo, type ArticoloCat } from '@/app/components/SelettoreArticoli'
import PagaConCarta from '@/app/cliente/PagaConCarta'
import { PAESI_MONDO } from '@/lib/paesi-elenco'

// Sigla di ripiego quando il contratto non ha un marchio riconosciuto. Attenzione: qui arriva
// il TIPO del contratto, cioe' il provider tecnico — stamparlo tale e quale lo mostrerebbe
// all'utente ('EASYPARCEL'). Ogni provider ha la sua sigla neutra.
const codiceProv = (t?:string) => t==='spediamopro'?'SP':t==='spedisci'?'SO':t==='easyparcel'?'V':(t||'').toUpperCase()
interface Tariffa { carrierCode:string; contractCode:string; total_price:string; zona:string; peso_fatturato:string; peso_reale:number; peso_volume:string; prezzo_spedizione?:string; weight_price?:string; costo_sponda?:string; costo_fuel?:string; fuel_pct?:number; costo_contrassegno?:string; costo_assicurazione?:string; accessori_disponibili?:{nome:string;prezzo:number;perc:number}[]; limiti_collo?:string; _corriere_id?:string; _corriere_tipo?:string; corriere_nome?:string }
interface Collo { lunghezza:string; larghezza:string; altezza:string; peso?:string }

const inp = {width:'100%',padding:'8px 11px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}
const lbl = {fontSize:'11.5px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px',whiteSpace:'nowrap' as const}
const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden' as const}
const cardH = {padding:'12px 16px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700' as const,color:'#1a1a1a'}
const cardB = {padding:'16px'}

const CARRIER_LABELS: Record<string,{nome:string,colore:string}> = {
  sda:{nome:'SDA Express',colore:'#e31837'},
  gls:{nome:'GLS',colore:'#f97316'},
  brt:{nome:'BRT',colore:'#e2001a'},
  poste:{nome:'Poste Italiane',colore:'#ffcc00'},
  dhl:{nome:'DHL Express',colore:'#ffcc00'},
}


function iconaCorriere(nome:string): string | null {
  const n = (nome||'').toUpperCase()
  const regole: [string,string][] = [
    ['DELIVERY BUSINESS','poste_delivery_business'],['POSTE','poste_delivery_business'],
    ['SDA','sda'], ['GLS','gls'], ['BRT','brt'], ['SPEDISCI','spedisci'], ['TNT','tnt'],
    ['DHL ECONNECT','dhl_econnect'], ['ECONNECT','dhl_econnect'], ['DHL','dhl'],
    ['FEDEX','fedex'], ['UPS','ups'], ['HERMES','hermes'], ['NEXIVE','nexive'],
    ['LICCARDI','liccardi'], ['SAILPOST','sailpost'], ['BDM','bdm'], ['NSSA','nssa'],
    ['HR PARCEL','hrp'], ['HRP','hrp'], ['PALLETWAYS','palletways'],
    ['CORREOS EXPRESS','correos_express'], ['CORREOS','correos'],
    ['INPOST','inpost'], ['SPRING','spring'], ['PAACK','paack'],['SPEEDY','speedy'],
    ['AMAZON','amazon_shipping'], ['CTT','ctt_express'], ['AIPACK','aipack'], ['ALT','alt'],
    ['GTECH','gtechgroup'], ['SPEDIAMOPRO','spedisci'], ['SPEDIAMO','spedisci'], ['SPEDISCI','spedisci'],
  ]
  for (const [chiave,file] of regole) { if (n.includes(chiave)) return `/corrieri/${file}.png` }
  return null
}

// TENDINA DEI SUGGERIMENTI DISEGNATA FUORI DALLA CARD.
// Le card di questa pagina hanno overflow:hidden, quindi una tendina di suggerimenti disegnata
// dentro con position:absolute veniva TAGLIATA al bordo della card: si vedeva solo la prima riga.
// La si disegna in fondo alla pagina (createPortal su document.body) con position:fixed, piazzata
// sul campo con getBoundingClientRect e ricalcolata su scroll/resize, cosi' nessun contenitore la
// puo' piu' ritagliare. Apre verso l'alto se sotto non c'e' spazio. Modello: SelectCercabile.tsx.
function TendinaPortata({ anchor, aperta, maxHeight = 240, children }: { anchor: { current: HTMLInputElement | null }; aperta: boolean; maxHeight?: number; children: React.ReactNode }) {
  const [pos, setPos] = useState<{top:number;left:number;width:number}|null>(null)
  const [montato, setMontato] = useState(false)
  useEffect(() => { setMontato(true) }, [])
  useLayoutEffect(() => {
    if (!aperta) { setPos(null); return }
    const misura = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (!r) return
      const spazioSotto = window.innerHeight - r.bottom
      const versoAlto = spazioSotto < maxHeight + 20 && r.top > spazioSotto
      setPos({ top: versoAlto ? Math.max(8, r.top - maxHeight - 4) : r.bottom + 4, left: r.left, width: r.width })
    }
    misura()
    window.addEventListener('scroll', misura, true)
    window.addEventListener('resize', misura)
    return () => { window.removeEventListener('scroll', misura, true); window.removeEventListener('resize', misura) }
  }, [aperta, maxHeight, anchor])
  if (!aperta || !montato || !pos) return null
  return createPortal(
    <div style={{position:'fixed',zIndex:1000000,top:pos.top,left:pos.left,width:pos.width,background:'#fff',border:'1px solid #d1d5db',borderRadius:'6px',maxHeight:maxHeight+'px',overflowY:'auto',boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}>
      {children}
    </div>, document.body)
}

export default function NuovaSpedizioneCliente() {
  const dialog = useDialog()
  const router = useRouter()
  const [clienteData, setClienteData] = useState<any>(null)
  // Ancore per le tendine dei suggerimenti: servono a piazzare il pannello portato sul campo giusto.
  const refMittNome = useRef<HTMLInputElement>(null)
  const refMittCitta = useRef<HTMLInputElement>(null)
  const refDestNome = useRef<HTMLInputElement>(null)
  const refDestCitta = useRef<HTMLInputElement>(null)
  const [mitt, setMitt] = useState({nome:'',indirizzo:'',citta:'',provincia:'',cap:'',email:'',telefono:''})
  const [suggMitt, setSuggMitt] = useState<any[]>([])   // rubrica mittenti
  const [showSuggMitt, setShowSuggMitt] = useState(false)
  const [suggDest, setSuggDest] = useState<any[]>([])   // rubrica destinatari
  const [showSuggDest, setShowSuggDest] = useState(false)
  const [dest, setDest] = useState({nome:'',indirizzo:'',citta:'',provincia:'',cap:'',paese:'IT',email:'',telefono:'',note:''})
  // Avvertenza (non blocca): destinatario che rifiuta i contrassegni, storico rete per telefono.
  const [codAlert, setCodAlert] = useState<{totCod:number;resi:number;nonConsegnato:number;giacenza:number;rifiutati:number}|null>(null)
  useEffect(()=>{
    const tel = (dest.telefono||'').replace(/[^0-9]/g,'')
    if (tel.length < 9) { setCodAlert(null); return }
    const t = setTimeout(async()=>{
      try{
        const r = await fetch('/api/spedizioni/check-destinatario?telefono='+encodeURIComponent(dest.telefono))
        const j = await r.json()
        setCodAlert(j && j.mostra ? j : null)
      }catch{ setCodAlert(null) }
    }, 500)
    return ()=>clearTimeout(t)
  }, [dest.telefono])
  const [suggComuni, setSuggComuni] = useState<any[]>([])
  const [showSugg, setShowSugg] = useState(false)
  const [suggComuniMitt, setSuggComuniMitt] = useState<any[]>([])   // autocomplete città→CAP del MITTENTE
  const [showComuneMitt, setShowComuneMitt] = useState(false)
  const [richiediRitiro, setRichiediRitiro] = useState(false)
  const [ritiroData, setRitiroData] = useState(() => { const d = new Date(); while ([0,6].includes(d.getDay())) d.setDate(d.getDate()+1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })   // weekend -> primo giorno lavorativo (data LOCALE, non UTC)
  const [ritiroOrario, setRitiroOrario] = useState('mattina')
  const [numColli, setNumColli] = useState(1)
  const [colli, setColli] = useState<Collo[]>([{lunghezza:'',larghezza:'',altezza:''}])
  const [peso, setPeso] = useState('1')
  const [pacchiSalvati, setPacchiSalvati] = useState<any[]>([])
  useEffect(() => { fetch('/api/cliente/pacchi').then(r=>r.json()).then(d=>setPacchiSalvati(Array.isArray(d)?d:[])).catch(()=>{}) }, [])
  // CATALOGO: serve a dire cosa c'e' nel pacco e a scaricare il magazzino. Se il cliente non ha
  // articoli il selettore non compare nemmeno, quindi per chi non lo usa la pagina resta identica.
  const [catalogo, setCatalogo] = useState<ArticoloCat[]>([])
  const [articoliScelti, setArticoliScelti] = useState<RigaArticolo[]>([])
  useEffect(() => { fetch('/api/cliente/articoli').then(r=>r.json()).then(d=>setCatalogo(Array.isArray(d)?d:[])).catch(()=>{}) }, [])
  // Precompila il codice HS dalla merce del catalogo (colonna codice_hs), senza sovrascrivere quello
  // digitato a mano: la dogana usa una voce aggregata, quindi basta il primo articolo che ce l'ha.
  useEffect(() => {
    const art = articoliScelti.map(r => catalogo.find(a => a.id === r.id)).find(a => a && (a as any).codice_hs)
    const code = art ? String((art as any).codice_hs).replace(/[^0-9]/g, '') : ''
    if (code) setHscode(prev => prev ? prev : code)
  }, [articoliScelti, catalogo])
  function applicaPacco(p:any) { setPeso(String(p.peso||'')); setNumColli(1); setColli([{ lunghezza:String(p.lunghezza||''), larghezza:String(p.larghezza||''), altezza:String(p.altezza||'') }]); setTariffe([]); setSelected(null) }
  const [contenuto, setContenuto] = useState('')
  const [tipoContenuto, setTipoContenuto] = useState('Merce destinata alla vendita')
  const [rifOrdine, setRifOrdine] = useState('')   // → "Rif." in etichetta (order id da import/integrazione o digitato)
  const [valoreMerce, setValoreMerce] = useState('')
  // Codice HS/TARIC per la dogana (solo estero): senza, i corrieri internazionali DVA rifiutano l'ordine
  // e prima non c'era un campo per inserirlo (si sperava solo nell'auto-ricerca dalla descrizione).
  const [hscode, setHscode] = useState('')
  const [contrassegno, setContrassegno] = useState('0')
  const [assicurazione, setAssicurazione] = useState('0')
  const [tariffe, setTariffe] = useState<Tariffa[]>([])
  const [selected, setSelected] = useState<Tariffa|null>(null)
  // Extra / servizi accessori scelti sul corriere selezionato (li paga il cliente)
  const [extraNomi, setExtraNomi] = useState<string[]>([])
  // Modalità d'incasso del contrassegno. Le opzioni dipendono dal CANALE: GLS diretto ha Contante + Assegno
  // bancario (AB) + Assegno circolare (AC) — codici ServiziAccessori 01/02/03; DVA solo Contante/Assegno
  // (la sua API ha 2 valori); gli altri solo Contante. Il valore è il codice modalità. Si azzera al cambio.
  const [incassoModalita, setIncassoModalita] = useState<string>('C')
  useEffect(() => { setExtraNomi([]); setIncassoModalita('C') }, [selected?._corriere_id])
  const codModalitaOpts: [string,string][] = selected?._corriere_tipo === 'gls'
    ? [['C','CONTANTE'],['AB','ASSEGNO BANCARIO'],['AC','ASSEGNO CIRCOLARE']]
    : selected?._corriere_tipo === 'V' ? [['C','CONTANTE'],['A','ASSEGNO']]
    : [['C','CONTANTE']]
  const accDisponibili = (selected?.accessori_disponibili || [])
  // Importo accessorio = prezzo fisso + % del PREZZO SPEDIZIONE (nolo+fuel+sponda), come dice il campo
  // "+% del valore della spedizione" a listino. NON del valore merce: era quasi sempre 0 e la % spariva.
  const extraScelti = accDisponibili
    .filter(a => extraNomi.includes(a.nome))
    .map(a => ({ nome: a.nome, importo: Math.round((Number(a.prezzo||0) + (Number(a.perc||0)/100)*(Number(selected?.prezzo_spedizione)||0))*100)/100 }))
  const extraTot = extraScelti.reduce((s,e)=>s+e.importo, 0)
  const totaleConExtra = selected ? (Number(selected.total_price||0) + extraTot) : 0
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [errore, setErrore] = useState('')
  const [vista, setVista] = useState<'dati'|'contratto'>('dati')
  const [successo, setSuccesso] = useState<{numero:string,id:string,ritiro?:{ok?:boolean,pickupId?:string,errore?:string}}|null>(null)
  // Credito insufficiente: tiene l'esatto mancante per offrire "Paga con la carta" e riprovare.
  const [creditoKO, setCreditoKO] = useState<{mancante:number,costo:number,credito:number}|null>(null)
  const [daOrdine, setDaOrdine] = useState('')
  const [corrierePref, setCorrierePref] = useState('')

  // Precompilazione da ordine ecommerce / import CSV (query param ?da_ordine=&nome=&...)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (!q.get('da_ordine') && !q.get('nome')) return
    setDaOrdine(q.get('da_ordine') || '')
    setCorrierePref(q.get('corriere') || '')
    setDest(d => ({...d,
      nome: q.get('nome') || d.nome,
      indirizzo: q.get('indirizzo') || d.indirizzo,
      citta: q.get('citta') || d.citta,
      provincia: q.get('provincia') || d.provincia,
      cap: q.get('cap') || d.cap,
      paese: q.get('paese') || d.paese,
      email: q.get('email') || d.email,
      telefono: q.get('telefono') || d.telefono,
      note: q.get('note') || d.note,
    }))
    // Dati collo / pagamento dell'ordine
    if (q.get('peso')) setPeso(q.get('peso') as string)
    if (q.get('colli')) { const n = Math.max(1, parseInt(q.get('colli') as string) || 1); aggiornaNumColli(n) }
    // Misure del 1° collo (da catalogo SKU / pacco dell'ordine importato)
    if (q.get('l') || q.get('w') || q.get('h')) {
      setColli(prev => { const n = prev.length ? [...prev] : [{ lunghezza: '', larghezza: '', altezza: '' }]
        n[0] = { lunghezza: q.get('l') || n[0].lunghezza, larghezza: q.get('w') || n[0].larghezza, altezza: q.get('h') || n[0].altezza }
        return n })
    }
    if (q.get('contenuto')) setContenuto(q.get('contenuto') as string)
    if (q.get('rif')) setRifOrdine(q.get('rif') as string)
    if (q.get('valore')) setValoreMerce(q.get('valore') as string)
    // Contrassegno: se l'ordine e' in contrassegno (pagamento in attesa) arriva gia' valorizzato
    if (q.get('contrassegno')) setContrassegno(q.get('contrassegno') as string)
  }, [])
  useEffect(() => {
    setTariffe([]); setSelected(null); setVista('dati')
  }, [dest, mitt, peso, colli, numColli, contrassegno, assicurazione])

  // Se il cliente modifica un dato che cambia il prezzo mentre la lista e' visibile,
  // azzera le tariffe: dovra' ricliccare "Seleziona Corriere" per vedere il prezzo aggiornato.
  const primoRender = useRef(true)
  useEffect(() => {
    if (primoRender.current) { primoRender.current = false; return }
    if (tariffe.length) { setTariffe([]); setSelected(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peso, numColli, colli, contrassegno, assicurazione])

  useEffect(() => {
    fetch('/api/cliente/dati').then(r=>r.json()).then(c => {
      if (!c || c.error) return
      setClienteData(c)
      setMitt({nome:c.ragione_sociale||'',indirizzo:c.so_indirizzo||'',citta:c.so_citta||'',provincia:c.so_provincia||'',cap:c.so_cap||'',email:c.email||'',telefono:c.telefono||''})
    })
  }, [])

  function aggiornaNumColli(n: number) {
    const num = Math.max(1, n)
    setNumColli(num)
    setColli(prev => {
      const next = [...prev]
      while (next.length < num) next.push({lunghezza:'',larghezza:'',altezza:'',peso:''})
      return next.slice(0, num)
    })
    setTariffe([]); setSelected(null)
  }

  function aggiornaCollo(i: number, field: keyof Collo, val: string) {
    setColli(prev => { const next=[...prev]; next[i]={...next[i],[field]:val}; return next })
    setTariffe([]); setSelected(null)
  }

  // ESTERO MULTICOLLO: il peso va indicato COLLO PER COLLO (i corrieri internazionali — es. UPS —
  // lo pretendono per ogni collo, non un totale). Solo estero (non Italia) e piu' di un collo.
  const esteroMulti = dest.paese !== 'IT' && colli.length > 1
  const pesoTotaleColli = colli.reduce((s,c)=>s+(+(c.peso||0)||0), 0)

  function buildPackages() {
    if (esteroMulti) {
      return colli.map(c => ({
        length: +c.lunghezza||20,
        width: +c.larghezza||15,
        height: +c.altezza||10,
        weight: +(c.peso||0)||0,
      }))
    }
    const n = Math.max(1, colli.length)
    const pesoPerCollo = (+peso || 0) / n
    return colli.map(c => ({
      length: +c.lunghezza||20,
      width: +c.larghezza||15,
      height: +c.altezza||10,
      weight: pesoPerCollo
    }))
  }

  async function calcolaTariffe() {
    if (!dest.nome||!dest.indirizzo||!dest.citta||!dest.cap||!dest.telefono) {
      setErrore('Compila tutti i dati del destinatario (incluso il telefono)'); return
    }
    if (dest.paese==='IT' && !dest.provincia) {
      setErrore('La provincia è obbligatoria per le spedizioni in Italia'); return
    }
    if (esteroMulti && colli.some(c => !(+(c.peso||0)>0))) {
      setErrore('Spedizione estera multicollo: indica il peso (kg) di OGNI collo'); return
    }
    setErrore(''); setLoading(true); setTariffe([]); setSelected(null)
    const res = await fetch('/api/spedizioni/tariffe', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        clienteId: clienteData?.id,
        packages: buildPackages(),
        shipFrom:{name:mitt.nome,company:mitt.nome,street1:mitt.indirizzo,street2:'',city:mitt.citta,state:mitt.provincia,postalCode:mitt.cap,country:'IT',phone:mitt.telefono,email:mitt.email},
        shipTo:{name:dest.nome,company:'',street1:dest.indirizzo,street2:'',city:dest.citta,state:dest.provincia,postalCode:dest.cap,country:dest.paese,phone:dest.telefono,email:dest.email},
        notes:dest.note, insuranceValue:+assicurazione, codValue:+contrassegno
      })
    })
    const data = await res.json()
    setLoading(false)
    if (data.error) { setErrore(data.error); return }
    if (!Array.isArray(data)||!data.length) { setErrore('Nessuna tariffa disponibile'); return }
    setTariffe(data)
    if (Array.isArray(data) && data.length) {
      const pref = corrierePref ? data.find((t:any)=>t.corriere_id===corrierePref || t._corriere_id===corrierePref) : null
      setSelected(pref || data[0])
    }
    setVista('contratto')
  }

  async function scaricaEtichetta(id:string) {
    try {
      const res = await fetch('/api/spedizioni/etichetta?id='+id)
      if (!res.ok) { await dialog.alert({ title: 'Errore', message: 'Etichetta non generata.' }); return }
      const blob = await res.blob()
      const ct = res.headers.get('content-type')||''
      const ext = ct.includes('gif')?'gif':ct.includes('png')?'png':'pdf'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'etichetta_'+id+'.'+ext
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch { await dialog.alert({ title: 'Errore', message: 'Errore durante il download dell\'etichetta.' }) }
  }
  // Reset TOTALE del form dopo la creazione (come un refresh): destinatario e dati spedizione vuoti.
  // Il mittente torna ai dati del cliente (il cliente spedisce sempre da sé). Il banner successo resta.
  function resetForm() {
    const c = clienteData
    if (c) setMitt({nome:c.ragione_sociale||'',indirizzo:c.so_indirizzo||'',citta:c.so_citta||'',provincia:c.so_provincia||'',cap:c.so_cap||'',email:c.email||'',telefono:c.telefono||''})
    setDest({nome:'',indirizzo:'',citta:'',provincia:'',cap:'',paese:'IT',email:'',telefono:'',note:''})
    setNumColli(1); setColli([{lunghezza:'',larghezza:'',altezza:''}])
    setPeso('1'); setContenuto(''); setTipoContenuto('Merce destinata alla vendita'); setValoreMerce(''); setHscode(''); setRifOrdine('')
    setContrassegno('0'); setAssicurazione('0')
    setTariffe([]); setSelected(null); setExtraNomi([])
    // Anche gli articoli: senza questo il pacco successivo scaricherebbe di nuovo la stessa merce.
    setArticoliScelti([])
    setRichiediRitiro(false); setRitiroData(new Date().toISOString().split('T')[0]); setRitiroOrario('mattina')
    setSuggComuni([]); setShowSugg(false); setDaOrdine('')
    setErrore(''); setVista('dati')
  }

  async function creaSpedizione() {
    if (!selected) return
    setCreating(true); setCreditoKO(null); setErrore('')
    const res = await fetch('/api/spedizioni/crea', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        clienteId: clienteData?.id,
        carrierCode:selected.carrierCode, contractCode:selected.contractCode,
        _corriere_id: (selected as any)._corriere_id || (selected as any).corriere_id || null, _spediamopro_quotation: (selected as any)._spediamopro_quotation || null,
        totalPrice: totaleConExtra.toFixed(2),
        serviziAccessori: extraScelti,
        packages: buildPackages(),
        colliDettaglio: colli,
        shipFrom:{name:mitt.nome,company:mitt.nome,street1:mitt.indirizzo,street2:'',city:mitt.citta,state:mitt.provincia,postalCode:mitt.cap,country:'IT',phone:mitt.telefono,email:mitt.email},
        shipTo:{name:dest.nome,company:'',street1:dest.indirizzo,street2:'',city:dest.citta,state:dest.provincia,postalCode:dest.cap,country:dest.paese,phone:dest.telefono,email:dest.email},
        notes:dest.note, insuranceValue:+assicurazione, codValue:+contrassegno,
        incassoModalita: +contrassegno > 0 ? incassoModalita : 'C',
        contenuto, tipoContenuto, valoreMerce, hscode, rifOrdine,
        // Ritiro: sui contratti DVA si prenota SOLO insieme all'ordine (il corriere non ha una
        // chiamata per aggiungerlo dopo), quindi la richiesta va passata gia' qui.
        richiediRitiro, dataRitiro:ritiroData, orarioRitiro:ritiroOrario
      })
    })
    const data = await res.json()
    // Credito insufficiente: invece del solo messaggio, mostro il riquadro "Paga con la carta"
    // (addebita l'esatto mancante e riprova da solo). Vedi PagaConCarta.
    if (res.status === 402 && data?.credito_insufficiente) {
      setCreating(false)
      setCreditoKO({ mancante: Number(data.mancante) || 0, costo: Number(data.costo) || 0, credito: Number(data.credito) || 0 })
      return
    }
    if (data.error) { setCreating(false); setErrore(data.error); return }
    // SCARICO DAL MAGAZZINO. Si fa QUI e non dentro la creazione: quella ha quattro rami, uno per
    // corriere, e ripetere la stessa cosa in quattro punti e' il modo in cui uno resta indietro.
    // Se fallisce non si blocca niente: la spedizione esiste gia' ed e' quella che conta. Il
    // magazzino si corregge con un conteggio, e la rotta si puo' richiamare senza scaricare due
    // volte (c'e' un indice unico che lo impedisce).
    if (articoliScelti.length && data.spedizioneId) {
      try {
        await fetch('/api/spedizioni/articoli', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ spedizione_id: data.spedizioneId, articoli: articoliScelti.map(r=>({ articolo_id:r.id, quantita:r.qta })) })
        })
      } catch { console.error('[SPEDIZIONE] scarico magazzino non riuscito') }
    }

    // Ritiro: mostro l'esito all'utente (niente più silenzio se fallisce).
    let ritiroEsito: {ok?:boolean,pickupId?:string,errore?:string}|undefined
    if (richiediRitiro && data.spedizioneId) {
      try {
        const rr = await fetch('/api/ritiri/crea', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            spedizioneIds:[data.spedizioneId],
            mittNome:mitt.nome, mittIndirizzo:mitt.indirizzo, mittCitta:mitt.citta,
            mittProvincia:mitt.provincia, mittCap:mitt.cap, mittPaese:'IT',
            mittTelefono:mitt.telefono, mittEmail:mitt.email,
            dataRitiro:ritiroData, orarioRitiro:ritiroOrario,
          })
        })
        const rj = await rr.json().catch(()=>({}))
        ritiroEsito = (!rr.ok || rj.error) ? { errore: rj.error || 'Ritiro non riuscito' } : { ok:true, pickupId: rj.pickupId }
      } catch { ritiroEsito = { errore: 'Ritiro non riuscito: il corriere non ha risposto. Riprova.' } }
    }
    if (daOrdine) {
      try {
        await fetch('/api/ordini/segna-spedito', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ ordine_id: daOrdine, spedizione_id: data.spedizioneId||null })
        })
      } catch {}
    }
    setCreating(false)
    // Il numero provvisorio non si mostra: e' un riferimento interno che il corriere non conosce,
    // e vederlo comparire per poi cambiare da solo sembra un errore. Meglio dire com'e': sta
    // arrivando. Appena c'e' quello vero il messaggio si completa.
    setSuccesso({numero: data.provvisorio ? '' : (data.numero||'—'), id:data.spedizioneId||'', ritiro: ritiroEsito})
    // Alcuni corrieri preparano la lettera di vettura qualche secondo dopo aver accettato l'ordine.
    // Finché non c'è, la spedizione porta un numero provvisorio: mostrarlo qui vorrebbe dire dare
    // all'utente un numero che il corriere non conosce. Quindi lo si richiede finché non arriva
    // quello vero (e con lui il codice del ritiro) e il messaggio si aggiorna da solo.
    if (data.spedizioneId && (data.provvisorio || (richiediRitiro && !ritiroEsito?.pickupId))) {
      attendiDatiCorriere(data.spedizioneId, richiediRitiro)
    }
    resetForm()   // form pulito per la prossima spedizione (il banner successo resta visibile)
  }

  const pesoVol0 = colli[0]?.lunghezza&&colli[0]?.larghezza&&colli[0]?.altezza
    ? ((+colli[0].lunghezza * +colli[0].larghezza * +colli[0].altezza)/5000).toFixed(2) : null


  // Richiede numero e codice ritiro finché il corriere non li ha pronti (al massimo ~40 secondi:
  // oltre è il completamento in background a scriverli, e si vedono in Elenco).
  async function attendiDatiCorriere(id: string, conRitiro: boolean) {
    for (let i = 0; i < 16; i++) {
      await new Promise(r => setTimeout(r, 2500))
      try {
        const st = await (await fetch(`/api/spedizioni/stato?id=${encodeURIComponent(id)}`)).json()
        if (st?.error) return
        setSuccesso(s => s && s.id === id ? {
          ...s,
          numero: st.provvisorio ? s.numero : (st.numero || s.numero),
          ritiro: s.ritiro && st.codiceRitiro ? { ...s.ritiro, pickupId: st.codiceRitiro } : s.ritiro,
        } : s)
        if (!st.provvisorio && (!conRitiro || st.codiceRitiro)) return
      } catch { return }
    }
  }

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Nuova Spedizione</h1>
        <p style={{color:'#999',fontSize:'13px',marginTop:'4px'}}>Compila i dati e seleziona il corriere</p>
      </div>

      {errore && <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#dc2626'}}>⚠️ {errore}</div>}
      {creditoKO && <PagaConCarta mancante={creditoKO.mancante} costo={creditoKO.costo} credito={creditoKO.credito} onPagato={() => { setCreditoKO(null); creaSpedizione() }} />}
      {successo && <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'12px 16px',marginBottom:'16px',fontSize:'14px',color:'#166534',display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px'}}>
        <span>{successo.numero
          ? <>✓ Spedizione <strong>{successo.numero}</strong> generata con successo</>
          : <>✓ Spedizione generata con successo — <span style={{opacity:.75}}>numero in arrivo dal corriere…</span></>}</span>
        {successo.id
          ? <button onClick={()=>scaricaEtichetta(successo.id)} style={{background:'#fff7ed',color:'#ea580c',border:'1px solid #fed7aa',borderRadius:'6px',padding:'6px 12px',fontSize:'14px',cursor:'pointer',fontWeight:'600'}} title="Scarica etichetta">🖨️ Scarica LDV</button>
          : <span style={{color:'#dc2626',fontSize:'13px'}}>⚠️ Etichetta non generata</span>}
      </div>}
      {successo?.ritiro && (successo.ritiro.ok
        ? <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'10px 16px',marginBottom:'16px',fontSize:'13px',color:'#166534'}}>📦 Ritiro prenotato{successo.ritiro.pickupId?<> — <strong>{successo.ritiro.pickupId}</strong></>:''}</div>
        : <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'10px 16px',marginBottom:'16px',fontSize:'13px',color:'#b91c1c'}}>⚠️ Spedizione creata, ma <strong>ritiro NON prenotato</strong>: {successo.ritiro.errore}</div>)}

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px',alignItems:'start'}}>

        {/* COLONNA SINISTRA */}
        <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>

          {/* MITTENTE */}
          <div style={card}>
            <div style={{...cardH,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span>Dati Mittente</span>
              <span style={{fontSize:'11px',color:'#bbb',fontWeight:'400'}}>precompilato dal tuo profilo</span>
            </div>
            <div style={cardB}>
              <div style={{marginBottom:'12px',position:'relative'}}>
                <label style={lbl}>Rif. Mittente</label>
                <input ref={refMittNome} value={mitt.nome} autoComplete="off"
                  onChange={async e=>{
                    const v=e.target.value
                    setMitt(m=>({...m,nome:v}))
                    if(v.trim().length>=2){
                      try{ const r=await fetch('/api/mittenti/cerca?q='+encodeURIComponent(v)); const j=await r.json(); setSuggMitt(Array.isArray(j)?j:[]); setShowSuggMitt(true) }catch{ setSuggMitt([]) }
                    } else { setSuggMitt([]); setShowSuggMitt(false) }
                  }}
                  onFocus={()=>{ if(suggMitt.length) setShowSuggMitt(true) }}
                  onBlur={()=>setTimeout(()=>setShowSuggMitt(false),200)}
                  style={inp}/>
                <TendinaPortata anchor={refMittNome} aperta={showSuggMitt && suggMitt.length>0} maxHeight={240}>
                  {suggMitt.map((c:any,i:number)=>(
                    <div key={i} onMouseDown={()=>{ setMitt(m=>({...m,nome:c.nome,indirizzo:c.indirizzo||m.indirizzo,citta:c.citta||m.citta,provincia:c.provincia||m.provincia,cap:c.cap||m.cap,email:c.email||m.email,telefono:c.telefono||m.telefono})); setShowSuggMitt(false) }}
                      style={{padding:'8px 10px',fontSize:'12px',cursor:'pointer',borderBottom:'1px solid #f0f0f0',color:'#1a1a1a'}}
                      onMouseEnter={e=>(e.currentTarget.style.background='#f9fafb')}
                      onMouseLeave={e=>(e.currentTarget.style.background='#fff')}>
                      <div style={{fontWeight:600}}>{c.nome}</div>
                      <div style={{color:'#999',fontSize:'11px'}}>{[c.indirizzo,c.citta,c.provincia&&`(${c.provincia})`,c.cap].filter(Boolean).join(' ')}</div>
                    </div>
                  ))}
                </TendinaPortata>
              </div>
              <div style={{marginBottom:'12px'}}><label style={lbl}>Indirizzo</label><input value={mitt.indirizzo} onChange={e=>setMitt({...mitt,indirizzo:e.target.value})} style={inp}/></div>
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:'8px',marginBottom:'12px'}}>
                <div style={{position:'relative'}}>
                  <label style={lbl}>Città</label>
                  <input ref={refMittCitta} value={mitt.citta} autoComplete="off"
                    onChange={async e=>{
                      const v=e.target.value
                      setMitt(m=>({...m,citta:v}))
                      if(v.trim().length>=2){
                        try{ const r=await fetch('/api/comuni?q='+encodeURIComponent(v)); const j=await r.json(); setSuggComuniMitt(Array.isArray(j)?j:[]); setShowComuneMitt(true) }catch{ setSuggComuniMitt([]) }
                      } else { setSuggComuniMitt([]); setShowComuneMitt(false) }
                    }}
                    onFocus={()=>{ if(suggComuniMitt.length) setShowComuneMitt(true) }}
                    onBlur={()=>setTimeout(()=>setShowComuneMitt(false),200)}
                    style={inp}/>
                  <TendinaPortata anchor={refMittCitta} aperta={showComuneMitt && suggComuniMitt.length>0} maxHeight={220}>
                    {suggComuniMitt.map((c:any,i:number)=>(
                      <div key={i} onMouseDown={()=>{ setMitt(m=>({...m,citta:c.nome,provincia:c.sigla,cap:c.cap})); setShowComuneMitt(false) }}
                        style={{padding:'7px 10px',fontSize:'12px',cursor:'pointer',borderBottom:'1px solid #f0f0f0',color:'#1a1a1a'}}
                        onMouseEnter={e=>(e.currentTarget.style.background='#f9fafb')}
                        onMouseLeave={e=>(e.currentTarget.style.background='#fff')}>
                        {c.nome} <span style={{color:'#999'}}>({c.sigla}) - {c.cap}</span>
                      </div>
                    ))}
                  </TendinaPortata>
                </div>
                <div><label style={lbl}>Prov.</label><input value={mitt.provincia} onChange={e=>setMitt({...mitt,provincia:e.target.value})} style={inp}/></div>
                <div><label style={lbl}>CAP</label><input value={mitt.cap} onChange={e=>setMitt({...mitt,cap:e.target.value})} style={inp}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'12px'}}>
                <div><label style={lbl}>Email</label><input value={mitt.email} onChange={e=>setMitt({...mitt,email:e.target.value})} style={inp}/></div>
                <div><label style={lbl}>Telefono</label><input value={mitt.telefono} onChange={e=>setMitt({...mitt,telefono:e.target.value})} style={inp}/></div>
              </div>
              <div style={{padding:'10px 12px',background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'6px'}}>
                <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',fontWeight:'600',color:'#1a1a1a',cursor:'pointer'}}>
                  <input type="checkbox" checked={richiediRitiro} onChange={e=>setRichiediRitiro(e.target.checked)} style={{width:'16px',height:'16px',cursor:'pointer'}}/>
                  Richiedi ritiro a questo indirizzo
                </label>
                {richiediRitiro && (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginTop:'10px'}}>
                    <div><label style={lbl}>Data ritiro</label><input type="date" value={ritiroData} min={new Date().toLocaleDateString('sv-SE')} onChange={e=>setRitiroData(e.target.value)} style={inp}/>
                      {ritiroData && [0,6].includes(new Date(ritiroData + 'T00:00:00').getDay()) && (
                        <div style={{marginTop:'4px',fontSize:'11.5px',color:'#dc2626',fontWeight:'600'}}>Sabato e domenica i ritiri non sono disponibili: scegli un giorno lavorativo.</div>
                      )}</div>
                    <div><label style={lbl}>Orario</label>
                      <select value={ritiroOrario} onChange={e=>setRitiroOrario(e.target.value)} style={inp}>
                        <option value="mattina">Mattina</option>
                        <option value="pomeriggio">Pomeriggio</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* DESTINATARIO */}
          <div style={card}>
            <div style={cardH}>Dati Destinatario</div>
            <div style={cardB}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'12px'}}>
                <div style={{position:'relative'}}>
                  <label style={lbl}>Nominativo *</label>
                  <input ref={refDestNome} value={dest.nome} autoComplete="off" placeholder="Mario Rossi"
                    onChange={async e=>{
                      const v=e.target.value
                      setDest(d=>({...d,nome:v}))
                      if(v.trim().length>=2){
                        try{ const r=await fetch('/api/destinatari/cerca?q='+encodeURIComponent(v)); const j=await r.json(); setSuggDest(Array.isArray(j)?j:[]); setShowSuggDest(true) }catch{ setSuggDest([]) }
                      } else { setSuggDest([]); setShowSuggDest(false) }
                    }}
                    onFocus={()=>{ if(suggDest.length) setShowSuggDest(true) }}
                    onBlur={()=>setTimeout(()=>setShowSuggDest(false),200)}
                    style={inp}/>
                  <TendinaPortata anchor={refDestNome} aperta={showSuggDest && suggDest.length>0} maxHeight={240}>
                    {suggDest.map((c:any,i:number)=>(
                      <div key={i} onMouseDown={()=>{ setDest(d=>({...d,nome:c.nome,indirizzo:c.indirizzo||d.indirizzo,citta:c.citta||d.citta,provincia:c.provincia||d.provincia,cap:c.cap||d.cap,email:c.email||d.email,telefono:c.telefono||d.telefono})); setShowSuggDest(false); setTariffe([]); setSelected(null) }}
                        style={{padding:'8px 10px',fontSize:'12px',cursor:'pointer',borderBottom:'1px solid #f0f0f0',color:'#1a1a1a'}}
                        onMouseEnter={e=>(e.currentTarget.style.background='#f9fafb')}
                        onMouseLeave={e=>(e.currentTarget.style.background='#fff')}>
                        <div style={{fontWeight:600}}>{c.nome}</div>
                        <div style={{color:'#999',fontSize:'11px'}}>{[c.indirizzo,c.citta,c.provincia&&`(${c.provincia})`,c.cap].filter(Boolean).join(' ')}</div>
                      </div>
                    ))}
                  </TendinaPortata>
                </div>
                <div><label style={lbl}>Paese</label>
                  <select value={dest.paese} onChange={e=>{ const paese=e.target.value; setDest(d=>({...d, paese, provincia: paese==='IT' ? (d.paese==='IT'?d.provincia:'') : paese})); setTariffe([]); setSelected(null) }} style={inp}>
                    {PAESI_MONDO.map(p => <option key={p.code} value={p.code}>{p.nome}</option>)}
                  </select>
                </div>
              </div>
              <div style={{marginBottom:'12px'}}><label style={lbl}>Indirizzo *</label><input value={dest.indirizzo} onChange={e=>setDest({...dest,indirizzo:e.target.value})} placeholder="Via Roma 1" style={inp}/></div>
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:'8px',marginBottom:'12px'}}>
                <div style={{position:'relative'}}>
                  <label style={lbl}>Città *</label>
                  <input ref={refDestCitta} value={dest.citta} autoComplete="off"
                    onChange={async e=>{
                      const v=e.target.value
                      setDest(d=>({...d,citta:v}))
                      if(v.trim().length>=2){
                        try{ const r=await fetch('/api/comuni?q='+encodeURIComponent(v)); const j=await r.json(); setSuggComuni(Array.isArray(j)?j:[]); setShowSugg(true) }catch{ setSuggComuni([]) }
                      } else { setSuggComuni([]); setShowSugg(false) }
                    }}
                    onFocus={()=>{ if(suggComuni.length) setShowSugg(true) }}
                    onBlur={()=>setTimeout(()=>setShowSugg(false),200)}
                    placeholder="Roma" style={inp}/>
                  <TendinaPortata anchor={refDestCitta} aperta={showSugg && suggComuni.length>0} maxHeight={220}>
                    {suggComuni.map((c:any,i:number)=>(
                      <div key={i} onMouseDown={()=>{ setDest(d=>({...d,citta:c.nome,provincia:c.sigla,cap:c.cap})); setShowSugg(false) }}
                        style={{padding:'7px 10px',fontSize:'12px',cursor:'pointer',borderBottom:'1px solid #f0f0f0',color:'#1a1a1a'}}
                        onMouseEnter={e=>(e.currentTarget.style.background='#f9fafb')}
                        onMouseLeave={e=>(e.currentTarget.style.background='#fff')}>
                        {c.nome} <span style={{color:'#999'}}>({c.sigla}) - {c.cap}</span>
                      </div>
                    ))}
                  </TendinaPortata>
                </div>
                <div><label style={lbl}>Prov. *</label><input value={dest.provincia} onChange={e=>setDest({...dest,provincia:e.target.value})} placeholder="RM" style={inp}/></div>
                <div><label style={lbl}>CAP *</label><input value={dest.cap} onChange={e=>setDest({...dest,cap:e.target.value})} placeholder="00100" style={inp}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'12px'}}>
                <div><label style={lbl}>Email</label><input value={dest.email} onChange={e=>setDest({...dest,email:e.target.value})} style={inp}/></div>
                <div><label style={lbl}>Telefono</label><input value={dest.telefono} onChange={e=>setDest({...dest,telefono:e.target.value})} style={inp}/></div>
              </div>
              {codAlert && (
                <div style={{display:'flex',gap:'10px',alignItems:'flex-start',padding:'10px 12px',marginBottom:'12px',background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:'6px'}}>
                  <span style={{fontSize:'16px',lineHeight:'18px'}}>⚠️</span>
                  <div style={{fontSize:'12.5px',color:'#92400e',lineHeight:'1.45'}}>
                    <b>Attenzione destinatario:</b> su <b>{codAlert.totCod}</b> spedizion{codAlert.totCod===1?'e':'i'} in contrassegno ne ha
                    {' '}<b>{codAlert.rifiutati>0 ? `rifiutat${codAlert.rifiutati===1?'a':'e'} ${codAlert.rifiutati}` : 'lasciate in giacenza'}</b>
                    {codAlert.giacenza>0 && codAlert.rifiutati>0 ? ` (di cui ${codAlert.giacenza} ora in giacenza)` : ''}.
                    {' '}Puoi comunque spedire — è solo un avviso.
                  </div>
                </div>
              )}
              <div><label style={lbl}>Note</label><input value={dest.note} onChange={e=>setDest({...dest,note:e.target.value})} style={inp}/></div>
            </div>
          </div>
        </div>

        {/* COLONNA DESTRA */}
        <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>

          {/* DATI SPEDIZIONE */}
          {vista==='dati' && (<div style={card}>
            <div style={cardH}>Dati Spedizione</div>
            <div style={cardB}>
              {pacchiSalvati.length > 0 && (
                <div style={{marginBottom:'14px'}}>
                  <label style={{...lbl,marginBottom:'6px'}}>📦 Pacchi salvati <span style={{fontWeight:400,color:'#999'}}>— clicca per riempire peso e misure</span></label>
                  <div style={{display:'flex',flexWrap:'wrap',gap:'8px'}}>
                    {pacchiSalvati.map((p:any)=>(
                      <button key={p.id} type="button" onClick={()=>applicaPacco(p)}
                        style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'8px',padding:'7px 12px',fontSize:'12px',color:'#9a3412',cursor:'pointer',fontWeight:600,display:'flex',flexDirection:'column',alignItems:'flex-start',lineHeight:1.3}}>
                        <span>{p.nome}</span>
                        <span style={{fontWeight:400,fontSize:'11px',color:'#b45309'}}>{p.peso}kg · {p.lunghezza}×{p.larghezza}×{p.altezza}cm</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'8px',marginBottom:'14px'}}>
                <div>
                  <label style={lbl}>Colli</label>
                  <input type="number" value={numColli} min="1"
                    onChange={e=>aggiornaNumColli(parseInt(e.target.value)||1)} style={inp}/>
                </div>
                <div>
                  <label style={lbl}>Peso totale{esteroMulti ? ' (somma colli)' : ''}</label>
                  {esteroMulti ? (
                    <input type="number" value={pesoTotaleColli ? pesoTotaleColli.toFixed(2) : ''} readOnly disabled
                      title="Spedizione estera multicollo: il peso si indica per collo qui sotto"
                      style={{...inp, background:'#f1f5f9', color:'#475569'}}/>
                  ) : (
                    <input type="number" value={peso} min="0.1" step="0.1"
                      onChange={e=>{setPeso(e.target.value);setTariffe([]);setSelected(null)}} style={inp}/>
                  )}
                </div>
                <div>
                  <label style={lbl}>Contrassegno €</label>
                  <input type="number" value={contrassegno} min="0" step="0.01"
                    onChange={e=>setContrassegno(e.target.value)} style={inp}/>
                </div>
                <div>
                  <label style={lbl}>Assicurazione €</label>
                  <input type="number" value={assicurazione} min="0" step="0.01"
                    onChange={e=>setAssicurazione(e.target.value)} style={inp}/>
                </div>
              </div>

              <div style={{marginBottom:'14px'}}>
                <div style={{display:'grid',gridTemplateColumns: esteroMulti ? '32px 1fr 1fr 1fr 1fr' : '32px 1fr 1fr 1fr',gap:'6px',marginBottom:'6px'}}>
                  <div style={{...lbl,marginBottom:0}}>#</div>
                  <div style={{...lbl,marginBottom:0}}>Lunghezza (cm)</div>
                  <div style={{...lbl,marginBottom:0}}>Larghezza (cm)</div>
                  <div style={{...lbl,marginBottom:0}}>Altezza (cm)</div>
                  {esteroMulti && <div style={{...lbl,marginBottom:0}}>Peso (kg)</div>}
                </div>
                {colli.map((c,i)=>(
                  <div key={i} style={{display:'grid',gridTemplateColumns: esteroMulti ? '32px 1fr 1fr 1fr 1fr' : '32px 1fr 1fr 1fr',gap:'6px',marginBottom:'6px',alignItems:'center'}}>
                    <div style={{fontSize:'12px',color:'#999',fontWeight:'600',textAlign:'center'}}>{i+1}</div>
                    <input type="number" value={c.lunghezza} placeholder="es. 30"
                      onChange={e=>aggiornaCollo(i,'lunghezza',e.target.value)} style={inp}/>
                    <input type="number" value={c.larghezza} placeholder="es. 20"
                      onChange={e=>aggiornaCollo(i,'larghezza',e.target.value)} style={inp}/>
                    <input type="number" value={c.altezza} placeholder="es. 15"
                      onChange={e=>aggiornaCollo(i,'altezza',e.target.value)} style={inp}/>
                    {esteroMulti && <input type="number" value={c.peso||''} min="0.1" step="0.1" placeholder="kg"
                      onChange={e=>aggiornaCollo(i,'peso',e.target.value)} style={inp}/>}
                  </div>
                ))}
              </div>



              <div style={{marginBottom:'10px'}}>
                <label style={lbl}>Rif. Ordine</label>
                <input value={rifOrdine} onChange={e=>setRifOrdine(e.target.value)} placeholder="Es. numero ordine — compare come Rif. in etichetta" style={inp}/>
              </div>

              <div style={{marginBottom:'10px'}}>
                <label style={lbl}>Contenuto</label>
                <input value={contenuto} onChange={e=>setContenuto(e.target.value)} style={inp}/>
              </div>

              <div style={{marginBottom:'10px'}}>
                <SelettoreArticoli articoli={catalogo} valore={articoliScelti} onChange={setArticoliScelti} />
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                <div>
                  <label style={lbl}>Tipo contenuto</label>
                  <select value={tipoContenuto} onChange={e=>setTipoContenuto(e.target.value)} style={inp}>
                    <option>Merce destinata alla vendita</option>
                    <option>Campioni commerciali</option>
                    <option>Documenti</option>
                    <option>Regalo</option>
                    <option>Uso personale</option>
                  </select>
                </div>
                <div>
                  <label style={lbl}>Valore merce €</label>
                  <input type="number" value={valoreMerce} onChange={e=>setValoreMerce(e.target.value)} min="0" step="0.01" style={inp}/>
                </div>
              </div>
              {dest.paese !== 'IT' && (
                <div style={{marginTop:'10px'}}>
                  <label style={lbl}>Codice HS/TARIC (dogana)</label>
                  <input value={hscode} onChange={e=>setHscode(e.target.value)} placeholder="es. 61091000 — solo cifre" style={inp}/>
                  <div style={{fontSize:'11px',color:'#888',marginTop:'4px'}}>Obbligatorio per le spedizioni fuori Italia. Se lo lasci vuoto proviamo a ricavarlo dalla descrizione, ma potrebbe non bastare (in quel caso la spedizione non parte).</div>
                </div>
              )}
            </div>
          </div>)}

          {/* CORRIERI E COSTI */}
          {vista==='dati' && (<div style={card}>
            <div style={{...cardH,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span>Corrieri e Costi</span>
              <button onClick={calcolaTariffe} disabled={loading}
                style={{background:'#f97316',color:'#fff',border:'none',padding:'5px 14px',borderRadius:'5px',fontSize:'12px',fontWeight:'600',cursor:'pointer',opacity:loading?0.7:1}}>
                {loading?'Calcolo...':'Seleziona Corriere'}
              </button>
            </div>
            <div style={cardB}>
              {!tariffe.length&&!loading && (
                <div style={{textAlign:'center',color:'#bbb',fontSize:'13px',padding:'20px 0'}}>
                  Compila i dati e clicca "Seleziona Corriere"
                </div>
              )}
              {tariffe.map((r,i)=>{
                const carrier = CARRIER_LABELS[r.carrierCode]||{nome:r.corriere_nome||codiceProv(r.carrierCode),colore:'#666'}
                const isSelected = ((selected as any)?._corriere_id && (r as any)?._corriere_id) ? ((selected as any)._corriere_id===(r as any)._corriere_id && selected?.zona===r.zona) : (selected?.carrierCode===r.carrierCode&&selected?.contractCode===r.contractCode&&selected?.zona===r.zona)
                return (
                  <div key={i} onClick={()=>setSelected(r)}
                    style={{display:'flex',alignItems:'center',gap:'12px',padding:'12px',border:`2px solid ${isSelected?'#f97316':'#e8e8e8'}`,borderRadius:'8px',marginBottom:'8px',cursor:'pointer',background:isSelected?'#fffbeb':'#fff',transition:'all .15s'}}>
                    {iconaCorriere(r.corriere_nome||r.carrierCode||carrier.nome) ? (
                      <img src={iconaCorriere(r.corriere_nome||r.carrierCode||carrier.nome)!} alt="" style={{width:'56px',height:'34px',objectFit:'contain',border:'1px solid #e8e8e8',borderRadius:'5px',background:'#fff',padding:'2px',flexShrink:0}}/>
                    ) : (
                      <div style={{width:'48px',height:'30px',border:'1px solid #e8e8e8',borderRadius:'5px',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                        <span style={{fontSize:'8px',fontWeight:'900',color:carrier.colore,textTransform:'uppercase'}}>{codiceProv(r.carrierCode)}</span>
                      </div>
                    )}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:'700',color:'#1a1a1a',fontSize:'13px'}}>{r.corriere_nome || carrier.nome || codiceProv(r.carrierCode)}</div>
                      <div style={{fontSize:'11px',color:'#999',marginTop:'1px'}}>{r.peso_fatturato}kg · zona {r.zona}{parseFloat(r.peso_volume)>r.peso_reale?' (vol.)':''}</div>
                      {r.limiti_collo && (
                        <div style={{fontSize:'10.5px',color:'#b45309',marginTop:'2px'}}>Limiti collo: {r.limiti_collo}</div>
                      )}
                    </div>
                    <div style={{textAlign:'right',flexShrink:0}}>
                      {(Number(r.costo_contrassegno||0) > 0 || Number(r.costo_assicurazione||0) > 0) ? (
                        <>
                          <div style={{fontSize:'11px',color:'#666'}}>Spedizione: € {r.prezzo_spedizione||r.total_price}</div>
                          {Number(r.costo_contrassegno||0) > 0 && <div style={{fontSize:'11px',color:'#666'}}>Contrassegno: € {r.costo_contrassegno}</div>}
                          {Number(r.costo_assicurazione||0) > 0 && <div style={{fontSize:'11px',color:'#666'}}>Assicurazione: € {r.costo_assicurazione}</div>}
                          <div style={{fontSize:'18px',fontWeight:'800',color:'#f97316',marginTop:'2px'}}>Totale € {r.total_price}</div>
                          <div style={{fontSize:'10px',color:'#bbb',marginTop:'1px'}}>iva esclusa</div>
                        </>
                      ) : (
                        <>
                          <div style={{fontSize:'18px',fontWeight:'800',color:'#f97316'}}>€ {r.total_price}</div>
                          <div style={{fontSize:'10px',color:'#bbb',marginTop:'1px'}}>iva esclusa</div>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
              {selected && (
                <button onClick={creaSpedizione} disabled={creating}
                  style={{width:'100%',marginTop:'4px',padding:'12px',background:'#1a1a1a',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13.5px',fontWeight:'700',cursor:'pointer',opacity:creating?0.7:1}}>
                  {creating?'Creazione in corso...':'✓ Crea Spedizione — € '+totaleConExtra.toFixed(2)}
                </button>
              )}
            </div>
          </div>)}
          {vista==='contratto' && (
        <div style={card}>
          <div style={{...cardH,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <span>Seleziona contratto</span>
            <button onClick={()=>{setVista('dati');setTariffe([]);setSelected(null)}}
              style={{background:'#eef2f7',color:'#334155',border:'1px solid #d7dee8',padding:'6px 14px',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
              Modifica dati Spedizione
            </button>
          </div>
          <div style={cardB}>
            {tariffe.map((r,i)=>{
              const carrier = CARRIER_LABELS[r.carrierCode]||{nome:r.corriere_nome||codiceProv(r.carrierCode),colore:'#666'}
              const isSelected = ((selected as any)?._corriere_id && (r as any)?._corriere_id) ? ((selected as any)._corriere_id===(r as any)._corriere_id && selected?.zona===r.zona) : (selected?.carrierCode===r.carrierCode&&selected?.contractCode===r.contractCode&&selected?.zona===r.zona)
              return (
                <div key={i} onClick={()=>setSelected(r)}
                  style={{display:'flex',alignItems:'center',gap:'12px',padding:'12px',border:`2px solid ${isSelected?'#f97316':'#e8e8e8'}`,borderRadius:'8px',marginBottom:'8px',cursor:'pointer',background:isSelected?'#fffbeb':'#fff'}}>
                  {iconaCorriere(r.corriere_nome||r.carrierCode||carrier.nome) ? (
                    <img src={iconaCorriere(r.corriere_nome||r.carrierCode||carrier.nome)!} alt="" style={{width:'56px',height:'34px',objectFit:'contain',border:'1px solid #e8e8e8',borderRadius:'5px',background:'#fff',padding:'2px',flexShrink:0}}/>
                  ) : (
                    <div style={{width:'48px',height:'30px',border:'1px solid #e8e8e8',borderRadius:'5px',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      <span style={{fontSize:'8px',fontWeight:'900',color:carrier.colore,textTransform:'uppercase'}}>{codiceProv(r.carrierCode)}</span>
                    </div>
                  )}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:'700',color:'#1a1a1a',fontSize:'14px'}}>{r.corriere_nome||carrier.nome}</div>
                    <div style={{fontSize:'11px',color:'#999',marginTop:'1px'}}>{r.peso_fatturato}kg · zona {r.zona}</div>
                  </div>
                  <div style={{fontSize:'18px',fontWeight:'800',color:'#f97316',flexShrink:0}}>€ {r.total_price}</div>
                </div>
              )
            })}

            {selected && (
              <div style={{marginTop:'8px',borderTop:'1px solid #eee',paddingTop:'14px'}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px',marginBottom:'14px',alignItems:'end' as const}}>
                  <div>
                    <label style={lbl}>Servizi accessori</label>
                    {accDisponibili.length === 0 ? (
                      <div style={{...inp,color:'#888'}}>Nessun extra per questo corriere</div>
                    ) : (
                      <>
                        <select value="" onChange={e=>{ const n=e.target.value; if(n) setExtraNomi(prev=>prev.includes(n)?prev:[...prev,n]) }} style={inp}>
                          <option value="">Aggiungi servizio…</option>
                          {accDisponibili.filter(a=>!extraNomi.includes(a.nome)).map((a,i)=>{
                            const imp = Math.round((Number(a.prezzo||0)+(Number(a.perc||0)/100)*(Number(selected?.prezzo_spedizione)||0))*100)/100
                            return <option key={i} value={a.nome}>{a.nome} — € {imp.toFixed(2)}</option>
                          })}
                        </select>
                        {extraScelti.length>0 && (
                          <div style={{display:'flex',flexWrap:'wrap',gap:'6px',marginTop:'8px'}}>
                            {extraScelti.map((e,i)=>(
                              <span key={i} style={{display:'inline-flex',alignItems:'center',gap:'6px',background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'20px',padding:'4px 10px',fontSize:'12px',color:'#1a1a1a'}}>
                                {e.nome} · € {e.importo.toFixed(2)}
                                <button onClick={()=>setExtraNomi(prev=>prev.filter(n=>n!==e.nome))} style={{border:'none',background:'none',cursor:'pointer',color:'#f97316',fontWeight:700,fontSize:'15px',lineHeight:1,padding:0}}>×</button>
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {/* La modalità d'incasso ha senso SOLO col contrassegno: senza importo non c'è nulla da
                      incassare, quindi la tendina compare solo quando il contrassegno è valorizzato. */}
                  {Number(contrassegno) > 0 && (
                    <div>
                      <label style={lbl}>Modalità di incasso contrassegno</label>
                      {codModalitaOpts.length > 1 ? (
                        <select style={inp} value={incassoModalita} onChange={e=>setIncassoModalita(e.target.value)}>
                          {codModalitaOpts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                        </select>
                      ) : (
                        <select style={inp} disabled value="C"><option value="C">CONTANTE</option></select>
                      )}
                    </div>
                  )}
                </div>
                <div style={{fontSize:'15px',fontWeight:'700',color:'#1a1a1a',marginBottom:'8px'}}>Costi</div>
                <div style={{border:'1px solid #eee',borderRadius:'8px',overflow:'hidden',marginBottom:'14px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',padding:'9px 14px',background:'#fff',fontSize:'13px',color:'#000'}}><span>Nolo</span><span>€ {selected.weight_price||selected.prezzo_spedizione||selected.total_price}</span></div>
                  {Number(selected.costo_fuel||0)>0 && <div style={{display:'flex',justifyContent:'space-between',padding:'9px 14px',fontSize:'13px',color:'#000'}}><span>Fuel{selected.fuel_pct?` (${selected.fuel_pct}%)`:''}</span><span>€ {selected.costo_fuel}</span></div>}
                  {Number(selected.costo_sponda||0)>0 && <div style={{display:'flex',justifyContent:'space-between',padding:'9px 14px',background:'#fafafa',fontSize:'13px',color:'#000'}}><span>Sponda</span><span>€ {selected.costo_sponda}</span></div>}
                  {Number(selected.costo_contrassegno||0)>0 && <div style={{display:'flex',justifyContent:'space-between',padding:'9px 14px',fontSize:'13px'}}><span>Costo Contrassegno</span><span>€ {selected.costo_contrassegno}</span></div>}
                  {Number(selected.costo_assicurazione||0)>0 && <div style={{display:'flex',justifyContent:'space-between',padding:'9px 14px',background:'#fafafa',fontSize:'13px'}}><span>Costo Assicurazione</span><span>€ {selected.costo_assicurazione}</span></div>}
                  {extraScelti.map((e,i)=>(<div key={i} style={{display:'flex',justifyContent:'space-between',padding:'9px 14px',fontSize:'13px',color:'#000'}}><span>{e.nome}</span><span>€ {e.importo.toFixed(2)}</span></div>))}
                  <div style={{display:'flex',justifyContent:'space-between',padding:'11px 14px',borderTop:'1px solid #eee',fontSize:'14px',fontWeight:'800',color:'#f97316'}}><span>Costo Totale</span><span>€ {totaleConExtra.toFixed(2)}</span></div>
                </div>
                <button onClick={creaSpedizione} disabled={creating}
                  style={{width:'100%',padding:'12px',background:'#1a1a1a',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13.5px',fontWeight:'700',cursor:'pointer',opacity:creating?0.7:1}}>
                  {creating?'Creazione in corso...':'✓ Crea Spedizione — € '+totaleConExtra.toFixed(2)}
                </button>
              </div>
            )}
        </div>
      </div>

      )}
        </div>

    </div>
      </div>
  )
}
