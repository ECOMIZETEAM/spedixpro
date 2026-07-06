'use client'
import { useEffect, useState } from 'react'

const ACCENT = '#f97316'
const card = { background:'#fff', borderRadius:'8px', border:'1px solid #e8e8e8', padding:'16px' as const }

export default function AbbonamentoPage() {
  const [stato, setStato] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [azione, setAzione] = useState('')
  const [msg, setMsg] = useState('')

  async function carica() {
    setLoading(true)
    const d = await fetch('/api/abbonamento').then(r=>r.json()).catch(()=>null)
    setStato(d); setLoading(false)
  }
  useEffect(()=>{ carica() }, [])

  async function cambia(pianoId:string, prezzoNuovo:number) {
    const prezzoAttuale = Number(stato?.prezzo||0)
    const isUp = prezzoNuovo > prezzoAttuale
    const testo = !stato?.attivo ? `Attivare questo piano? Verranno scalati € ${prezzoNuovo}.`
      : isUp ? `Upgrade: verrà scalata solo la differenza (€ ${(prezzoNuovo-prezzoAttuale).toFixed(2)}). Procedere?`
      : `Downgrade a questo piano? Nessun addebito ora, il nuovo canone partirà dal prossimo mese.`
    if (!confirm(testo)) return
    setAzione(pianoId); setMsg('')
    const res = await fetch('/api/abbonamento', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pianoId }) })
    const d = await res.json(); setAzione('')
    if (d.error) { setMsg(d.error); return }
    setMsg(d.addebitato>0 ? `✓ Piano attivato — scalati € ${d.addebitato}` : '✓ Piano aggiornato')
    carica()
  }
  async function disdici() {
    if (!confirm('Disdire l\'abbonamento? Il portale verrà BLOCCATO finché non selezioni un nuovo piano. Nessun rimborso.')) return
    setAzione('disdici')
    await fetch('/api/abbonamento/disdici', { method:'POST' })
    setAzione(''); window.location.reload()
  }
  async function segnaPagato(id:string, nome:string, importo:number) {
    if (!confirm(`Confermi di aver ricevuto il bonifico di € ${Number(importo).toFixed(2)} da ${nome}?\nIl credito verrà rimborsato in automatico sulla sua Lista Movimenti.`)) return
    setAzione('pag_'+id); setMsg('')
    const res = await fetch(`/api/abbonamento/pagamenti/${id}`, { method:'POST' })
    const d = await res.json(); setAzione('')
    if (d.error) { setMsg(d.error); return }
    setMsg(`✓ Pagamento registrato — rimborsati € ${Number(d.rimborsato||0).toFixed(2)} a ${nome}`)
    carica()
  }

  if (loading) return <div style={{padding:'40px',textAlign:'center',color:'#666'}}>Caricamento...</div>

  const perc = stato?.limite ? Math.min(100, (stato.spedizioni_mese/stato.limite)*100) : 0

  // ROOT (master principale): illimitato, non paga; gestisce gli incassi della sua rete
  if (stato?.isRoot) {
    const pagamenti = stato?.pagamenti || []
    const daIncassare = pagamenti.filter((p:any)=>!p.pagato)
    const totaleAperto = daIncassare.reduce((s:number,p:any)=>s+Number(p.importo||0),0)
    return (
      <div>
        <div style={{marginBottom:'16px'}}>
          <h1 style={{fontSize:'20px',fontWeight:700,color:'#1a1a1a',margin:0}}>Abbonamenti — Incassi</h1>
        </div>
        {msg && <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'6px',padding:'10px',marginBottom:'14px',fontSize:'13px',color:'#ea580c'}}>{msg}</div>}

        <div style={{...card, marginBottom:'16px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'10px'}}>
          <div>
            <div style={{fontSize:'12px',color:'#777'}}>Il tuo piano</div>
            <div style={{fontSize:'18px',fontWeight:800,color:ACCENT}}>Illimitato — gratuito</div>
            <div style={{fontSize:'12px',color:'#999',marginTop:'2px'}}>Master principale: nessun canone, spedizioni illimitate.</div>
          </div>
          <div style={{textAlign:'right' as const}}>
            <div style={{fontSize:'12px',color:'#777'}}>Da incassare</div>
            <div style={{fontSize:'20px',fontWeight:800,color:totaleAperto>0?'#dc2626':'#16a34a'}}>€ {totaleAperto.toFixed(2)}</div>
          </div>
        </div>

        <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a',marginBottom:'10px'}}>Iscrizioni della tua rete</div>
        <div style={{...card, padding:0, overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
            <thead>
              <tr style={{background:'#fafafa'}}>
                {['Master','Piano','Mese','Importo','Stato',''].map(h=>(
                  <th key={h} style={{textAlign:'left' as const,padding:'9px 14px',fontSize:'11px',fontWeight:600,color:'#777',borderBottom:'1px solid #f0f0f0'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!pagamenti.length ? (
                <tr><td colSpan={6} style={{padding:'30px',textAlign:'center' as const,color:'#999',fontSize:'12px'}}>Nessuna iscrizione ancora</td></tr>
              ) : pagamenti.map((p:any)=>(
                <tr key={p.id} style={{borderBottom:'1px solid #f5f5f5'}}>
                  <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:600}}>{p.master_nome}</td>
                  <td style={{padding:'9px 14px',color:'#555'}}>{(p.piano||'').replace('enterprise_','Enterprise ').toUpperCase()}</td>
                  <td style={{padding:'9px 14px',color:'#555'}}>{p.mese}</td>
                  <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:700}}>€ {Number(p.importo||0).toFixed(2)}</td>
                  <td style={{padding:'9px 14px'}}>
                    {p.pagato
                      ? <span style={{background:'#dcfce7',color:'#16a34a',borderRadius:'999px',padding:'3px 10px',fontSize:'11px',fontWeight:700}}>Pagato</span>
                      : <span style={{background:'#fef3c7',color:'#b45309',borderRadius:'999px',padding:'3px 10px',fontSize:'11px',fontWeight:700}}>In attesa</span>}
                  </td>
                  <td style={{padding:'9px 14px',textAlign:'right' as const}}>
                    {!p.pagato && <button onClick={()=>segnaPagato(p.id, p.master_nome, p.importo)} disabled={!!azione}
                      style={{background:ACCENT,color:'#fff',border:'none',borderRadius:'6px',padding:'6px 12px',fontSize:'12px',fontWeight:700,cursor:'pointer',opacity:azione==='pag_'+p.id?0.6:1}}>
                      {azione==='pag_'+p.id?'…':'Segna pagato'}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:700,color:'#1a1a1a',margin:0}}>Abbonamento</h1>
      </div>
      {msg && <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'6px',padding:'10px',marginBottom:'14px',fontSize:'13px',color:'#ea580c'}}>{msg}</div>}

      <div style={{...card, marginBottom:'16px'}}>
        {stato?.attivo ? (
          <>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'10px'}}>
              <div>
                <div style={{fontSize:'12px',color:'#777'}}>Piano attuale</div>
                <div style={{fontSize:'18px',fontWeight:800,color:'#1a1a1a'}}>{(stato.piano||'').replace('enterprise_','Enterprise ').toUpperCase()} — € {stato.prezzo}/mese</div>
              </div>
              <div style={{textAlign:'right' as const}}>
                <div style={{fontSize:'12px',color:'#777'}}>Credito</div>
                <div style={{fontSize:'16px',fontWeight:700,color:Number(stato.credito)<0?'#dc2626':'#16a34a'}}>€ {Number(stato.credito||0).toFixed(2)}</div>
              </div>
            </div>
            <div style={{marginTop:'14px'}}>
              <div style={{fontSize:'12px',color:'#1a1a1a',marginBottom:'4px'}}>Spedizioni questo mese: <b>{stato.spedizioni_mese?.toLocaleString('it-IT')}</b> di {stato.limite?.toLocaleString('it-IT')}</div>
              <div style={{height:'8px',background:'#f0f0f0',borderRadius:'999px',overflow:'hidden'}}><div style={{height:'100%',width:`${perc}%`,background:perc>90?'#dc2626':ACCENT,transition:'width .4s'}}/></div>
            </div>
            <button onClick={disdici} disabled={!!azione}
              style={{marginTop:'14px',background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',borderRadius:'6px',padding:'7px 14px',fontSize:'12.5px',fontWeight:600,cursor:'pointer'}}>Disdici abbonamento</button>
          </>
        ) : (
          <div style={{fontSize:'13px',color:'#dc2626',fontWeight:600}}>Nessun abbonamento attivo — seleziona un piano per usare la piattaforma.</div>
        )}
      </div>

      <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a',marginBottom:'10px'}}>Piani disponibili</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:'12px'}}>
        {(stato?.piani||[]).map((p:any)=>{
          const attuale = stato?.piano===p.id
          const isUp = p.prezzo > Number(stato?.prezzo||0)
          return (
            <div key={p.id} style={{...card, borderColor: attuale?ACCENT:'#e8e8e8'}}>
              <div style={{fontSize:'14px',fontWeight:800,color:'#1a1a1a'}}>{p.nome}</div>
              <div style={{fontSize:'12px',color:'#777'}}>fino a <b>{p.limite.toLocaleString('it-IT')}</b>/mese</div>
              <div style={{fontSize:'20px',fontWeight:800,color:ACCENT,margin:'6px 0'}}>€ {p.prezzo}<span style={{fontSize:'11px',color:'#999',fontWeight:600}}>/mese</span></div>
              {attuale ? (
                <div style={{fontSize:'12px',fontWeight:700,color:'#16a34a',padding:'8px 0'}}>✓ Piano attuale</div>
              ) : (
                <button onClick={()=>cambia(p.id, p.prezzo)} disabled={!!azione}
                  style={{width:'100%',background: isUp?ACCENT:'#fff',color:isUp?'#fff':'#1a1a1a',border:isUp?'none':'1px solid #d1d5db',borderRadius:'6px',padding:'8px',fontSize:'12.5px',fontWeight:700,cursor:'pointer',opacity:azione===p.id?0.6:1}}>
                  {azione===p.id?'…':(!stato?.attivo?'Seleziona':isUp?'Upgrade':'Downgrade')}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
