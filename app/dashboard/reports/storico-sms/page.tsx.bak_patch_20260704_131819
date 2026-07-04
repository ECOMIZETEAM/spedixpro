'use client'
import { useState, useEffect } from 'react'

export default function StoricoCreditoSmsPage() {
  const [storico, setStorico] = useState<any[]>([])
  const [cerca, setCerca] = useState('')

  useEffect(() => {
    setStorico([])
  }, [])

  const storicofiltrato = cerca
    ? storico.filter(s => s.descrizione?.toLowerCase().includes(cerca.toLowerCase()))
    : storico

  return (
    <div>
      <div style={{marginBottom:'16px'}}><h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Notifiche SMS</h1></div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'13px',color:'#1a1a1a',fontWeight:'600',cursor:'pointer'}}>
            🔄 Storico Credito
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'12px',color:'#1a1a1a'}}>Cerca:</span>
            <input value={cerca} onChange={e=>setCerca(e.target.value)}
              style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',width:'180px',color:'#1a1a1a'}}/>
          </div>
        </div>
        <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
          <thead>
            <tr style={{background:'#f9fafb'}}>
              {['Data','Descrizione','Importo','Totale'].map(h=>(
                <th key={h} style={{textAlign:'left' as const,padding:'9px 14px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!storicofiltrato.length ? (
              <tr><td colSpan={4} style={{padding:'20px 14px',color:'#3b82f6',fontSize:'13px'}}>Nessun dato disponibile nella tabella</td></tr>
            ) : storicofiltrato.map((s:any,i:number)=>(
              <tr key={i} style={{borderBottom:'1px solid #d1d5db'}}>
                <td style={{padding:'9px 14px',color:'#1a1a1a',fontSize:'12px'}}>{s.data}</td>
                <td style={{padding:'9px 14px',color:'#1a1a1a'}}>{s.descrizione}</td>
                <td style={{padding:'9px 14px',color:'#1a1a1a'}}>€ {s.importo}</td>
                <td style={{padding:'9px 14px',fontWeight:'600',color:'#1a1a1a'}}>€ {s.totale}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{padding:'10px 14px',borderTop:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:'12px',color:'#1a1a1a'}}>
          <span>Risultati da 0 a 0 di 0 elementi</span>
          <div style={{display:'flex',gap:'6px'}}>
            <button style={{padding:'4px 12px',border:'1px solid #d1d5db',borderRadius:'4px',background:'#fff',fontSize:'12px',cursor:'pointer',color:'#1a1a1a'}}>Precedente</button>
            <button style={{padding:'4px 12px',border:'1px solid #d1d5db',borderRadius:'4px',background:'#fff',fontSize:'12px',cursor:'pointer',color:'#1a1a1a'}}>Successivo</button>
          </div>
        </div>
      </div>
    </div>
  )
}