'use client'
import { useEffect, useState } from 'react'

declare global { interface Window { shopify?: any } }

const ACCENT = '#f97316'

export default function ShopifyEmbedded() {
  const [stato, setStato] = useState<any>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancel = false
    async function run() {
      // aspetta che App Bridge sia pronto
      for (let i = 0; i < 60 && !window.shopify?.idToken; i++) {
        await new Promise(r => setTimeout(r, 100))
      }
      if (!window.shopify?.idToken) { if (!cancel) { setErr('App Bridge non caricato. Apri l\'app dall\'admin Shopify.'); setLoading(false) } return }
      try {
        const token = await window.shopify.idToken()
        const r = await fetch('/api/integrazioni/shopify/embedded/stato', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const d = await r.json()
        if (!cancel) { setStato(d); setLoading(false) }
      } catch (e: any) {
        if (!cancel) { setErr(String(e?.message || e)); setLoading(false) }
      }
    }
    run()
    return () => { cancel = true }
  }, [])

  const card: React.CSSProperties = { background:'#fff', border:'1px solid #e8e8e8', borderRadius:'10px', padding:'22px', maxWidth:'560px', margin:'40px auto' }

  if (loading) return <div style={{...card, textAlign:'center', color:'#777'}}>Caricamento…</div>
  if (err) return <div style={{...card, color:'#dc2626'}}>{err}</div>

  return (
    <div style={card}>
      <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'6px'}}>
        <div style={{width:'34px',height:'34px',borderRadius:'8px',background:ACCENT,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800}}>M</div>
        <h1 style={{fontSize:'18px',fontWeight:800,color:'#1a1a1a',margin:0}}>MoovExpress</h1>
      </div>
      <div style={{fontSize:'12px',color:'#999',marginBottom:'18px'}}>Negozio: <b>{stato?.shop}</b></div>

      {stato?.collegato ? (
        <div>
          <div style={{background:'#dcfce7',color:'#16a34a',borderRadius:'8px',padding:'12px 14px',fontSize:'13px',fontWeight:600}}>
            ✓ Negozio collegato a MoovExpress{stato?.cliente ? ` — ${stato.cliente}` : ''}
          </div>
          <p style={{fontSize:'13px',color:'#555',marginTop:'16px'}}>
            I tuoi ordini Shopify vengono importati e, alla spedizione, il tracking torna in automatico su Shopify.
          </p>
        </div>
      ) : (
        <div>
          <div style={{background:'#fff7ed',color:'#b45309',border:'1px solid #fed7aa',borderRadius:'8px',padding:'12px 14px',fontSize:'13px',fontWeight:600}}>
            Negozio non ancora collegato a un account MoovExpress
          </div>
          <p style={{fontSize:'13px',color:'#555',marginTop:'16px'}}>
            Collega questo negozio al tuo account MoovExpress per iniziare a spedire i tuoi ordini.
          </p>
          {/* Azione di collegamento — dipende dal modello di onboarding scelto */}
        </div>
      )}
    </div>
  )
}
