'use client'
import { useState, useEffect } from 'react'

const DISPONIBILI = [
  {tipo:'gls',nome:'GLS',icona:'gls'},
  {tipo:'sda',nome:'SDA Express',icona:'sda'},
  {tipo:'generico',nome:'Nexive',icona:'nexive'},
  {tipo:'spedisci',nome:'Spedisci.online',icona:'spedisci'},
  {tipo:'poste',nome:'Poste Italiane',icona:'poste_pt'},
  {tipo:'generico',nome:'TNT',icona:'tnt'},
  {tipo:'dhl',nome:'DHL Express',icona:'dhl'},
  {tipo:'generico',nome:'Hermes',icona:'hermes'},
  {tipo:'generico',nome:'Liccardi',icona:'liccardi'},
  {tipo:'generico',nome:'SailPost',icona:'sailpost'},
  {tipo:'generico',nome:'BDM',icona:'bdm'},
  {tipo:'generico',nome:'NSSA',icona:'nssa'},
  {tipo:'brt',nome:'BRT',icona:'brt'},
  {tipo:'poste',nome:'Poste Delivery Business',icona:'poste_delivery_business'},
  {tipo:'generico',nome:'GTech Group',icona:'gtechgroup'},
  {tipo:'generico',nome:'HR Parcel',icona:'hrp'},
  {tipo:'generico',nome:'FedEx',icona:'fedex'},
  {tipo:'generico',nome:'Palletways',icona:'palletways'},
  {tipo:'generico',nome:'Correos Express',icona:'correos_express'},
  {tipo:'generico',nome:'InPost',icona:'inpost'},
  {tipo:'generico',nome:'Spring',icona:'spring'},
  {tipo:'generico',nome:'Paack',icona:'paack'},
  {tipo:'generico',nome:'Speedy',icona:'speedy'},
  {tipo:'generico',nome:'Amazon Shipping',icona:'amazon_shipping'},
  {tipo:'generico',nome:'Correos',icona:'correos'},
  {tipo:'generico',nome:'DHL eConnect',icona:'dhl_econnect'},
  {tipo:'generico',nome:'UPS',icona:'ups'},
  {tipo:'generico',nome:'ALT',icona:'alt'},
  {tipo:'generico',nome:'CTT Express',icona:'ctt_express'},
  {tipo:'generico',nome:'AiPack',icona:'aipack'},
]

function iconaCorriere(nome){
  const n = (nome||'').toUpperCase()
  const regole = [
    ['DELIVERY BUSINESS','poste_delivery_business'],['POSTE','poste_delivery_business'],
    ['SDA','sda'],['GLS','gls'],['BRT','brt'],['SPEDISCI','spedisci'],['TNT','tnt'],
    ['DHL ECONNECT','dhl_econnect'],['ECONNECT','dhl_econnect'],['DHL','dhl'],
    ['FEDEX','fedex'],['UPS','ups'],['HERMES','hermes'],['NEXIVE','nexive'],
    ['LICCARDI','liccardi'],['SAILPOST','sailpost'],['BDM','bdm'],['NSSA','nssa'],
    ['HR PARCEL','hrp'],['HRP','hrp'],['PALLETWAYS','palletways'],
    ['CORREOS EXPRESS','correos_express'],['CORREOS','correos'],
    ['INPOST','inpost'],['SPRING','spring'],['PAACK','paack'],['SPEEDY','speedy'],
    ['AMAZON','amazon_shipping'],['CTT','ctt_express'],['AIPACK','aipack'],['GTECH','gtechgroup'],
  ]
  for (const [k,file] of regole) { if (n.includes(k)) return '/corrieri/'+file+'.png' }
  return null
}

export default function CorrieriPage() {
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [confermaElimina, setConfermaElimina] = useState<string | null>(null)
  const [eliminando, setEliminando] = useState(false)

  useEffect(() => {
    fetch('/api/corrieri/lista').then(r => r.json()).then(d => {
      setCorrieri(Array.isArray(d) ? d : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  async function toggleAttivo(id: string, attivoAttuale: boolean) {
    setCorrieri(prev => prev.map(c => c.id === id ? { ...c, attivo: !attivoAttuale } : c))
    await fetch('/api/corrieri/'+id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attivo: !attivoAttuale })
    })
  }

  async function confermaEliminazione() {
    if (!confermaElimina) return
    setEliminando(true)
    const res = await fetch('/api/corrieri/'+confermaElimina, { method: 'DELETE' })
    setEliminando(false)
    if (res.ok) {
      setCorrieri(prev => prev.filter(c => c.id !== confermaElimina))
      setConfermaElimina(null)
    }
  }

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Corrieri</h1>
        <p style={{color:'#1a1a1a',fontSize:'13px',marginTop:'4px'}}>{corrieri.length} contratti configurati</p>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px',alignItems:'start'}}>
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'13.5px',fontWeight:'600',color:'#1a1a1a'}}>Contratti Configurati</div>
          {loading ? (
            <div style={{padding:'30px',textAlign:'center',color:'#1a1a1a',fontSize:'13px'}}>Caricamento...</div>
          ) : !corrieri.length ? (
            <div style={{padding:'30px',textAlign:'center',color:'#1a1a1a',fontSize:'13px'}}>Nessun contratto — aggiungine uno</div>
          ) : corrieri.map(c => (
            <div key={c.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 18px',borderBottom:'1px solid #f5f5f5'}}>
              <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                {iconaCorriere(c.nome_contratto) ? (
                  <img src={iconaCorriere(c.nome_contratto)!} alt="" style={{width:'96px',height:'58px',objectFit:'contain',border:'1px solid #eee',borderRadius:'6px',background:'#fff'}}/>
                ) : (
                  <div style={{width:'96px',height:'58px',background:'#f5f5f5',border:'1px solid #e8e8e8',borderRadius:'6px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'700',color:'#333',textTransform:'uppercase'}}>{c.tipo}</div>
                )}
                <div>
                  <div style={{fontSize:'13px',fontWeight:'600',color:'#1a1a1a'}}>{c.nome_contratto}</div>
                  <div style={{fontSize:'11px',color:'#1a1a1a'}}>L{c.livello}</div>
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                <button onClick={() => toggleAttivo(c.id, c.attivo)}
                  style={{background:c.attivo?'#f0fdf4':'#fef2f2',color:c.attivo?'#16a34a':'#dc2626',padding:'3px 10px',borderRadius:'4px',fontSize:'11px',fontWeight:'600',border:'none',cursor:'pointer'}}>
                  {c.attivo?'● Attivo':'⏸ In pausa'}
                </button>
                <a href={'/dashboard/corrieri/aggiungi?tipo='+c.tipo+'&id='+c.id} title="Modifica"
                  style={{padding:'4px 10px',background:'#eff6ff',color:'#2563eb',borderRadius:'4px',fontSize:'11px',textDecoration:'none',border:'1px solid #bfdbfe'}}>Modifica</a>
                <button onClick={() => setConfermaElimina(c.id)} title="Elimina"
                  style={{padding:'4px 10px',background:'#fef2f2',color:'#dc2626',borderRadius:'4px',fontSize:'11px',border:'1px solid #fecaca',cursor:'pointer'}}>Elimina</button>
              </div>
            </div>
          ))}
        </div>

        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'13.5px',fontWeight:'600',color:'#1a1a1a'}}>Aggiungi Corriere</div>
          <div style={{padding:'16px',display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px'}}>
            {DISPONIBILI.map((c,i) => (
              <a key={i} href={'/dashboard/corrieri/aggiungi?tipo='+c.tipo}
                style={{border:'1px solid #e8e8e8',borderRadius:'8px',textDecoration:'none',display:'block',overflow:'hidden',background:'#fff'}}>
                <img src={'/corrieri/'+c.icona+'.png'} alt={c.nome} style={{width:'100%',height:'90px',objectFit:'contain',display:'block'}}/>
              </a>
            ))}
          </div>
        </div>
      </div>

      {confermaElimina && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
          <div style={{background:'#fff',borderRadius:'10px',padding:'28px',maxWidth:'380px',textAlign:'center'}}>
            <div style={{fontSize:'32px',marginBottom:'12px'}}>!</div>
            <div style={{fontSize:'15px',fontWeight:'700',color:'#1a1a1a',marginBottom:'8px'}}>Sei sicuro di voler eliminare?</div>
            <div style={{fontSize:'13px',color:'#666',marginBottom:'20px'}}>Tutti i dati di questo contratto andranno persi. Questa azione non e reversibile.</div>
            <div style={{display:'flex',gap:'10px',justifyContent:'center'}}>
              <button onClick={() => setConfermaElimina(null)} disabled={eliminando}
                style={{padding:'9px 20px',background:'#f5f5f5',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',fontWeight:'600',color:'#1a1a1a',cursor:'pointer'}}>
                Annulla
              </button>
              <button onClick={confermaEliminazione} disabled={eliminando}
                style={{padding:'9px 20px',background:'#dc2626',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',color:'#fff',cursor:'pointer',opacity:eliminando?0.7:1}}>
                {eliminando?'Eliminazione...':'Si, elimina'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}