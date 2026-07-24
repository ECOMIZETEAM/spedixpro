'use client'
import { useState, useEffect } from 'react'

const ACCENT = '#f97316'
const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden' as const}
const th = {padding:'9px 12px',fontSize:'11px',fontWeight:700 as const,textTransform:'uppercase' as const,color:'#666',textAlign:'left' as const,whiteSpace:'nowrap' as const}
const td = {padding:'9px 12px',fontSize:'12.5px',color:'#1a1a1a',borderTop:'1px solid #f0f0f0'}

export default function NetworkRicevutiPage() {
  const [tab, setTab] = useState<'rettifiche'|'contrassegni'|'resi'>('rettifiche')
  const [dati, setDati] = useState<any>({rettifiche:[],contrassegni:[],resi:[]})
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [propagando, setPropagando] = useState<string>('')
  const [accettando, setAccettando] = useState<string>('')

  async function carica() {
    setLoading(true)
    const d = await fetch('/api/network/ricevuti').then(r=>r.json()).catch(()=>null)
    if (d && !d.error) setDati(d)
    setLoading(false)
  }
  useEffect(()=>{ carica() }, [])

  // Propaga una rettifica ricevuta ai MIEI clienti/sub-master: riusa l'upload
  // (stessa LDV + peso reale -> il mio upload la smista col MIO listino)
  async function propaga(r: any) {
    setPropagando(r.id); setMsg('')
    try {
      const res = await fetch('/api/rettifiche/upload', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          nomeFile: 'Propagazione ' + r.numero_spedizione,
          righe: [{ 'LDV': r.numero_spedizione, 'Peso Reale': r.peso_reale }],
        })
      })
      const d = await res.json()
      if (d.error) setMsg('Errore: ' + d.error)
      else if (d.nDaRettificare > 0) {
        await decidi(r, 'propagata', true)
        setMsg('✓ ' + r.numero_spedizione + ': rettifica creata verso il tuo cliente/master — confermala dalla pagina Rettifiche')
      }
      else if (d.nTrovate > 0) setMsg(r.numero_spedizione + ': nessuna differenza col tuo listino (o gia propagata)')
      else setMsg(r.numero_spedizione + ': LDV non agganciata (' + (d.nScartati||0) + ' scartate)')
    } catch { setMsg('Errore di connessione') }
    setPropagando('')
  }

  async function decidi(r: any, decisione: string | null, silenzioso = false) {
    try {
      await fetch('/api/network/rettifiche', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ rettifica_id: r.id, decisione })
      })
      if (!silenzioso) setMsg(decisione === 'assorbita' ? ('✓ ' + r.numero_spedizione + ': assorbita — resta a tuo carico, i tuoi clienti non vengono toccati') : 'Aggiornata')
      carica()
    } catch { if (!silenzioso) setMsg('Errore di connessione') }
  }

  // Accetta un reso ricevuto: propaga (distinte reso verso clienti e/o sotto-master)
  async function accettaReso(r: any) {
    setAccettando(r.id); setMsg('')
    try {
      const res = await fetch('/api/network/resi/accetta', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ distintaId: r.id })
      })
      const d = await res.json()
      if (d.error) setMsg('Errore: ' + d.error)
      else setMsg('✓ Reso #' + r.numero + ' accettato — create ' + (d.distinteCreate||0) + ' distinte reso' + (d.giaCaricate ? ' ('+d.giaCaricate+' già in reso, saltate)' : '') + ' (verso i tuoi clienti/sotto-master)')
      carica()
    } catch { setMsg('Errore di connessione') }
    setAccettando('')
  }

  // Accetta una rimessa contrassegni ricevuta: crea le distinte verso i miei clienti
  async function accettaContrassegno(c: any) {
    setAccettando(c.id); setMsg('')
    try {
      const res = await fetch('/api/network/contrassegni/accetta', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ distintaId: c.id })
      })
      const d = await res.json()
      if (d.error) setMsg('Errore: ' + d.error)
      else setMsg('✓ Rimessa #' + c.numero + ' accettata — vai in Contrassegni › Distinte Contrassegni: lì la selezioni e la CARICHI verso i tuoi clienti/sotto-master quando vuoi.')
      carica()
    } catch { setMsg('Errore di connessione') }
    setAccettando('')
  }

  const tabs: [typeof tab, string, number][] = [
    ['rettifiche', 'Rettifiche ricevute', dati.rettifiche.length],
    ['contrassegni', 'Rimesse COD ricevute', dati.contrassegni.length],
    ['resi', 'Resi ricevuti', dati.resi.length],
  ]

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:700,color:'#1a1a1a',margin:0}}>Dal mio network</h1>
        <p style={{color:'#999',fontSize:'13px',marginTop:'4px'}}>Rettifiche, rimesse contrassegni e resi ricevuti dal livello superiore — accetta e propaga alla tua rete/clienti</p>
      </div>

      <div style={{display:'flex',gap:'8px',marginBottom:'16px'}}>
        {tabs.map(([k, label, n]) => (
          <button key={k} onClick={()=>setTab(k)} style={{background:tab===k?ACCENT:'#fff',color:tab===k?'#fff':'#1a1a1a',border:'1px solid '+(tab===k?ACCENT:'#e8e8e8'),borderRadius:'8px',padding:'8px 16px',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>
            {label} ({n})
          </button>
        ))}
      </div>

      {msg && <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'8px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#ea580c'}}>{msg}</div>}

      <div style={card}>
        {loading ? <div style={{padding:'40px',textAlign:'center',color:'#999'}}>Caricamento…</div> : (
          <>
          {tab==='rettifiche' && (
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:'#f9fafb'}}>
                <th style={th}>Data</th><th style={th}>Da</th><th style={th}>LDV</th><th style={th}>Peso dich. → reale</th><th style={th}>Costo → ricalcolo</th><th style={th}>Differenza</th><th style={th}>Stato</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {dati.rettifiche.length===0 ? <tr><td colSpan={8} style={{...td,textAlign:'center',color:'#999',padding:'32px'}}>Nessuna rettifica ricevuta</td></tr> :
                dati.rettifiche.map((r:any)=>(
                  <tr key={r.id}>
                    <td style={td}>{new Date(r.created_at).toLocaleDateString('it-IT')}</td>
                    <td style={td}>{r.masters?.nome||'—'}</td>
                    <td style={{...td,fontWeight:600}}>{r.numero_spedizione}</td>
                    <td style={td}>{r.peso_iniziale} → {r.peso_reale} kg</td>
                    <td style={td}>€ {Number(r.costo_iniziale).toFixed(2)} → € {Number(r.costo_finale).toFixed(2)}</td>
                    <td style={{...td,fontWeight:700,color:Number(r.differenza)<0?'#dc2626':'#16a34a'}}>€ {Number(r.differenza).toFixed(2)}</td>
                    <td style={td}>
                      <span style={{fontSize:'11px',fontWeight:600,padding:'2px 8px',borderRadius:'999px',background:r.confermata?'#fee2e2':'#fef3c7',color:r.confermata?'#991b1b':'#92400e'}}>
                        {r.confermata?'Addebitata':'In attesa'}
                      </span>
                    </td>
                    <td style={{...td,textAlign:'right',whiteSpace:'nowrap'}}>
                      {r.propagazione === 'propagata' ? (
                        <span style={{fontSize:'11px',fontWeight:600,padding:'2px 8px',borderRadius:'999px',background:'#ffedd5',color:'#ea580c'}}>↓ Propagata</span>
                      ) : r.propagazione === 'assorbita' ? (
                        <span style={{fontSize:'11px',fontWeight:600,padding:'2px 8px',borderRadius:'999px',background:'#dcfce7',color:'#166534'}}>✓ Assorbita da me</span>
                      ) : (<>
                        <button onClick={()=>propaga(r)} disabled={propagando===r.id}
                          style={{background:'#fff7ed',color:'#ea580c',border:'1px solid #fed7aa',borderRadius:'6px',padding:'5px 10px',fontSize:'12px',fontWeight:600,cursor:'pointer',opacity:propagando===r.id?.6:1,marginRight:'6px'}}>
                          {propagando===r.id?'…':'↓ Propaga'}
                        </button>
                        <button onClick={()=>decidi(r, 'assorbita')}
                          style={{background:'#f0fdf4',color:'#166534',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'5px 10px',fontSize:'12px',fontWeight:600,cursor:'pointer'}}>
                          ✓ La assorbo io
                        </button>
                      </>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab==='contrassegni' && (
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:'#f9fafb'}}>
                <th style={th}>Data</th><th style={th}>Da</th><th style={th}>Distinta</th><th style={th}>LDV incluse</th><th style={th}>Totale dovuto</th><th style={th}>Stato</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {dati.contrassegni.length===0 ? <tr><td colSpan={7} style={{...td,textAlign:'center',color:'#999',padding:'32px'}}>Nessuna rimessa ricevuta</td></tr> :
                dati.contrassegni.map((c:any)=>(
                  <tr key={c.id}>
                    <td style={td}>{new Date(c.created_at).toLocaleDateString('it-IT')}</td>
                    <td style={td}>{c.masters?.nome||'—'}</td>
                    <td style={{...td,fontWeight:600}}>#{c.numero}</td>
                    <td style={td}>{(c.distinte_contrassegni_righe||[]).map((x:any)=>x.numero_spedizione).join(', ')||'—'}</td>
                    <td style={{...td,fontWeight:700,color:'#16a34a'}}>€ {Number(c.totale_rimborsato ?? c.totale_iniziale).toFixed(2)}</td>
                    <td style={td}>
                      <span style={{fontSize:'11px',fontWeight:600,padding:'2px 8px',borderRadius:'999px',background:c.stato==='pagata'?'#dcfce7':'#fef3c7',color:c.stato==='pagata'?'#166534':'#92400e'}}>
                        {c.stato==='pagata'?('Pagata'+(c.data_pagamento?' il '+new Date(c.data_pagamento).toLocaleDateString('it-IT'):'')):'Da ricevere'}
                      </span>
                    </td>
                    <td style={{...td,textAlign:'right',whiteSpace:'nowrap'}}>
                      {c.accettata_target ? (
                        <span style={{fontSize:'11px',fontWeight:600,padding:'2px 8px',borderRadius:'999px',background:'#dcfce7',color:'#166534'}}>✓ Accettata</span>
                      ) : (
                        <button onClick={()=>accettaContrassegno(c)} disabled={accettando===c.id}
                          style={{background:'#fff7ed',color:'#ea580c',border:'1px solid #fed7aa',borderRadius:'6px',padding:'5px 10px',fontSize:'12px',fontWeight:600,cursor:'pointer',opacity:accettando===c.id?.6:1}}>
                          {accettando===c.id?'…':'✓ Accetta e carica'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab==='resi' && (
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:'#f9fafb'}}>
                <th style={th}>Data</th><th style={th}>Da</th><th style={th}>Distinta</th><th style={th}>LDV incluse</th><th style={th}>Totale</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {dati.resi.length===0 ? <tr><td colSpan={6} style={{...td,textAlign:'center',color:'#999',padding:'32px'}}>Nessun reso ricevuto</td></tr> :
                dati.resi.map((r:any)=>(
                  <tr key={r.id}>
                    <td style={td}>{new Date(r.created_at).toLocaleDateString('it-IT')}</td>
                    <td style={td}>{r.masters?.nome||'—'}</td>
                    <td style={{...td,fontWeight:600}}>#{r.numero}</td>
                    <td style={td}>{(Array.isArray(r.voci)?r.voci:[]).map((x:any)=>x.numero).join(', ')||('—')}</td>
                    <td style={{...td,fontWeight:700,color:'#dc2626'}}>€ {Number(r.totale||0).toFixed(2)}</td>
                    <td style={{...td,textAlign:'right',whiteSpace:'nowrap'}}>
                      {r.accettata_target ? (
                        <span style={{fontSize:'11px',fontWeight:600,padding:'2px 8px',borderRadius:'999px',background:'#dcfce7',color:'#166534'}}>✓ Accettato</span>
                      ) : (
                        <button onClick={()=>accettaReso(r)} disabled={accettando===r.id}
                          style={{background:'#fff7ed',color:'#ea580c',border:'1px solid #fed7aa',borderRadius:'6px',padding:'5px 10px',fontSize:'12px',fontWeight:600,cursor:'pointer',opacity:accettando===r.id?.6:1}}>
                          {accettando===r.id?'…':'✓ Accetta e propaga'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </>
        )}
      </div>
    </div>
  )
}
