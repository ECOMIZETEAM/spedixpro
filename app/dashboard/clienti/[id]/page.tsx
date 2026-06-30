'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

export default function ClienteProfiloPage() {
  const { id } = useParams()
  const [cliente, setCliente] = useState<any>(null)
  const [spedizioni, setSpedizioni] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/clienti/${id}`).then(r=>r.json()).then(d => {
      setCliente(d); setLoading(false)
    })
    fetch(`/api/spedizioni/lista?clienteId=${id}`).then(r=>r.json()).then(d => {
      setSpedizioni(Array.isArray(d) ? d.slice(0,10) : [])
    })
  }, [id])

  if (loading) return <div style={{padding:'40px',textAlign:'center',color:'#1a1a1a'}}>Caricamento...</div>
  if (!cliente || cliente.error) return <div style={{padding:'40px',textAlign:'center',color:'#dc2626'}}>Cliente non trovato</div>

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'20px'}}>
        <div>
          <a href="/dashboard/clienti" style={{fontSize:'12px',color:'#f97316',textDecoration:'none'}}>← Clienti</a>
          <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:'4px 0 0'}}>{cliente.ragione_sociale}</h1>
          <p style={{color:'#1a1a1a',fontSize:'13px',margin:'2px 0 0'}}>{cliente.codice_cliente} · {cliente.email}</p>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
          <span style={{background:cliente.attivo?'#f0fdf4':'#fef2f2',color:cliente.attivo?'#16a34a':'#dc2626',padding:'4px 12px',borderRadius:'20px',fontSize:'12px',fontWeight:'600'}}>
            {cliente.attivo?'Attivo':'Inattivo'}
          </span>
          <span style={{fontSize:'13px',color:'#1a1a1a'}}>Credito: <strong style={{color:'#f97316'}}>€ {Number(cliente.credito||0).toFixed(2)}</strong></span>
          <a href={`/dashboard/clienti/${id}/modifica`} style={{padding:'8px 16px',background:'#f97316',color:'#fff',borderRadius:'6px',fontSize:'13px',fontWeight:'600',textDecoration:'none'}}>✏️ Modifica Anagrafica</a>
          <a href={`/dashboard/clienti/${id}/impostazioni`} style={{padding:'8px 16px',background:'#1a1a1a',color:'#fff',borderRadius:'6px',fontSize:'13px',fontWeight:'600',textDecoration:'none'}}>⚙️ Impostazioni</a>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 320px',gap:'20px',alignItems:'start'}}>
        <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
          <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>Profilo Azienda</div>
            <div style={{padding:'16px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px',fontSize:'13px'}}>
              <div><div style={{color:'#1a1a1a',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>RAGIONE SOCIALE</div><div style={{fontWeight:'600',color:'#1a1a1a'}}>{cliente.ragione_sociale}</div></div>
              {cliente.piva&&<div><div style={{color:'#1a1a1a',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>P.IVA</div><div>{cliente.piva}</div></div>}
              {cliente.cf&&<div><div style={{color:'#1a1a1a',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>CODICE FISCALE</div><div>{cliente.cf}</div></div>}
              {cliente.pec&&<div><div style={{color:'#1a1a1a',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>PEC</div><div>{cliente.pec}</div></div>}
              {cliente.rappresentante_legale&&<div><div style={{color:'#1a1a1a',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>RAPPRESENTANTE LEGALE</div><div>{cliente.rappresentante_legale}</div></div>}
              {cliente.telefono&&<div><div style={{color:'#1a1a1a',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>TELEFONO</div><div>{cliente.telefono}</div></div>}
              <div><div style={{color:'#1a1a1a',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>LISTINO PREZZI</div><div style={{color:cliente.listino_cliente_id?'#f97316':'#bbb'}}>{cliente.listino_cliente_id?'Assegnato':'— nessun listino —'}</div></div>
              <div><div style={{color:'#1a1a1a',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>TIPO CONTRATTO</div><div>{cliente.tipo_contratto?.replace(/_/g,' ')||'—'}</div></div>
            </div>
          </div>

          {(cliente.sl_indirizzo||cliente.sl_citta)&&(
            <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
              <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>📋 Sede Legale (Dati Fatturazione)</div>
              <div style={{padding:'16px',fontSize:'13px',color:'#1a1a1a',lineHeight:1.7}}>{cliente.sl_indirizzo}<br/>{cliente.sl_citta} {cliente.sl_provincia&&`(${cliente.sl_provincia})`} {cliente.sl_cap}<br/>{cliente.sl_paese}</div>
            </div>
          )}

          {(cliente.so_indirizzo||cliente.so_citta)&&(
            <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
              <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>📍 Sede Operativa (Dati mittente)</div>
              <div style={{padding:'16px',fontSize:'13px',color:'#1a1a1a',lineHeight:1.7}}>{cliente.so_indirizzo}<br/>{cliente.so_citta} {cliente.so_provincia&&`(${cliente.so_provincia})`} {cliente.so_cap}<br/>{cliente.so_paese}</div>
            </div>
          )}

          <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>Movimenti</div>
            <div style={{padding:'40px',textAlign:'center',color:'#1a1a1a'}}>
              <div style={{fontSize:'32px',marginBottom:'8px'}}>📊</div>
              <div style={{fontSize:'13px'}}>Nessun movimento</div>
            </div>
          </div>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
          <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700',color:'#1a1a1a',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span>Credito & Movimenti</span>
              <button style={{background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',padding:'4px 12px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>+ Ricarica</button>
            </div>
            <div style={{padding:'20px',textAlign:'center'}}>
              <div style={{fontSize:'32px',fontWeight:'800',color:'#f97316'}}>€ {Number(cliente.credito||0).toFixed(2)}</div>
              <div style={{fontSize:'12px',color:'#1a1a1a',marginTop:'4px'}}>credito disponibile</div>
            </div>
            <div style={{borderTop:'1px solid #f0f0f0',padding:'12px 16px',textAlign:'center',color:'#1a1a1a',fontSize:'12px'}}>Nessun movimento</div>
          </div>

          <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>Ultime Spedizioni</div>
            {!spedizioni.length?(
              <div style={{padding:'30px',textAlign:'center',color:'#1a1a1a',fontSize:'12px'}}>Nessuna spedizione</div>
            ):spedizioni.map(s=>(
              <div key={s.id} style={{padding:'10px 16px',borderBottom:'1px solid #f5f5f5'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <a href={`/dashboard/spedizioni/${s.id}`} style={{fontWeight:'600',color:'#f97316',textDecoration:'none',fontSize:'13px'}}>{s.numero}</a>
                  <span style={{fontWeight:'600',fontSize:'13px',color:'#1a1a1a'}}>€{Number(s.costo_totale||0).toFixed(2)}</span>
                </div>
                <div style={{fontSize:'11px',color:'#1a1a1a',marginTop:'2px'}}>{s.dest_nome} → {s.dest_citta} · {new Date(s.created_at).toLocaleDateString('it-IT')}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}