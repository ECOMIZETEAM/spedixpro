'use client'
import { useEffect, useState } from 'react'

const ACCENT = '#f97316'
const card = { background:'#fff', borderRadius:'8px', border:'1px solid #e8e8e8', padding:'16px' as const }
const MESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']
const meseLabel = (mm:string) => { const [y,m]=(mm||'').split('-'); return (MESI[Number(m)-1]||m||'')+' '+(y||'') }

import { useDialog } from '@/app/components/DialogProvider'
export default function AbbonamentoPage() {
  const dialog = useDialog()
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
    if (!await dialog.confirm({ title: 'Confermi il piano?', message: testo, confirmText: 'Conferma' })) return
    setAzione(pianoId); setMsg('')
    const res = await fetch('/api/abbonamento', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pianoId }) })
    const d = await res.json(); setAzione('')
    if (d.error) { setMsg(d.error); return }
    setMsg(d.addebitato>0 ? `✓ Piano attivato — scalati € ${d.addebitato}` : '✓ Piano aggiornato')
    carica()
  }
  async function disdici() {
    if (!await dialog.confirm({ title: 'Disdire l\'abbonamento?', message: 'Il portale verrà BLOCCATO finché non selezioni un nuovo piano. Nessun rimborso.', danger: true, confirmText: 'Disdici' })) return
    setAzione('disdici')
    await fetch('/api/abbonamento/disdici', { method:'POST' })
    setAzione(''); window.location.reload()
  }
  async function segnaPagato(id:string, nome:string, importo:number, metodo:'pagato'|'bonifico') {
    const isBonifico = metodo === 'bonifico'
    const testo = isBonifico
      ? `Confermi il BONIFICO di € ${Number(importo).toFixed(2)} da ${nome}? Il credito gli verrà RIMBORSATO in automatico (ha pagato con bonifico).`
      : `Segnare come PAGATO € ${Number(importo).toFixed(2)} da ${nome}? NESSUN rimborso: il pagamento resta scalato dal suo credito.`
    if (!await dialog.confirm({ title: isBonifico?'Bonifico ricevuto?':'Segna pagato', message: testo, confirmText: 'Conferma' })) return
    setAzione('pag_'+id); setMsg('')
    const res = await fetch(`/api/abbonamento/pagamenti/${id}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ metodo }) })
    const d = await res.json(); setAzione('')
    if (d.error) { setMsg(d.error); return }
    setMsg(d.rimborsato>0 ? `✓ Bonifico registrato — rimborsati € ${Number(d.rimborsato).toFixed(2)} a ${nome}` : `✓ Pagato registrato (nessun rimborso) — ${nome}`)
    carica()
  }

  if (loading) return <div style={{padding:'40px',textAlign:'center',color:'#666'}}>Caricamento...</div>

  const perc = stato?.limite ? Math.min(100, (stato.spedizioni_mese/stato.limite)*100) : 0

  // ROOT (master principale): illimitato, non paga; gestisce gli incassi della sua rete
  if (stato?.isRoot) {
    const abbonati = stato?.abbonati || []
    const daIncassare = abbonati.filter((a:any)=>a.pagamento_id)
    const totaleAperto = Number(stato?.totaleDaIncassare||0)
    return (
      <div>
        <div style={{marginBottom:'16px'}}>
          <h1 style={{fontSize:'20px',fontWeight:700,color:'#1a1a1a',margin:0}}>Abbonamenti — Incassi</h1>
        </div>
        {msg && <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'6px',padding:'10px',marginBottom:'14px',fontSize:'13px',color:'#ea580c'}}>{msg}</div>}

        {/* KPI mensili */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:'12px',marginBottom:'16px'}}>
          <div style={card}>
            <div style={{fontSize:'12px',color:'#777'}}>Da incassare</div>
            <div style={{fontSize:'22px',fontWeight:800,color:totaleAperto>0?'#dc2626':'#16a34a'}}>€ {totaleAperto.toFixed(2)}</div>
            <div style={{fontSize:'11px',color:'#999',marginTop:'2px'}}>{daIncassare.length} in attesa</div>
          </div>
          <div style={card}>
            <div style={{fontSize:'12px',color:'#777'}}>Incassato questo mese</div>
            <div style={{fontSize:'22px',fontWeight:800,color:'#16a34a'}}>€ {Number(stato?.incassatoMese||0).toFixed(2)}</div>
            <div style={{fontSize:'11px',color:'#999',marginTop:'2px'}}>pagamenti segnati nel mese</div>
          </div>
          <div style={card}>
            <div style={{fontSize:'12px',color:'#777'}}>Incassato {stato?.annoCorrente||''}</div>
            <div style={{fontSize:'22px',fontWeight:800,color:'#16a34a'}}>€ {Number(stato?.incassatoAnno||0).toFixed(2)}</div>
            <div style={{fontSize:'11px',color:'#999',marginTop:'2px'}}>totale anno in corso</div>
          </div>
          <div style={card}>
            <div style={{fontSize:'12px',color:'#777'}}>Previsto prossimo mese</div>
            <div style={{fontSize:'22px',fontWeight:800,color:ACCENT}}>€ {Number(stato?.previstoProssimoMese||0).toFixed(2)}</div>
            <div style={{fontSize:'11px',color:'#999',marginTop:'2px'}}>{stato?.abbonatiAttivi||0} abbonati attivi (esclusi gli esenti)</div>
          </div>
          <div style={card}>
            <div style={{fontSize:'12px',color:'#777'}}>Il tuo piano</div>
            <div style={{fontSize:'18px',fontWeight:800,color:ACCENT}}>Illimitato — gratis</div>
            <div style={{fontSize:'11px',color:'#999',marginTop:'2px'}}>Master principale: nessun canone.</div>
          </div>
        </div>

        <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a',marginBottom:'10px'}}>Master della tua rete <span style={{color:'#999',fontWeight:400}}>({abbonati.length})</span></div>
        <div style={{...card, padding:0, overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
            <thead>
              <tr style={{background:'#fafafa'}}>
                {['Master','Piano','Canone/mese','Stato',''].map(h=>(
                  <th key={h} style={{textAlign:'left' as const,padding:'9px 14px',fontSize:'11px',fontWeight:600,color:'#777',borderBottom:'1px solid #f0f0f0'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!abbonati.length ? (
                <tr><td colSpan={5} style={{padding:'30px',textAlign:'center' as const,color:'#999',fontSize:'12px'}}>Nessun master abbonato ancora</td></tr>
              ) : abbonati.map((a:any)=>(
                <tr key={a.master_id} style={{borderBottom:'1px solid #f5f5f5'}}>
                  <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:600}}>
                    {a.master_nome}
                    {a.esente && <span style={{marginLeft:'6px',background:'#eef2ff',color:'#4338ca',borderRadius:'999px',padding:'1px 7px',fontSize:'10px',fontWeight:700}}>esente</span>}
                  </td>
                  <td style={{padding:'9px 14px',color:'#555'}}>{(a.piano||'').replace('enterprise_','Enterprise ').toUpperCase() || '—'}</td>
                  <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:700}}>€ {Number(a.prezzo||0).toFixed(2)}{a.esente && <span style={{fontSize:'10px',color:'#4338ca',fontWeight:600}}> (gratis)</span>}</td>
                  <td style={{padding:'9px 14px'}}>
                    {a.esente
                      ? <span style={{background:'#eef2ff',color:'#4338ca',borderRadius:'999px',padding:'3px 10px',fontSize:'11px',fontWeight:700}}>Esente</span>
                      : a.pagamento_id
                        ? <span style={{background:'#fef3c7',color:'#b45309',borderRadius:'999px',padding:'3px 10px',fontSize:'11px',fontWeight:700}}>Da incassare € {Number(a.importo_da_incassare||0).toFixed(2)}{a.n_da_incassare>1?` (${a.n_da_incassare} mesi)`:''}</span>
                        : <span style={{background:'#dcfce7',color:'#16a34a',borderRadius:'999px',padding:'3px 10px',fontSize:'11px',fontWeight:700}}>In regola</span>}
                  </td>
                  <td style={{padding:'9px 14px',textAlign:'right' as const}}>
                    {a.pagamento_id && !a.esente && <div style={{display:'inline-flex',gap:'6px'}}>
                      <button onClick={()=>segnaPagato(a.pagamento_id, a.master_nome, a.importo_da_incassare, 'pagato')} disabled={!!azione} title="Saldato: nessun rimborso al credito"
                        style={{background:'#fff',color:'#16a34a',border:'1px solid #86efac',borderRadius:'6px',padding:'6px 10px',fontSize:'12px',fontWeight:700,cursor:'pointer'}}>Pagato</button>
                      <button onClick={()=>segnaPagato(a.pagamento_id, a.master_nome, a.importo_da_incassare, 'bonifico')} disabled={!!azione} title="Bonifico: rimborsa il credito al master"
                        style={{background:ACCENT,color:'#fff',border:'none',borderRadius:'6px',padding:'6px 10px',fontSize:'12px',fontWeight:700,cursor:'pointer'}}>Bonifico</button>
                    </div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* STORICO INCASSI mese per mese */}
        <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a',margin:'22px 0 10px'}}>Storico incassi</div>
        <div style={{...card, padding:0, overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
            <thead>
              <tr style={{background:'#fafafa'}}>
                {['Mese','Pagamenti','Incassato'].map(h=>(
                  <th key={h} style={{textAlign: h==='Mese'?'left':'right' as const,padding:'9px 14px',fontSize:'11px',fontWeight:600,color:'#777',borderBottom:'1px solid #f0f0f0'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!(stato?.storicoIncassi||[]).length ? (
                <tr><td colSpan={3} style={{padding:'26px',textAlign:'center' as const,color:'#999',fontSize:'12px'}}>Nessun incasso registrato</td></tr>
              ) : (stato?.storicoIncassi||[]).map((r:any)=>(
                <tr key={r.mese} style={{borderBottom:'1px solid #f5f5f5'}}>
                  <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:600}}>{meseLabel(r.mese)}</td>
                  <td style={{padding:'9px 14px',color:'#555',textAlign:'right' as const}}>{r.n}</td>
                  <td style={{padding:'9px 14px',color:'#16a34a',fontWeight:800,textAlign:'right' as const}}>€ {Number(r.incassato||0).toFixed(2)}</td>
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
