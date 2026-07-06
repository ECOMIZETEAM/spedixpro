'use client'
import { useEffect, useState } from 'react'

const ACCENT = '#f97316'

// Blocca il portale master finché non viene selezionato un piano di abbonamento.
// Il master principale (root) è esente (l'API ritorna attivo=true).
export default function AbbonamentoGate() {
  const [stato, setStato] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [scegliendo, setScegliendo] = useState('')
  const [msg, setMsg] = useState('')

  async function carica() {
    const d = await fetch('/api/abbonamento').then(r=>r.json()).catch(()=>null)
    setStato(d); setLoading(false)
  }
  useEffect(()=>{ carica() }, [])

  async function scegli(pianoId:string) {
    setScegliendo(pianoId); setMsg('')
    const res = await fetch('/api/abbonamento', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pianoId }) })
    const d = await res.json()
    setScegliendo('')
    if (d.error) { setMsg(d.error); return }
    // ricarica la pagina: il canone è stato scalato e il portale si sblocca
    window.location.reload()
  }

  if (loading || !stato || stato.error || stato.attivo) return null // esente o già attivo -> nessun blocco

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(15,15,15,0.72)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px',fontFamily:'var(--font-geist-sans),system-ui,sans-serif'}}>
      <div style={{background:'#fff',borderRadius:'14px',maxWidth:'760px',width:'100%',maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,.4)'}}>
        <div style={{padding:'24px 28px',borderBottom:'1px solid #eee',textAlign:'center'}}>
          <div style={{fontSize:'22px',fontWeight:800,color:'#1a1a1a'}}>Moov<span style={{color:ACCENT}}>Express</span></div>
          <div style={{fontSize:'15px',fontWeight:700,color:'#1a1a1a',marginTop:'10px'}}>Scegli un abbonamento per iniziare</div>
          <div style={{fontSize:'13px',color:'#777',marginTop:'4px'}}>Per usare la piattaforma seleziona un pacchetto. Il canone del primo mese viene scalato subito dal tuo credito (ricaricabile con bonifico).</div>
        </div>
        {msg && <div style={{margin:'16px 28px 0',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'10px',fontSize:'13px',color:'#dc2626'}}>{msg}</div>}
        <div style={{padding:'20px 28px',display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:'12px'}}>
          {(stato.piani||[]).map((p:any)=>(
            <div key={p.id} style={{border:'1px solid #e8e8e8',borderRadius:'10px',padding:'16px',display:'flex',flexDirection:'column',gap:'6px'}}>
              <div style={{fontSize:'14px',fontWeight:800,color:'#1a1a1a'}}>{p.nome}</div>
              <div style={{fontSize:'12px',color:'#777'}}>fino a <b>{p.limite.toLocaleString('it-IT')}</b> spedizioni/mese</div>
              <div style={{fontSize:'22px',fontWeight:800,color:ACCENT,marginTop:'4px'}}>€ {p.prezzo}<span style={{fontSize:'12px',color:'#999',fontWeight:600}}>/mese</span></div>
              <button onClick={()=>scegli(p.id)} disabled={!!scegliendo}
                style={{marginTop:'8px',background:ACCENT,color:'#fff',border:'none',borderRadius:'8px',padding:'9px',fontSize:'13px',fontWeight:700,cursor:'pointer',opacity:scegliendo===p.id?0.6:1}}>
                {scegliendo===p.id?'Attivazione…':'Seleziona'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
