'use client'
import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { logoCorriere } from '@/lib/corriere-logo'

export default function ZonePage() {
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [zone, setZone] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [modalNuovaCorr, setModalNuovaCorr] = useState<string|null>(null)
  const [modalModifica, setModalModifica] = useState<any>(null)
  const [modalSposta, setModalSposta] = useState<any>(null)
  const [modalCopia, setModalCopia] = useState<any>(null)   // corriere di origine da cui copiare le zone
  const [copiando, setCopiando] = useState(false)
  const [syncing, setSyncing] = useState<string|null>(null)
  const [formNuova, setFormNuova] = useState({nome:'',descrizione:'',con_fuel:false})
  const [formMod, setFormMod] = useState({nome:'',descrizione:'',con_fuel:false})
  const [regioni, setRegioni] = useState<any[]>([])
  const [formRegione, setFormRegione] = useState({paese:'IT',provincia:'',cap:'*',citta:'*'})
  const [savingReg, setSavingReg] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editReg, setEditReg] = useState<any>(null)
  const [importing, setImporting] = useState('')
  const [brand, setBrand] = useState('')

  useEffect(() => { load() }, [])

  // Brand = prima parola del nome contratto (BRT, SDA, Poste, UPS…)
  const brandKey = (c:any) => ((c?.nome_contratto||'').trim().split(/\s+/)[0]||'').toUpperCase()
  const brands:{key:string,label:string}[] = []
  const _seen = new Set<string>()
  for(const c of corrieri){ const k=brandKey(c); if(k && !_seen.has(k)){ _seen.add(k); brands.push({key:k, label:(c.nome_contratto||'').trim().split(/\s+/)[0]}) } }

  useEffect(() => {
    if(!corrieri.length) return
    const keys = brands.map(b=>b.key)
    if(!brand || !keys.includes(brand)) setBrand(keys[0]||'')
  }, [corrieri])

  async function load() {
    setLoading(true)
    const c = await fetch('/api/corrieri/lista').then(r=>r.json()).catch(()=>[])
    const z = await fetch('/api/zone').then(r=>r.json()).catch(()=>[])
    setCorrieri(Array.isArray(c)?c:[])
    setZone(Array.isArray(z)?z:[])
    setLoading(false)
  }

  // Forza la propagazione di tutte le zone del corriere ai sotto-master (le modifiche singole
  // propagano già da sole; questo è il "riallinea tutto adesso").
  async function syncZone(corriereId:string) {
    setSyncing(corriereId)
    try {
      const r = await fetch('/api/zone/sync-corriere',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({corriereId})}).then(r=>r.json())
      alert(r?.ok ? `Zone propagate ai sotto-master (${r.zone_sincronizzate} zone).` : (r?.error||'Errore sync'))
    } catch { alert('Errore durante la propagazione') }
    setSyncing(null); await load()
  }

  async function salvaZona() {
    if(!modalNuovaCorr) return
    if(!formNuova.nome.trim()){ alert('Inserisci il nome della zona'); return }
    setSaving(true)
    const res = await fetch('/api/zone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...formNuova,corriereId:modalNuovaCorr})})
    const d = await res.json().catch(()=>({}))
    setSaving(false)
    if(!res.ok || d?.error){ alert(d?.error || 'Errore durante il salvataggio della zona'); return }
    setFormNuova({nome:'',descrizione:'',con_fuel:false}); setModalNuovaCorr(null); load()
  }

  async function salvaMod() {
    setSaving(true)
    await fetch('/api/zone/'+modalModifica.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(formMod)})
    setModalModifica(null); setSaving(false); load()
  }
  async function caricaRegioni(zonaId:string) {
    const r = await fetch('/api/zone/'+zonaId+'/cap').then(r=>r.json()).catch(()=>[])
    setRegioni(Array.isArray(r)?r:[])
  }
  async function aggiungiRegione() {
    if(!modalModifica) return
    // Multi-CAP: il campo CAP accetta piu valori separati da virgola/spazio/a-capo
    const caps = (formRegione.cap||'*').split(/[\s,;]+/).map(c=>c.trim()).filter(Boolean)
    const lista = caps.length ? caps : ['*']
    setSavingReg(true)
    if(lista.length>1){
      const rows = lista.map(c=>({paese:formRegione.paese,provincia:formRegione.provincia,cap:c,citta:formRegione.citta}))
      const res = await fetch('/api/zone/'+modalModifica.id+'/cap',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows})})
      const d = await res.json()
      setSavingReg(false)
      if(d?.error){ alert(d.error); return }
    } else {
      const res = await fetch('/api/zone/'+modalModifica.id+'/cap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...formRegione,cap:lista[0]})})
      const d = await res.json()
      setSavingReg(false)
      if(d?.error){ alert(d.error); return }
    }
    setFormRegione({paese:'IT',provincia:'',cap:'*',citta:'*'})
    caricaRegioni(modalModifica.id); load()
  }
  async function salvaEditRegione() {
    if(!modalModifica || !editReg) return
    setSavingReg(true)
    const res = await fetch('/api/zone/'+modalModifica.id+'/cap',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(editReg)})
    const d = await res.json()
    setSavingReg(false)
    if(d?.error){ alert(d.error); return }
    setEditReg(null)
    caricaRegioni(modalModifica.id); load()
  }
  async function eliminaRegione(capId:string) {
    if(!modalModifica) return
    await fetch('/api/zone/'+modalModifica.id+'/cap?capId='+capId,{method:'DELETE'})
    caricaRegioni(modalModifica.id); load()
  }

  async function elimina(id:string,nome:string) {
    if(!confirm('Eliminare "'+nome+'"?')) return
    await fetch('/api/zone/'+id,{method:'DELETE'}); load()
  }

  async function sposta(zonaId:string,corrId:string) {
    await fetch('/api/zone/'+zonaId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({corriere_id:corrId})})
    setModalSposta(null); load()
  }

  async function copiaZone(fromCorr:any, toId:string) {
    setCopiando(true)
    const res = await fetch('/api/zone/copia',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fromCorriereId:fromCorr.id,toCorriereId:toId})})
    const d = await res.json().catch(()=>({}))
    setCopiando(false)
    if(!res.ok || d?.error){ alert(d?.error||'Errore durante la copia'); return }
    setModalCopia(null)
    alert(`Copiate ${d.create} zone`+(d.saltate?` (${d.saltate} già presenti, saltate)`:'')+'.')
    load()
  }

  // Export XLSX nel formato spedisci.online: colonne country_id / province / cap / city,
  // una riga per regione della zona.
  async function esporta(z:any) {
    const regs:any[] = await fetch('/api/zone/'+z.id+'/cap').then(r=>r.json()).catch(()=>[])
    const righe = (Array.isArray(regs)?regs:[]).map((r:any)=>({
      country_id: r.paese, province: r.provincia, cap: r.cap, city: r.citta,
    }))
    if(!righe.length) righe.push({country_id:'IT',province:'*',cap:'*',city:'*'})
    const corr = corrieri.find(c=>c.id===z.corriere_id)
    const ws = XLSX.utils.json_to_sheet(righe, {header:['country_id','province','cap','city']})
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Zona')
    const nomeCorr = (corr?.nome_contratto||'Corriere').replace(/[\\/:*?"<>|]/g,'')
    const nomeZona = (z.nome||'zona').replace(/[\\/:*?"<>|]/g,'')
    XLSX.writeFile(wb, `${nomeCorr}_${nomeZona}.xlsx`)
  }

  // Import XLSX (formato spedisci.online): legge country_id/province/cap/city e
  // sostituisce le regioni della zona.
  async function importaXlsx(zonaId:string, file:File) {
    setImporting(zonaId)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const dati:any[] = XLSX.utils.sheet_to_json(ws, {defval:''})
      const rows = dati.map((r:any)=>{
        // accetta sia le intestazioni spedisci.online sia varianti italiane
        const paese = r.country_id ?? r.paese ?? r.Paese ?? r.COUNTRY_ID ?? ''
        const provincia = r.province ?? r.provincia ?? r.Provincia ?? r.PROVINCE ?? '*'
        const cap = r.cap ?? r.CAP ?? r.zip ?? '*'
        const citta = r.city ?? r.citta ?? r.Citta ?? r.CITY ?? '*'
        return {paese:String(paese).trim(),provincia:String(provincia).trim(),cap:String(cap).trim(),citta:String(citta).trim()}
      }).filter(r=>r.paese)
      if(!rows.length){ alert('Nessuna riga valida nel file (attese colonne country_id/province/cap/city).'); setImporting(''); return }
      const res = await fetch('/api/zone/'+zonaId+'/cap',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows,replace:true})})
      const d = await res.json()
      if(d?.error){ alert(d.error); setImporting(''); return }
      alert(`Importate ${d.inserite} regioni nella zona.`)
      if(modalModifica?.id===zonaId) caricaRegioni(zonaId)
      load()
    } catch(e:any){
      alert('Errore lettura file: '+(e?.message||e))
    }
    setImporting('')
  }

  // Riepilogo regioni per la colonna "Paese (Pr) CAP Città" (come spedisci.online)
  function riepilogoRegioni(z:any):string {
    const regs:any[] = Array.isArray(z?.zone_cap) ? z.zone_cap : []
    if(!regs.length) return z?.descrizione || '—'
    const fmt=(r:any)=>{
      const citta = (r.citta==null || r.citta==='' || r.citta==='null') ? '' : ` ${r.citta}`
      return `${r.paese} (${r.provincia}) ${r.cap}${citta}`
    }
    const max=15
    const parts=regs.map(fmt)
    return parts.length>max ? parts.slice(0,max).join(' · ')+' · ……' : parts.join(' · ')
  }

  const inp={padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',width:'100%',boxSizing:'border-box' as const}
  const ibtn=(bg:string,color:string,border:string)=>({width:'28px',height:'28px',background:bg,color,border:`1px solid ${border}`,borderRadius:'4px',cursor:'pointer',fontSize:'13px',display:'inline-flex' as const,alignItems:'center' as const,justifyContent:'center' as const})
  const brandBtn=(k:string)=>({padding:'8px 18px',background:'none',border:'none',cursor:'pointer',fontSize:'14px',fontWeight:brand===k?'700' as const:'500' as const,color:brand===k?'#f97316':'#1a1a1a',borderBottom:brand===k?'3px solid #f97316':'3px solid transparent',whiteSpace:'nowrap' as const})

  if(loading) return <div style={{padding:'40px',textAlign:'center' as const,color:'#666'}}>Caricamento...</div>

  return (
    <div>
      <div style={{marginBottom:'16px'}}><h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Gestione Zone</h1></div>

      {!corrieri.length && (
        <div style={{padding:'40px',textAlign:'center' as const,color:'#666',fontSize:'13px',background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db'}}>Nessun corriere configurato</div>
      )}

      {brands.length>0 && (
        <div style={{display:'flex',gap:'4px',borderBottom:'1px solid #d1d5db',marginBottom:'20px',overflowX:'auto' as const}}>
          {brands.map(b=><button key={b.key} style={brandBtn(b.key)} onClick={()=>setBrand(b.key)}>{b.label}</button>)}
        </div>
      )}

      {corrieri.filter((c:any)=>brandKey(c)===brand).map((c:any)=>{
        const zoneC = zone.filter(z=>z.corriere_id===c.id)
        return (
          <div key={c.id} style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden',marginBottom:'20px'}}>
            <div style={{padding:'16px'}}>
              <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'16px'}}>
                {logoCorriere(c?.nome_contratto) ? (
                  <img src={logoCorriere(c?.nome_contratto)!} alt={c?.nome_contratto||''} style={{height:'34px',maxWidth:'80px',objectFit:'contain' as const}}/>
                ) : (
                  <div style={{width:'60px',height:'36px',background:'#1a1a1a',borderRadius:'4px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:'700',color:'#fff'}}>{(c?.nome_contratto||'').trim().split(/\s+/)[0]?.toUpperCase()||'—'}</div>
                )}
                <span style={{fontSize:'16px',fontWeight:'700',color:'#1a1a1a'}}>{c?.nome_contratto}</span>
              </div>
              <div style={{display:'flex',gap:'8px',marginBottom:'16px'}}>
                <button onClick={()=>{setFormNuova({nome:'',descrizione:'',con_fuel:false});setModalNuovaCorr(c.id)}} style={{background:'none',border:'none',color:'#f97316',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>+Aggiungi zona</button>
                <button onClick={()=>syncZone(c.id)} disabled={syncing===c.id} style={{padding:'6px 14px',background:'#fff',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',cursor:syncing===c.id?'default':'pointer',color:'#1a1a1a'}}>{syncing===c.id?'⏳ Sincronizzo…':'🔄 Propaga ai sotto-master'}</button>
                {zoneC.length>0 && <button onClick={()=>setModalCopia(c)} style={{padding:'6px 14px',background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:'6px',fontSize:'12px',cursor:'pointer',color:'#2563eb',fontWeight:'600'}}>⧉ Copia zone su altro corriere</button>}
              </div>
              {!zoneC.length ? (
                <div style={{padding:'30px',textAlign:'center' as const,color:'#666',fontSize:'13px'}}>Nessuna zona configurata</div>
              ) : (
                <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
                  <thead><tr>
                    {['Nome','Opzioni','Paese (Pr) CAP Città','Modifica/Esporta/Importa/Sposta',''].map(h=>(
                      <th key={h} style={{textAlign:'left' as const,padding:'9px 12px',fontSize:'11px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {zoneC.map((z:any)=>(
                      <tr key={z.id} style={{borderBottom:'1px solid #e5e7eb'}}>
                        <td style={{padding:'10px 12px',fontWeight:'600',color:'#f97316'}}>{z.nome}</td>
                        <td style={{padding:'10px 12px'}}>
                          {z.con_fuel&&<span style={{background:'#f97316',color:'#fff',padding:'2px 8px',borderRadius:'20px',fontSize:'11px',fontWeight:'700'}}>Fuel</span>}
                        </td>
                        <td style={{padding:'10px 12px',color:'#1a1a1a',fontSize:'12px',maxWidth:'500px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' as const}} title={riepilogoRegioni(z)}>{riepilogoRegioni(z)}</td>
                        <td style={{padding:'10px 12px'}}>
                          <div style={{display:'flex',gap:'4px'}}>
                            <button onClick={()=>{setModalModifica(z);setFormMod({nome:z.nome,descrizione:z.descrizione||'',con_fuel:z.con_fuel||false});setRegioni([]);setEditReg(null);caricaRegioni(z.id)}} style={ibtn('#16a34a','#fff','#86efac')}>✏️</button>
                            <button onClick={()=>esporta(z)} title="Esporta zona (XLSX)" style={ibtn('#fff','#1a1a1a','#d1d5db')}>⬇</button>
                            <label title="Importa regioni (XLSX spedisci.online)" style={{...ibtn('#fff','#1a1a1a','#d1d5db'),cursor:importing===z.id?'wait':'pointer',opacity:importing===z.id?0.5:1}}>
                              {importing===z.id?'…':'⬆'}<input type="file" accept=".xlsx,.xls,.csv" disabled={!!importing} style={{display:'none'}} onChange={async e=>{
                                const f=e.target.files?.[0]; e.target.value=''; if(!f)return
                                await importaXlsx(z.id, f)
                              }}/>
                            </label>
                            <button onClick={()=>setModalSposta(z)} style={ibtn('#fff','#1a1a1a','#d1d5db')}>↪</button>
                          </div>
                        </td>
                        <td style={{padding:'10px 8px'}}>
                          <button onClick={()=>elimina(z.id,z.nome)} style={{background:'none',border:'none',color:'#dc2626',fontSize:'16px',cursor:'pointer'}}>🗑️</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )
      })}

      {modalNuovaCorr&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={()=>setModalNuovaCorr(null)}>
          <div style={{background:'#fff',borderRadius:'8px',width:'500px'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',display:'flex',justifyContent:'space-between'}}>
              <span style={{fontWeight:'700',color:'#1a1a1a'}}>Aggiungi Zona — {corrieri.find(c=>c.id===modalNuovaCorr)?.nome_contratto||''}</span>
              <button onClick={()=>setModalNuovaCorr(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:'18px'}}>✕</button>
            </div>
            <div style={{padding:'20px'}}>
              <div style={{marginBottom:'12px'}}><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Nome</label><input value={formNuova.nome} onChange={e=>setFormNuova(f=>({...f,nome:e.target.value}))} style={inp} placeholder="es. SARDEGNA"/></div>
              <div style={{marginBottom:'12px'}}><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Descrizione</label><textarea value={formNuova.descrizione} onChange={e=>setFormNuova(f=>({...f,descrizione:e.target.value}))} rows={4} style={{...inp,resize:'vertical' as const}} placeholder="opzionale"/></div>
              <div style={{marginBottom:'16px',display:'flex',alignItems:'center',gap:'8px'}}><input type="checkbox" checked={formNuova.con_fuel} onChange={e=>setFormNuova(f=>({...f,con_fuel:e.target.checked}))} id="fn"/><label htmlFor="fn" style={{fontSize:'13px',color:'#1a1a1a',cursor:'pointer'}}>Applica supplemento Fuel</label></div>
              <div style={{display:'flex',gap:'10px',justifyContent:'flex-end'}}>
                <button onClick={()=>setModalNuovaCorr(null)} style={{padding:'8px 16px',background:'#f5f5f5',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',cursor:'pointer',color:'#1a1a1a'}}>Annulla</button>
                <button onClick={salvaZona} disabled={saving} style={{padding:'8px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>Aggiungi</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalModifica&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={()=>setModalModifica(null)}>
          <div style={{background:'#fff',borderRadius:'8px',width:'600px'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',display:'flex',justifyContent:'space-between'}}>
              <span style={{fontWeight:'700',color:'#1a1a1a'}}>Modifica — {modalModifica.nome}</span>
              <button onClick={()=>setModalModifica(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:'18px'}}>✕</button>
            </div>
            <div style={{padding:'20px'}}>
              <div style={{marginBottom:'12px'}}><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Nome</label><input value={formMod.nome} onChange={e=>setFormMod(f=>({...f,nome:e.target.value}))} style={inp}/></div>
              <div style={{marginBottom:'12px'}}><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Descrizione</label><textarea value={formMod.descrizione} onChange={e=>setFormMod(f=>({...f,descrizione:e.target.value}))} rows={5} style={{...inp,resize:'vertical' as const}}/></div>
              <div style={{marginBottom:'16px',display:'flex',alignItems:'center',gap:'8px'}}><input type="checkbox" checked={formMod.con_fuel} onChange={e=>setFormMod(f=>({...f,con_fuel:e.target.checked}))} id="fm"/><label htmlFor="fm" style={{fontSize:'13px',color:'#1a1a1a',cursor:'pointer'}}>Applica supplemento Fuel</label></div>
              <div style={{marginBottom:'8px',paddingTop:'12px',borderTop:'1px solid #e5e7eb'}}>
                <label style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',display:'block',marginBottom:'8px'}}>Regioni (Paese / Provincia / CAP / Città)</label>
                <div style={{maxHeight:'180px',overflowY:'auto' as const,marginBottom:'10px',border:'1px solid #e8e8e8',borderRadius:'6px'}}>
                  {regioni.length===0 ? (
                    <div style={{padding:'14px',textAlign:'center' as const,color:'#999',fontSize:'12px'}}>Nessuna regione. Aggiungine una qui sotto.</div>
                  ) : (
                    <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'12px'}}>
                      <thead><tr style={{background:'#f9fafb'}}>
                        <th style={{padding:'6px 8px',textAlign:'left' as const,color:'#666'}}>Paese</th>
                        <th style={{padding:'6px 8px',textAlign:'left' as const,color:'#666'}}>Prov.</th>
                        <th style={{padding:'6px 8px',textAlign:'left' as const,color:'#666'}}>CAP</th>
                        <th style={{padding:'6px 8px',textAlign:'left' as const,color:'#666'}}>Città</th>
                        <th></th>
                      </tr></thead>
                      <tbody>
                        {regioni.map((r:any)=>(
                          editReg?.capId===r.id ? (
                            <tr key={r.id} style={{borderTop:'1px solid #f0f0f0',background:'#fffdf5'}}>
                              <td style={{padding:'4px 6px'}}><input value={editReg.paese} onChange={e=>setEditReg((v:any)=>({...v,paese:e.target.value}))} style={{...inp,padding:'4px 6px',fontSize:'12px'}}/></td>
                              <td style={{padding:'4px 6px'}}><input value={editReg.provincia} onChange={e=>setEditReg((v:any)=>({...v,provincia:e.target.value}))} style={{...inp,padding:'4px 6px',fontSize:'12px'}}/></td>
                              <td style={{padding:'4px 6px'}}><input value={editReg.cap} onChange={e=>setEditReg((v:any)=>({...v,cap:e.target.value}))} style={{...inp,padding:'4px 6px',fontSize:'12px'}}/></td>
                              <td style={{padding:'4px 6px'}}><input value={editReg.citta} onChange={e=>setEditReg((v:any)=>({...v,citta:e.target.value}))} style={{...inp,padding:'4px 6px',fontSize:'12px'}}/></td>
                              <td style={{padding:'4px 6px',textAlign:'right' as const,whiteSpace:'nowrap' as const}}>
                                <button onClick={salvaEditRegione} disabled={savingReg} title="Salva" style={{background:'none',border:'none',cursor:'pointer',color:'#16a34a',fontSize:'14px'}}>✔</button>
                                <button onClick={()=>setEditReg(null)} title="Annulla" style={{background:'none',border:'none',cursor:'pointer',color:'#666',fontSize:'14px'}}>✕</button>
                              </td>
                            </tr>
                          ) : (
                            <tr key={r.id} style={{borderTop:'1px solid #f0f0f0'}}>
                              <td style={{padding:'6px 8px',color:'#1a1a1a'}}>{r.paese}</td>
                              <td style={{padding:'6px 8px',color:'#1a1a1a'}}>{r.provincia}</td>
                              <td style={{padding:'6px 8px',color:'#1a1a1a'}}>{r.cap}</td>
                              <td style={{padding:'6px 8px',color:'#1a1a1a'}}>{r.citta}</td>
                              <td style={{padding:'6px 8px',textAlign:'right' as const,whiteSpace:'nowrap' as const}}>
                                <button onClick={()=>setEditReg({capId:r.id,paese:r.paese,provincia:r.provincia,cap:r.cap,citta:r.citta})} title="Modifica" style={{background:'none',border:'none',cursor:'pointer',color:'#16a34a',fontSize:'13px'}}>✏️</button>
                                <button onClick={()=>eliminaRegione(r.id)} title="Elimina" style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',fontSize:'14px'}}>🗑</button>
                              </td>
                            </tr>
                          )
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr auto',gap:'6px',alignItems:'end'}}>
                  <div><label style={{fontSize:'11px',color:'#666',display:'block',marginBottom:'2px'}}>Paese</label><input value={formRegione.paese} onChange={e=>setFormRegione(f=>({...f,paese:e.target.value}))} placeholder="IT" style={{...inp,padding:'6px 8px',fontSize:'12px'}}/></div>
                  <div><label style={{fontSize:'11px',color:'#666',display:'block',marginBottom:'2px'}}>Provincia</label><input value={formRegione.provincia} onChange={e=>setFormRegione(f=>({...f,provincia:e.target.value}))} placeholder="* o RM" style={{...inp,padding:'6px 8px',fontSize:'12px'}}/></div>
                  <div><label style={{fontSize:'11px',color:'#666',display:'block',marginBottom:'2px'}}>CAP</label><input value={formRegione.cap} onChange={e=>setFormRegione(f=>({...f,cap:e.target.value}))} placeholder="*" style={{...inp,padding:'6px 8px',fontSize:'12px'}}/></div>
                  <div><label style={{fontSize:'11px',color:'#666',display:'block',marginBottom:'2px'}}>Città</label><input value={formRegione.citta} onChange={e=>setFormRegione(f=>({...f,citta:e.target.value}))} placeholder="*" style={{...inp,padding:'6px 8px',fontSize:'12px'}}/></div>
                  <button onClick={aggiungiRegione} disabled={savingReg} style={{padding:'7px 12px',background:'#16a34a',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:'pointer',whiteSpace:'nowrap' as const}}>+ Aggiungi</button>
                </div>
                <div style={{fontSize:'11px',color:'#999',marginTop:'6px'}}>Usa <b>*</b> per "qualsiasi". Es: Paese IT, Provincia RM, CAP * = tutta la provincia di Roma. Paese DE, Provincia *, CAP * = tutta la Germania. Nel campo CAP puoi inserire <b>più valori</b> separati da virgola o spazio.</div>
              </div>
              <div style={{display:'flex',gap:'10px',justifyContent:'flex-end'}}>
                <button onClick={()=>setModalModifica(null)} style={{padding:'8px 16px',background:'#f5f5f5',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',cursor:'pointer',color:'#1a1a1a'}}>Annulla</button>
                <button onClick={salvaMod} disabled={saving} style={{padding:'8px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>Salva</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalCopia&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={()=>!copiando&&setModalCopia(null)}>
          <div style={{background:'#fff',borderRadius:'8px',width:'440px',maxWidth:'95vw'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',display:'flex',justifyContent:'space-between'}}>
              <span style={{fontWeight:'700',color:'#1a1a1a'}}>Copia zone da {modalCopia.nome_contratto}</span>
              <button onClick={()=>setModalCopia(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:'18px'}}>✕</button>
            </div>
            <div style={{padding:'20px'}}>
              <div style={{fontSize:'12.5px',color:'#666',marginBottom:'12px'}}>Scegli il corriere su cui copiare tutte le zone (con i CAP) di <b>{modalCopia.nome_contratto}</b>. Le zone con lo stesso nome già presenti vengono saltate.</div>
              <div style={{display:'flex',flexDirection:'column' as const,gap:'8px'}}>
                {corrieri.filter(c=>c.id!==modalCopia.id).map(c=>(
                  <button key={c.id} disabled={copiando} onClick={()=>copiaZone(modalCopia,c.id)} style={{padding:'10px 14px',background:'#f9fafb',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',cursor:copiando?'wait':'pointer',color:'#1a1a1a',textAlign:'left' as const,opacity:copiando?0.6:1}}>{c.nome_contratto}</button>
                ))}
                {corrieri.filter(c=>c.id!==modalCopia.id).length===0 && <div style={{fontSize:'12px',color:'#999',textAlign:'center' as const,padding:'10px'}}>Nessun altro corriere disponibile</div>}
              </div>
              <button onClick={()=>setModalCopia(null)} disabled={copiando} style={{marginTop:'12px',padding:'8px',background:'#f5f5f5',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',cursor:'pointer',color:'#1a1a1a',width:'100%'}}>Annulla</button>
            </div>
          </div>
        </div>
      )}

      {modalSposta&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={()=>setModalSposta(null)}>
          <div style={{background:'#fff',borderRadius:'8px',width:'400px'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',display:'flex',justifyContent:'space-between'}}>
              <span style={{fontWeight:'700',color:'#1a1a1a'}}>Sposta — {modalSposta.nome}</span>
              <button onClick={()=>setModalSposta(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:'18px'}}>✕</button>
            </div>
            <div style={{padding:'20px'}}>
              <div style={{display:'flex',flexDirection:'column' as const,gap:'8px'}}>
                {corrieri.filter(c=>c.id!==modalSposta.corriere_id).map(c=>(
                  <button key={c.id} onClick={()=>sposta(modalSposta.id,c.id)} style={{padding:'10px 14px',background:'#f9fafb',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',cursor:'pointer',color:'#1a1a1a',textAlign:'left' as const}}>{c.nome_contratto}</button>
                ))}
              </div>
              <button onClick={()=>setModalSposta(null)} style={{marginTop:'12px',padding:'8px',background:'#f5f5f5',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',cursor:'pointer',color:'#1a1a1a',width:'100%'}}>Annulla</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
