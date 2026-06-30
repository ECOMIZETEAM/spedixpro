'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const inp = {padding:'6px 8px',border:'1px solid #d1d5db',borderRadius:'5px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}
const inpFull = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'5px',fontSize:'13px',color:'#1a1a1a',background:'#fff',width:'100%',textAlign:'right' as const,boxSizing:'border-box' as const}

const fattori = [
  {label:'350 kg/m³ (2857)',value:2857},{label:'300 kg/m³ (3333)',value:3333},
  {label:'250 kg/m³ (4000)',value:4000},{label:'200 kg/m³ (5000)',value:5000},
  {label:'166.66 kg/m³ (6000)',value:6000},{label:'150 kg/m³ (6666)',value:6666},
  {label:'125 kg/m³ (8000)',value:8000},{label:'100 kg/m³ (10000)',value:10000},
]

type RigaSuppl = { valore_max:string; prezzo_fisso:string; perc:string; calcolo_su:string }
const rigaVuota = (): RigaSuppl => ({ valore_max:'', prezzo_fisso:'', perc:'', calcolo_su:'totale' })

type Fascia = { tipo:string; kg:string; prezzi:Record<string,string>; fuel:string }

const ZONE_DEFAULT = ['Sardegna','ITALIA','CALABRIA','SICILIA','LIVIGNO CAMPIONE','ISOLE MINORI','EUROPA 1','EUROPA 2','LOCALITA DISAGIATE']

export default function NuovoListinoCorrierePage() {
  const router = useRouter()
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [corriereId, setCorriereId] = useState('')
  const [nome, setNome] = useState('')
  const [saving, setSaving] = useState(false)
  const [errore, setErrore] = useState('')
  const [msg, setMsg] = useState('')
  const [tab, setTab] = useState('pesi')
  const [fattore, setFattore] = useState(5000)

  const [fasce, setFasce] = useState<Fascia[]>([
    {tipo:'fino_a',kg:'2',prezzi:{},fuel:'0'},
    {tipo:'fino_a',kg:'5',prezzi:{},fuel:'0'},
    {tipo:'fino_a',kg:'10',prezzi:{},fuel:'0'},
    {tipo:'fino_a',kg:'20',prezzi:{},fuel:'0'},
    {tipo:'fino_a',kg:'30',prezzi:{},fuel:'0'},
    {tipo:'fino_a',kg:'50',prezzi:{},fuel:'0'},
    {tipo:'oltre',kg:'100',prezzi:{},fuel:'0'},
  ])

  const [righeAssic, setRigheAssic] = useState<RigaSuppl[]>([rigaVuota()])
  const [righeContr, setRigheContr] = useState<RigaSuppl[]>([rigaVuota(), rigaVuota()])
  const [serviziAccessori, setServiziAccessori] = useState([
    {nome:'Reverse A Domicilio',prezzo:0,perc:0},
    {nome:'Andata & Ritorno',prezzo:0,perc:0},
    {nome:'Reverse PuntoPoste',prezzo:0,perc:0},
    {nome:'Reverse PuntoPoste Locker',prezzo:0,perc:0},
    {nome:'Reverse Ufficio Postale',prezzo:0,perc:0},
    {nome:'Consegna su appuntamento',prezzo:0,perc:0},
  ])
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

  useEffect(() => {
    fetch('/api/corrieri/lista').then(r=>r.json()).then(d=>setCorrieri(d||[]))
  }, [])

  function addFascia() { setFasce(prev=>[...prev,{tipo:'fino_a',kg:'',prezzi:{},fuel:'0'}]) }
  function removeFascia(i:number) { setFasce(prev=>prev.filter((_,idx)=>idx!==i)) }
  function setFasciaKg(i:number,val:string) { setFasce(prev=>prev.map((f,idx)=>idx===i?{...f,kg:val}:f)) }
  function setFasciaPrezzo(i:number,zona:string,val:string) { setFasce(prev=>prev.map((f,idx)=>idx===i?{...f,prezzi:{...f.prezzi,[zona]:val}}:f)) }
  function setFasciaFuel(i:number,val:string) { setFasce(prev=>prev.map((f,idx)=>idx===i?{...f,fuel:val}:f)) }
  function setFasciaTipo(i:number,val:string) { setFasce(prev=>prev.map((f,idx)=>idx===i?{...f,tipo:val}:f)) }
  function setRigaAssic(i:number,k:keyof RigaSuppl,v:string) { setRigheAssic(prev=>prev.map((r,idx)=>idx===i?{...r,[k]:v}:r)) }
  function setRigaContr(i:number,k:keyof RigaSuppl,v:string) { setRigheContr(prev=>prev.map((r,idx)=>idx===i?{...r,[k]:v}:r)) }

  async function salva() {
    if (!corriereId) { setErrore('Seleziona un contratto'); return }
    if (!nome.trim()) { setErrore('Inserisci il nome del listino'); return }
    setSaving(true); setErrore('')
    const fasceArr = fasce.map(f=>({
      corriere_id:corriereId, peso_max:parseFloat(f.kg)||0,
      zona:'MULTI', prezzo:0, fuel_perc:parseFloat(f.fuel)||0,
      tipo:f.tipo, prezzi_zone:f.prezzi,
    }))
    const supplementi = {
      assicurazione:righeAssic, contrassegno:righeContr,
      servizi:serviziAccessori,
      giacenze:{servizi:giacenzeServizi,apertura:aperturaGiacenza},
      ritiro:{prezzo:ritiroPrezzo,perc_nolo:ritiroPercNolo},
    }
    const res = await fetch('/api/listini/corrieri', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({corriereId, nome, fasce:fasceArr, supplementi, fattore_volume:fattore})
    })
    const data = await res.json()
    setSaving(false)
    if (data.error) { setErrore(data.error); return }
    setMsg('✓ Listino salvato!'); setTimeout(()=>setMsg(''),3000)
  }

  const tabStyle = (t:string) => ({
    padding:'9px 16px',background:'none',border:'none',cursor:'pointer',fontSize:'12px',
    fontWeight:tab===t?'700' as const:'400' as const,
    color:tab===t?'#f97316':'#1a1a1a',
    borderBottom:tab===t?'2px solid #f97316':'2px solid transparent',
    whiteSpace:'nowrap' as const
  })

  return (
    <div>
      <div style={{marginBottom:'8px'}}>
        <button onClick={()=>router.push('/dashboard/listini')} style={{background:'none',border:'none',color:'#f97316',fontSize:'13px',cursor:'pointer',padding:0,fontWeight:'600'}}>← Listini</button>
      </div>
      <div style={{marginBottom:'16px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Nuovo Listino Corriere</h1>
        <button onClick={salva} disabled={saving} style={{padding:'9px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:saving?0.7:1}}>
          {saving?'Salvo...':'Salva Listino'}
        </button>
      </div>

      {errore&&<div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'10px',marginBottom:'16px',fontSize:'13px',color:'#dc2626'}}>{errore}</div>}
      {msg&&<div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'10px',marginBottom:'16px',fontSize:'13px',color:'#16a34a'}}>{msg}</div>}

      {/* Impostazioni */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'20px',marginBottom:'16px'}}>
        <div style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a',marginBottom:'16px'}}>Impostazioni</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'16px'}}>
          <div>
            <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Nome Listino</label>
            <input value={nome} onChange={e=>setNome(e.target.value)} style={{...inp,width:'100%',padding:'8px 10px'}}/>
          </div>
          <div>
            <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Corriere</label>
            <select value={corriereId} onChange={e=>{setCorriereId(e.target.value);const c=corrieri.find(x=>x.id===e.target.value);if(c&&!nome)setNome(c.nome_contratto+' - Listino')}} style={{...inp,width:'100%',padding:'8px 10px'}}>
              <option value="">Seleziona contratto...</option>
              {corrieri.map((c:any)=><option key={c.id} value={c.id}>{c.nome_contratto}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Fattore Peso/Volume (kg/m³)</label>
            <select value={fattore} onChange={e=>setFattore(Number(e.target.value))} style={{...inp,width:'100%',padding:'8px 10px'}}>
              {fattori.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{display:'flex',borderBottom:'1px solid #d1d5db',padding:'0 16px',overflowX:'auto' as const}}>
          {[['pesi','Pesi / Zone'],['assicurazione','Assicurazione'],['contrassegni','Contrassegni'],['servizi','Servizi accessori'],['giacenze','Giacenze'],['ritiro','Ritiro']].map(([k,l])=>(
            <button key={k} style={tabStyle(k)} onClick={()=>setTab(k)}>{l}</button>
          ))}
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center'}}>
            <button onClick={salva} disabled={saving} style={{margin:'6px 0',padding:'6px 16px',background:'#f97316',color:'#fff',border:'none',borderRadius:'4px',fontSize:'12px',fontWeight:'700',cursor:'pointer'}}>Salva</button>
          </div>
        </div>

        {tab==='pesi' && (
          <div>
            <div style={{overflowX:'auto' as const}}>
              <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'12px'}}>
                <thead>
                  <tr style={{background:'#f9fafb'}}>
                    <th style={{padding:'8px 10px',borderBottom:'1px solid #d1d5db',color:'#1a1a1a',fontWeight:'700',textAlign:'left' as const}}>Peso (kg)</th>
                    <th style={{padding:'8px 6px',borderBottom:'1px solid #d1d5db',color:'#1a1a1a',fontWeight:'700'}}></th>
                    {ZONE_DEFAULT.map(z=>(
                      <th key={z} style={{padding:'8px 8px',borderBottom:'1px solid #d1d5db',color:'#1a1a1a',fontWeight:'700',textAlign:'center' as const,whiteSpace:'nowrap' as const}}>{z} €</th>
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
                          <input type="number" value={f.kg} onChange={e=>setFasciaKg(i,e.target.value)} style={{...inp,width:'55px',textAlign:'right' as const}}/>
                          <span style={{fontSize:'11px',color:'#666'}}>kg</span>
                        </div>
                      </td>
                      {ZONE_DEFAULT.map(z=>(
                        <td key={z} style={{padding:'4px 4px',textAlign:'center' as const}}>
                          <input type="number" step="0.01" value={f.prezzi[z]||''} onChange={e=>setFasciaPrezzo(i,z,e.target.value)} style={{...inp,width:'70px',textAlign:'right' as const}} placeholder="0.00"/>
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
            <div style={{padding:'10px 16px',borderTop:'1px solid #e5e7eb'}}>
              <button onClick={addFascia} style={{background:'none',border:'none',color:'#f97316',fontSize:'13px',fontWeight:'600',cursor:'pointer',padding:0}}>+ Aggiungi campo</button>
            </div>
          </div>
        )}

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
                        <option value="valore_merce">valore merce</option>
                        <option value="nolo">nolo</option>
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
                        <option value="valore_merce">valore merce</option>
                        <option value="nolo">nolo</option>
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
      </div>
    </div>
  )
}