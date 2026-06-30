'use client'
import { useState, useEffect } from 'react'

export default function ClientiPage() {
  const [clienti, setClienti] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/clienti/lista')
      .then(r => r.json())
      .then(d => { setClienti(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'20px'}}>
        <div>
          <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Clienti</h1>
          <p style={{color:'#1a1a1a',fontSize:'13px',marginTop:'4px'}}>{clienti.length} clienti totali</p>
        </div>
        <a href="/dashboard/clienti/nuovo" style={{background:'#f97316',color:'#fff',padding:'8px 18px',borderRadius:'6px',fontSize:'13px',fontWeight:'600',textDecoration:'none'}}>+ Nuovo Cliente</a>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
        {loading ? (
          <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a'}}><div style={{fontSize:'14px'}}>Caricamento...</div></div>
        ) : !clienti.length ? (
          <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a'}}>
            <div style={{fontSize:'40px',marginBottom:'12px'}}>👥</div>
            <div style={{fontSize:'14px',fontWeight:'500',color:'#1a1a1a'}}>Nessun cliente</div>
            <a href="/dashboard/clienti/nuovo" style={{display:'inline-block',marginTop:'12px',background:'#f97316',color:'#fff',padding:'8px 18px',borderRadius:'6px',fontSize:'13px',fontWeight:'600',textDecoration:'none'}}>Crea il primo</a>
          </div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
              <thead>
                <tr style={{background:'#fafafa'}}>
                  {['Nr.#','Società','Tipo Contratto','Listino','Stato','Azioni'].map(h=>(
                    <th key={h} style={{textAlign:'left',padding:'9px 14px',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.5px',color:'#1a1a1a',borderBottom:'1px solid #f0f0f0',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clienti.map(c => (
                  <tr key={c.id} style={{borderBottom:'1px solid #f5f5f5'}}>
                    <td style={{padding:'10px 14px',color:'#1a1a1a',fontSize:'12px'}}>{c.codice_cliente}</td>
                    <td style={{padding:'10px 14px'}}>
                      <div style={{fontWeight:'600',color:'#1a1a1a'}}>{c.ragione_sociale}</div>
                      <div style={{fontSize:'11px',color:'#1a1a1a'}}>{c.email}</div>
                      {c.telefono && <div style={{fontSize:'11px',color:'#1a1a1a'}}>{c.telefono}</div>}
                    </td>
                    <td style={{padding:'10px 14px',color:'#1a1a1a',fontSize:'12px'}}>{c.tipo_contratto?.replace(/_/g,' ')||'—'}</td>
                    <td style={{padding:'10px 14px',color:'#1a1a1a',fontSize:'12px'}}>{c.listino_cliente_id ? <span style={{color:'#f97316',fontWeight:'600'}}>Assegnato</span> : '—'}</td>
                    <td style={{padding:'10px 14px'}}>
                      <span style={{background:c.attivo?'#f0fdf4':'#fef2f2',color:c.attivo?'#16a34a':'#dc2626',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'500'}}>
                        {c.attivo?'Attivo':'Inattivo'}
                      </span>
                    </td>
                    <td style={{padding:'10px 14px'}}>
                      <div style={{display:'flex',gap:'6px'}}>
                        <a href={`/api/clienti/${c.id}/impersona`} title="Accedi come cliente"
                          style={{padding:'5px 8px',background:'#fff7ed',color:'#f97316',borderRadius:'4px',fontSize:'14px',textDecoration:'none',border:'1px solid #fed7aa'}}>🔑</a>
                        <a href={`/dashboard/clienti/${c.id}`} title="Profilo"
                          style={{padding:'5px 8px',background:'#eff6ff',color:'#2563eb',borderRadius:'4px',fontSize:'14px',textDecoration:'none',border:'1px solid #bfdbfe'}}>🔵</a>
                        <a href={`/dashboard/clienti/${c.id}/modifica`} title="Modifica"
                          style={{padding:'5px 8px',background:'#f0fdf4',color:'#16a34a',borderRadius:'4px',fontSize:'14px',textDecoration:'none',border:'1px solid #bbf7d0'}}>✏️</a>
                        <a href={`/dashboard/clienti/${c.id}/impostazioni`} title="Impostazioni"
                          style={{padding:'5px 8px',background:'#fffbeb',color:'#d97706',borderRadius:'4px',fontSize:'14px',textDecoration:'none',border:'1px solid #fde68a'}}>⚙️</a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
