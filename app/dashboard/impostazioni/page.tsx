'use client'
import { useState, useEffect } from 'react'
import { PROVINCE_IT } from '@/lib/province-it'

const inp = {padding:'8px 11px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',width:'100%',boxSizing:'border-box' as const}
const lbl = {fontSize:'12px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

import { useDialog } from '@/app/components/DialogProvider'
export default function ImpostazioniPage() {
  const dialog = useDialog()
  const [tab, setTab] = useState<'azienda'|'fatturazione'|'pagamento'|'sede'>('azienda')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dati, setDati] = useState({
    ragione_sociale:'', partita_iva:'', codice_fiscale:'',
    indirizzo:'', cap:'', citta:'', paese:'IT', provincia:'',
    telefono:'', email_sede:'', email_supporto:'',
    iban:'', banca:'', intestatario:'',
    indirizzo_fatturazione:'', cap_fatturazione:'', citta_fatturazione:'', provincia_fatturazione:'',
    pec:'', codice_sdi:'',
    indirizzo_operativo:'', cap_operativo:'', citta_operativo:'', provincia_operativo:'', telefono_operativo:''
  })

  useEffect(() => {
    fetch('/api/master').then(r=>r.json()).then(d=>{
      if (d && !d.error) setDati(prev=>({...prev,...d}))
    })
  }, [])

  const setF = (k:string,v:string) => setDati(f=>({...f,[k]:v}))

  async function salva() {
    setSaving(true)
    try {
      const res = await fetch('/api/master', {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(dati)
      })
      const out = await res.json().catch(()=>({}))
      if (!res.ok || out?.error) { await dialog.alert({ title: 'Errore', message: 'Errore nel salvataggio: ' + (out?.error || res.status) }); return }
      setSaved(true); setTimeout(()=>setSaved(false), 3000)
    } catch(e:any) {
      await dialog.alert({ title: 'Errore', message: 'Errore di rete nel salvataggio.' })
    } finally {
      setSaving(false)
    }
  }

  const tabStyle = (t:string) => ({
    padding:'10px 20px',background:'none',border:'none',cursor:'pointer',fontSize:'13px',
    fontWeight:tab===t?'700' as const:'400' as const,
    color:tab===t?'#f97316':'#666',
    borderBottom:tab===t?'2px solid #f97316':'2px solid transparent'
  })

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Impostazioni</h1>
      </div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{display:'flex',borderBottom:'1px solid #d1d5db',padding:'0 16px'}}>
          <button style={tabStyle('azienda')} onClick={()=>setTab('azienda')}>Azienda</button>
          <button style={tabStyle('fatturazione')} onClick={()=>setTab('fatturazione')}>Fatturazione</button>
          <button style={tabStyle('pagamento')} onClick={()=>setTab('pagamento')}>Dati Pagamento</button>
          <button style={tabStyle('sede')} onClick={()=>setTab('sede')}>Sede Operativa</button>
        </div>
        <div style={{padding:'24px'}}>

          {tab==='azienda' && (
            <div>
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:'16px',marginBottom:'16px'}}>
                <div><label style={lbl}>Ragione sociale</label>
                  <input value={dati.ragione_sociale} onChange={e=>setF('ragione_sociale',e.target.value)} style={inp}/>
                </div>
                <div><label style={lbl}>Partita IVA</label>
                  <input value={dati.partita_iva} onChange={e=>setF('partita_iva',e.target.value)} style={inp}/>
                </div>
              </div>
              <div style={{marginBottom:'16px'}}>
                <label style={lbl}>Indirizzo</label>
                <input value={dati.indirizzo} onChange={e=>setF('indirizzo',e.target.value)} style={inp}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 2fr 1fr 1fr',gap:'16px',marginBottom:'16px'}}>
                <div><label style={lbl}>CAP</label>
                  <input value={dati.cap} onChange={e=>setF('cap',e.target.value)} style={inp}/>
                </div>
                <div><label style={lbl}>Città</label>
                  <input value={dati.citta} onChange={e=>setF('citta',e.target.value)} style={inp}/>
                </div>
                <div><label style={lbl}>Paese</label>
                  <input value={dati.paese} onChange={e=>setF('paese',e.target.value)} style={inp}/>
                </div>
                <div><label style={lbl}>Provincia</label>
                  <select value={dati.provincia} onChange={e=>setF('provincia',e.target.value)} style={{...inp}}>
                    <option value="">Seleziona</option>
                    {PROVINCE_IT.map(p=><option key={p.sigla} value={p.sigla}>{p.nome} ({p.sigla})</option>)}
                  </select>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px',marginBottom:'16px'}}>
                <div><label style={lbl}>Telefono</label>
                  <input value={dati.telefono} onChange={e=>setF('telefono',e.target.value)} style={inp}/>
                </div>
                <div><label style={lbl}>Codice Fiscale</label>
                  <input value={dati.codice_fiscale} onChange={e=>setF('codice_fiscale',e.target.value)} style={inp}/>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px',marginBottom:'16px'}}>
                <div><label style={lbl}>E-Mail Sede</label>
                  <input value={dati.email_sede} onChange={e=>setF('email_sede',e.target.value)} style={inp}/>
                </div>
                <div><label style={lbl}>E-Mail Supporto Tecnico</label>
                  <input value={dati.email_supporto} onChange={e=>setF('email_supporto',e.target.value)} style={inp}/>
                </div>
              </div>
            </div>
          )}

          {tab==='fatturazione' && (
            <div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px',marginBottom:'16px'}}>
                <div><label style={lbl}>PEC</label>
                  <input value={dati.pec} onChange={e=>setF('pec',e.target.value)} style={inp} placeholder="email@pec.it"/>
                </div>
                <div><label style={lbl}>Codice SDI</label>
                  <input value={dati.codice_sdi} onChange={e=>setF('codice_sdi',e.target.value)} style={inp} placeholder="es. XXXXXXX"/>
                </div>
              </div>
              <div style={{marginBottom:'16px'}}>
                <label style={lbl}>Indirizzo Fatturazione</label>
                <input value={dati.indirizzo_fatturazione} onChange={e=>setF('indirizzo_fatturazione',e.target.value)} style={inp}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 2fr 1fr',gap:'16px',marginBottom:'16px'}}>
                <div><label style={lbl}>CAP</label>
                  <input value={dati.cap_fatturazione} onChange={e=>setF('cap_fatturazione',e.target.value)} style={inp}/>
                </div>
                <div><label style={lbl}>Città</label>
                  <input value={dati.citta_fatturazione} onChange={e=>setF('citta_fatturazione',e.target.value)} style={inp}/>
                </div>
                <div><label style={lbl}>Provincia</label>
                  <select value={dati.provincia_fatturazione} onChange={e=>setF('provincia_fatturazione',e.target.value)} style={{...inp}}>
                    <option value="">Seleziona</option>
                    {PROVINCE_IT.map(p=><option key={p.sigla} value={p.sigla}>{p.nome} ({p.sigla})</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          {tab==='pagamento' && (
            <div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px',marginBottom:'16px'}}>
                <div><label style={lbl}>Intestatario conto</label>
                  <input value={dati.intestatario} onChange={e=>setF('intestatario',e.target.value)} style={inp}/>
                </div>
                <div><label style={lbl}>Banca</label>
                  <input value={dati.banca} onChange={e=>setF('banca',e.target.value)} style={inp}/>
                </div>
              </div>
              <div style={{marginBottom:'16px'}}>
                <label style={lbl}>IBAN</label>
                <input value={dati.iban} onChange={e=>setF('iban',e.target.value)} style={inp} placeholder="IT00 X000 0000 0000 0000 0000 000"/>
              </div>
            </div>
          )}

          {tab==='sede' && (
            <div>
              <div style={{marginBottom:'16px'}}>
                <label style={lbl}>Indirizzo Sede Operativa</label>
                <input value={dati.indirizzo_operativo} onChange={e=>setF('indirizzo_operativo',e.target.value)} style={inp}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 2fr 1fr',gap:'16px',marginBottom:'16px'}}>
                <div><label style={lbl}>CAP</label>
                  <input value={dati.cap_operativo} onChange={e=>setF('cap_operativo',e.target.value)} style={inp}/>
                </div>
                <div><label style={lbl}>Città</label>
                  <input value={dati.citta_operativo} onChange={e=>setF('citta_operativo',e.target.value)} style={inp}/>
                </div>
                <div><label style={lbl}>Provincia</label>
                  <select value={dati.provincia_operativo} onChange={e=>setF('provincia_operativo',e.target.value)} style={{...inp}}>
                    <option value="">Seleziona</option>
                    {PROVINCE_IT.map(p=><option key={p.sigla} value={p.sigla}>{p.nome} ({p.sigla})</option>)}
                  </select>
                </div>
              </div>
              <div style={{marginBottom:'16px'}}>
                <label style={lbl}>Telefono Sede Operativa</label>
                <input value={dati.telefono_operativo} onChange={e=>setF('telefono_operativo',e.target.value)} style={inp}/>
              </div>
            </div>
          )}

          {saved && (
            <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#16a34a'}}>
              ✅ Dati salvati con successo!
            </div>
          )}
          <button onClick={salva} disabled={saving}
            style={{padding:'9px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:saving?0.7:1}}>
            {saving?'Salvataggio...':'💾 Salva'}
          </button>
        </div>
      </div>
    </div>
  )
}