'use client'
import { useEffect, useState, useCallback } from 'react'

declare global { interface Window { shopify?: any } }

const ACCENT = '#f97316'

export default function ShopifyEmbedded() {
  const [stato, setStato] = useState<any>(null)
  const [ordini, setOrdini] = useState<any[]>([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [sincronizzo, setSincronizzo] = useState(false)
  const [msg, setMsg] = useState('')

  // chiamata autenticata dal session token di App Bridge
  const callApi = useCallback(async (path: string, method: 'GET' | 'POST' = 'GET') => {
    const token = await window.shopify.idToken()
    const r = await fetch(path, { method, headers: { Authorization: `Bearer ${token}` } })
    return r.json()
  }, [])

  const caricaOrdini = useCallback(async () => {
    try { const d = await callApi('/api/integrazioni/shopify/embedded/ordini'); setOrdini(d.ordini || []) } catch {}
  }, [callApi])

  useEffect(() => {
    let cancel = false
    async function run() {
      for (let i = 0; i < 60 && !window.shopify?.idToken; i++) await new Promise(r => setTimeout(r, 100))
      if (!window.shopify?.idToken) { if (!cancel) { setErr('App Bridge non caricato. Apri l\'app dall\'admin Shopify.'); setLoading(false) } return }
      try {
        const d = await callApi('/api/integrazioni/shopify/embedded/stato')
        if (cancel) return
        setStato(d); setLoading(false)
        if (d?.collegato) caricaOrdini()
      } catch (e: any) { if (!cancel) { setErr(String(e?.message || e)); setLoading(false) } }
    }
    run()
    return () => { cancel = true }
  }, [callApi, caricaOrdini])

  async function sincronizza() {
    setSincronizzo(true); setMsg('')
    try {
      const d = await callApi('/api/integrazioni/shopify/embedded/sync', 'POST')
      if (d.error) setMsg('Errore: ' + d.error)
      else { setMsg(`✓ ${d.importati} ordini importati (${d.letti} letti)`); await caricaOrdini() }
    } catch (e: any) { setMsg('Errore: ' + String(e?.message || e)) }
    setSincronizzo(false)
  }

  const wrap: React.CSSProperties = { maxWidth:'760px', margin:'32px auto', padding:'0 16px', fontFamily:'system-ui,sans-serif' }
  const card: React.CSSProperties = { background:'#fff', border:'1px solid #e8e8e8', borderRadius:'10px', padding:'20px', marginBottom:'16px' }

  if (loading) return <div style={{...wrap, textAlign:'center', color:'#777', marginTop:'60px'}}>Caricamento…</div>
  if (err) return <div style={wrap}><div style={{...card, color:'#dc2626'}}>{err}</div></div>

  return (
    <div style={wrap}>
      <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'16px'}}>
        <div style={{width:'34px',height:'34px',borderRadius:'8px',background:ACCENT,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800}}>M</div>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:800,color:'#1a1a1a',margin:0}}>MoovExpress</h1>
          <div style={{fontSize:'12px',color:'#999'}}>{stato?.shop}</div>
        </div>
      </div>

      {!stato?.collegato ? (
        <div style={{...card, background:'#fff7ed', borderColor:'#fed7aa', color:'#b45309'}}>
          Negozio non ancora collegato a un account MoovExpress. Completa l'installazione dall'App Store.
        </div>
      ) : (
        <>
          <div style={{...card, display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'12px'}}>
            <div>
              <div style={{fontSize:'13px',fontWeight:700,color:'#16a34a'}}>✓ Negozio collegato{stato?.cliente ? ` — ${stato.cliente}` : ''}</div>
              <div style={{fontSize:'12px',color:'#777',marginTop:'2px'}}>Importa i tuoi ordini non evasi e spediscili con MoovExpress.</div>
            </div>
            <button onClick={sincronizza} disabled={sincronizzo}
              style={{background:ACCENT,color:'#fff',border:'none',borderRadius:'8px',padding:'10px 18px',fontSize:'13px',fontWeight:700,cursor:'pointer',opacity:sincronizzo?0.6:1}}>
              {sincronizzo ? 'Sincronizzo…' : '↻ Sincronizza ordini'}
            </button>
          </div>

          {msg && <div style={{...card, padding:'10px 14px', fontSize:'13px', color: msg.startsWith('✓') ? '#16a34a' : '#dc2626'}}>{msg}</div>}

          <div style={{...card, padding:0, overflow:'hidden'}}>
            <div style={{padding:'12px 16px', borderBottom:'1px solid #f0f0f0', fontSize:'13px', fontWeight:700, color:'#1a1a1a'}}>
              Ordini importati ({ordini.length})
            </div>
            {!ordini.length ? (
              <div style={{padding:'28px', textAlign:'center', color:'#999', fontSize:'13px'}}>Nessun ordine importato. Premi "Sincronizza ordini".</div>
            ) : (
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:'13px'}}>
                <thead>
                  <tr style={{background:'#fafafa'}}>
                    {['Ordine','Destinatario','Articoli','Totale','Stato'].map(h => (
                      <th key={h} style={{textAlign:'left', padding:'8px 14px', fontSize:'11px', fontWeight:600, color:'#777', borderBottom:'1px solid #f0f0f0'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ordini.map(o => {
                    const spedito = o.fulfillment_stato === 'ok' || !!o.spedizione_id
                    return (
                      <tr key={o.id} style={{borderBottom:'1px solid #f5f5f5'}}>
                        <td style={{padding:'8px 14px', fontWeight:600, color:'#1a1a1a'}}>{o.numero_ordine}</td>
                        <td style={{padding:'8px 14px', color:'#555'}}>{o.destinatario?.nome || o.cliente_nome || '—'}<div style={{fontSize:'11px',color:'#999'}}>{o.destinatario?.citta} {o.destinatario?.cap}</div></td>
                        <td style={{padding:'8px 14px', color:'#555'}}>{(o.articoli || []).length}</td>
                        <td style={{padding:'8px 14px', color:'#1a1a1a'}}>{o.totale != null ? `${Number(o.totale).toFixed(2)} ${o.valuta || ''}` : '—'}</td>
                        <td style={{padding:'8px 14px'}}>
                          {spedito
                            ? <span style={{background:'#dcfce7',color:'#16a34a',borderRadius:'999px',padding:'2px 9px',fontSize:'11px',fontWeight:700}}>Spedito</span>
                            : <span style={{background:'#fff7ed',color:'#b45309',borderRadius:'999px',padding:'2px 9px',fontSize:'11px',fontWeight:700}}>Da spedire</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
