'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

const NOMI: Record<string,string> = { shopify:'Shopify', prestashop:'PrestaShop', woocommerce:'WooCommerce' }
const ACCENT = '#f97316'

export default function OrdiniPage() {
  const params = useParams()
  const router = useRouter()
  const piattaforma = String(params.piattaforma || 'shopify')
  const [ordini, setOrdini] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sincronizzando, setSincronizzando] = useState(false)
  const [msg, setMsg] = useState('')
  const [integrazioneId, setIntegrazioneId] = useState('')

  async function carica() {
    setLoading(true)
    const [ord, integr] = await Promise.all([
      fetch('/api/ordini/lista?piattaforma='+piattaforma).then(r=>r.json()).catch(()=>[]),
      fetch('/api/integrazioni/lista').then(r=>r.json()).catch(()=>[]),
    ])
    setOrdini(Array.isArray(ord)?ord:[])
    const mia = (Array.isArray(integr)?integr:[]).find((i:any)=>i.piattaforma===piattaforma && i.stato==='attivo')
    setIntegrazioneId(mia?.id || '')
    setLoading(false)
  }
  useEffect(()=>{ carica() }, [piattaforma])

  async function sincronizza() {
    if (!integrazioneId) { setMsg('Nessun negozio '+(NOMI[piattaforma]||piattaforma)+' collegato'); return }
    setSincronizzando(true); setMsg('')
    try {
      const res = await fetch('/api/integrazioni/'+piattaforma+'/sync', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ integrazione_id: integrazioneId })
      })
      const d = await res.json()
      if (d.error) setMsg('Errore: '+d.error)
      else setMsg('Sincronizzati '+d.importati+' ordini (letti '+d.letti+')')
      carica()
    } catch { setMsg('Errore di connessione') }
    setSincronizzando(false)
  }

  function creaSpedizione(o:any) {
    // Passa i dati destinatario alla nuova spedizione via query (precompilazione)
    const d = o.destinatario || {}
    const qs = new URLSearchParams({
      da_ordine: o.id,
      nome: d.nome||'', indirizzo: d.indirizzo||'', citta: d.citta||'',
      provincia: d.provincia||'', cap: d.cap||'', paese: d.paese||'IT',
      email: d.email||'', telefono: d.telefono||'',
    })
    router.push('/cliente/spedizioni/nuova?'+qs.toString())
  }

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
        <h1 style={{fontSize:'22px',fontWeight:'800',color:'#1a1a1a',margin:0}}>Ordini {NOMI[piattaforma]||piattaforma}</h1>
        <button onClick={sincronizza} disabled={sincronizzando} style={{background:ACCENT,color:'#fff',border:'none',borderRadius:'8px',padding:'10px 18px',fontSize:'13px',fontWeight:'700',cursor:sincronizzando?'default':'pointer',opacity:sincronizzando?.6:1}}>
          {sincronizzando ? 'Sincronizzazione…' : '↻ Sincronizza ordini'}
        </button>
      </div>
      {msg && <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:'8px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#1d4ed8'}}>{msg}</div>}
      <div style={{background:'#fff',border:'1px solid #e8e8e8',borderRadius:'10px',overflow:'hidden'}}>
        {loading ? (
          <div style={{padding:'40px',textAlign:'center',color:'#999'}}>Caricamento…</div>
        ) : ordini.length===0 ? (
          <div style={{padding:'40px',textAlign:'center',color:'#999'}}>Nessun ordine. Clicca "Sincronizza ordini" per importarli.</div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
            <thead><tr style={{background:'#f9fafb',textAlign:'left'}}>
              <th style={{padding:'10px 14px',color:'#666'}}>Ordine</th>
              <th style={{padding:'10px 14px',color:'#666'}}>Destinatario</th>
              <th style={{padding:'10px 14px',color:'#666'}}>Città</th>
              <th style={{padding:'10px 14px',color:'#666'}}>Totale</th>
              <th style={{padding:'10px 14px',color:'#666'}}>Stato</th>
              <th style={{padding:'10px 14px'}}></th>
            </tr></thead>
            <tbody>
              {ordini.map((o:any)=>(
                <tr key={o.id} style={{borderTop:'1px solid #f0f0f0'}}>
                  <td style={{padding:'10px 14px',fontWeight:'600',color:'#1a1a1a'}}>{o.numero_ordine}</td>
                  <td style={{padding:'10px 14px',color:'#1a1a1a'}}>{o.destinatario?.nome}</td>
                  <td style={{padding:'10px 14px',color:'#666'}}>{o.destinatario?.citta} ({o.destinatario?.provincia})</td>
                  <td style={{padding:'10px 14px',color:'#666'}}>{o.totale?Number(o.totale).toFixed(2):''} {o.valuta}</td>
                  <td style={{padding:'10px 14px'}}>
                    <span style={{fontSize:'11px',fontWeight:'600',padding:'2px 8px',borderRadius:'999px',background:o.stato==='spedito'?'#dcfce7':'#fef3c7',color:o.stato==='spedito'?'#166534':'#92400e'}}>
                      {o.stato==='spedito'?'Spedito':'Da spedire'}
                    </span>
                  </td>
                  <td style={{padding:'10px 14px',textAlign:'right'}}>
                    {o.stato!=='spedito' && <button onClick={()=>creaSpedizione(o)} style={{background:'#eff6ff',color:'#1d4ed8',border:'1px solid #bfdbfe',borderRadius:'6px',padding:'6px 12px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>Crea spedizione</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
