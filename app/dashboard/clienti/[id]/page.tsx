'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

function fmtEuro(n: number) {
  return `€ ${Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtImporto(n: number) {
  const v = Number(n || 0)
  const seg = v > 0 ? '+' : v < 0 ? '−' : ''
  const abs = Math.abs(v).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${seg} € ${abs}`
}
function fmtData(iso: string) {
  const d = new Date(iso)
  return `${d.toLocaleDateString('it-IT')} ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`
}

export default function ClienteProfiloPage() {
  const { id } = useParams()
  const [cliente, setCliente] = useState<any>(null)
  const [spedizioni, setSpedizioni] = useState<any[]>([])
  const [movimenti, setMovimenti] = useState<any[]>([])
  const [paginaMov, setPaginaMov] = useState(1)
  const [cercaMov, setCercaMov] = useState('')
  const perPaginaMov = 10
  const [saldo, setSaldo] = useState(0)
  const [loading, setLoading] = useState(true)

  // Popup ricarica
  const [showRicarica, setShowRicarica] = useState(false)
  const [importo, setImporto] = useState('')
  const [conferma, setConferma] = useState('')
  const [descrizione, setDescrizione] = useState('Accredito credito a scalare')
  const [saving, setSaving] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  function caricaCliente() {
    fetch(`/api/clienti/${id}`).then(r => r.json()).then(d => { setCliente(d); setLoading(false) })
  }
  function caricaMovimenti() {
    fetch(`/api/movimenti/lista?clienteId=${id}`).then(r => r.json()).then(d => {
      if (d && !d.error) { setMovimenti(d.movimenti || []); setSaldo(Number(d.saldo || 0)) }
    })
  }

  useEffect(() => {
    caricaCliente()
    caricaMovimenti()
    fetch(`/api/spedizioni/lista?clienteId=${id}`).then(r => r.json()).then(d => {
      setSpedizioni(Array.isArray(d) ? d.slice(0, 10) : [])
    })
  }, [id])

  function apriRicarica() {
    setImporto(''); setConferma(''); setDescrizione('Accredito credito a scalare')
    setErrore(null); setShowRicarica(true)
  }

  async function salvaRicarica() {
    setErrore(null)
    const imp = parseFloat(importo.replace(',', '.'))
    const conf = parseFloat(conferma.replace(',', '.'))
    if (!isFinite(imp) || imp === 0) { setErrore('Inserisci un importo diverso da 0 (usa il − per togliere credito)'); return }
    if (imp !== conf) { setErrore('L\'importo e la conferma non coincidono'); return }
    if (!descrizione.trim()) { setErrore('Inserisci una descrizione'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/movimenti/crea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId: id,
          tipo: imp > 0 ? 'ricarica' : 'rettifica',
          descrizione: descrizione.trim(),
          importo: imp,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setErrore(data.error || 'Errore durante la ricarica'); setSaving(false); return }
      setShowRicarica(false)
      setSaving(false)
      caricaCliente()
      caricaMovimenti()
    } catch {
      setErrore('Errore di rete'); setSaving(false)
    }
  }

  if (loading) return <div style={{padding:'40px',textAlign:'center',color:'#1a1a1a'}}>Caricamento...</div>
  if (!cliente || cliente.error) return <div style={{padding:'40px',textAlign:'center',color:'#dc2626'}}>Cliente non trovato</div>

  const creditoView = Number(cliente.credito ?? saldo ?? 0)

  const movimentiFiltrati = cercaMov
    ? movimenti.filter((m:any) => (m.descrizione||'').toLowerCase().includes(cercaMov.toLowerCase()) || (m.riferimento||'').toLowerCase().includes(cercaMov.toLowerCase()))
    : movimenti
  const totPagineMov = Math.max(1, Math.ceil(movimentiFiltrati.length / perPaginaMov))
  const paginaCorrMov = Math.min(paginaMov, totPagineMov)
  const movimentiPag = movimentiFiltrati.slice((paginaCorrMov-1)*perPaginaMov, paginaCorrMov*perPaginaMov)

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
          <span style={{fontSize:'13px',color:'#1a1a1a'}}>Credito: <strong style={{color:'#f97316'}}>{fmtEuro(creditoView)}</strong></span>
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
              {cliente.piva&&<div><div style={{color:'#1a1a1a',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>P.IVA</div><div style={{color:'#1a1a1a'}}>{cliente.piva}</div></div>}
              {cliente.cf&&<div><div style={{color:'#1a1a1a',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>CODICE FISCALE</div><div>{cliente.cf}</div></div>}
              {cliente.pec&&<div><div style={{color:'#1a1a1a',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>PEC</div><div>{cliente.pec}</div></div>}
              {cliente.rappresentante_legale&&<div><div style={{color:'#1a1a1a',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>RAPPRESENTANTE LEGALE</div><div style={{color:'#1a1a1a'}}>{cliente.rappresentante_legale}</div></div>}
              {cliente.telefono&&<div><div style={{color:'#1a1a1a',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>TELEFONO</div><div style={{color:'#1a1a1a'}}>{cliente.telefono}</div></div>}
              <div><div style={{color:'#1a1a1a',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>LISTINO PREZZI</div><div style={{color:cliente.listino_cliente_id?'#f97316':'#bbb',fontWeight:'600'}}>{cliente.listini_clienti?.nome || (cliente.listino_cliente_id?'Assegnato':'— nessun listino —')}</div></div>
              <div><div style={{color:'#1a1a1a',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>TIPO CONTRATTO</div><div style={{color:'#1a1a1a'}}>{cliente.tipo_contratto?.replace(/_/g,' ')||'—'}</div></div>
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
            <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:'8px',padding:'10px 16px',borderBottom:'1px solid #f0f0f0'}}>
              <span style={{fontSize:'12.5px',color:'#1a1a1a'}}>Cerca:</span>
              <input value={cercaMov} onChange={e=>{setCercaMov(e.target.value);setPaginaMov(1)}} placeholder="Movimento o riferimento…" style={{padding:'7px 10px',border:'1px solid #ddd',borderRadius:'6px',fontSize:'13px',width:'240px',color:'#1a1a1a',background:'#fff'}}/>
            </div>
            {!movimenti.length ? (
              <div style={{padding:'40px',textAlign:'center',color:'#1a1a1a'}}>
                <div style={{fontSize:'32px',marginBottom:'8px'}}>📊</div>
                <div style={{fontSize:'13px'}}>Nessun movimento</div>
              </div>
            ) : (
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
                  <thead>
                    <tr style={{background:'#fafafa'}}>
                      <th style={{textAlign:'left',padding:'9px 16px',fontSize:'11px',fontWeight:'700',color:'#1a1a1a',textTransform:'uppercase',letterSpacing:'.03em',borderBottom:'1px solid #f0f0f0'}}>Data e ora</th>
                      <th style={{textAlign:'left',padding:'9px 16px',fontSize:'11px',fontWeight:'700',color:'#1a1a1a',textTransform:'uppercase',letterSpacing:'.03em',borderBottom:'1px solid #f0f0f0'}}>Movimento</th>
                      <th style={{textAlign:'right',padding:'9px 16px',fontSize:'11px',fontWeight:'700',color:'#1a1a1a',textTransform:'uppercase',letterSpacing:'.03em',borderBottom:'1px solid #f0f0f0'}}>Importo</th>
                      <th style={{textAlign:'right',padding:'9px 16px',fontSize:'11px',fontWeight:'700',color:'#1a1a1a',textTransform:'uppercase',letterSpacing:'.03em',borderBottom:'1px solid #f0f0f0'}}>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movimentiPag.map((m:any) => {
                      const positivo = Number(m.importo) > 0
                      return (
                        <tr key={m.id}>
                          <td style={{padding:'10px 16px',color:'#1a1a1a',fontSize:'12px',borderBottom:'1px solid #f5f5f5',whiteSpace:'nowrap'}}>{fmtData(m.created_at)}</td>
                          <td style={{padding:'10px 16px',color:'#1a1a1a',borderBottom:'1px solid #f5f5f5'}}>{m.descrizione}</td>
                          <td style={{padding:'10px 16px',textAlign:'right',fontWeight:'600',borderBottom:'1px solid #f5f5f5',color:positivo?'#15803d':'#b91c1c',whiteSpace:'nowrap'}}>{fmtImporto(Number(m.importo))}</td>
                          <td style={{padding:'10px 16px',textAlign:'right',color:'#1a1a1a',borderBottom:'1px solid #f5f5f5',whiteSpace:'nowrap'}}>{fmtEuro(Number(m.saldo_dopo))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'flex-end',gap:'4px',borderTop:'1px solid #f0f0f0'}}>
              <button onClick={()=>setPaginaMov(p=>Math.max(1,p-1))} disabled={paginaCorrMov<=1} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorrMov<=1?'default':'pointer',color:paginaCorrMov<=1?'#1a1a1a':'#1a1a1a'}}>Precedente</button>
              {Array.from({length: totPagineMov}, (_,i)=>i+1).filter(n => n===1 || n===totPagineMov || Math.abs(n-paginaCorrMov)<=2).map((n,idx,arr)=>(
                <span key={n} style={{display:'flex',alignItems:'center'}}>
                  {idx>0 && arr[idx-1] !== n-1 && <span style={{padding:'0 4px',color:'#bbb',fontSize:'12px'}}>…</span>}
                  <button onClick={()=>setPaginaMov(n)} style={{minWidth:'30px',padding:'5px 8px',border:'1px solid',borderColor:n===paginaCorrMov?'#f97316':'#d1d5db',borderRadius:'5px',background:n===paginaCorrMov?'#f97316':'#fff',color:n===paginaCorrMov?'#fff':'#1a1a1a',fontSize:'12px',fontWeight:n===paginaCorrMov?'700':'400',cursor:'pointer'}}>{n}</button>
                </span>
              ))}
              <button onClick={()=>setPaginaMov(p=>Math.min(totPagineMov,p+1))} disabled={paginaCorrMov>=totPagineMov} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorrMov>=totPagineMov?'default':'pointer',color:paginaCorrMov>=totPagineMov?'#1a1a1a':'#1a1a1a'}}>Successivo</button>
            </div>
          </div>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
          <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700',color:'#1a1a1a',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span>Credito &amp; Movimenti</span>
              <button onClick={apriRicarica} style={{background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',padding:'4px 12px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>+ Ricarica</button>
            </div>
            <div style={{padding:'20px',textAlign:'center'}}>
              <div style={{fontSize:'32px',fontWeight:'800',color:'#f97316'}}>{fmtEuro(creditoView)}</div>
              <div style={{fontSize:'12px',color:'#1a1a1a',marginTop:'4px'}}>credito disponibile</div>
            </div>
            <div style={{borderTop:'1px solid #f0f0f0',padding:'12px 16px',textAlign:'center',color:'#1a1a1a',fontSize:'12px'}}>
              {movimenti.length ? `${movimenti.length} movimenti · ultimo ${fmtData(movimenti[0].created_at)}` : 'Nessun movimento'}
            </div>
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

      {/* POPUP RICARICA */}
      {showRicarica && (
        <div onClick={()=>!saving&&setShowRicarica(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:'10px',width:'520px',maxWidth:'94vw',overflow:'hidden'}}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid #eee',fontSize:'15px',fontWeight:'700',color:'#1a1a1a'}}>
              👤 Cliente: {cliente.ragione_sociale}
            </div>
            <div style={{padding:'20px'}}>
              {errore && <div style={{marginBottom:'14px',padding:'10px 12px',borderRadius:'8px',background:'#fef2f2',border:'1px solid #fecaca',color:'#b91c1c',fontSize:'13px'}}>{errore}</div>}
              <div style={{display:'grid',gridTemplateColumns:'150px 1fr',gap:'12px',alignItems:'center'}}>
                <label style={{fontSize:'13px',fontWeight:'600',color:'#1a1a1a',textAlign:'right'}}>Importo</label>
                <div style={{position:'relative'}}>
                  <input value={importo} onChange={e=>setImporto(e.target.value)} placeholder="0.00" inputMode="decimal"
                    style={{width:'100%',padding:'9px 34px 9px 12px',border:'1px solid #ddd',borderRadius:'6px',fontSize:'14px',textAlign:'right',boxSizing:'border-box',color:'#1a1a1a',background:'#fff'}}/>
                  <span style={{position:'absolute',right:'12px',top:'50%',transform:'translateY(-50%)',color:'#1a1a1a',fontSize:'14px'}}>€</span>
                </div>

                <label style={{fontSize:'13px',fontWeight:'600',color:'#1a1a1a',textAlign:'right'}}>Conferma l'importo</label>
                <div style={{position:'relative'}}>
                  <input value={conferma} onChange={e=>setConferma(e.target.value)} placeholder="0.00" inputMode="decimal"
                    style={{width:'100%',padding:'9px 34px 9px 12px',border:'1px solid #ddd',borderRadius:'6px',fontSize:'14px',textAlign:'right',boxSizing:'border-box',color:'#1a1a1a',background:'#fff'}}/>
                  <span style={{position:'absolute',right:'12px',top:'50%',transform:'translateY(-50%)',color:'#1a1a1a',fontSize:'14px'}}>€</span>
                </div>

                <label style={{fontSize:'13px',fontWeight:'600',color:'#1a1a1a',textAlign:'right'}}>Descrizione</label>
                <input value={descrizione} onChange={e=>setDescrizione(e.target.value)}
                  style={{width:'100%',padding:'9px 12px',border:'1px solid #ddd',borderRadius:'6px',fontSize:'14px',boxSizing:'border-box',color:'#1a1a1a',background:'#fff'}}/>
              </div>
              <div style={{marginTop:'8px',fontSize:'11px',color:'#1a1a1a'}}>Suggerimento: scrivi <strong>200</strong> per accreditare, <strong>-200</strong> per addebitare/togliere credito.</div>
            </div>
            <div style={{padding:'14px 20px',borderTop:'1px solid #eee',display:'flex',justifyContent:'flex-end',gap:'10px'}}>
              <button onClick={()=>setShowRicarica(false)} disabled={saving} style={{padding:'8px 16px',background:'#f2f2f2',color:'#1a1a1a',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Annulla</button>
              <button onClick={salvaRicarica} disabled={saving} style={{padding:'8px 20px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:saving?0.6:1}}>{saving?'Salvataggio…':'Ricarica'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
