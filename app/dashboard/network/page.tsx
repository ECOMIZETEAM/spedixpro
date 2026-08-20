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
  const [apertoBlocco, setApertoBlocco] = useState<string>('')

  async function carica() {
    setLoading(true)
    const d = await fetch('/api/network/ricevuti').then(r=>r.json()).catch(()=>null)
    if (d && !d.error) setDati(d)
    setLoading(false)
  }
  useEffect(()=>{ carica() }, [])

  // UN BLOCCO, NON CINQUANTASETTE RIGHE.
  // Le rettifiche arrivano tutte insieme, dallo stesso file dello stesso mittente: si decidono
  // insieme. Il dettaglio resta, ma si apre solo se uno lo vuole vedere.
  const blocchi = (() => {
    const m = new Map<string, any>()
    for (const r of (dati.rettifiche || [])) {
      const giorno = new Date(r.created_at).toLocaleDateString('it-IT')
      const da = r.masters?.nome || '—'
      const k = da + '|' + giorno
      if (!m.has(k)) m.set(k, { k, da, giorno, righe: [], totale: 0, daDecidere: [] })
      const b = m.get(k)
      b.righe.push(r); b.totale += Number(r.differenza) || 0
      if (!r.propagazione) b.daDecidere.push(r.id)
    }
    return Array.from(m.values()).sort((a, b) => (a.giorno < b.giorno ? 1 : -1))
  })()

  // ACCETTARE NON E' CARICARE.
  // Accettare vuol dire "va bene, me la prendo in carico": le righe finiscono nella MIA pagina
  // Rettifica Costi, riprezzate col MIO listino e gia' divise per cliente e sotto-master. Li'
  // guardo, scelgo a CHI caricarle, e solo premendo Conferma il credito scende di un gradino.
  // Sono due gesti distinti, come per i contrassegni: chi accetta non sta ancora addebitando
  // nessuno, e finche' non carica non e' uscito un euro dalla sua rete.
  async function decidiBlocco(b: any, decisione: 'propagata' | 'assorbita') {
    if (!b.daDecidere.length) return
    setPropagando(b.k); setMsg('')
    try {
      const res = await fetch('/api/network/rettifiche', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ rettifica_ids: b.daDecidere, decisione })
      })
      const d = await res.json()
      if (d.error) setMsg('Errore: ' + d.error)
      else if (d.giaDecise) setMsg('ℹ️ ' + (d.messaggio || 'Queste rettifiche erano già state decise.'))
      else if (decisione === 'assorbita') setMsg(`✓ ${d.assorbite} rettifiche assorbite: restano a tuo carico, la tua rete non viene toccata.`)
      else {
        // Messaggio COMPLETO e persistente: prima non spiegava perché alcune non venissero girate
        // (mostrava "0 accettate" e basta), e sembrava che "non le facesse accettare". Ora dice
        // esattamente quali sono rimaste indietro, perché, e come chiuderle ("Le assorbo io").
        const parti: string[] = []
        if (d.create > 0) parti.push(`✓ Accettate ${d.create}: sono in Spedizioni › Rettifica Costi, divise per cliente e sotto-master — da lì scegli a chi caricarle (fino ad allora non scende niente a nessuno).`)
        if (d.nonPropagate) {
          const elenco = (d.dettaglio || []).map((x: any) => `${x.ldv} — ${x.perche}`).join('\n• ')
          parti.push(`⚠️ ${d.nonPropagate} non si possono girare al livello sotto:\n• ${elenco}\nQueste tienile a tuo carico con "Le assorbo io", oppure sistema il listino di chi sta sotto (fascia di peso o zona mancante) e riprova.`)
        }
        if (!d.create && !d.nonPropagate) parti.push('Nessuna rettifica da decidere.')
        setMsg(parti.join('\n\n'))
      }
      carica()
    } catch { setMsg('Errore di connessione') }
    setPropagando('')
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

  // Il numero sul tab = azioni ANCORA DA FARE, non il totale ricevuto: appena si accetta/decide
  // deve sparire. Prima contava TUTTO (dati.x.length) e restava "(1)"/"(11)" anche dopo aver
  // accettato tutto. Pending: rettifica non ancora decisa (!propagazione — vale sulle RIGHE, così
  // un blocco accettato in parte conta solo quelle rimaste); rimessa/reso non ancora accettati.
  const tabs: [typeof tab, string, number][] = [
    ['rettifiche', 'Rettifiche ricevute', (dati.rettifiche||[]).filter((r:any)=>!r.propagazione).length],
    ['contrassegni', 'Rimesse COD ricevute', (dati.contrassegni||[]).filter((c:any)=>!c.accettata_target).length],
    ['resi', 'Resi ricevuti', (dati.resi||[]).filter((r:any)=>!r.accettata_target).length],
  ]

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:700,color:'#1a1a1a',margin:0}}>Dal mio network</h1>
        <p style={{color:'#999',fontSize:'13px',marginTop:'4px'}}>Rettifiche, rimesse contrassegni e resi ricevuti dal livello superiore. Qui si ACCETTA: a chi caricarli si decide dopo, dalle rispettive pagine — e solo allora il credito scende di un gradino.</p>
      </div>

      <div style={{display:'flex',gap:'8px',marginBottom:'16px'}}>
        {tabs.map(([k, label, n]) => (
          <button key={k} onClick={()=>setTab(k)} style={{background:tab===k?ACCENT:'#fff',color:tab===k?'#fff':'#1a1a1a',border:'1px solid '+(tab===k?ACCENT:'#e8e8e8'),borderRadius:'8px',padding:'8px 16px',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>
            {label}{n>0?` (${n})`:''}
          </button>
        ))}
      </div>

      {msg && <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'8px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#ea580c',whiteSpace:'pre-line' as const}}>{msg}</div>}

      <div style={card}>
        {loading ? <div style={{padding:'40px',textAlign:'center',color:'#999'}}>Caricamento…</div> : (
          <>
          {tab==='rettifiche' && (
            blocchi.length===0 ? <div style={{padding:'32px',textAlign:'center',color:'#999',fontSize:'13px'}}>Nessuna rettifica ricevuta</div> :
            <div>
              {blocchi.map((b:any)=>(
                <div key={b.k} style={{borderTop:'1px solid #f0f0f0'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px',flexWrap:'wrap',padding:'14px 16px'}}>
                    <div>
                      <div style={{fontSize:'14px',fontWeight:700,color:'#1a1a1a'}}>
                        Da {b.da} · {b.righe.length} rettifiche · <span style={{color:'#dc2626'}}>€ {Math.abs(b.totale).toFixed(2)}</span>
                      </div>
                      <div style={{fontSize:'12px',color:'#8a8a8a',marginTop:'3px'}}>
                        Ricevute il {b.giorno} · già scalate dal tuo credito.
                        {b.daDecidere.length ? ' Accettandole vanno nella tua Rettifica Costi, divise per cliente e sotto-master: da lì scegli a chi caricarle.' : ' Già decise.'}
                      </div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                      <button onClick={()=>setApertoBlocco(apertoBlocco===b.k?'':b.k)}
                        style={{background:'#fff',color:'#666',border:'1px solid #e8e8e8',borderRadius:'6px',padding:'6px 12px',fontSize:'12px',fontWeight:600,cursor:'pointer'}}>
                        {apertoBlocco===b.k?'Nascondi il dettaglio':'Vedi le '+b.righe.length}
                      </button>
                      {b.daDecidere.length>0 && <>
                        <button onClick={()=>decidiBlocco(b,'propagata')} disabled={propagando===b.k}
                          style={{background:ACCENT,color:'#fff',border:'none',borderRadius:'6px',padding:'7px 14px',fontSize:'12.5px',fontWeight:700,cursor:'pointer',opacity:propagando===b.k?.6:1}}>
                          {propagando===b.k?'…':'Accetta ('+b.daDecidere.length+')'}
                        </button>
                        <button onClick={()=>decidiBlocco(b,'assorbita')} disabled={propagando===b.k}
                          style={{background:'#f0fdf4',color:'#166534',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'7px 14px',fontSize:'12.5px',fontWeight:600,cursor:'pointer'}}>
                          ✓ Le assorbo io
                        </button>
                      </>}
                    </div>
                  </div>
                  {apertoBlocco===b.k && (
                    <table style={{width:'100%',borderCollapse:'collapse',background:'#fcfcfc'}}>
                      <thead><tr style={{background:'#f9fafb'}}>
                        <th style={th}>LDV</th><th style={th}>Peso fatturato (vol.)</th><th style={th}>Costo → ricalcolo</th><th style={th}>Differenza</th><th style={th}>Stato</th>
                      </tr></thead>
                      <tbody>
                        {b.righe.map((r:any)=>(
                          <tr key={r.id}>
                            <td style={{...td,fontWeight:600}}>{r.numero_spedizione}</td>
                            {/* Si mostra il peso che FATTURA (max fra reale e volume): con un collo
                                leggero ma ingombrante e' il volume a far salire il costo, e va scritto
                                — altrimenti "14 kg" sembra un peso sceso e la rettifica pare un furto. */}
                            {(() => {
                              const vol = Number(r.peso_volume_reale) || 0
                              const reale = Number(r.peso_reale) || 0
                              const fatt = Math.max(reale, vol)
                              // Il "prima" è il FATTURATO iniziale = max(reale, volume) dichiarati (non il solo
                              // peso_iniziale, che ora è il reale dichiarato): così è coerente col "dopo" (fatt).
                              const iniz = Math.max(Number(r.peso_iniziale) || 0, Number(r.peso_volume_iniziale) || 0)
                              return <td style={td}>{iniz.toFixed(1)} → <strong>{fatt.toFixed(1)}</strong> kg{vol > reale ? <span style={{color:'#ea580c'}}> (vol.)</span> : ''}</td>
                            })()}
                            <td style={td}>€ {Number(r.costo_iniziale).toFixed(2)} → € {Number(r.costo_finale).toFixed(2)}</td>
                            <td style={{...td,fontWeight:700,color:Number(r.differenza)<0?'#dc2626':'#16a34a'}}>€ {Number(r.differenza).toFixed(2)}</td>
                            <td style={td}>
                              {r.propagazione === 'propagata' ? (
                                <span style={{fontSize:'11px',fontWeight:600,padding:'2px 8px',borderRadius:'999px',background:'#ffedd5',color:'#ea580c'}}>✓ Accettata — è in Rettifica Costi</span>
                              ) : r.propagazione === 'assorbita' ? (
                                <span style={{fontSize:'11px',fontWeight:600,padding:'2px 8px',borderRadius:'999px',background:'#dcfce7',color:'#166534'}}>✓ Assorbita da me</span>
                              ) : (
                                <span style={{fontSize:'11px',fontWeight:600,padding:'2px 8px',borderRadius:'999px',background:'#fef3c7',color:'#92400e'}}>Da decidere</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
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
