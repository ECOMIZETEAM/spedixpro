'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden' as const}
const cardHead = {padding:'14px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'14px',fontWeight:'700' as const,color:'#1a1a1a'}
const sel = {padding:'7px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',minWidth:'80px'}

function iconaCorriere(nome:string): string | null {
  const n = (nome||'').toUpperCase()
  const regole: [string,string][] = [
    ['DELIVERY BUSINESS','poste_delivery_business'],
    ['POSTE','poste_delivery_business'],
    ['SDA','sda'], ['GLS','gls'], ['BRT','brt'],
    ['SPEDISCI','spedisci'], ['TNT','tnt'],
    ['DHL ECONNECT','dhl_econnect'], ['ECONNECT','dhl_econnect'], ['DHL','dhl'],
    ['FEDEX','fedex'], ['UPS','ups'], ['HERMES','hermes'], ['NEXIVE','nexive'],
    ['LICCARDI','liccardi'], ['SAILPOST','sailpost'], ['BDM','bdm'], ['NSSA','nssa'],
    ['HR PARCEL','hrp'], ['HRP','hrp'], ['PALLETWAYS','palletways'],
    ['CORREOS EXPRESS','correos_express'], ['CORREOS','correos'],
    ['INPOST','inpost'], ['SPRING','spring'], ['PAACK','paack'], ['SPEEDY','speedy'],
    ['AMAZON','amazon_shipping'], ['CTT','ctt_express'], ['AIPACK','aipack'], ['ALT','alt'],
    ['GTECH','gtechgroup'],
  ]
  for (const [chiave,file] of regole) { if (n.includes(chiave)) return `/corrieri/${file}.png` }
  return null
}

const ADMIN_FIELDS = [
  {key:'attivo', label:'Account Attivo', desc:'Attiva / Disattiva profilo cliente.'},
  {key:'prezzi_in_distinta', label:'Prezzi in distinta', desc:'Visualizza / Nascondi i prezzi nella distinta di spedizione PDF.'},
  {key:'visualizza_fatture', label:'Visualizza fatture', desc:'Visualizza / Nascondi la sezione Fatture.'},
  {key:'vieta_inserimento', label:'Vieta inserimento Spedizione', desc:'Se attivo, il cliente NON puo creare spedizioni.'},
  {key:'vieta_cancellazione', label:'Vieta cancellazione Spedizione', desc:'Se attivo, il cliente NON puo cancellare le spedizioni.'},
]

export default function ImpostazioniClientePage() {
  const { id } = useParams()
  const [cliente, setCliente] = useState<any>(null)
  const [contratti, setContratti] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    fetch(`/api/clienti/${id}`).then(r=>r.json()).then(d => { setCliente(d); setLoading(false) })
    fetch(`/api/clienti/${id}/corrieri-abilitati`).then(r=>r.json()).then(d => setContratti(Array.isArray(d)?d:[]))
  }, [id])

  function setAdmin(key:string, value:boolean) {
    setCliente((prev:any) => ({ ...prev, [key]: value }))
  }

  async function salvaAdmin() {
    setSaving(true); setMsg('')
    const res = await fetch(`/api/clienti/${id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(cliente)
    })
    const data = await res.json()
    setSaving(false)
    if (data.error) { setMsg('Errore: '+data.error); return }
    setMsg('✓ Impostazioni salvate!')
    setTimeout(()=>setMsg(''), 3000)
  }

  async function toggleContratto(corriereId:string, abilitato:boolean) {
    setContratti(prev => prev.map(c => c.id===corriereId ? {...c, abilitato} : c))
    await fetch(`/api/clienti/${id}/corrieri-abilitati`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ corriereId, abilitato })
    })
  }

  if (loading) return <div style={{padding:'40px',textAlign:'center',color:'#1a1a1a'}}>Caricamento...</div>
  if (!cliente || cliente.error) return <div style={{padding:'40px',textAlign:'center',color:'#dc2626'}}>Cliente non trovato</div>

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <a href={`/dashboard/clienti/${id}`} style={{fontSize:'12px',color:'#f97316',textDecoration:'none'}}>← {cliente.ragione_sociale}</a>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:'4px 0 0'}}>Impostazioni</h1>
      </div>

      {msg && <div style={{background:msg.startsWith('✓')?'#f0fdf4':'#fef2f2',border:`1px solid ${msg.startsWith('✓')?'#bbf7d0':'#fecaca'}`,borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:msg.startsWith('✓')?'#15803d':'#dc2626'}}>{msg}</div>}

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px',alignItems:'start'}}>

        <div style={card}>
          <div style={cardHead}>Contratti abilitati</div>
          {!contratti.length ? (
            <div style={{padding:'30px',textAlign:'center',color:'#999',fontSize:'13px'}}>Nessun contratto associato al listino del cliente</div>
          ) : contratti.map(c => (
            <div key={c.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 18px',borderBottom:'1px solid #f5f5f5'}}>
              <span style={{display:'flex',alignItems:'center',gap:'10px'}}>
                {iconaCorriere(c.nome_contratto) ? (
                  <img src={iconaCorriere(c.nome_contratto)!} alt="" style={{width:'40px',height:'40px',objectFit:'contain',border:'1px solid #eee',borderRadius:'6px',background:'#fff',padding:'3px'}} />
                ) : (
                  <span style={{width:'40px',height:'40px',borderRadius:'6px',background:'#f0f0f0',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:'11px',color:'#999'}}>—</span>
                )}
                <span style={{fontSize:'13px',fontWeight:'600',color:'#1a1a1a'}}>{c.nome_contratto}</span>
              </span>
              <button onClick={()=>toggleContratto(c.id, !c.abilitato)}
                style={{position:'relative',width:'46px',height:'24px',borderRadius:'12px',border:'none',cursor:'pointer',background:c.abilitato?'#f97316':'#d1d5db',transition:'background .2s'}}>
                <span style={{position:'absolute',top:'2px',left:c.abilitato?'24px':'2px',width:'20px',height:'20px',borderRadius:'50%',background:'#fff',transition:'left .2s'}}></span>
              </button>
            </div>
          ))}
        </div>

        <div style={card}>
          <div style={cardHead}>Impostazioni Admin</div>
          <div style={{padding:'8px 0'}}>
            {ADMIN_FIELDS.map(f => (
              <div key={f.key} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'16px',padding:'12px 18px',borderBottom:'1px solid #f5f5f5'}}>
                <div>
                  <div style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>{f.label}</div>
                  <div style={{fontSize:'11.5px',color:'#888',marginTop:'2px'}}>{f.desc}</div>
                </div>
                <select value={cliente[f.key]?'si':'no'} onChange={e=>setAdmin(f.key, e.target.value==='si')} style={sel}>
                  <option value="si">Si</option>
                  <option value="no">No</option>
                </select>
              </div>
            ))}
          </div>
          <div style={{padding:'16px 18px'}}>
            <button onClick={salvaAdmin} disabled={saving}
              style={{background:'#f97316',color:'#fff',border:'none',padding:'10px 28px',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:saving?0.7:1}}>
              {saving?'Salvataggio...':'Salva Impostazioni'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}