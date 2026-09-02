'use client'
import { useState, useEffect, useMemo } from 'react'
import { logoCorriere, serviziAccessoriDefault } from '@/lib/corriere-logo'
import EditorMarkupFasce, { type MarkupOut } from '@/app/components/EditorMarkupFasce'

const inp = {padding:'6px 8px',border:'1px solid #d1d5db',borderRadius:'5px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}
const inpFull = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'5px',fontSize:'13px',color:'#1a1a1a',background:'#fff',width:'100%',textAlign:'right' as const,boxSizing:'border-box' as const}

const fattori = [
  {label:'350 kg/m³ (2857)',value:2857},{label:'300 kg/m³ (3333)',value:3333},
  {label:'250 kg/m³ (4000)',value:4000},{label:'200 kg/m³ (5000)',value:5000},
  {label:'166.66 kg/m³ (6000)',value:6000},{label:'150 kg/m³ (6666)',value:6666},
  {label:'125 kg/m³ (8000)',value:8000},{label:'100 kg/m³ (10000)',value:10000},
  {label:'Peso reale (no volumetrico)',value:0},
]

type RigaSuppl = { valore_max:string; prezzo_fisso:string; perc:string; calcolo_su:string }
const rigaVuota = (): RigaSuppl => ({ valore_max:'', prezzo_fisso:'', perc:'', calcolo_su:'totale' })

type Fascia = { tipo:string; kg:string; prezzi:Record<string,string>; fuel:string }

function parseDescr(s: any): any {
  try { return JSON.parse(s) } catch { return null }
}

function buildFasceInit(fasceEsistenti: any[]): Fascia[] {
  if (!fasceEsistenti?.length) return [
    {tipo:'fino_a',kg:'2',prezzi:{},fuel:'0'},
    {tipo:'fino_a',kg:'5',prezzi:{},fuel:'0'},
    {tipo:'fino_a',kg:'10',prezzi:{},fuel:'0'},
    {tipo:'fino_a',kg:'20',prezzi:{},fuel:'0'},
    {tipo:'fino_a',kg:'30',prezzi:{},fuel:'0'},
    {tipo:'fino_a',kg:'50',prezzi:{},fuel:'0'},
    {tipo:'oltre',kg:'1',prezzi:{},fuel:'0'},
  ]
  const map = new Map<string, Fascia>()
  for (const f of fasceEsistenti) {
    const kg = String(Number(f.peso_max))
    const tipo = f.tipo === 'oltre' ? 'oltre' : 'fino_a'
    const key = `${tipo}_${kg}`
    if (!map.has(key)) map.set(key, { tipo, kg, prezzi: {}, fuel: String(f.fuel ?? '0') })
    if (f.fuel != null && Number(f.fuel) > 0) map.get(key)!.fuel = String(f.fuel)
    const zonaId = f.zona_id || 'MULTI'
    if (zonaId !== 'MULTI') map.get(key)!.prezzi[zonaId] = String(f.prezzo ?? '')
  }
  // "fino_a" ordinate per peso; la "oltre" (incrementale) sempre in fondo.
  return Array.from(map.values()).sort((a,b) => {
    if (a.tipo === 'oltre') return 1
    if (b.tipo === 'oltre') return -1
    return Number(a.kg) - Number(b.kg)
  })
}

function buildRigheDa(supplementi: any[], tipo: string, fallback: RigaSuppl[]): RigaSuppl[] {
  const righe = (supplementi||[]).filter(s => s.tipo === tipo)
  if (!righe.length) return fallback
  return righe.map(r => {
    const d = parseDescr(r.descrizione)
    if (d) return { valore_max: String(d.valore_max ?? ''), prezzo_fisso: String(d.prezzo_fisso ?? r.valore ?? ''), perc: String(d.perc ?? ''), calcolo_su: d.calcolo_su || r.tipo_calcolo || 'totale' }
    return { valore_max:'', prezzo_fisso: String(r.valore ?? ''), perc:'', calcolo_su: r.tipo_calcolo || 'totale' }
  })
  // Ordine CRESCENTE per valore massimo (fascia più bassa in alto). Le righe vuote/senza valore in coda.
  .sort((a,b) => {
    const va = Number(a.valore_max), vb = Number(b.valore_max)
    const aEmpty = !a.valore_max || isNaN(va), bEmpty = !b.valore_max || isNaN(vb)
    if (aEmpty && bEmpty) return 0
    if (aEmpty) return 1
    if (bEmpty) return -1
    return va - vb
  })
}

function buildServiziDa(supplementi: any[], tipo: string, fallback: {nome:string;prezzo:number;perc:number}[]) {
  const righe = (supplementi||[]).filter(s => s.tipo === tipo)
  if (!righe.length) return fallback
  return fallback.map(f => {
    const match = righe.find(r => r.nome === f.nome)
    if (!match) return f
    const d = parseDescr(match.descrizione)
    return { nome: f.nome, prezzo: d?.prezzo ?? match.valore ?? f.prezzo, perc: d?.perc ?? f.perc }
  })
}

function iniziali(nome: string): string {
  const p = (nome || '?').trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'
}

export default function ListinoCorrierePage() {
  const [pronto, setPronto] = useState(false)
  const [loading, setLoading] = useState(false)
  const [listino, setListino] = useState<any>(null)
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [corrieriDisponibili, setCorrieriDisponibili] = useState<any[]>([])
  // Logo del master: per il circuito interno il "logo del corriere" è il suo marchio (lo stesso che
  // finisce sull'etichetta interna). Se non ha caricato un logo, resta la sigla a iniziali.
  const [masterLogo, setMasterLogo] = useState<string | null>(null)
  const [corriereId, setCorriereId] = useState('')
  const [expandedId, setExpandedId] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [errore, setErrore] = useState('')
  const [msg, setMsg] = useState('')
  const [tab, setTab] = useState('pesi')
  const [fattore, setFattore] = useState(5000)
  const [soloPesoReale, setSoloPesoReale] = useState(false)
  const [soloLettura, setSoloLettura] = useState(false)  // TUTTO il listino assegnato dal padre (rivenditore puro): nasconde "Aggiungi contratto" e il banner generale
  const [soloLetturaCorriere, setSoloLetturaCorriere] = useState(false)  // il SINGOLO contratto aperto è ereditato dal master sopra → prezzi in sola lettura

  const [aggiungendoContratto, setAggiungendoContratto] = useState(false)
  const [nuovoContrattoId, setNuovoContrattoId] = useState('')
  const [aggiungendoSaving, setAggiungendoSaving] = useState(false)

  const [fasce, setFasce] = useState<Fascia[]>([])
  const [zoneCorr, setZoneCorr] = useState<any[]>([])   // zone reali del corriere selezionato
  const [righeAssic, setRigheAssic] = useState<RigaSuppl[]>([rigaVuota()])
  const [righeContr, setRigheContr] = useState<RigaSuppl[]>([rigaVuota(), rigaVuota()])
  // Vuoto all'avvio: il default giusto (per marca del corriere) lo mette carica() appena carica il corriere.
  const [serviziAccessori, setServiziAccessori] = useState<{nome:string;prezzo:number;perc:number}[]>([])
  const [giacenzeServizi, setGiacenzeServizi] = useState([
    {nome:'Riconsegna',prezzo:0,perc:0},
    {nome:'Riconsegna al nuovo destinatario',prezzo:0,perc:0},
    {nome:'Reso al mittente',prezzo:0,perc:100},
    {nome:'Distruggere',prezzo:0,perc:0},
    {nome:'Il destinatario ritira la merce in sede',prezzo:0,perc:0},
    {nome:'Consegna parziale e rendi',prezzo:0,perc:0},
    {nome:'Consegna parziale e distruggi',prezzo:0,perc:0},
  ])
  const [aperturaGiacenza, setAperturaGiacenza] = useState(0)
  const [ritiroPrezzo, setRitiroPrezzo] = useState(0)
  const [ritiroPercNolo, setRitiroPercNolo] = useState(0)
  const [spondaSoglia, setSpondaSoglia] = useState(150)
  const [spondaPrezzoKg, setSpondaPrezzoKg] = useState(0)

  // ── Duplica il COSTO di questo contratto in un LISTINO CLIENTE (nuovo o esistente) + maggiorazione ──
  const [dupOpen, setDupOpen] = useState(false)
  const [dupTargetMode, setDupTargetMode] = useState<'nuovo' | 'esistente'>('nuovo')
  const [dupNome, setDupNome] = useState('')
  const [dupTargetId, setDupTargetId] = useState('')
  const [listiniClienti, setListiniClienti] = useState<any[]>([])
  const [dupMarkup, setDupMarkup] = useState<MarkupOut>({ default: null, perFascia: {} })
  const [duplicando, setDuplicando] = useState(false)
  const [dupMsg, setDupMsg] = useState('')
  // Modale aperto → blocca lo scroll della pagina sotto: la tabella per-fascia è lunga e senza questo
  // la rotella scorre il listino dietro invece del popup (stesso pattern del widget Supporto).
  useEffect(() => { if (!dupOpen) return; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [dupOpen])
  const keyFascia = (f: Fascia) => `${f.tipo === 'oltre' ? 'oltre' : 'fino_a'}_${Number(f.kg)}`
  // Fasce per l'editor markup: costo d'esempio = il piu' basso fra le zone della fascia.
  const fasceMarkup = useMemo(() => fasce.map(f => {
    const costi = Object.values(f.prezzi || {}).map((v: any) => parseFloat(v)).filter((n: number) => isFinite(n) && n > 0)
    return { key: keyFascia(f), label: f.tipo === 'oltre' ? `oltre, ogni ${f.kg || '?'} kg` : `fino a ${f.kg || '?'} kg`, tipo: f.tipo, peso: Number(f.kg), costo: costi.length ? Math.min(...costi) : 0, costoMax: costi.length ? Math.max(...costi) : 0 }
  }), [fasce])
  function apriDuplica() {
    setDupTargetMode('nuovo'); setDupNome(`${corrieri.find((c: any) => c.id === corriereId)?.nome_contratto || 'Listino'} (cliente)`)
    setDupTargetId(''); setDupMarkup({ default: null, perFascia: {} }); setDupMsg(''); setDupOpen(true)
    fetch('/api/listini/lista').then(r => r.json()).then(d => setListiniClienti(Array.isArray(d) ? d : [])).catch(() => setListiniClienti([]))
  }
  async function confermaDuplica() {
    if (dupTargetMode === 'nuovo' && !dupNome.trim()) { setDupMsg('Inserisci un nome per il nuovo listino'); return }
    if (dupTargetMode === 'esistente' && !dupTargetId) { setDupMsg('Scegli un listino cliente esistente'); return }
    setDuplicando(true); setDupMsg('')
    const res = await fetch('/api/listini/costo-in-cliente', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corriereId, ...(dupTargetMode === 'nuovo' ? { nuovoNome: dupNome.trim() } : { targetListinoId: dupTargetId }), markup: dupMarkup }),
    })
    const d = await res.json().catch(() => ({}))
    setDuplicando(false)
    if (d?.error) { setDupMsg(d.error); return }
    setDupOpen(false)
    setMsg(`✓ "${d.nome_corriere}" copiato nel listino cliente${d.creato ? ' nuovo' : ''} con la maggiorazione`)
    setTimeout(() => setMsg(''), 5000)
  }

  async function carica(corriereDaSelezionare?: string) {
    setLoading(true); setErrore(''); setMsg('')
    const url = corriereDaSelezionare ? `/api/listini/corrieri?corriere=${corriereDaSelezionare}` : '/api/listini/corrieri'
    const res = await fetch(url)
    const data = await res.json()
    setListino(data.listino)
    setCorrieri(data.corrieri || [])
    setCorrieriDisponibili(data.corrieriDisponibili || [])
    setCorriereId(data.corriereSelezionatoId || '')
    // Il contratto aperto è ereditato dal master sopra? Allora i suoi prezzi sono in sola lettura,
    // anche se altri contratti di questo master sono suoi e restano modificabili.
    setSoloLetturaCorriere(!!data.corriereEreditato)
    setFattore(Number(data.listino?.fattore_volume) || 5000)
    setSoloPesoReale(!!data.listino?.solo_peso_reale)
    setFasce(buildFasceInit(data.fasce || []))
    // Zone reali definite in Gestione Zone per il corriere selezionato (colonne prezzi)
    const zTutte = await fetch('/api/zone').then(r => r.json()).catch(() => [])
    setZoneCorr((Array.isArray(zTutte) ? zTutte : []).filter((z: any) => z.corriere_id === (data.corriereSelezionatoId || '')))
    setRigheAssic(buildRigheDa(data.supplementi||[], 'assicurazione', [rigaVuota()]))
    setRigheContr(buildRigheDa(data.supplementi||[], 'contrassegno', [rigaVuota(), rigaVuota()]))
    // Servizi accessori DIVERSI per marca del corriere caricato (GLS≠Poste≠SDA): il master vede subito i
    // servizi giusti da prezzare. Sui listini già compilati buildServiziDa tiene i valori salvati.
    const corrSel = (data.corrieri||[]).find((c:any)=>c.id===(data.corriereSelezionatoId||corriereDaSelezionare||''))
    setServiziAccessori(buildServiziDa(data.supplementi||[], 'accessorio', serviziAccessoriDefault(corrSel?.nome_contratto || '', corrSel?.tipo)))
    setGiacenzeServizi(prev => buildServiziDa(data.supplementi||[], 'giacenza', prev))
    const aperturaRiga = (data.supplementi||[]).find((s:any) => s.tipo === 'giacenza_apertura')
    setAperturaGiacenza(aperturaRiga ? Number(aperturaRiga.valore)||0 : 0)
    const ritiroRiga = (data.supplementi||[]).find((s:any) => s.tipo === 'ritiro')
    setRitiroPrezzo(ritiroRiga ? Number(ritiroRiga.valore)||0 : 0)
    const ritiroDescr = ritiroRiga ? parseDescr(ritiroRiga.descrizione) : null
    setRitiroPercNolo(ritiroDescr?.perc_nolo ? Number(ritiroDescr.perc_nolo)||0 : 0)
    const spondaRiga = (data.supplementi||[]).find((s:any) => s.tipo === 'sponda')
    const spondaDescr = spondaRiga ? parseDescr(spondaRiga.descrizione) : null
    setSpondaSoglia(spondaDescr?.soglia_kg ? Number(spondaDescr.soglia_kg)||150 : 150)
    setSpondaPrezzoKg(spondaRiga ? Number(spondaRiga.valore)||0 : 0)
    setLoading(false); setPronto(true)
  }

  useEffect(() => {
    carica()
    fetch('/api/listini/corrieri/ereditato').then(r => r.json()).then(d => setSoloLettura(!!d?.ereditato)).catch(() => {})
    // Logo del master per il circuito interno (vedi masterLogo sopra).
    fetch('/api/master').then(r => r.json()).then(d => setMasterLogo(d?.logo_url || null)).catch(() => {})
  }, [])

  // Apre/chiude un contratto (accordion). Aprendone uno diverso, ne carica i dati.
  function toggleContratto(id: string) {
    setTab('pesi')
    if (expandedId === id) { setExpandedId(''); return }
    setExpandedId(id)
    if (id !== corriereId) carica(id)
  }

  async function confermaAggiungiContratto() {
    if (!nuovoContrattoId || !listino) return
    setAggiungendoSaving(true)
    await fetch('/api/listini/corrieri-corrieri', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ listinoId: listino.id, corriereId: nuovoContrattoId })
    })
    setAggiungendoContratto(false)
    setAggiungendoSaving(false)
    const idDaSelezionare = nuovoContrattoId
    setNuovoContrattoId('')
    setExpandedId(idDaSelezionare)
    await carica(idDaSelezionare)
  }

  function addFascia() { setFasce(prev=>[...prev,{tipo:'fino_a',kg:'',prezzi:{},fuel:'0'}]) }
  function removeFascia(i:number) { setFasce(prev=>prev.filter((_,idx)=>idx!==i)) }
  function setFasciaKg(i:number,val:string) { setFasce(prev=>prev.map((f,idx)=>idx===i?{...f,kg:val}:f)) }
  function setFasciaPrezzo(i:number,zona:string,val:string) { setFasce(prev=>prev.map((f,idx)=>idx===i?{...f,prezzi:{...f.prezzi,[zona]:val}}:f)) }
  function setFasciaFuel(i:number,val:string) { setFasce(prev=>prev.map((f,idx)=>idx===i?{...f,fuel:val}:f)) }
  function setFasciaTipo(i:number,val:string) { setFasce(prev=>prev.map((f,idx)=>idx===i?{...f,tipo:val}:f)) }
  function setRigaAssic(i:number,k:keyof RigaSuppl,v:string) { setRigheAssic(prev=>prev.map((r,idx)=>idx===i?{...r,[k]:v}:r)) }
  function setRigaContr(i:number,k:keyof RigaSuppl,v:string) { setRigheContr(prev=>prev.map((r,idx)=>idx===i?{...r,[k]:v}:r)) }

  async function salva() {
    if (soloLetturaCorriere) { setErrore('Questo contratto è ereditato dal tuo master: il prezzo è in sola lettura e non puoi modificarlo.'); return }
    if (!corriereId) { setErrore('Seleziona un contratto'); return }
    if (!listino) { setErrore('Listino non trovato'); return }
    setSaving(true); setErrore('')

    const fasceArr: any[] = []
    for (const f of fasce) {
      const peso_max = parseFloat(f.kg) || 0
      for (const [zona_id, prezzo] of Object.entries(f.prezzi)) {
        const p = parseFloat(String(prezzo))
        if (p > 0) {
          fasceArr.push({ zona_id, peso_min: 0, peso_max, prezzo: p, tipo: f.tipo, fuel: parseFloat(f.fuel) || 0 })
        }
      }
    }

    const supplementi = {
      assicurazione: righeAssic, contrassegno: righeContr,
      servizi: serviziAccessori,
      giacenze: { servizi: giacenzeServizi, apertura: aperturaGiacenza },
      ritiro: { prezzo: ritiroPrezzo, perc_nolo: ritiroPercNolo },
      sponda: { soglia_kg: spondaSoglia, prezzo_kg: spondaPrezzoKg },
    }

    const res = await fetch('/api/listini/corrieri', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ listinoId: listino.id, corriereId, fasce: fasceArr, supplementi, fattore_volume: fattore, solo_peso_reale: soloPesoReale })
    })
    const data = await res.json()
    setSaving(false)
    if (data.error) { setErrore(data.error); return }
    const propagati = Number(data.propagati || 0)
    setMsg(propagati > 0 ? `✓ Listino salvato e propagato a ${propagati} master collegati` : '✓ Listino salvato!')
    setTimeout(()=>setMsg(''),4000)
  }

  const tabStyle = (t:string) => ({
    padding:'9px 16px',background:'none',border:'none',cursor:'pointer',fontSize:'12px',
    fontWeight:tab===t?'700' as const:'400' as const,
    color:tab===t?'#f97316':'#1a1a1a',
    borderBottom:tab===t?'2px solid #f97316':'2px solid transparent',
    whiteSpace:'nowrap' as const
  })

  // Corpo dell'editor del contratto attualmente aperto (dentro la tendina).
  const editorContratto = (
    <div>
      {/* Contratto ereditato dal master sopra (ma il master ne possiede altri suoi): banner per-contratto.
          Non appare per i rivenditori puri, che hanno già il banner generale sopra la lista. */}
      {soloLetturaCorriere && !soloLettura && (
        <div style={{margin:'12px 14px 0',padding:'10px 14px',background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'8px',fontSize:'12.5px',color:'#ea580c',lineHeight:1.5,pointerEvents:'auto' as const}}>
          Questo contratto è <b>ereditato dal tuo master</b>: i prezzi sono in <b>sola lettura</b>. Puoi vederli e usarli, ma li gestisce il master sopra di te. Con <b>⧉ Duplica in listino cliente</b> puoi comunque crearci sopra un tuo listino di vendita.
        </div>
      )}
      {/* Fattore peso/volume (per-corriere) */}
      <div style={{padding:'16px 18px',borderBottom:'1px solid #eee',display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap' as const}}>
        <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a'}}>Fattore Peso/Volume (kg/m³)</label>
        <select value={soloPesoReale ? 0 : fattore} onChange={e=>{const v=Number(e.target.value); if(v===0){setSoloPesoReale(true)}else{setSoloPesoReale(false);setFattore(v)}}} style={{...inp,padding:'8px 10px',minWidth:'220px'}}>
          {fattori.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        {soloPesoReale && <span style={{fontSize:'11px',color:'#f97316'}}>Si paga sempre sul peso reale, il volumetrico viene ignorato.</span>}
        {/* Duplica: cliccabile SEMPRE, anche su un contratto ereditato in sola lettura — per questo
            forza pointerEvents:auto, superando l'overlay che blocca il resto dell'editor. */}
        <button onClick={apriDuplica} disabled={saving} title="Crea un listino cliente da questo costo, con maggiorazione"
          style={{marginLeft:'auto',padding:'9px 16px',background:'#fff7ed',color:'#ea580c',border:'1px solid #fed7aa',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',pointerEvents:'auto' as const}}>
          ⧉ Duplica in listino cliente
        </button>
        <button onClick={salva} disabled={saving||soloLetturaCorriere} title={soloLetturaCorriere?'Contratto ereditato dal master: sola lettura':''}
          style={{padding:'9px 24px',background:soloLetturaCorriere?'#e5e7eb':'#f97316',color:soloLetturaCorriere?'#9ca3af':'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:soloLetturaCorriere?'not-allowed':'pointer',opacity:saving?0.6:1}}>
          {saving?'Salvo...':'Salva'}
        </button>
      </div>

      {/* Tabs — sempre cliccabili anche in sola lettura (pointer-events:auto sovrascrive il blocco):
          così si possono vedere Assicurazione/Contrassegni/Giacenze ecc., ma non modificarli. */}
      <div style={{display:'flex',borderBottom:'1px solid #d1d5db',padding:'0 16px',overflowX:'auto' as const,pointerEvents:'auto' as const}}>
        {[['pesi','Pesi / Zone'],['assicurazione','Assicurazione'],['contrassegni','Contrassegni'],['servizi','Servizi accessori'],['giacenze','Giacenze'],['ritiro','Ritiro'],['extra','Extra']].map(([k,l])=>(
          <button key={k} style={tabStyle(k)} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {tab==='pesi' && (
        <div>
          {!zoneCorr.length && (
            <div style={{margin:'12px',padding:'12px 14px',background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'8px',fontSize:'12.5px',color:'#9a3412'}}>
              Nessuna zona definita per questo corriere. Vai su <b>Gestione Zone</b> e crea le zone (es. ITALIA, SICILIA, SARDEGNA…): compariranno qui come colonne prezzo.
            </div>
          )}
          <div style={{overflowX:'auto' as const}}>
            <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'12px'}}>
              <thead>
                <tr style={{background:'#f9fafb'}}>
                  <th style={{padding:'8px 10px',borderBottom:'1px solid #d1d5db',color:'#1a1a1a',fontWeight:'700',textAlign:'left' as const}}>Peso (kg)</th>
                  <th style={{padding:'8px 6px',borderBottom:'1px solid #d1d5db',color:'#1a1a1a',fontWeight:'700'}}></th>
                  {zoneCorr.map(z=>(
                    <th key={z.id} style={{padding:'8px 8px',borderBottom:'1px solid #d1d5db',color:'#1a1a1a',fontWeight:'700',textAlign:'center' as const,whiteSpace:'nowrap' as const}}>{z.nome} €</th>
                  ))}
                  <th style={{padding:'8px 6px',borderBottom:'1px solid #d1d5db',color:'#1a1a1a',fontWeight:'700',textAlign:'center' as const}}>Fuel %</th>
                  <th style={{padding:'8px 6px',borderBottom:'1px solid #d1d5db',width:'36px'}}></th>
                </tr>
              </thead>
              <tbody>
                {fasce.map((f,i)=>(
                  <tr key={i} style={{borderBottom:'1px solid #e5e7eb',background:i%2===0?'#fff':'#fafafa'}}>
                    <td style={{padding:'6px 10px',whiteSpace:'nowrap' as const}}>
                      <select value={f.tipo} onChange={e=>setFasciaTipo(i,e.target.value)} style={{padding:'4px 6px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',color:'#1a1a1a'}}>
                        <option value="fino_a">Fino a:</option>
                        <option value="oltre">oltre X ogni</option>
                      </select>
                    </td>
                    <td style={{padding:'6px 6px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
                        <input type="number" value={f.kg} onChange={e=>setFasciaKg(i,e.target.value)} style={{...inp,width:'65px',textAlign:'right' as const}}/>
                        <span style={{fontSize:'11px',color:'#666'}}>kg</span>
                      </div>
                    </td>
                    {zoneCorr.map(z=>(
                      <td key={z.id} style={{padding:'4px 4px',textAlign:'center' as const}}>
                        <input type="number" step="0.01" value={f.prezzi[z.id]||''} onChange={e=>setFasciaPrezzo(i,z.id,e.target.value)} style={{...inp,width:'70px',textAlign:'right' as const}} placeholder="0.00"/>
                      </td>
                    ))}
                    <td style={{padding:'4px 6px',textAlign:'center' as const}}>
                      <input type="number" step="0.01" value={f.fuel||''} onChange={e=>setFasciaFuel(i,e.target.value)} style={{...inp,width:'55px',textAlign:'right' as const}} placeholder="0"/>
                    </td>
                    <td style={{padding:'4px 6px',textAlign:'center' as const}}>
                      <button onClick={()=>removeFascia(i)} style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'50%',width:'22px',height:'22px',cursor:'pointer',color:'#dc2626',fontSize:'14px',display:'flex',alignItems:'center',justifyContent:'center'}}>−</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{padding:'10px 16px',borderTop:'1px solid #e5e7eb',display:'flex',gap:'16px',alignItems:'center'}}>
            <button onClick={addFascia} style={{background:'none',border:'none',color:'#f97316',fontSize:'13px',fontWeight:'600',cursor:'pointer',padding:0}}>+ Aggiungi fascia</button>
            <span style={{fontSize:'11px',color:'#999'}}>Usa "oltre X ogni" per i pesi oltre l'ultima fascia (es. oltre 50kg, +0,38 € ogni 1 kg). Così copri anche i 1000 kg.</span>
          </div>
        </div>
      )}

      {tab==='assicurazione' && (
        <div style={{padding:'16px'}}>
          <div style={{marginBottom:'12px',padding:'9px 12px',borderRadius:'8px',fontSize:'12.5px',fontWeight:600,...(righeAssic.some(r=>Number(r.valore_max)>0)?{background:'#f0fdf4',border:'1px solid #bbf7d0',color:'#15803d'}:{background:'#fff7ed',border:'1px solid #fed7aa',color:'#c2410c'})}}>
            {righeAssic.some(r=>Number(r.valore_max)>0)
              ? '✓ Servizio ATTIVO — disponibile fino al valore massimo impostato.'
              : '⚠ Servizio NON attivo — valore massimo 0 o vuoto: il servizio non sarà disponibile. Imposta un valore massimo maggiore di 0 per attivarlo.'}
          </div>
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
            <thead><tr style={{background:'#fafafa'}}>
              <th style={{textAlign:'left' as const,padding:'8px 10px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>Valore massimo <span style={{color:'#666',fontWeight:'400'}}>€</span></th>
              <th style={{textAlign:'left' as const,padding:'8px 10px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>Prezzo fisso <span style={{color:'#666',fontWeight:'400'}}>€</span></th>
              <th style={{textAlign:'left' as const,padding:'8px 10px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>+%</th>
              <th style={{textAlign:'left' as const,padding:'8px 10px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>Calcolo % su</th>
              <th style={{width:'40px',borderBottom:'1px solid #d1d5db'}}></th>
            </tr></thead>
            <tbody>
              {righeAssic.map((r,i)=>(
                <tr key={i} style={{borderBottom:'1px solid #e5e7eb'}}>
                  <td style={{padding:'6px 8px'}}><input type="number" value={r.valore_max} onChange={e=>setRigaAssic(i,'valore_max',e.target.value)} style={inpFull} placeholder="0"/></td>
                  <td style={{padding:'6px 8px'}}><input type="number" value={r.prezzo_fisso} onChange={e=>setRigaAssic(i,'prezzo_fisso',e.target.value)} style={inpFull} placeholder="0"/></td>
                  <td style={{padding:'6px 8px'}}><input type="number" value={r.perc} onChange={e=>setRigaAssic(i,'perc',e.target.value)} style={inpFull} placeholder="0"/></td>
                  <td style={{padding:'6px 8px'}}>
                    <select value={r.calcolo_su} onChange={e=>setRigaAssic(i,'calcolo_su',e.target.value)} style={{...inp,width:'120px'}}>
                      <option value="totale">totale</option>
                      <option value="differenza">differenza</option>
                    </select>
                  </td>
                  <td style={{padding:'6px 8px',textAlign:'center' as const}}>
                    <button onClick={()=>setRigheAssic(prev=>prev.filter((_,idx)=>idx!==i))} style={{width:'22px',height:'22px',borderRadius:'50%',background:'#fef2f2',border:'1px solid #fecaca',color:'#dc2626',cursor:'pointer',fontSize:'14px',display:'inline-flex',alignItems:'center',justifyContent:'center'}}>−</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={()=>setRigheAssic(prev=>[...prev,rigaVuota()])} style={{marginTop:'10px',background:'none',border:'none',color:'#f97316',fontSize:'13px',fontWeight:'600',cursor:'pointer',padding:0}}>+Aggiungi campo</button>
        </div>
      )}

      {tab==='contrassegni' && (
        <div style={{padding:'16px'}}>
          <div style={{marginBottom:'12px',padding:'9px 12px',borderRadius:'8px',fontSize:'12.5px',fontWeight:600,...(righeContr.some(r=>Number(r.valore_max)>0)?{background:'#f0fdf4',border:'1px solid #bbf7d0',color:'#15803d'}:{background:'#fff7ed',border:'1px solid #fed7aa',color:'#c2410c'})}}>
            {righeContr.some(r=>Number(r.valore_max)>0)
              ? '✓ Servizio ATTIVO — disponibile fino al valore massimo impostato.'
              : '⚠ Servizio NON attivo — valore massimo 0 o vuoto: il servizio non sarà disponibile. Imposta un valore massimo maggiore di 0 per attivarlo.'}
          </div>
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
            <thead><tr style={{background:'#fafafa'}}>
              <th style={{textAlign:'left' as const,padding:'8px 10px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>Valore massimo <span style={{color:'#666',fontWeight:'400'}}>€</span></th>
              <th style={{textAlign:'left' as const,padding:'8px 10px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>Prezzo fisso <span style={{color:'#666',fontWeight:'400'}}>€</span></th>
              <th style={{textAlign:'left' as const,padding:'8px 10px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>+ % del valore</th>
              <th style={{textAlign:'left' as const,padding:'8px 10px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>Calcolo % su</th>
              <th style={{width:'40px',borderBottom:'1px solid #d1d5db'}}></th>
            </tr></thead>
            <tbody>
              {righeContr.map((r,i)=>(
                <tr key={i} style={{borderBottom:'1px solid #e5e7eb'}}>
                  <td style={{padding:'6px 8px'}}><input type="number" value={r.valore_max} onChange={e=>setRigaContr(i,'valore_max',e.target.value)} style={inpFull} placeholder="0"/></td>
                  <td style={{padding:'6px 8px'}}><input type="number" value={r.prezzo_fisso} onChange={e=>setRigaContr(i,'prezzo_fisso',e.target.value)} style={inpFull} placeholder="0"/></td>
                  <td style={{padding:'6px 8px'}}><input type="number" value={r.perc} onChange={e=>setRigaContr(i,'perc',e.target.value)} style={inpFull} placeholder="0"/></td>
                  <td style={{padding:'6px 8px'}}>
                    <select value={r.calcolo_su} onChange={e=>setRigaContr(i,'calcolo_su',e.target.value)} style={{...inp,width:'120px'}}>
                      <option value="totale">totale</option>
                      <option value="differenza">differenza</option>
                    </select>
                  </td>
                  <td style={{padding:'6px 8px',textAlign:'center' as const}}>
                    <button onClick={()=>setRigheContr(prev=>prev.filter((_,idx)=>idx!==i))} style={{width:'22px',height:'22px',borderRadius:'50%',background:'#fef2f2',border:'1px solid #fecaca',color:'#dc2626',cursor:'pointer',fontSize:'14px',display:'inline-flex',alignItems:'center',justifyContent:'center'}}>−</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={()=>setRigheContr(prev=>[...prev,rigaVuota()])} style={{marginTop:'10px',background:'none',border:'none',color:'#f97316',fontSize:'13px',fontWeight:'600',cursor:'pointer',padding:0}}>+Aggiungi campo</button>
        </div>
      )}

      {tab==='servizi' && (
        <div style={{padding:'16px'}}>
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px',maxWidth:'700px'}}>
            <thead><tr style={{background:'#fafafa'}}>
              <th style={{textAlign:'left' as const,padding:'9px 12px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>Servizio</th>
              <th style={{textAlign:'left' as const,padding:'9px 12px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>Prezzo <span style={{color:'#666',fontWeight:'400'}}>€</span></th>
              <th style={{textAlign:'left' as const,padding:'9px 12px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>+% del valore della spedizione</th>
            </tr></thead>
            <tbody>
              {serviziAccessori.map((s,i)=>(
                <tr key={i} style={{borderBottom:'1px solid #e5e7eb'}}>
                  <td style={{padding:'8px 12px',color:'#f97316',fontWeight:'500'}}>{s.nome}</td>
                  <td style={{padding:'8px 12px'}}><input type="number" step="0.01" value={s.prezzo||''} onChange={e=>setServiziAccessori(prev=>prev.map((x,idx)=>idx===i?{...x,prezzo:parseFloat(e.target.value)||0}:x))} style={{...inp,width:'120px',textAlign:'right' as const}} placeholder="0"/></td>
                  <td style={{padding:'8px 12px'}}><input type="number" step="0.01" value={s.perc||''} onChange={e=>setServiziAccessori(prev=>prev.map((x,idx)=>idx===i?{...x,perc:parseFloat(e.target.value)||0}:x))} style={{...inp,width:'200px',textAlign:'right' as const}} placeholder="0"/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab==='giacenze' && (
        <div style={{padding:'16px'}}>
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px',maxWidth:'700px'}}>
            <thead><tr style={{background:'#fafafa'}}>
              <th style={{textAlign:'left' as const,padding:'9px 12px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>Servizio</th>
              <th style={{textAlign:'left' as const,padding:'9px 12px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>Prezzo <span style={{color:'#666',fontWeight:'400'}}>€</span></th>
              <th style={{textAlign:'left' as const,padding:'9px 12px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>+% del valore della spedizione</th>
            </tr></thead>
            <tbody>
              {giacenzeServizi.map((s,i)=>(
                <tr key={i} style={{borderBottom:'1px solid #e5e7eb'}}>
                  <td style={{padding:'8px 12px',color:'#f97316',fontWeight:'500'}}>{s.nome}</td>
                  <td style={{padding:'8px 12px'}}><input type="number" step="0.01" value={s.prezzo||''} onChange={e=>setGiacenzeServizi(prev=>prev.map((x,idx)=>idx===i?{...x,prezzo:parseFloat(e.target.value)||0}:x))} style={{...inp,width:'120px',textAlign:'right' as const}} placeholder="0"/></td>
                  <td style={{padding:'8px 12px'}}><input type="number" step="0.01" value={s.perc||''} onChange={e=>setGiacenzeServizi(prev=>prev.map((x,idx)=>idx===i?{...x,perc:parseFloat(e.target.value)||0}:x))} style={{...inp,width:'200px',textAlign:'right' as const}} placeholder="0"/></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{marginTop:'16px',display:'flex',alignItems:'center',gap:'12px',fontSize:'13px'}}>
            <label style={{color:'#1a1a1a',fontWeight:'600'}}>Apertura dossier giacenza: <span style={{color:'#dc2626'}}>*</span></label>
            <input type="number" step="0.01" value={aperturaGiacenza||''} onChange={e=>setAperturaGiacenza(parseFloat(e.target.value)||0)} style={{...inp,width:'80px',textAlign:'right' as const}} placeholder="0"/>
          </div>
          <div style={{fontSize:'11px',color:'#f97316',marginTop:'4px'}}>* Il costo sarà addebitato solo nella fase di svincolo da parte del cliente</div>
        </div>
      )}

      {tab==='ritiro' && (
        <div style={{padding:'16px'}}>
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px',maxWidth:'700px'}}>
            <thead><tr style={{background:'#fafafa'}}>
              <th style={{textAlign:'left' as const,padding:'9px 12px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>Servizio</th>
              <th style={{textAlign:'left' as const,padding:'9px 12px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>Prezzo fisso <span style={{color:'#666',fontWeight:'400'}}>€</span></th>
              <th style={{textAlign:'left' as const,padding:'9px 12px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>+% del nolo</th>
            </tr></thead>
            <tbody>
              <tr style={{borderBottom:'1px solid #e5e7eb'}}>
                <td style={{padding:'8px 12px',color:'#f97316',fontWeight:'500'}}>Ritiro</td>
                <td style={{padding:'8px 12px'}}><input type="number" step="0.01" value={ritiroPrezzo||''} onChange={e=>setRitiroPrezzo(parseFloat(e.target.value)||0)} style={{...inp,width:'120px',textAlign:'right' as const}} placeholder="0"/></td>
                <td style={{padding:'8px 12px'}}><input type="number" step="0.01" value={ritiroPercNolo||''} onChange={e=>setRitiroPercNolo(parseFloat(e.target.value)||0)} style={{...inp,width:'200px',textAlign:'right' as const}} placeholder="0"/></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {tab==='extra' && (
        <div style={{padding:'16px'}}>
          <div style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a',marginBottom:'4px'}}>Sponda idraulica (supplemento peso)</div>
          <div style={{fontSize:'12px',color:'#666',marginBottom:'14px'}}>La soglia è solo il trigger: da quel peso in su, il prezzo/kg si applica sul <b>totale dei kg</b> (peso fatturato). Es: soglia 200kg, 0,03 €/kg → spedizione da 220kg = +220×0,03 = +6,60 €.</div>
          <div style={{display:'flex',gap:'20px',alignItems:'flex-end',flexWrap:'wrap' as const}}>
            <div>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Soglia (kg)</label>
              <input type="number" step="1" value={spondaSoglia||''} onChange={e=>setSpondaSoglia(parseFloat(e.target.value)||0)} style={{...inp,width:'120px',textAlign:'right' as const}} placeholder="150"/>
            </div>
            <div>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Prezzo per kg (€)</label>
              <input type="number" step="any" value={spondaPrezzoKg||''} onChange={e=>setSpondaPrezzoKg(parseFloat(e.target.value)||0)} style={{...inp,width:'180px',textAlign:'right' as const}} placeholder="0.0400334448"/>
            </div>
          </div>
          <div style={{fontSize:'11px',color:'#999',marginTop:'10px'}}>Lascia 0 per disattivare la sponda su questo contratto.</div>
        </div>
      )}
    </div>
  )

  if (!pronto) {
    return <div style={{padding:'40px',textAlign:'center' as const,color:'#666'}}>Caricamento...</div>
  }

  return (
    <div>
      <div style={{marginBottom:'16px',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap' as const,gap:'10px'}}>
        <div>
          <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Listino Corrieri</h1>
          <p style={{fontSize:'12.5px',color:'#666',margin:'4px 0 0'}}>Clicca su un contratto per aprirne il listino. Le modifiche salvate vengono propagate ai master collegati.</p>
        </div>
        {!aggiungendoContratto && !soloLettura && (
          <button onClick={()=>setAggiungendoContratto(true)}
            style={{background:'#f97316',border:'none',color:'#fff',padding:'9px 18px',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>
            + Aggiungi contratto
          </button>
        )}
      </div>

      {aggiungendoContratto && (
        <div style={{marginBottom:'16px',padding:'12px 14px',background:'#f9fafb',border:'1px solid #d1d5db',borderRadius:'8px',display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap' as const}}>
          {corrieriDisponibili.length > 0 ? (
            <>
              <select value={nuovoContrattoId} onChange={e=>setNuovoContrattoId(e.target.value)}
                style={{padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',color:'#1a1a1a',flex:1,minWidth:'200px'}}>
                <option value="">Seleziona contratto da aggiungere...</option>
                {corrieriDisponibili.map((c:any)=>(
                  <option key={c.id} value={c.id}>{c.nome_contratto}</option>
                ))}
              </select>
              <button onClick={confermaAggiungiContratto} disabled={aggiungendoSaving || !nuovoContrattoId}
                style={{padding:'7px 16px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:'pointer',opacity:(aggiungendoSaving||!nuovoContrattoId)?0.6:1}}>
                {aggiungendoSaving?'Aggiungo...':'Aggiungi'}
              </button>
            </>
          ) : (
            <span style={{flex:1,fontSize:'12.5px',color:'#666',minWidth:'200px'}}>Non hai altri corrieri da attivare. Collega prima un tuo corriere.</span>
          )}
          <a href="/dashboard/corrieri" style={{padding:'7px 14px',background:'#fff',border:'1px solid #f97316',color:'#f97316',borderRadius:'6px',fontSize:'12px',fontWeight:'700',textDecoration:'none',whiteSpace:'nowrap' as const}}>+ Collega un tuo corriere</a>
          <button onClick={()=>{setAggiungendoContratto(false);setNuovoContrattoId('')}}
            style={{padding:'7px 16px',background:'#f5f5f5',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',cursor:'pointer',color:'#1a1a1a'}}>
            Annulla
          </button>
        </div>
      )}

      {soloLettura&&<div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#ea580c',lineHeight:1.5}}>Questo Listino Corrieri ti è stato <b>assegnato dal tuo master</b>: è in <b>sola lettura</b>. Vedi i prezzi e le impostazioni (peso volume, giacenze, ecc.) applicati, ma non puoi modificarli — li gestisce il master sopra di te.</div>}
      {errore&&<div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'10px',marginBottom:'16px',fontSize:'13px',color:'#dc2626'}}>{errore}</div>}
      {msg&&<div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'10px',marginBottom:'16px',fontSize:'13px',color:'#16a34a'}}>{msg}</div>}

      {!corrieri.length ? (
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'40px',textAlign:'center' as const,color:'#666',fontSize:'13px'}}>
          Nessun contratto agganciato. Usa "+ Aggiungi contratto" per iniziare.
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column' as const,gap:'10px'}}>
          {corrieri.map((c:any)=>{
            const aperto = expandedId === c.id
            return (
              <div key={c.id} style={{background:'#fff',borderRadius:'10px',border:aperto?'1px solid #f97316':'1px solid #e5e7eb',overflow:'hidden',boxShadow:aperto?'0 1px 3px rgba(249,115,22,0.12)':'none'}}>
                <div onClick={()=>toggleContratto(c.id)}
                  style={{display:'flex',alignItems:'center',gap:'12px',padding:'12px 16px',cursor:'pointer',userSelect:'none' as const,background:aperto?'#fff7ed':'#fff'}}>
                  {logoCorriere(c.nome_contratto) ? (
                    <span style={{width:'56px',height:'40px',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      <img src={logoCorriere(c.nome_contratto)!} alt={c.nome_contratto} style={{maxWidth:'56px',maxHeight:'40px',objectFit:'contain' as const}}/>
                    </span>
                  ) : (c.tipo === 'interno' && masterLogo) ? (
                    // Circuito interno: il marchio è quello del master (lo stesso dell'etichetta), non un logo provider.
                    <span style={{width:'56px',height:'40px',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      <img src={masterLogo} alt={c.nome_contratto} style={{maxWidth:'56px',maxHeight:'40px',objectFit:'contain' as const}}/>
                    </span>
                  ) : (
                    <span style={{width:'40px',height:'40px',borderRadius:'8px',background:aperto?'#f97316':'#f3f4f6',color:aperto?'#fff':'#6b7280',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'12px',fontWeight:'700',flexShrink:0}}>{iniziali(c.nome_contratto)}</span>
                  )}
                  <span style={{flex:1,fontSize:'14px',fontWeight:'600',color:'#1a1a1a'}}>{c.nome_contratto}</span>
                  <span style={{fontSize:'18px',color:'#9ca3af',transform:aperto?'rotate(90deg)':'none',transition:'transform 0.15s'}}>›</span>
                </div>
                {aperto && (
                  <div style={{borderTop:'1px solid #eee', ...(soloLetturaCorriere ? {pointerEvents:'none' as const, opacity:0.92, userSelect:'none' as const} : {})}}
                    title={soloLetturaCorriere ? 'Contratto ereditato dal master: sola lettura' : undefined}>
                    {loading ? (
                      <div style={{padding:'30px',textAlign:'center' as const,color:'#999',fontSize:'13px'}}>Caricamento…</div>
                    ) : editorContratto}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {dupOpen && (
        <div onClick={()=>duplicando?null:setDupOpen(false)} style={{position:'fixed',inset:0,background:'rgba(15,15,15,0.55)',zIndex:9999,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'20px',overflowY:'auto'}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:'12px',maxWidth:'560px',width:'100%',margin:'auto',maxHeight:'88vh',overflowY:'auto' as const,overscrollBehavior:'contain' as const,padding:'22px',boxShadow:'0 20px 60px rgba(0,0,0,.35)'}}>
            <div style={{fontSize:'17px',fontWeight:800,color:'#1a1a1a',marginBottom:'4px'}}>Duplica in listino cliente</div>
            <div style={{fontSize:'12.5px',color:'#666',marginBottom:'16px'}}>Copio il <b>costo</b> di <b>{corrieri.find((c:any)=>c.id===corriereId)?.nome_contratto||'—'}</b> in un listino cliente, con la maggiorazione. Le zone restano le stesse.</div>

            {/* Destinazione */}
            <div style={{display:'flex',gap:'8px',marginBottom:'10px'}}>
              <button onClick={()=>setDupTargetMode('nuovo')} style={{flex:1,padding:'8px',borderRadius:'8px',border:`1px solid ${dupTargetMode==='nuovo'?'#f97316':'#e2e2e2'}`,background:dupTargetMode==='nuovo'?'#fff7ed':'#fff',color:'#1a1a1a',fontSize:'12.5px',fontWeight:700,cursor:'pointer'}}>Nuovo listino</button>
              <button onClick={()=>setDupTargetMode('esistente')} style={{flex:1,padding:'8px',borderRadius:'8px',border:`1px solid ${dupTargetMode==='esistente'?'#f97316':'#e2e2e2'}`,background:dupTargetMode==='esistente'?'#fff7ed':'#fff',color:'#1a1a1a',fontSize:'12.5px',fontWeight:700,cursor:'pointer'}}>Listino esistente</button>
            </div>
            {dupTargetMode==='nuovo' ? (
              <input value={dupNome} onChange={e=>setDupNome(e.target.value)} placeholder="Nome del nuovo listino cliente" autoFocus
                style={{width:'100%',padding:'9px 12px',border:'1px solid #e2e2e2',borderRadius:'8px',fontSize:'14px',color:'#1a1a1a',outline:'none',marginBottom:'16px',boxSizing:'border-box' as const}}/>
            ) : (
              <select value={dupTargetId} onChange={e=>setDupTargetId(e.target.value)}
                style={{width:'100%',padding:'9px 12px',border:'1px solid #e2e2e2',borderRadius:'8px',fontSize:'14px',color:'#1a1a1a',background:'#fff',marginBottom:'16px',boxSizing:'border-box' as const}}>
                <option value="">Scegli un listino cliente…</option>
                {listiniClienti.map((l:any)=><option key={l.id} value={l.id}>{l.nome}</option>)}
              </select>
            )}

            {/* Maggiorazione: modifica in blocco + per fascia + ANTEPRIMA (componente condiviso) */}
            <div style={{fontSize:'12px',fontWeight:700,color:'#1a1a1a',marginBottom:'8px'}}>Maggiorazione — con anteprima del prezzo cliente</div>
            <div style={{marginBottom:'16px'}}>
              <EditorMarkupFasce fasce={fasceMarkup} onChange={setDupMarkup} />
            </div>

            {dupMsg && <div style={{padding:'8px 12px',borderRadius:'8px',background:'#fef2f2',border:'1px solid #fecaca',color:'#b91c1c',fontSize:'12.5px',marginBottom:'12px'}}>{dupMsg}</div>}
            <div style={{display:'flex',gap:'10px',justifyContent:'flex-end'}}>
              <button onClick={()=>setDupOpen(false)} disabled={duplicando} style={{background:'#fff',color:'#1a1a1a',border:'1px solid #ddd',borderRadius:'8px',padding:'9px 18px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>Annulla</button>
              <button onClick={confermaDuplica} disabled={duplicando} style={{background:'#f97316',color:'#fff',border:'none',borderRadius:'8px',padding:'9px 20px',fontSize:'13px',fontWeight:700,cursor:'pointer',opacity:duplicando?0.6:1}}>{duplicando?'Duplico…':'Duplica'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
