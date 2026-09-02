'use client'
import { useState, useEffect, useMemo } from 'react'
import { logoCorriere, serviziAccessoriDefault } from '@/lib/corriere-logo'
import { setFlash } from '@/lib/flash'
import { useDialog } from '@/app/components/DialogProvider'
import EditorMarkupFasce, { type MarkupOut } from '@/app/components/EditorMarkupFasce'

// Input decimale che accetta virgola o punto e valori parziali (es. "0.", "0,5")
// mentre scrivi, restituendo comunque il NUMERO al parent (nessuna modifica al salvataggio).
function NumInput({ value, onChange, style, placeholder }: { value: number; onChange: (n: number) => void; style?: React.CSSProperties; placeholder?: string }) {
  const [buf, setBuf] = useState<string | null>(null)
  const shown = buf !== null ? buf : (!value ? '' : String(value))
  return (
    <input
      type="text" inputMode="decimal" value={shown} placeholder={placeholder} style={style}
      onChange={e => {
        const v = e.target.value.replace(',', '.')
        if (v !== '' && !/^\d*\.?\d*$/.test(v)) return   // solo cifre e un punto decimale
        setBuf(v)
        onChange(v === '' || v === '.' ? 0 : (parseFloat(v) || 0))
      }}
      onBlur={() => setBuf(null)}
    />
  )
}

interface Zona { id: string; nome: string }
interface Corriere { id: string; nome_contratto: string; tipo?: string }
interface Fascia { tipo: 'fino_a' | 'oltre'; peso: number; prezzi: Record<string, string>; fuel?: string }
interface Props {
  listino: any; corrieri: Corriere[]; zone: Zona[]
  fasceEsistenti: any[]; clientiAssegnati: any[]; tipoListino: string
  corriereSelezionatoId?: string
  supplementiEsistenti?: any[]
  corrieriDisponibili?: Corriere[]
  fattoreCorriere?: number
  // Il MIO costo per questo corriere, chiave "tipo|peso|zona_id". Serve a segnalare a colpo
  // d'occhio le caselle in cui sto vendendo SOTTO COSTO: in creazione spedizione il blocco
  // c'e' gia', ma sul listino di un sotto-master non avvisava nulla e ce ne si accorgeva mesi
  // dopo guardando i margini (o non ce ne si accorgeva affatto).
  costiMaster?: Record<string, number>
}

const fattori = [
  {label:'350 kg/m³ (2857)',value:2857},{label:'300 kg/m³ (3333)',value:3333},
  {label:'250 kg/m³ (4000)',value:4000},{label:'200 kg/m³ (5000)',value:5000},
  {label:'166.66 kg/m³ (6000)',value:6000},{label:'150 kg/m³ (6666)',value:6666},
  {label:'125 kg/m³ (8000)',value:8000},{label:'100 kg/m³ (10000)',value:10000},
  {label:'Peso reale (no volumetrico)',value:0},
]

function buildFasceInit(fasceEsistenti: any[]): Fascia[] {
  if (!fasceEsistenti?.length) return [2,5,10,20,30,50].map(p => ({ tipo:'fino_a', peso:p, prezzi:{}, fuel:'' }))
  const map = new Map<string, Fascia>()
  for (const f of fasceEsistenti) {
    const peso = Number(f.peso_max); if (isNaN(peso)) continue
    const tipo = f.tipo === 'oltre' ? 'oltre' : 'fino_a'
    const key = `${tipo}_${peso}`
    if (!map.has(key)) map.set(key, { tipo, peso, prezzi: {}, fuel: String(f.fuel ?? '') })
    if (f.fuel != null && Number(f.fuel) > 0) map.get(key)!.fuel = String(f.fuel)
    map.get(key)!.prezzi[f.zona_id] = String(f.prezzo ?? '')
  }
  return Array.from(map.values()).sort((a,b) => {
    if (a.tipo === 'oltre') return 1
    if (b.tipo === 'oltre') return -1
    return a.peso - b.peso
  })
}

type RigaSuppl = { valore_max: string; prezzo_fisso: string; perc: string; calcolo_su: string }
const rigaVuota = (): RigaSuppl => ({ valore_max:'', prezzo_fisso:'', perc:'', calcolo_su:'totale' })

function parseDescr(s: any): any {
  try { return JSON.parse(s) } catch { return null }
}

function iniziali(nome: string): string {
  const p = (nome || '?').trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'
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

// Servizi accessori (EXTRA): voci personalizzabili per corriere. A differenza di buildServiziDa
// NON filtra su una lista fissa: carica TUTTE le voci salvate (nomi custom inclusi).
function buildAccessoriDa(supplementi: any[], fallback: {nome:string;prezzo:number;perc:number}[]) {
  const righe = (supplementi||[]).filter(s => s.tipo === 'accessorio')
  if (!righe.length) return fallback
  return righe.map(r => {
    const d = parseDescr(r.descrizione)
    return { nome: r.nome ?? d?.nome ?? '', prezzo: Number(d?.prezzo ?? r.valore ?? 0), perc: Number(d?.perc ?? 0) }
  })
}

export default function ListinoEditor({ listino, corrieri, zone, fasceEsistenti, clientiAssegnati, tipoListino, corriereSelezionatoId, supplementiEsistenti, corrieriDisponibili, fattoreCorriere, costiMaster }: Props) {
  const isCorriere = tipoListino === 'corriere'
  const apiAggancio = isCorriere ? '/api/listini/corriere-corrieri' : '/api/listini/cliente-corrieri'
  const basePagina = isCorriere ? '/dashboard/listini/corrieri' : '/dashboard/listini/clienti'
  const [aggiungendoContratto, setAggiungendoContratto] = useState(false)
  const [nuovoContrattoId, setNuovoContrattoId] = useState('')
  const [aggiungendoSaving, setAggiungendoSaving] = useState(false)

  async function confermaAggiungiContratto() {
    if (!nuovoContrattoId) return
    setAggiungendoSaving(true)
    await fetch(apiAggancio, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ listinoId: listino.id, corriereId: nuovoContrattoId })
    })
    window.location.href = `${basePagina}/${listino.id}?corriere=${nuovoContrattoId}`
  }
  const corriereId = corriereSelezionatoId || corrieri[0]?.id || ''
  // ZONE POSSEDUTE DAL MASTER: quelle per cui ho un costo su QUESTO corriere (da costiMaster).
  // Sulle altre non posso mettere un prezzo di vendita: venderei una zona che non compro, e nasce
  // l'"orfano" — un prezzo che a valle resta comunque bloccato perché il costo manca (è successo:
  // clienti con isole/disagiate prezzate ma non spedibili). Meglio non farlo scrivere proprio.
  // Guardia attiva SOLO se conosco i costi (costiMaster non vuoto) e SOLO su un listino di vendita
  // (mai sul listino-costo del master, dove le zone il costo ce l'hanno per definizione).
  const zoneMasterPossiede = useMemo(() => {
    const s = new Set<string>()
    for (const k of Object.keys(costiMaster || {})) { const zid = k.split('|')[2]; if (zid) s.add(zid) }
    return s
  }, [costiMaster])
  const guardiaCosti = !isCorriere && zoneMasterPossiede.size > 0
  const zonaBloccata = (zid: string) => guardiaCosti && !zoneMasterPossiede.has(zid)
  // BOZZA in corso: se vai a vedere un altro listino e poi torni la ritrovi (navigazione);
  // se invece RICARICHI la pagina (reload) riparte pulita dai dati salvati.
  const bozzaKey = `bozza_listino:${listino.id}:${corriereId}`
  const [bozza] = useState<any>(() => {
    if (typeof window === 'undefined') return null
    try {
      const nav = (performance.getEntriesByType('navigation')[0] as any)?.type
      if (nav === 'reload') { sessionStorage.removeItem(bozzaKey); return null }
      const raw = sessionStorage.getItem(bozzaKey)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })
  const [nome, setNome] = useState<string>(bozza?.nome ?? (listino.nome ?? ''))
  const [fattore, setFattore] = useState<number>(bozza?.fattore ?? (Number(fattoreCorriere ?? listino.fattore_volume) || 5000))
  const [soloPesoReale, setSoloPesoReale] = useState<boolean>(bozza?.soloPesoReale ?? !!(listino as any).solo_peso_reale)
  const [fasce, setFasce] = useState<Fascia[]>(() => bozza?.fasce ?? buildFasceInit(fasceEsistenti))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  // Logo del master per il circuito interno (stesso marchio dell'etichetta); se manca, restano le iniziali.
  const [masterLogo, setMasterLogo] = useState<string | null>(null)
  useEffect(() => { fetch('/api/master').then(r => r.json()).then(d => setMasterLogo(d?.logo_url || null)).catch(() => {}) }, [])
  const [tab, setTab] = useState('pesi')
  const [chiuso, setChiuso] = useState(false)   // collassa il corriere aperto senza cambiare pagina
  function toggleContratto(cId: string) {
    if (cId === corriereId) { setChiuso(x => !x); return }  // già aperto -> apri/chiudi
    apriContratto(cId)                                       // altro corriere -> naviga e apri
  }

  // Copia singolo corriere in un altro listino (esistente o nuovo)
  const [copia, setCopia] = useState<any>(null)
  const [listiniList, setListiniList] = useState<any[]>([])
  const [copiaModo, setCopiaModo] = useState<'esistente'|'nuovo'>('esistente')
  const [copiaTarget, setCopiaTarget] = useState('')
  const [copiaNome, setCopiaNome] = useState('')
  const [copiaSaving, setCopiaSaving] = useState(false)
  const [copiaErr, setCopiaErr] = useState('')
  const [copiaOk, setCopiaOk] = useState('')
  const [copiaMarkup, setCopiaMarkup] = useState<MarkupOut>({ default: null, perFascia: {} })
  // "Da costo": riempi i prezzi di un corriere dal COSTO del master con una maggiorazione (%/€ fisso).
  const [dcOpen, setDcOpen] = useState(false)
  const [dcCorr, setDcCorr] = useState<any>(null)
  const [dcFasce, setDcFasce] = useState<any[]>([])
  const [dcMarkup, setDcMarkup] = useState<MarkupOut>({ default: null, perFascia: {} })
  const [dcLoad, setDcLoad] = useState(false)
  const [dcSaving, setDcSaving] = useState(false)
  // "Da listino esistente": copia un corriere da un ALTRO listino cliente in questo (via duplica-corriere).
  // Serve p.es. ai preventivi: proporre un corriere che il master prezza già altrove, senza rifarlo dal costo.
  const [dlOpen, setDlOpen] = useState(false)
  const [dlListini, setDlListini] = useState<any[]>([])
  const [dlSourceId, setDlSourceId] = useState('')
  const [dlCorrieri, setDlCorrieri] = useState<any[]>([])
  const [dlCorrId, setDlCorrId] = useState('')
  const [dlFasce, setDlFasce] = useState<any[]>([])
  const [dlMarkup, setDlMarkup] = useState<MarkupOut>({ default: null, perFascia: {} })
  const [dlLoad, setDlLoad] = useState(false)
  const [dlSaving, setDlSaving] = useState(false)
  const [dlErr, setDlErr] = useState('')
  // Un modale aperto → blocca lo scroll della pagina sotto: senza questo la rotella "sfonda" e scorre
  // l'editor dietro invece del contenuto del popup (stesso pattern del widget Supporto).
  useEffect(() => { if (!dcOpen && !dlOpen && !copia) return; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [dcOpen, dlOpen, copia])
  async function apriDaCosto(c: any) {
    setDcCorr(c); setDcOpen(true); setDcLoad(true); setDcFasce([]); setDcMarkup({ default: null, perFascia: {} })
    try {
      const d = await fetch(`/api/listini/corrieri?corriere=${c.id}`).then(r => r.json())
      const raw = Array.isArray(d?.fasce) ? d.fasce : []
      const map = new Map<string, { tipo: string; peso: number; costi: number[] }>()
      for (const f of raw) { const tipo = f.tipo === 'oltre' ? 'oltre' : 'fino_a'; const peso = Number(f.peso_max); const k = `${tipo}_${peso}`; const pr = parseFloat(f.prezzo); if (!map.has(k)) map.set(k, { tipo, peso, costi: [] }); if (isFinite(pr) && pr > 0) map.get(k)!.costi.push(pr) }
      setDcFasce(Array.from(map.values()).sort((a, b) => a.tipo === 'oltre' ? 1 : b.tipo === 'oltre' ? -1 : a.peso - b.peso).map(g => ({ key: `${g.tipo}_${g.peso}`, label: g.tipo === 'oltre' ? `oltre ${g.peso} kg` : `fino a ${g.peso} kg`, tipo: g.tipo, peso: g.peso, costo: g.costi.length ? Math.min(...g.costi) : 0, costoMax: g.costi.length ? Math.max(...g.costi) : 0 })))
    } catch { setDcFasce([]) }
    setDcLoad(false)
  }
  async function confermaDaCosto() {
    if (!dcCorr) return
    setDcSaving(true)
    try {
      const res = await fetch('/api/listini/costo-in-cliente', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ corriereId: dcCorr.id, targetListinoId: listino.id, markup: dcMarkup, sovrascrivi: true }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d?.error) { await dialog.alert({ title: 'Errore', message: d?.error || 'Riempimento non riuscito' }); setDcSaving(false); return }
      window.location.reload()   // ricarica: le celle si riempiono coi prezzi (costo + margine)
    } catch { await dialog.alert({ title: 'Errore', message: 'Errore di rete' }); setDcSaving(false) }
  }
  const keyFasciaCopia = (f: Fascia) => `${f.tipo==='oltre'?'oltre':'fino_a'}_${Number(f.peso)}`
  // Fasce per l'editor markup: base = i prezzi del listino di ORIGINE (il piu' basso fra le zone della fascia).
  const fasceMarkupCopia = useMemo(() => fasce.map(f => {
    const costi = Object.values(f.prezzi || {}).map((v:any)=>parseFloat(v)).filter((n:number)=>isFinite(n)&&n>0)
    return { key: keyFasciaCopia(f), label: f.tipo==='oltre'?`oltre, ogni ${f.peso||'?'} kg`:`fino a ${f.peso||'?'} kg`, tipo: f.tipo, peso: Number(f.peso), costo: costi.length?Math.min(...costi):0, costoMax: costi.length?Math.max(...costi):0 }
  }), [fasce])
  async function apriCopia(c: any) {
    setCopia(c); setCopiaModo('esistente'); setCopiaTarget(''); setCopiaNome(''); setCopiaErr(''); setCopiaOk(''); setCopiaMarkup({ default: null, perFascia: {} })
    try { const r = await fetch('/api/listini/lista'); const d = await r.json(); setListiniList((Array.isArray(d)?d:[]).filter((x:any)=>x.id!==listino.id)) } catch { setListiniList([]) }
  }
  async function confermaCopia() {
    if (!copia) return
    if (copiaModo==='esistente' && !copiaTarget) { setCopiaErr('Seleziona un listino di destinazione'); return }
    if (copiaModo==='nuovo' && !copiaNome.trim()) { setCopiaErr('Inserisci il nome del nuovo listino'); return }
    setCopiaSaving(true); setCopiaErr('')
    const body: any = { sourceListinoId: listino.id, corriereId: copia.id }
    if (copiaModo==='nuovo') body.nuovoNome = copiaNome.trim(); else body.targetListinoId = copiaTarget
    body.markup = copiaMarkup
    const res = await fetch('/api/listini/duplica-corriere', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
    const d = await res.json().catch(()=>({}))
    setCopiaSaving(false)
    if (d?.error) { setCopiaErr(d.error); return }
    setCopiaOk('Corriere copiato con successo.')
    setTimeout(()=>{ window.location.href = `${basePagina}/${d.id}` }, 900)
  }

  // ── "Da listino esistente": porta DENTRO questo listino un corriere preso da un altro ──
  async function apriDaListino() {
    setDlOpen(true); setDlSourceId(''); setDlCorrieri([]); setDlCorrId(''); setDlFasce([]); setDlErr(''); setDlMarkup({ default: null, perFascia: {} })
    try { const r = await fetch('/api/listini/lista'); const d = await r.json(); setDlListini((Array.isArray(d)?d:[]).filter((x:any)=>x.id!==listino.id)) } catch { setDlListini([]) }
  }
  async function dlSelSource(id: string) {
    setDlSourceId(id); setDlCorrId(''); setDlFasce([]); setDlCorrieri([]); setDlErr(''); setDlMarkup({ default: null, perFascia: {} })
    if (!id) return
    setDlLoad(true)
    try { const d = await fetch(`/api/listini/corrieri-di?listino=${id}`).then(r=>r.json()); setDlCorrieri(Array.isArray(d?.corrieri)?d.corrieri:[]) } catch { setDlCorrieri([]) }
    setDlLoad(false)
  }
  function dlSelCorr(id: string) {
    setDlCorrId(id); setDlMarkup({ default: null, perFascia: {} })
    const c = dlCorrieri.find((x:any)=>x.id===id)
    const ff = (c?.fasce||[]).map((g:any)=>({ key: `${g.tipo}_${g.peso}`, label: g.tipo==='oltre'?`oltre ${g.peso} kg`:`fino a ${g.peso} kg`, tipo: g.tipo, peso: g.peso, costo: g.costo||0, costoMax: g.costoMax ?? g.costo ?? 0 }))
    setDlFasce(ff)
  }
  async function confermaDaListino() {
    if (!dlSourceId || !dlCorrId) { setDlErr('Scegli un listino e un corriere.'); return }
    setDlSaving(true); setDlErr('')
    try {
      const res = await fetch('/api/listini/duplica-corriere', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ sourceListinoId: dlSourceId, corriereId: dlCorrId, targetListinoId: listino.id, markup: dlMarkup }) })
      const d = await res.json().catch(()=>({}))
      if (!res.ok || d?.error) { setDlErr(d?.error || 'Copia non riuscita'); setDlSaving(false); return }
      window.location.reload()   // il corriere copiato compare nell'accordion
    } catch { setDlErr('Errore di rete'); setDlSaving(false) }
  }

  // ── Eliminazione: listino intero o singolo contratto, con conferma MoovExpress ──
  const dialog = useDialog()
  const [eliminando, setEliminando] = useState(false)
  async function eliminaListino() {
    const ok = await dialog.confirm({
      title: `Eliminare il listino "${nome}"?`,
      message: 'Cancella TUTTI i contratti, fasce e supplementi di questo listino. I clienti che ce l\'hanno assegnato resteranno senza listino. Lo storico delle spedizioni non cambia. Operazione irreversibile.',
      danger: true, confirmText: 'Elimina listino',
    })
    if (!ok) return
    setEliminando(true)
    const res = await fetch(`/api/listini/cliente/${listino.id}`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({}))
    setEliminando(false)
    if (d?.error) { await dialog.alert({ title: 'Errore', message: d.error }); return }
    window.location.href = '/dashboard/listini'
  }
  async function rimuoviCorriere(c: any) {
    const ok = await dialog.confirm({
      title: `Rimuovere "${c.nome_contratto}" da questo listino?`,
      message: 'Cancella le fasce peso/zona e i supplementi di questo contratto SOLO in questo listino. Gli altri contratti restano. Lo storico non cambia. Operazione irreversibile.',
      danger: true, confirmText: 'Rimuovi contratto',
    })
    if (!ok) return
    setEliminando(true)
    const res = await fetch('/api/listini/rimuovi-corriere', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listinoId: listino.id, corriereId: c.id }),
    })
    const d = await res.json().catch(() => ({}))
    setEliminando(false)
    if (d?.error) { await dialog.alert({ title: 'Errore', message: d.error }); return }
    window.location.href = `${basePagina}/${listino.id}`
  }

  const [righeAssic, setRigheAssic] = useState<RigaSuppl[]>(() => bozza?.righeAssic ?? buildRigheDa(supplementiEsistenti||[], 'assicurazione', [rigaVuota()]))
  const [righeContr, setRigheContr] = useState<RigaSuppl[]>(() => bozza?.righeContr ?? buildRigheDa(supplementiEsistenti||[], 'contrassegno', [rigaVuota(), rigaVuota()]))
  // Default dei servizi accessori DIVERSO per marca del corriere in modifica (GLS≠Poste≠SDA): il master
  // vede subito i servizi giusti da prezzare. Sui listini già compilati buildAccessoriDa tiene il salvato.
  const [serviziAccessori, setServiziAccessori] = useState(() => { const _c = corrieri.find(c => c.id === corriereId); return bozza?.serviziAccessori ?? buildAccessoriDa(supplementiEsistenti||[], serviziAccessoriDefault(_c?.nome_contratto, _c?.tipo)) })
  const [giacenzeServizi, setGiacenzeServizi] = useState(() => bozza?.giacenzeServizi ?? buildServiziDa(supplementiEsistenti||[], 'giacenza', [
    {nome:'Riconsegna',prezzo:0,perc:0},
    {nome:'Riconsegna al nuovo destinatario',prezzo:0,perc:0},
    {nome:'Reso al mittente',prezzo:0,perc:100},
    {nome:'Distruggere',prezzo:0,perc:0},
    {nome:'Il destinatario ritira la merce in sede',prezzo:0,perc:0},
    {nome:'Consegna parziale e rendi',prezzo:0,perc:0},
    {nome:'Consegna parziale e distruggi',prezzo:0,perc:0},
  ]))
  const [aperturaGiacenza, setAperturaGiacenza] = useState(() => {
    if (bozza?.aperturaGiacenza != null) return bozza.aperturaGiacenza
    const r = (supplementiEsistenti||[]).find(s => s.tipo === 'giacenza_apertura')
    return r ? Number(r.valore) || 0 : 0
  })
  const [ritiroPrezzo, setRitiroPrezzo] = useState(() => {
    if (bozza?.ritiroPrezzo != null) return bozza.ritiroPrezzo
    const r = (supplementiEsistenti||[]).find(s => s.tipo === 'ritiro')
    return r ? Number(r.valore) || 0 : 0
  })
  const [ritiroPercNolo, setRitiroPercNolo] = useState(() => {
    if (bozza?.ritiroPercNolo != null) return bozza.ritiroPercNolo
    const r = (supplementiEsistenti||[]).find(s => s.tipo === 'ritiro')
    const d = r ? parseDescr(r.descrizione) : null
    return d?.perc_nolo ? Number(d.perc_nolo) || 0 : 0
  })
  const [spondaSoglia, setSpondaSoglia] = useState(() => {
    if (bozza?.spondaSoglia != null) return bozza.spondaSoglia
    const r = (supplementiEsistenti||[]).find(s => s.tipo === 'sponda')
    const d = r ? parseDescr(r.descrizione) : null
    return d?.soglia_kg ? Number(d.soglia_kg) || 150 : 150
  })
  const [spondaPrezzoKg, setSpondaPrezzoKg] = useState(() => {
    if (bozza?.spondaPrezzoKg != null) return bozza.spondaPrezzoKg
    const r = (supplementiEsistenti||[]).find(s => s.tipo === 'sponda')
    return r ? Number(r.valore) || 0 : 0
  })

  // Salva la bozza in sessionStorage ad ogni modifica (persiste tra le navigazioni).
  useEffect(() => {
    try {
      sessionStorage.setItem(bozzaKey, JSON.stringify({ nome, fattore, soloPesoReale, fasce, righeAssic, righeContr, serviziAccessori, giacenzeServizi, aperturaGiacenza, ritiroPrezzo, ritiroPercNolo, spondaSoglia, spondaPrezzoKg }))
    } catch {}
  }, [bozzaKey, nome, fattore, soloPesoReale, fasce, righeAssic, righeContr, serviziAccessori, giacenzeServizi, aperturaGiacenza, ritiroPrezzo, ritiroPercNolo, spondaSoglia, spondaPrezzoKg])

  function aggiungiFascia() { setFasce(prev => [...prev, { tipo:'fino_a', peso:0, prezzi:{}, fuel:'' }]) }
  function aggiornaFuel(idx: number, raw: string) { setFasce(prev => prev.map((f,i) => i===idx ? {...f, fuel: raw} : f)) }
  function rimuoviFascia(idx: number) { setFasce(prev => prev.filter((_,i) => i !== idx)) }
  function aggiornaTipo(idx: number, tipo: 'fino_a'|'oltre') { setFasce(prev => prev.map((f,i) => i===idx ? {...f, tipo} : f)) }
  function aggiornaPeso(idx: number, raw: string) { const peso = parseFloat(raw); setFasce(prev => prev.map((f,i) => i===idx ? {...f, peso: isNaN(peso)?0:peso} : f)) }
  function aggiornaPrezzo(idx: number, zonaId: string, raw: string) { setFasce(prev => prev.map((f,i) => i===idx ? {...f, prezzi:{...f.prezzi,[zonaId]:raw}} : f)) }

  function setRigaAssic(i: number, k: keyof RigaSuppl, v: string) { setRigheAssic(prev => prev.map((r,idx) => idx===i ? {...r,[k]:v} : r)) }
  function setRigaContr(i: number, k: keyof RigaSuppl, v: string) { setRigheContr(prev => prev.map((r,idx) => idx===i ? {...r,[k]:v} : r)) }

  async function salva() {
    setSaving(true); setMsg('')
    try {
      const res = await fetch(`/api/listini/cliente/${listino.id}`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          nome, corriere_id: corriereId, fattore_volume: fattore, solo_peso_reale: soloPesoReale,
          fasce: fasce.map(f => ({...f, prezzi: Object.fromEntries(Object.entries(f.prezzi).map(([k,v]) => [k, parseFloat(v)||0]))})),
          supplementi: {
            assicurazione: righeAssic,
            contrassegno: righeContr,
            servizi: serviziAccessori,
            giacenze: { servizi: giacenzeServizi, apertura: aperturaGiacenza },
            ritiro: { prezzo: ritiroPrezzo, perc_nolo: ritiroPercNolo },
            sponda: { soglia_kg: spondaSoglia, prezzo_kg: spondaPrezzoKg },
          }
        })
      })
      const data = await res.json()
      if (data.error) { setMsg('Errore: '+data.error); setSaving(false); return }
      const prop = Number(data.propagati || 0)
      // Salva il banner e ricarica: la pagina torna coi dati salvati e mostra la conferma in alto
      try { sessionStorage.removeItem(bozzaKey) } catch {}   // salvato -> la bozza non serve più
      // La propagazione ai sotto-master ora prosegue in background (il salvataggio e' immediato).
      setFlash(data.propagazione === 'in corso'
        ? '✓ Listino salvato! I master collegati vengono aggiornati in automatico entro pochi istanti.'
        : (prop > 0 ? `✓ Listino salvato e propagato a ${prop} master collegati` : '✓ Listino salvato!'))
      window.location.reload()
    } catch { setMsg('Errore di rete'); setSaving(false) }
  }

  function apriContratto(cId: string) {
    if (cId === corriereId) return
    window.location.href = `${basePagina}/${listino.id}?corriere=${cId}`
  }

  const inp = {padding:'6px 8px',border:'1px solid #d1d5db',borderRadius:'5px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}
  const inpFull = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'5px',fontSize:'13px',color:'#1a1a1a',background:'#fff',width:'100%',textAlign:'right' as const,boxSizing:'border-box' as const}

  const tabStyle = (t:string) => ({
    padding:'9px 16px',background:'none',border:'none',cursor:'pointer',fontSize:'12px',
    fontWeight:tab===t?'700' as const:'400' as const,
    color:tab===t?'#f97316':'#1a1a1a',
    borderBottom:tab===t?'2px solid #f97316':'2px solid transparent',
    whiteSpace:'nowrap' as const
  })

  // Corpo dell'editor del contratto aperto (dentro la tendina)
  const editorContratto = (
    <div style={{borderTop:'1px solid #eee'}}>
      {/* Fattore peso/volume (per-corriere) + Salva */}
      <div style={{padding:'16px 18px',borderBottom:'1px solid #eee',display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap' as const}}>
        <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a'}}>Fattore Peso/Volume (kg/m³)</label>
        <select value={soloPesoReale ? 0 : fattore} onChange={e=>{const v=Number(e.target.value); if(v===0){setSoloPesoReale(true)}else{setSoloPesoReale(false);setFattore(v)}}} style={{...inp,padding:'8px 10px',minWidth:'220px'}}>
          {fattori.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        {soloPesoReale && <span style={{fontSize:'11px',color:'#f97316'}}>Il cliente paga sempre sul peso reale.</span>}
        <button onClick={salva} disabled={saving} style={{marginLeft:'auto',padding:'9px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:saving?0.7:1}}>
          {saving?'Salvo...':'Salva'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',borderBottom:'1px solid #d1d5db',padding:'0 16px',overflowX:'auto' as const}}>
        {[['pesi','Pesi / Zone'],['assicurazione','Assicurazione'],['contrassegni','Contrassegni'],['servizi','Servizi accessori'],['giacenze','Giacenze'],['ritiro','Ritiro'],['extra','Extra']].map(([k,l])=>(
          <button key={k} style={tabStyle(k)} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {/* PESI / ZONE */}
      {tab==='pesi' && (
        <div>
          {(() => {
            // Riepilogo sotto costo: senza questo un prezzo sbagliato passa inosservato e ci si
            // accorge della perdita solo mesi dopo, guardando i margini a spedizioni gia' fatte.
            if (!costiMaster) return null
            let n = 0
            for (const f of fasce) for (const z of zone) {
              const c = costiMaster[`${f.tipo}|${f.peso}|${z.id}`]
              const p = parseFloat(f.prezzi[z.id] ?? '')
              if (c != null && p > 0 && p < c) n++
            }
            if (!n) return null
            return (
              <div style={{margin:'12px 16px 0',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'8px',padding:'10px 14px',fontSize:'13px',color:'#b91c1c'}}>
                ⚠️ <b>{n} {n===1?'prezzo è':'prezzi sono'} sotto il tuo costo</b> — {n===1?'la casella è evidenziata':'le caselle sono evidenziate'} in rosso, con il costo indicato sotto. Puoi salvare lo stesso, ma su {n===1?'quella tratta':'quelle tratte'} ci rimetti.
              </div>
            )
          })()}
          {(() => {
            // Zone che il master NON possiede: non prezzabili (casella bloccata). Spiega perché, così
            // non sembra un errore. Senza questo nascevano prezzi "orfani" bloccati a valle.
            if (!guardiaCosti) return null
            const bloccate = zone.filter(z => zonaBloccata(z.id))
            if (!bloccate.length) return null
            return (
              <div style={{margin:'12px 16px 0',background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:'8px',padding:'10px 14px',fontSize:'13px',color:'#4b5563'}}>
                🔒 <b>{bloccate.length===1?'1 zona non è disponibile':`${bloccate.length} zone non sono disponibili`}</b> — non hai un costo per {bloccate.length===1?'questa zona':'queste zone'} su questo corriere, quindi non {bloccate.length===1?'la puoi':'le puoi'} prezzare: {bloccate.map(z=>z.nome).join(', ')}. Per attivarla, chiedi al tuo master.
              </div>
            )
          })()}
          <div style={{overflowX:'auto' as const}}>
            <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
              <thead>
                <tr style={{background:'#fafafa'}}>
                  <th style={{padding:'9px 12px',textAlign:'left' as const,fontWeight:'600',color:'#1a1a1a',fontSize:'11.5px',borderBottom:'1px solid #d1d5db',minWidth:'230px'}}>Peso (kg)</th>
                  {zone.map(z=>{ const bl = zonaBloccata(z.id); return (
                    <th key={z.id} style={{padding:'9px 10px',textAlign:'center' as const,fontWeight:'600',color:bl?'#9ca3af':'#1a1a1a',fontSize:'11.5px',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap' as const}}>
                      {z.nome} €{bl && <div style={{fontSize:'9px',fontWeight:500,color:'#9ca3af'}}>non disponibile</div>}
                    </th>
                  )})}
                  <th style={{padding:'9px 8px',textAlign:'center' as const,fontWeight:'600',color:'#1a1a1a',fontSize:'11.5px',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap' as const}}>Fuel %</th>
                  <th style={{padding:'9px 8px',borderBottom:'1px solid #d1d5db',width:'32px'}}></th>
                </tr>
              </thead>
              <tbody>
                {fasce.map((fascia, idx) => (
                  <tr key={idx} style={{borderBottom:'1px solid #e5e7eb',background:idx%2===0?'#fff':'#fafafa'}}>
                    <td style={{padding:'6px 10px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                        <select value={fascia.tipo} onChange={e=>aggiornaTipo(idx,e.target.value as 'fino_a'|'oltre')} style={{...inp,fontSize:'12px',width:'130px'}}>
                          <option value="fino_a">Fino a:</option>
                          <option value="oltre">Oltre X ogni</option>
                        </select>
                        <input type="number" value={fascia.peso===0?'':String(fascia.peso)} onChange={e=>aggiornaPeso(idx,e.target.value)} placeholder="0" min="0" step="0.5" style={{...inp,width:'65px',textAlign:'center' as const}}/>
                        <span style={{fontSize:'12px',color:'#666'}}>kg</span>
                      </div>
                    </td>
                    {zone.map(z=>{
                      const bloccata = zonaBloccata(z.id)
                      const costo = costiMaster?.[`${fascia.tipo}|${fascia.peso}|${z.id}`]
                      const prezzo = parseFloat(fascia.prezzi[z.id] ?? '')
                      const sottoCosto = !bloccata && costo != null && prezzo > 0 && prezzo < costo
                      return (
                      <td key={z.id} style={{padding:'6px 6px',textAlign:'center' as const}}>
                        <input type="number" value={fascia.prezzi[z.id]??''} disabled={bloccata}
                          onChange={e=>{ if (!bloccata) aggiornaPrezzo(idx,z.id,e.target.value) }} placeholder={bloccata?'—':'0.00'} min="0" step="0.01"
                          title={bloccata ? `Non possiedi il costo per «${z.nome}» su questo corriere: non puoi venderla. Chiedi al tuo master di attivare questa zona.` : (sottoCosto ? `Sotto costo: il tuo costo per ${z.nome} a questa fascia e' ${costo!.toFixed(2)} €` : (costo != null ? `Tuo costo: ${costo.toFixed(2)} €` : undefined))}
                          style={{...inp,width:'72px',textAlign:'right' as const,
                            ...(bloccata ? {background:'#f3f4f6',color:'#9ca3af',borderColor:'#e5e7eb',cursor:'not-allowed'} : {}),
                            ...(sottoCosto ? {borderColor:'#dc2626',background:'#fef2f2',color:'#b91c1c',fontWeight:700} : {})}}/>
                        {sottoCosto && <div style={{fontSize:'10px',color:'#dc2626',marginTop:'2px',whiteSpace:'nowrap' as const}}>costo {costo!.toFixed(2)}</div>}
                        {bloccata && <div style={{fontSize:'10px',color:'#9ca3af',marginTop:'2px',whiteSpace:'nowrap' as const}}>non disp.</div>}
                      </td>
                    )})}
                    <td style={{padding:'6px 6px',textAlign:'center' as const}}>
                      <input type="number" value={fascia.fuel??''} onChange={e=>aggiornaFuel(idx,e.target.value)} placeholder="0" min="0" step="0.01" style={{...inp,width:'60px',textAlign:'right' as const}}/>
                    </td>
                    <td style={{padding:'6px 8px',textAlign:'center' as const}}>
                      <button onClick={()=>rimuoviFascia(idx)} style={{width:'22px',height:'22px',borderRadius:'50%',background:'#fef2f2',border:'1px solid #fecaca',color:'#dc2626',cursor:'pointer',fontSize:'14px',display:'inline-flex',alignItems:'center',justifyContent:'center'}}>−</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{padding:'10px 16px',borderTop:'1px solid #e5e7eb',display:'flex',gap:'16px',alignItems:'center'}}>
            <button onClick={aggiungiFascia} style={{background:'none',border:'none',color:'#f97316',fontSize:'13px',fontWeight:'600',cursor:'pointer',padding:0}}>+ Aggiungi fascia</button>
            <span style={{fontSize:'11px',color:'#999'}}>Usa "Oltre X ogni" per i pesi oltre l'ultima fascia (copre anche i 1000 kg).</span>
          </div>
        </div>
      )}

      {/* ASSICURAZIONE */}
      {tab==='assicurazione' && (
        <div style={{padding:'16px'}}>
          <div style={{marginBottom:'12px',padding:'9px 12px',borderRadius:'8px',fontSize:'12.5px',fontWeight:600,...(righeAssic.some(r=>Number(r.valore_max)>0)?{background:'#f0fdf4',border:'1px solid #bbf7d0',color:'#15803d'}:{background:'#fff7ed',border:'1px solid #fed7aa',color:'#c2410c'})}}>
            {righeAssic.some(r=>Number(r.valore_max)>0)
              ? '✓ Servizio ATTIVO — l\'assicurazione è disponibile fino al valore massimo impostato.'
              : '⚠ Servizio NON attivo — valore massimo 0 o vuoto: il cliente non potrà spedire con assicurazione. Imposta un valore massimo maggiore di 0 per attivarlo.'}
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

      {/* CONTRASSEGNI */}
      {tab==='contrassegni' && (
        <div style={{padding:'16px'}}>
          <div style={{marginBottom:'12px',padding:'9px 12px',borderRadius:'8px',fontSize:'12.5px',fontWeight:600,...(righeContr.some(r=>Number(r.valore_max)>0)?{background:'#f0fdf4',border:'1px solid #bbf7d0',color:'#15803d'}:{background:'#fff7ed',border:'1px solid #fed7aa',color:'#c2410c'})}}>
            {righeContr.some(r=>Number(r.valore_max)>0)
              ? '✓ Servizio ATTIVO — il contrassegno è disponibile fino al valore massimo impostato.'
              : '⚠ Servizio NON attivo — valore massimo 0 o vuoto: il cliente non potrà spedire in contrassegno. Imposta un valore massimo maggiore di 0 per attivarlo.'}
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

      {/* SERVIZI ACCESSORI (EXTRA) — voci personalizzabili per corriere */}
      {tab==='servizi' && (
        <div style={{padding:'16px'}}>
          <div style={{fontSize:'12px',color:'#666',marginBottom:'12px'}}>Extra che il cliente può aggiungere alla spedizione (variano per corriere). Il nome è modificabile: aggiungi le voci che ti servono (es. Consegna al piano).</div>
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px',maxWidth:'760px'}}>
            <thead><tr style={{background:'#fafafa'}}>
              <th style={{textAlign:'left' as const,padding:'9px 12px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>Servizio</th>
              <th style={{textAlign:'left' as const,padding:'9px 12px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>Prezzo <span style={{color:'#666',fontWeight:'400'}}>€</span></th>
              <th style={{textAlign:'left' as const,padding:'9px 12px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>+% del valore della spedizione</th>
              <th style={{width:'40px',borderBottom:'1px solid #d1d5db'}}></th>
            </tr></thead>
            <tbody>
              {serviziAccessori.map((s,i)=>(
                <tr key={i} style={{borderBottom:'1px solid #e5e7eb'}}>
                  <td style={{padding:'8px 12px'}}><input value={s.nome||''} onChange={e=>setServiziAccessori(prev=>prev.map((x,idx)=>idx===i?{...x,nome:e.target.value}:x))} style={{...inp,width:'260px',color:'#f97316',fontWeight:'500'}} placeholder="Nome servizio (es. Consegna al piano)"/></td>
                  <td style={{padding:'8px 12px'}}><NumInput value={s.prezzo} onChange={n=>setServiziAccessori(prev=>prev.map((x,idx)=>idx===i?{...x,prezzo:n}:x))} style={{...inp,width:'120px',textAlign:'right' as const}} placeholder="0"/></td>
                  <td style={{padding:'8px 12px'}}><NumInput value={s.perc} onChange={n=>setServiziAccessori(prev=>prev.map((x,idx)=>idx===i?{...x,perc:n}:x))} style={{...inp,width:'200px',textAlign:'right' as const}} placeholder="0"/></td>
                  <td style={{padding:'8px 12px',textAlign:'center' as const}}><button onClick={()=>setServiziAccessori(prev=>prev.filter((_,idx)=>idx!==i))} title="Rimuovi voce" style={{background:'none',border:'none',color:'#dc2626',fontSize:'16px',cursor:'pointer',lineHeight:1,padding:0}}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={()=>setServiziAccessori(prev=>[...prev,{nome:'',prezzo:0,perc:0}])} style={{marginTop:'10px',background:'none',border:'none',color:'#f97316',fontSize:'13px',fontWeight:'600',cursor:'pointer',padding:0}}>+ Aggiungi servizio</button>
        </div>
      )}

      {/* GIACENZE */}
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
                  <td style={{padding:'8px 12px'}}><NumInput value={s.prezzo} onChange={n=>setGiacenzeServizi(prev=>prev.map((x,idx)=>idx===i?{...x,prezzo:n}:x))} style={{...inp,width:'120px',textAlign:'right' as const}} placeholder="0"/></td>
                  <td style={{padding:'8px 12px'}}><NumInput value={s.perc} onChange={n=>setGiacenzeServizi(prev=>prev.map((x,idx)=>idx===i?{...x,perc:n}:x))} style={{...inp,width:'200px',textAlign:'right' as const}} placeholder="0"/></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{marginTop:'16px',display:'flex',alignItems:'center',gap:'12px',fontSize:'13px'}}>
            <label style={{color:'#1a1a1a',fontWeight:'600'}}>Apertura dossier giacenza: <span style={{color:'#dc2626'}}>*</span></label>
            <NumInput value={aperturaGiacenza} onChange={setAperturaGiacenza} style={{...inp,width:'80px',textAlign:'right' as const}} placeholder="0"/>
          </div>
          <div style={{fontSize:'11px',color:'#f97316',marginTop:'4px'}}>* Il costo sarà addebitato solo nella fase di svincolo da parte del cliente</div>
        </div>
      )}

      {/* RITIRO */}
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
                <td style={{padding:'8px 12px'}}><NumInput value={ritiroPrezzo} onChange={setRitiroPrezzo} style={{...inp,width:'120px',textAlign:'right' as const}} placeholder="0"/></td>
                <td style={{padding:'8px 12px'}}><NumInput value={ritiroPercNolo} onChange={setRitiroPercNolo} style={{...inp,width:'200px',textAlign:'right' as const}} placeholder="0"/></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* EXTRA — Sponda idraulica */}
      {tab==='extra' && (
        <div style={{padding:'16px'}}>
          <div style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a',marginBottom:'4px'}}>Sponda idraulica (supplemento peso)</div>
          <div style={{fontSize:'12px',color:'#666',marginBottom:'14px'}}>La soglia è solo il trigger: da quel peso in su, il prezzo/kg si applica sul <b>totale dei kg</b> (peso fatturato). Es: soglia 200kg, 0,03 €/kg → 220kg = +220×0,03 = +6,60 €.</div>
          <div style={{display:'flex',gap:'20px',alignItems:'flex-end',flexWrap:'wrap' as const}}>
            <div>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Soglia (kg)</label>
              <NumInput value={spondaSoglia} onChange={setSpondaSoglia} style={{...inp,width:'120px',textAlign:'right' as const}} placeholder="150"/>
            </div>
            <div>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Prezzo per kg (€)</label>
              <NumInput value={spondaPrezzoKg} onChange={setSpondaPrezzoKg} style={{...inp,width:'180px',textAlign:'right' as const}} placeholder="0.0400334448"/>
            </div>
          </div>
          <div style={{fontSize:'11px',color:'#999',marginTop:'10px'}}>Lascia 0 per disattivare la sponda su questo contratto.</div>
        </div>
      )}
    </div>
  )

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <div style={{fontSize:'13px',marginBottom:'4px'}}>← <a href="/dashboard/listini" style={{color:'#f97316',textDecoration:'none'}}>Listini</a></div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap' as const,gap:'10px'}}>
          <div>
            <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Modifica: {listino.nome}</h1>
            <p style={{fontSize:'12.5px',color:'#666',margin:'4px 0 0'}}>Clicca su un contratto per aprirne il listino. Salvando, le modifiche si propagano ai master collegati.</p>
          </div>
          {!aggiungendoContratto && corrieriDisponibili && corrieriDisponibili.length > 0 && (
            <button onClick={()=>setAggiungendoContratto(true)}
              style={{background:'#f97316',border:'none',color:'#fff',padding:'9px 18px',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>
              + Aggiungi contratto
            </button>
          )}
          {!isCorriere && !aggiungendoContratto && (
            <button onClick={apriDaListino} title="Copia qui un corriere preso da un altro tuo listino"
              style={{background:'#fff7ed',border:'1px solid #fed7aa',color:'#ea580c',padding:'9px 16px',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>
              ⧉ Da listino esistente
            </button>
          )}
        </div>

        {aggiungendoContratto && (
          <div style={{marginTop:'12px',padding:'12px 14px',background:'#f9fafb',border:'1px solid #d1d5db',borderRadius:'6px',display:'flex',alignItems:'center',gap:'10px'}}>
            <select value={nuovoContrattoId} onChange={e=>setNuovoContrattoId(e.target.value)}
              style={{padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',color:'#1a1a1a',flex:1}}>
              <option value="">Seleziona contratto da aggiungere...</option>
              {(corrieriDisponibili||[]).map(c=>(
                <option key={c.id} value={c.id}>{c.nome_contratto}</option>
              ))}
            </select>
            <button onClick={confermaAggiungiContratto} disabled={aggiungendoSaving || !nuovoContrattoId}
              style={{padding:'7px 16px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:'pointer',opacity:(aggiungendoSaving||!nuovoContrattoId)?0.6:1}}>
              {aggiungendoSaving?'Aggiungo...':'Aggiungi'}
            </button>
            <button onClick={()=>{setAggiungendoContratto(false);setNuovoContrattoId('')}}
              style={{padding:'7px 16px',background:'#f5f5f5',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',cursor:'pointer',color:'#1a1a1a'}}>
              Annulla
            </button>
          </div>
        )}
      </div>

      {msg && <div style={{background:msg.startsWith('✓')?'#f0fdf4':'#fef2f2',border:`1px solid ${msg.startsWith('✓')?'#bbf7d0':'#fecaca'}`,borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:msg.startsWith('✓')?'#15803d':'#dc2626'}}>{msg}</div>}

      {/* Nome listino */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'14px 16px',marginBottom:'16px',display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap' as const}}>
        <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a'}}>Nome Listino</label>
        <input value={nome} onChange={e=>setNome(e.target.value)} style={{...inp,padding:'8px 11px',minWidth:'280px'}}/>
        {!isCorriere && (
          <button onClick={eliminaListino} disabled={eliminando} title="Elimina l'intero listino"
            style={{marginLeft:'auto',padding:'8px 14px',background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',borderRadius:'7px',fontSize:'12.5px',fontWeight:'700',cursor:'pointer',opacity:eliminando?0.6:1,whiteSpace:'nowrap' as const}}>🗑 Elimina listino</button>
        )}
      </div>

      {/* Accordion contratti */}
      {!corrieri.length ? (
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'40px',textAlign:'center' as const,color:'#666',fontSize:'13px',marginBottom:'16px'}}>
          Nessun contratto in questo listino. Usa "+ Aggiungi contratto".
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column' as const,gap:'10px',marginBottom:'16px'}}>
          {corrieri.map(c=>{
            const aperto = corriereId === c.id && !chiuso
            return (
              <div key={c.id} style={{background:'#fff',borderRadius:'10px',border:aperto?'1px solid #f97316':'1px solid #e5e7eb',overflow:'hidden',boxShadow:aperto?'0 1px 3px rgba(249,115,22,0.12)':'none'}}>
                <div onClick={()=>toggleContratto(c.id)}
                  style={{display:'flex',alignItems:'center',gap:'12px',padding:'12px 16px',cursor:'pointer',userSelect:'none' as const,background:aperto?'#fff7ed':'#fff'}}>
                  {logoCorriere(c.nome_contratto) ? (
                    <span style={{width:'56px',height:'40px',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      <img src={logoCorriere(c.nome_contratto)!} alt={c.nome_contratto} style={{maxWidth:'56px',maxHeight:'40px',objectFit:'contain' as const}}/>
                    </span>
                  ) : ((c as any).tipo === 'interno' && masterLogo) ? (
                    // Circuito interno: il marchio è quello del master (lo stesso dell'etichetta), non un logo provider.
                    <span style={{width:'56px',height:'40px',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      <img src={masterLogo} alt={c.nome_contratto} style={{maxWidth:'56px',maxHeight:'40px',objectFit:'contain' as const}}/>
                    </span>
                  ) : (
                    <span style={{width:'40px',height:'40px',borderRadius:'8px',background:aperto?'#f97316':'#f3f4f6',color:aperto?'#fff':'#6b7280',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'12px',fontWeight:'700',flexShrink:0}}>{iniziali(c.nome_contratto)}</span>
                  )}
                  <span style={{flex:1,fontSize:'14px',fontWeight:'600',color:'#1a1a1a'}}>{c.nome_contratto}</span>
                  {!isCorriere && (
                    <button onClick={(e)=>{e.stopPropagation(); apriDaCosto(c)}} title="Riempi i prezzi dal TUO costo con una maggiorazione (% o € fisso)"
                      style={{padding:'4px 10px',background:'#eff6ff',color:'#1d4ed8',border:'1px solid #bfdbfe',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:'pointer',whiteSpace:'nowrap' as const}}>€ Da costo</button>
                  )}
                  {!isCorriere && (
                    <button onClick={(e)=>{e.stopPropagation(); apriCopia(c)}} title="Copia questo corriere in un altro listino"
                      style={{padding:'4px 10px',background:'#fff7ed',color:'#ea580c',border:'1px solid #fed7aa',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:'pointer',whiteSpace:'nowrap' as const}}>⧉ Copia</button>
                  )}
                  {!isCorriere && (
                    <button onClick={(e)=>{e.stopPropagation(); rimuoviCorriere(c)}} disabled={eliminando} title="Rimuovi questo contratto dal listino"
                      style={{padding:'4px 9px',background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',borderRadius:'6px',fontSize:'13px',cursor:'pointer',opacity:eliminando?0.6:1}}>🗑</button>
                  )}
                  <span style={{fontSize:'18px',color:'#9ca3af',transform:aperto?'rotate(90deg)':'none',transition:'transform 0.15s'}}>›</span>
                </div>
                {aperto && editorContratto}
              </div>
            )
          })}
        </div>
      )}

      {/* Clienti assegnati */}
      {clientiAssegnati.length > 0 && (
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>
            Clienti con questo listino ({clientiAssegnati.length})
          </div>
          <div style={{padding:'12px'}}>
            {clientiAssegnati.map(c=>(
              <div key={c.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid #e5e7eb'}}>
                <div>
                  <div style={{fontWeight:'600',fontSize:'13px',color:'#1a1a1a'}}>{c.ragione_sociale}</div>
                  <div style={{fontSize:'11px',color:'#666'}}>{c.email}</div>
                </div>
                <a href={`/dashboard/clienti/${c.id}`} style={{fontSize:'12px',color:'#f97316',textDecoration:'none'}}>Apri →</a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Popup COPIA CORRIERE */}
      {dlOpen && (
        <div onClick={()=>!dlSaving && setDlOpen(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'20px',overflowY:'auto'}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:'12px',width:'100%',maxWidth:'560px',margin:'auto',maxHeight:'85vh',overflow:'auto',overscrollBehavior:'contain' as const,boxShadow:'0 10px 40px rgba(0,0,0,0.2)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'16px 20px',borderBottom:'1px solid #eee'}}>
              <span style={{fontWeight:800,fontSize:'15px',color:'#1a1a1a'}}>Aggiungi corriere da un listino esistente</span>
              <button onClick={()=>setDlOpen(false)} style={{background:'none',border:'none',fontSize:'20px',cursor:'pointer',color:'#999',lineHeight:1}}>×</button>
            </div>
            <div style={{padding:'18px 20px'}}>
              <p style={{fontSize:'12.5px',color:'#666',margin:'0 0 14px'}}>Scegli un altro tuo listino e il corriere da proporre: fasce, zone e supplementi vengono copiati qui. Puoi applicare una maggiorazione (% o € fisso) prima di copiare.</p>
              <label style={{fontSize:'12px',fontWeight:700,color:'#1a1a1a',display:'block',marginBottom:'6px'}}>Listino di origine</label>
              <select value={dlSourceId} onChange={e=>dlSelSource(e.target.value)} style={{width:'100%',padding:'9px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}}>
                <option value="">Seleziona un listino…</option>
                {dlListini.map((l:any)=><option key={l.id} value={l.id}>{l.nome}</option>)}
              </select>
              {dlSourceId && (
                <div style={{marginTop:'14px'}}>
                  <label style={{fontSize:'12px',fontWeight:700,color:'#1a1a1a',display:'block',marginBottom:'6px'}}>Corriere</label>
                  {dlLoad ? <div style={{fontSize:'12.5px',color:'#999'}}>Carico i corrieri…</div> : (
                    <select value={dlCorrId} onChange={e=>dlSelCorr(e.target.value)} style={{width:'100%',padding:'9px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}}>
                      <option value="">Seleziona un corriere…</option>
                      {dlCorrieri.map((c:any)=><option key={c.id} value={c.id}>{c.nome_contratto}</option>)}
                    </select>
                  )}
                  {dlSourceId && !dlLoad && dlCorrieri.length===0 && <div style={{marginTop:'8px',fontSize:'12px',color:'#999'}}>Questo listino non ha corrieri.</div>}
                </div>
              )}
              {dlCorrId && dlFasce.length>0 && (
                <div style={{marginTop:'16px'}}>
                  <label style={{fontSize:'12px',fontWeight:700,color:'#1a1a1a',display:'block',marginBottom:'6px'}}>Maggiorazione (opzionale)</label>
                  <EditorMarkupFasce fasce={dlFasce} onChange={setDlMarkup} />
                </div>
              )}
              {dlErr && <div style={{marginTop:'12px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'9px 12px',fontSize:'12.5px',color:'#dc2626'}}>{dlErr}</div>}
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',padding:'14px 20px',borderTop:'1px solid #eee'}}>
              <button onClick={()=>setDlOpen(false)} disabled={dlSaving} style={{padding:'9px 16px',background:'#fff',color:'#1a1a1a',border:'1px solid #ddd',borderRadius:'7px',fontSize:'13px',cursor:'pointer'}}>Annulla</button>
              <button onClick={confermaDaListino} disabled={dlSaving || !dlCorrId} style={{padding:'9px 20px',background:'#f97316',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:700,cursor:'pointer',opacity:(dlSaving||!dlCorrId)?0.6:1}}>{dlSaving?'Aggiungo…':'Aggiungi al listino'}</button>
            </div>
          </div>
        </div>
      )}

      {copia && (
        <div onClick={()=>!copiaSaving && setCopia(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'20px',overflowY:'auto'}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:'12px',width:'440px',maxWidth:'92vw',margin:'auto',boxShadow:'0 20px 60px rgba(0,0,0,.25)',overflow:'hidden'}}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid #eee',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontWeight:800,fontSize:'15px',color:'#1a1a1a'}}>Copia corriere</span>
              <button onClick={()=>setCopia(null)} style={{background:'none',border:'none',fontSize:'20px',cursor:'pointer',color:'#999',lineHeight:1}}>×</button>
            </div>
            <div style={{padding:'20px'}}>
              <div style={{fontSize:'13px',color:'#1a1a1a',marginBottom:'16px'}}>Copio <b>{copia.nome_contratto}</b> (fasce, zone e supplementi) in:</div>

              <div style={{display:'flex',gap:'10px',marginBottom:'14px'}}>
                <button onClick={()=>setCopiaModo('esistente')} style={{flex:1,padding:'9px',borderRadius:'8px',border:copiaModo==='esistente'?'2px solid #f97316':'1px solid #ddd',background:copiaModo==='esistente'?'#fff7ed':'#fff',color:'#1a1a1a',fontSize:'12.5px',fontWeight:700,cursor:'pointer'}}>Listino esistente</button>
                <button onClick={()=>setCopiaModo('nuovo')} style={{flex:1,padding:'9px',borderRadius:'8px',border:copiaModo==='nuovo'?'2px solid #f97316':'1px solid #ddd',background:copiaModo==='nuovo'?'#fff7ed':'#fff',color:'#1a1a1a',fontSize:'12.5px',fontWeight:700,cursor:'pointer'}}>Nuovo listino</button>
              </div>

              {copiaModo==='esistente' ? (
                <div>
                  <label style={{fontSize:'12px',fontWeight:600,color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Listino di destinazione</label>
                  <select value={copiaTarget} onChange={e=>setCopiaTarget(e.target.value)} style={{width:'100%',padding:'9px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}}>
                    <option value="">Seleziona un listino…</option>
                    {listiniList.map((l:any)=><option key={l.id} value={l.id}>{l.nome}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label style={{fontSize:'12px',fontWeight:600,color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Nome del nuovo listino</label>
                  <input value={copiaNome} onChange={e=>setCopiaNome(e.target.value)} placeholder="Es. Listino Standard 2" style={{width:'100%',padding:'9px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}}/>
                </div>
              )}

              <div style={{marginTop:'14px'}}>
                <label style={{fontSize:'12px',fontWeight:600,color:'#1a1a1a',display:'block',marginBottom:'8px'}}>Maggiorazione — con anteprima del prezzo</label>
                <EditorMarkupFasce fasce={fasceMarkupCopia} onChange={setCopiaMarkup} />
              </div>

              {copiaErr && <div style={{marginTop:'12px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'9px 12px',fontSize:'12.5px',color:'#dc2626'}}>{copiaErr}</div>}
              {copiaOk && <div style={{marginTop:'12px',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'9px 12px',fontSize:'12.5px',color:'#16a34a'}}>{copiaOk}</div>}
            </div>
            <div style={{padding:'14px 20px',borderTop:'1px solid #eee',display:'flex',justifyContent:'flex-end',gap:'10px'}}>
              <button onClick={()=>setCopia(null)} disabled={copiaSaving} style={{padding:'9px 16px',background:'#fff',color:'#1a1a1a',border:'1px solid #ddd',borderRadius:'7px',fontSize:'13px',cursor:'pointer'}}>Annulla</button>
              <button onClick={confermaCopia} disabled={copiaSaving} style={{padding:'9px 20px',background:'#f97316',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:700,cursor:'pointer',opacity:copiaSaving?0.7:1}}>{copiaSaving?'Copio…':'Copia'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Riempi dal costo + margine (%/€) */}
      {dcOpen && (
        <div onClick={()=>!dcSaving && setDcOpen(false)} style={{position:'fixed',inset:0,background:'rgba(15,15,15,0.55)',zIndex:9999,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'20px',overflowY:'auto'}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:'12px',width:'100%',maxWidth:'600px',margin:'auto',maxHeight:'86vh',overflowY:'auto' as const,overscrollBehavior:'contain' as const,padding:'20px'}}>
            <div style={{fontSize:'16px',fontWeight:800,color:'#1a1a1a',marginBottom:'4px'}}>Riempi dal costo — {dcCorr?.nome_contratto}</div>
            <div style={{fontSize:'12.5px',color:'#666',marginBottom:'14px'}}>Parte dal <b>tuo costo</b> su questo corriere e applica la maggiorazione (% o € fisso) su tutte le zone. Sovrascrive i prezzi attuali di questo contratto (le zone che non hai a costo restano vuote).</div>
            {dcLoad ? <div style={{padding:'20px',textAlign:'center',color:'#999',fontSize:'13px'}}>Carico il costo…</div>
              : dcFasce.length===0 ? <div style={{color:'#999',fontSize:'12.5px'}}>Nessun costo per questo corriere (non hai un contratto costo qui).</div>
                : <EditorMarkupFasce fasce={dcFasce} onChange={setDcMarkup} />}
            <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'16px'}}>
              <button onClick={()=>setDcOpen(false)} disabled={dcSaving} style={{padding:'9px 18px',background:'#fff',color:'#1a1a1a',border:'1px solid #ddd',borderRadius:'8px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>Annulla</button>
              <button onClick={confermaDaCosto} disabled={dcSaving||dcLoad||dcFasce.length===0} style={{padding:'9px 20px',background:'#f97316',color:'#fff',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:700,cursor:'pointer',opacity:(dcSaving||dcLoad||!dcFasce.length)?0.6:1}}>{dcSaving?'Riempio…':'Riempi i prezzi'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
