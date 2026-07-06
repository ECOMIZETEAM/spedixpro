'use client'
import { useState } from 'react'

const inp = {padding:'8px 11px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',width:'100%',boxSizing:'border-box' as const}
const lbl = {fontSize:'12px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

export default function FilialePage() {
  const [saved, setSaved] = useState(false)
  const [filiale, setFiliale] = useState({
    nome:'', indirizzo:'', citta:'', cap:'', provincia:'',
    telefono:'', email:'', piva:'', cf:'', sito:''
  })

  const setF = (k:string,v:string) => setFiliale(f=>({...f,[k]:v}))

  function salva() { setSaved(true); setTimeout(()=>setSaved(false),3000) }

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>🏢 Filiale / Rete Interna</h1>
        <p style={{color:'#1a1a1a',fontSize:'13px',marginTop:'4px'}}>Configura i dati della tua filiale. Verranno usati nei documenti e nelle comunicazioni.</p>
      </div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'24px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px',marginBottom:'16px'}}>
          <div><label style={lbl}>Nome Filiale / Azienda</label>
            <input value={filiale.nome} onChange={e=>setF('nome',e.target.value)} style={inp} placeholder="es. MoovExpress SRL"/>
          </div>
          <div><label style={lbl}>Partita IVA</label>
            <input value={filiale.piva} onChange={e=>setF('piva',e.target.value)} style={inp} placeholder="IT12345678901"/>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px',marginBottom:'16px'}}>
          <div><label style={lbl}>Codice Fiscale</label>
            <input value={filiale.cf} onChange={e=>setF('cf',e.target.value)} style={inp} placeholder="RSSMRA80A01H501Z"/>
          </div>
          <div><label style={lbl}>Sito Web</label>
            <input value={filiale.sito} onChange={e=>setF('sito',e.target.value)} style={inp} placeholder="www.moovexpress.com"/>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'16px',marginBottom:'16px'}}>
          <div><label style={lbl}>Indirizzo</label>
            <input value={filiale.indirizzo} onChange={e=>setF('indirizzo',e.target.value)} style={inp} placeholder="Via Roma, 1"/>
          </div>
          <div><label style={lbl}>Città</label>
            <input value={filiale.citta} onChange={e=>setF('citta',e.target.value)} style={inp} placeholder="Roma"/>
          </div>
          <div><label style={lbl}>CAP</label>
            <input value={filiale.cap} onChange={e=>setF('cap',e.target.value)} style={inp} placeholder="00100"/>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'16px',marginBottom:'20px'}}>
          <div><label style={lbl}>Provincia</label>
            <input value={filiale.provincia} onChange={e=>setF('provincia',e.target.value)} style={inp} placeholder="RM"/>
          </div>
          <div><label style={lbl}>Telefono</label>
            <input value={filiale.telefono} onChange={e=>setF('telefono',e.target.value)} style={inp} placeholder="+39 06 12345678"/>
          </div>
          <div><label style={lbl}>Email</label>
            <input value={filiale.email} onChange={e=>setF('email',e.target.value)} style={inp} placeholder="info@moovexpress.com"/>
          </div>
        </div>
        {saved && (
          <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#16a34a'}}>
            ✅ Dati filiale salvati con successo!
          </div>
        )}
        <button onClick={salva}
          style={{padding:'9px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>
          💾 Salva Filiale
        </button>
      </div>
    </div>
  )
}