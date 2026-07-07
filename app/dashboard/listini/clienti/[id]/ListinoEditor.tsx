'use client'
import { useState } from 'react'

interface Zona { id: string; nome: string }
interface Corriere { id: string; nome_contratto: string }
interface Fascia { tipo: 'fino_a' | 'oltre'; peso: number; prezzi: Record<string, string> }
interface Props {
  listino: any; corrieri: Corriere[]; zone: Zona[]
  fasceEsistenti: any[]; clientiAssegnati: any[]; tipoListino: string
  corriereSelezionatoId?: string
  supplementiEsistenti?: any[]
  corrieriDisponibili?: Corriere[]
  fattoreCorriere?: number
}

const fattori = [
  {label:'350 kg/m³ (2857)',value:2857},{label:'300 kg/m³ (3333)',value:3333},
  {label:'250 kg/m³ (4000)',value:4000},{label:'200 kg/m³ (5000)',value:5000},
  {label:'166.66 kg/m³ (6000)',value:6000},{label:'150 kg/m³ (6666)',value:6666},
  {label:'125 kg/m³ (8000)',value:8000},{label:'100 kg/m³ (10000)',value:10000},
  {label:'Peso reale (no volumetrico)',value:0},
]

function buildFasceInit(fasceEsistenti: any[]): Fascia[] {
  if (!fasceEsistenti?.length) return [2,5,10,20,30,50].map(p => ({ tipo:'fino_a', peso:p, prezzi:{} }))
  const map = new Map<string, Fascia>()
  for (const f of fasceEsistenti) {
    const peso = Number(f.peso_max); if (isNaN(peso)) continue
    const tipo = f.tipo === 'oltre' ? 'oltre' : 'fino_a'
    const key = `${tipo}_${peso}`
    if (!map.has(key)) map.set(key, { tipo, peso, prezzi: {} })
    map.get(key)!.prezzi[f.zona_id] = String(f.prezzo ?? '')
  }
  return Array.from(map.values()).sort((a,b) => a.peso - b.peso)
}

type RigaSuppl = { valore_max: string; prezzo_fisso: string; perc: string; calcolo_su: string }
const rigaVuota = (): RigaSuppl => ({ valore_max:'', prezzo_fisso:'', perc:'', calcolo_su:'totale' })

function parseDescr(s: any): any {
  try { return JSON.parse(s) } catch { return null }
}

function buildRigheDa(supplementi: any[], tipo: string, fallback: RigaSuppl[]): RigaSuppl[] {
  const righe = (supplementi||[]).filter(s => s.tipo === tipo)
  if (!righe.length) return fallback
  return righe.map(r => {
    const d = parseDescr(r.descrizione)
    if (d) return { valore_max: String(d.valore_max ?? ''), prezzo_fisso: String(d.prezzo_fisso ?? r.valore ?? ''), perc: String(d.perc ?? ''), calcolo_su: d.calcolo_su || r.tipo_calcolo || 'totale' }
    return { valore_max:'', prezzo_fisso: String(r.valore ?? ''), perc:'', calcolo_su: r.tipo_calcolo || 'totale' }
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

export default function ListinoEditor({ listino, corrieri, zone, fasceEsistenti, clientiAssegnati, tipoListino, corriereSelezionatoId, supplementiEsistenti, corrieriDisponibili, fattoreCorriere }: Props) {
  const isCorriere = tipoListino === 'corriere'
  const apiSalva = isCorriere ? '/api/listini/corriere' : '/api/listini/cliente'
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
  const [nome, setNome] = useState<string>(listino.nome ?? '')
  const [corriereId, setCorriereId] = useState<string>(corriereSelezionatoId || corrieri[0]?.id || '')
  const [fattore, setFattore] = useState<number>(Number(fattoreCorriere ?? listino.fattore_volume) || 5000)
  const [soloPesoReale, setSoloPesoReale] = useState<boolean>(!!(listino as any).solo_peso_reale)
  const [fasce, setFasce] = useState<Fascia[]>(() => buildFasceInit(fasceEsistenti))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [tab, setTab] = useState('pesi')

  const [righeAssic, setRigheAssic] = useState<RigaSuppl[]>(() => buildRigheDa(supplementiEsistenti||[], 'assicurazione', [rigaVuota()]))
  const [righeContr, setRigheContr] = useState<RigaSuppl[]>(() => buildRigheDa(supplementiEsistenti||[], 'contrassegno', [rigaVuota(), rigaVuota()]))

  const [serviziAccessori, setServiziAccessori] = useState(() => buildServiziDa(supplementiEsistenti||[], 'accessorio', [
    {nome:'Reverse A Domicilio', prezzo:0, perc:0},
    {nome:'Andata & Ritorno', prezzo:0, perc:0},
    {nome:'Reverse PuntoPoste', prezzo:0, perc:0},
    {nome:'Reverse PuntoPoste Locker', prezzo:0, perc:0},
    {nome:'Reverse Ufficio Postale', prezzo:0, perc:0},
    {nome:'Consegna su appuntamento', prezzo:0, perc:0},
  ]))

  const [giacenzeServizi, setGiacenzeServizi] = useState(() => buildServiziDa(supplementiEsistenti||[], 'giacenza', [
    {nome:'Riconsegna', prezzo:0, perc:0},
    {nome:'Riconsegna al nuovo destinatario', prezzo:0, perc:0},
    {nome:'Reso al mittente', prezzo:0, perc:100},
    {nome:'Distruggere', prezzo:0, perc:0},
    {nome:'Il destinatario ritira la merce in sede', prezzo:0, perc:0},
    {nome:'Consegna parziale e rendi', prezzo:0, perc:0},
    {nome:'Consegna parziale e distruggi', prezzo:0, perc:0},
  ]))
  const [aperturaGiacenza, setAperturaGiacenza] = useState(() => {
    const r = (supplementiEsistenti||[]).find(s => s.tipo === 'giacenza_apertura')
    return r ? Number(r.valore) || 0 : 0
  })

  const [ritiroPrezzo, setRitiroPrezzo] = useState(() => {
    const r = (supplementiEsistenti||[]).find(s => s.tipo === 'ritiro')
    return r ? Number(r.valore) || 0 : 0
  })
  const [ritiroPercNolo, setRitiroPercNolo] = useState(() => {
    const r = (supplementiEsistenti||[]).find(s => s.tipo === 'ritiro')
    const d = r ? parseDescr(r.descrizione) : null
    return d?.perc_nolo ? Number(d.perc_nolo) || 0 : 0
  })

  function aggiungiFascia() { setFasce(prev => [...prev, { tipo:'fino_a', peso:0, prezzi:{} }]) }
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
          }
        })
      })
      const data = await res.json()
      if (data.error) { setMsg('Errore: '+data.error); setSaving(false); return }
      setMsg('✓ Listino salvato!')
      setTimeout(() => setMsg(''), 3000)
    } catch { setMsg('Errore di rete') }
    setSaving(false)
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

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <div style={{fontSize:'13px',marginBottom:'4px'}}>← <a href="/dashboard/listini" style={{color:'#f97316',textDecoration:'none'}}>Listini</a></div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap' as const,gap:'10px'}}>
          <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Modifica: {listino.nome}</h1>
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            {!aggiungendoContratto && corrieriDisponibili && corrieriDisponibili.length > 0 && (
              <button onClick={()=>setAggiungendoContratto(true)}
                style={{background:'none',border:'1px solid #d1d5db',color:'#f97316',padding:'8px 16px',borderRadius:'6px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
                + Aggiungi contratto
              </button>
            )}
            <button onClick={salva} disabled={saving} style={{background:'#f97316',color:'#fff',border:'none',padding:'9px 24px',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:saving?0.7:1}}>
              {saving?'Salvataggio...':'Salva'}
            </button>
          </div>
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

      {/* Impostazioni */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden',marginBottom:'16px'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>Impostazioni</div>
        <div style={{padding:'16px',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px'}}>
          <div>
            <label style={{fontSize:'11.5px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Nome Listino</label>
            <input value={nome} onChange={e=>setNome(e.target.value)} style={{...inp,width:'100%',padding:'8px 11px'}}/>
          </div>
          <div>
            <label style={{fontSize:'11.5px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Corriere</label>
            <select value={corriereId} onChange={e=>{
              setCorriereId(e.target.value)
              window.location.href = `${basePagina}/${listino.id}?corriere=${e.target.value}`
            }} style={{...inp,width:'100%',padding:'8px 11px'}}>
              {corrieri.map(c=><option key={c.id} value={c.id}>{c.nome_contratto}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:'11.5px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Fattore Peso/Volume (kg/m³)</label>
            <select value={soloPesoReale ? 0 : fattore} onChange={e=>{const v=Number(e.target.value); if(v===0){setSoloPesoReale(true)}else{setSoloPesoReale(false);setFattore(v)}}} style={{...inp,width:'100%',padding:'8px 11px'}}>
              {fattori.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            {soloPesoReale && <div style={{fontSize:'11px',color:'#f97316',marginTop:'3px'}}>Il cliente paga sempre sul peso reale, anche con misure grandi.</div>}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden',marginBottom:'16px'}}>
        <div style={{display:'flex',borderBottom:'1px solid #d1d5db',padding:'0 16px',overflowX:'auto' as const}}>
          {[['pesi','Pesi / Zone'],['assicurazione','Assicurazione'],['contrassegni','Contrassegni'],['servizi','Servizi accessori'],['giacenze','Giacenze'],['ritiro','Ritiro']].map(([k,l])=>(
            <button key={k} style={tabStyle(k)} onClick={()=>setTab(k)}>{l}</button>
          ))}
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center'}}>
            <button onClick={salva} disabled={saving} style={{margin:'6px 0',padding:'6px 16px',background:'#f97316',color:'#fff',border:'none',borderRadius:'4px',fontSize:'12px',fontWeight:'700',cursor:'pointer'}}>
              Salva
            </button>
          </div>
        </div>

        {/* PESI / ZONE */}
        {tab==='pesi' && (
          <div>
            <div style={{overflowX:'auto' as const}}>
              <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
                <thead>
                  <tr style={{background:'#fafafa'}}>
                    <th style={{padding:'9px 12px',textAlign:'left' as const,fontWeight:'600',color:'#1a1a1a',fontSize:'11.5px',borderBottom:'1px solid #d1d5db',minWidth:'230px'}}>Peso (kg)</th>
                    {zone.map(z=>(
                      <th key={z.id} style={{padding:'9px 10px',textAlign:'center' as const,fontWeight:'600',color:'#1a1a1a',fontSize:'11.5px',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap' as const}}>
                        {z.nome} €
                      </th>
                    ))}
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
                      {zone.map(z=>(
                        <td key={z.id} style={{padding:'6px 6px',textAlign:'center' as const}}>
                          <input type="number" value={fascia.prezzi[z.id]??''} onChange={e=>aggiornaPrezzo(idx,z.id,e.target.value)} placeholder="0.00" min="0" step="0.01" style={{...inp,width:'72px',textAlign:'right' as const}}/>
                        </td>
                      ))}
                      <td style={{padding:'6px 8px',textAlign:'center' as const}}>
                        <button onClick={()=>rimuoviFascia(idx)} style={{width:'22px',height:'22px',borderRadius:'50%',background:'#fef2f2',border:'1px solid #fecaca',color:'#dc2626',cursor:'pointer',fontSize:'14px',display:'inline-flex',alignItems:'center',justifyContent:'center'}}>−</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{padding:'10px 16px',borderTop:'1px solid #e5e7eb'}}>
              <button onClick={aggiungiFascia} style={{background:'none',border:'none',color:'#f97316',fontSize:'13px',fontWeight:'600',cursor:'pointer',padding:0}}>+ Aggiungi campo</button>
            </div>
          </div>
        )}

        {/* ASSICURAZIONE */}
        {tab==='assicurazione' && (
          <div style={{padding:'16px'}}>
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

        {/* SERVIZI ACCESSORI */}
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
                    <td style={{padding:'8px 12px'}}><input type="number" step="0.01" value={s.prezzo||''} onChange={e=>setGiacenzeServizi(prev=>prev.map((x,idx)=>idx===i?{...x,prezzo:parseFloat(e.target.value)||0}:x))} style={{...inp,width:'120px',textAlign:'right' as const}} placeholder="0"/></td>
                    <td style={{padding:'8px 12px'}}><input type="number" step="0.01" value={s.perc||''} onChange={e=>setGiacenzeServizi(prev=>prev.map((x,idx)=>idx===i?{...x,perc:parseFloat(e.target.value)||0}:x))} style={{...inp,width:'200px',textAlign:'right' as const}} placeholder="0"/></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{marginTop:'16px',display:'flex',alignItems:'center',gap:'12px',fontSize:'13px'}}>
              <label style={{color:'#1a1a1a',fontWeight:'600'}}>Apertura dossier giacenza: <span style={{color:'#dc2626'}}>*</span></label>
              <input type="number" step="0.01" value={aperturaGiacenza||''} onChange={e=>setAperturaGiacenza(parseFloat(e.target.value)||0)}
                style={{...inp,width:'80px',textAlign:'right' as const}} placeholder="0"/>
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
                  <td style={{padding:'8px 12px'}}><input type="number" step="0.01" value={ritiroPrezzo||''} onChange={e=>setRitiroPrezzo(parseFloat(e.target.value)||0)} style={{...inp,width:'120px',textAlign:'right' as const}} placeholder="0"/></td>
                  <td style={{padding:'8px 12px'}}><input type="number" step="0.01" value={ritiroPercNolo||''} onChange={e=>setRitiroPercNolo(parseFloat(e.target.value)||0)} style={{...inp,width:'200px',textAlign:'right' as const}} placeholder="0"/></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

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
    </div>
  )
}
