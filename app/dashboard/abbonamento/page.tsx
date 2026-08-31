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
  // Tornato indietro dalla cassa senza pagare: quasi sempre e' la banca che ha rifiutato il
  // mandato ricorrente. Si propone il pagamento del solo mese, che quelle carte accettano.
  const [rifiutato, setRifiutato] = useState(false)
  const [meseScelto, setMeseScelto] = useState('')   // vuoto = mese in corso
  const [filtro, setFiltro] = useState('tutti')
  // Riallineo conguagli: anteprima + applica (solo master principale)
  const [riall, setRiall] = useState<any>(null)
  const [riallAzione, setRiallAzione] = useState('')
  // Allinea ciclo fatturazione al 1°
  const [allinea, setAllinea] = useState<any>(null)
  const [allineaAzione, setAllineaAzione] = useState('')

  async function carica() {
    setLoading(true)
    const d = await fetch('/api/abbonamento').then(r=>r.json()).catch(()=>null)
    setStato(d); setLoading(false)
  }
  useEffect(()=>{ carica() }, [])
  // Tornato dalla cassa senza aver pagato: la banca ha rifiutato il rinnovo automatico.
  useEffect(()=>{ if (new URLSearchParams(window.location.search).get('rifiutato')) setRifiutato(true) }, [])
  useEffect(()=>{
    const esito = new URLSearchParams(window.location.search).get('pagamento')
    if (esito === 'ok') setMsg('✓ Pagamento ricevuto — il piano si attiva in pochi secondi, ricarica se non lo vedi già.')
    if (esito === 'annullato') setMsg('Pagamento annullato: nessun addebito.')
    if (esito) window.history.replaceState({}, '', window.location.pathname)
  }, [])

  async function cambia(pianoId:string, prezzoNuovo:number) {
    const prezzoAttuale = Number(stato?.prezzo||0)
    const isUp = prezzoNuovo > prezzoAttuale
    const testo = !stato?.attivo ? `Attivare questo piano? Verranno scalati € ${prezzoNuovo}.`
      : isUp ? `Upgrade immediato: vale da subito e paghi la differenza di piano (€ ${(prezzoNuovo-prezzoAttuale).toFixed(2)}). Procedere?`
      : `Downgrade dal 1° del mese prossimo. Fino ad allora tieni il piano attuale, che hai già pagato: nessun addebito ora.`
    if (!await dialog.confirm({ title: 'Confermi il piano?', message: testo, confirmText: 'Conferma' })) return
    setAzione(pianoId); setMsg('')
    const res = await fetch('/api/abbonamento', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pianoId }) })
    const d = await res.json(); setAzione('')
    if (d.error) { setMsg(d.error); return }
    setMsg(d.addebitato>0 ? `✓ Piano attivato — scalati € ${d.addebitato}` : '✓ Piano aggiornato')
    carica()
  }
  // Pagamento con CARTA. Il piano non si attiva qui: si attiva quando il circuito conferma
  // l'incasso. Chi ha gia' l'abbonamento non ripassa dalla cassa — si cambia il piano su quello
  // che ha, col conguaglio dei giorni che restano.
  async function pagaConCarta(pianoId:string, modo?:'singolo') {
    setAzione(pianoId); setMsg('')
    const res = await fetch('/api/stripe/checkout', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pianoId, modo }) })
    const d = await res.json().catch(()=>({}))
    if (d.url) { window.location.href = d.url; return }
    setAzione('')
    if (d.error) { setMsg(d.error); return }
    if (d.aggiornato) {
      setMsg(d.immediato
        ? (d.conguaglio > 0
            ? `✓ Piano attivo da subito. Il conguaglio di € ${Number(d.conguaglio).toFixed(2)} (differenza sui giorni che restano) si paga col prossimo rinnovo — lo vedi qui sopra in "Prossimo pagamento".`
            : '✓ Piano attivo da subito.')
        : `✓ Downgrade registrato — partirà il ${new Date(d.dal).toLocaleDateString('it-IT')}. Fino ad allora tieni il piano attuale.`)
      carica()
    }
  }
  async function areaFatture() {
    setAzione('fatture'); setMsg('')
    const d = await fetch('/api/stripe/portal', { method:'POST' }).then(r=>r.json()).catch(()=>({}))
    if (d.url) { window.location.href = d.url; return }
    setAzione(''); setMsg(d.error || 'Area fatture non disponibile')
  }
  async function disdici() {
    if (!await dialog.confirm({ title: 'Disdire l\'abbonamento?', message: 'Il mese in corso è già pagato e resta attivo fino alla fine. Dal primo del mese prossimo il portale si blocca finché non scegli un nuovo piano. Nessun rimborso.', danger: true, confirmText: 'Disdici' })) return
    setAzione('disdici')
    const d = await fetch('/api/abbonamento/disdici', { method:'POST' }).then(r=>r.json()).catch(()=>({}))
    setAzione('')
    if (d.error) { setMsg(d.error); return }
    window.location.reload()
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

  // RIALLINEO CONGUAGLI (solo master principale): anteprima poi applica.
  async function caricaRiallineo() {
    setRiallAzione('carico'); setMsg('')
    const d = await fetch('/api/abbonamento/riallinea-conguagli').then(r=>r.json()).catch(()=>({error:'Errore nel controllo'}))
    setRiall(d); setRiallAzione('')
  }
  async function applicaRiallineo() {
    const n = (riall?.righe||[]).filter((r:any)=>!r.gia_allineato).length
    if (!await dialog.confirm({ title:'Riallineo i conguagli?',
      message:`Tolgo le differenze piene in sospeso (€ ${Number(riall?.totale_in_sospeso||0).toFixed(2)}) e metto i conguagli proporzionati (€ ${Number(riall?.totale_conguaglio||0).toFixed(2)}) su ${n} master. Si incassano al loro rinnovo — nessun addebito adesso.`,
      confirmText:'Riallinea' })) return
    setRiallAzione('applico'); setMsg('')
    const d = await fetch('/api/abbonamento/riallinea-conguagli', { method:'POST' }).then(r=>r.json()).catch(()=>({error:'errore'}))
    setRiallAzione('')
    if (d.error) { setMsg(d.error); return }
    setMsg(`✓ Riallineati ${d.master} master — tolto € ${Number(d.tolto||0).toFixed(2)}, messo € ${Number(d.messo||0).toFixed(2)}. Si incassa al rinnovo.`)
    caricaRiallineo()
  }

  // ALLINEA CICLO al 1° del mese (solo master principale)
  async function caricaAllinea() {
    setAllineaAzione('carico'); setMsg('')
    const d = await fetch('/api/abbonamento/allinea-ciclo').then(r=>r.json()).catch(()=>({error:'Errore nel controllo'}))
    setAllinea(d); setAllineaAzione('')
  }
  async function applicaAllinea(opts?:{solo?:string, nome?:string}) {
    const solo = opts?.solo
    const attivi = (allinea?.righe||[]).filter((r:any)=>!r.gia_al_primo && !r.gia_pagato && !r.escluso)
    if (!await dialog.confirm({ title: solo?`Prova su ${opts?.nome}?`:`Incasso ${allinea?.mese_una_tantum} e pausa al ${allinea?.pausa_fino_al}?`,
      message: solo
        ? `CANARY su ${opts?.nome}: addebita canone + conguaglio sulla sua carta salvata e lo mette in pausa fino al ${allinea?.pausa_fino_al}. SOLO lui — così lo verifichiamo su Stripe prima di toccare gli altri.`
        : `Addebito SUBITO ${attivi.length} master (canone + conguaglio, tot € ${Number(allinea?.totale_addebito||0).toFixed(2)}) e metto l'abbonamento in pausa fino al ${allinea?.pausa_fino_al}, poi rinnovano il 1°. ${(allinea?.esclusi||[]).length} esclusi. Se una carta rifiuta, quel master resta sul suo ciclo (congelamento normale). Procedere?`,
      confirmText: solo?'Prova questo':'Addebita e allinea', danger:true })) return
    setAllineaAzione(solo||'applico'); setMsg('')
    const d = await fetch('/api/abbonamento/allinea-ciclo', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(solo?{solo}:{}) }).then(r=>r.json()).catch(()=>({error:'errore'}))
    setAllineaAzione('')
    if (d.error) { setMsg(d.error); return }
    setMsg(`✓ Fatti ${d.n_fatti} master · pausa fino al ${d.pausa_fino_al}${d.non_incassati?.length?` · ⚠️ ${d.non_incassati.length} NON incassati: ${d.non_incassati.join(', ')}`:''}${d.errori?.length?` · ${d.errori.length} errori`:''}.`)
    caricaAllinea()
  }

  if (loading) return <div style={{padding:'40px',textAlign:'center',color:'#666'}}>Caricamento...</div>

  const perc = stato?.limite ? Math.min(100, (stato.spedizioni_mese/stato.limite)*100) : 0
  const conCarta = !!stato?.carta?.disponibile

  // ROOT (master principale): illimitato, non paga; gestisce gli incassi della sua rete
  if (stato?.isRoot) {
    const abbonati = stato?.abbonati || []
    const pagamenti = stato?.pagamenti || []
    const daIncassare = abbonati.filter((a:any)=>a.pagamento_id)
    const totaleAperto = Number(stato?.totaleDaIncassare||0)

    // Mesi selezionabili: quelli in cui c'è stato un movimento, più il mese in corso e il prossimo.
    const mesiSet = new Set<string>(pagamenti.map((p:any)=>p.mese).filter(Boolean))
    const oggi = new Date()
    const mm = (d:Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
    mesiSet.add(mm(oggi)); mesiSet.add(mm(new Date(oggi.getFullYear(), oggi.getMonth()+1, 1)))
    const mesi = Array.from(mesiSet).sort().reverse()
    const mese = meseScelto || mm(oggi)

    // Incassato = pagamenti SALDATI del mese di competenza (non della data di incasso): è la
    // domanda vera — "luglio quanto ha reso?" — e non cambia se il bonifico arriva ad agosto.
    const delMese = pagamenti.filter((p:any)=>p.mese===mese)
    const incassatoMese = delMese.filter((p:any)=>p.pagato).reduce((s:number,p:any)=>s+Number(p.importo||0),0)
    const attesoMese = delMese.reduce((s:number,p:any)=>s+Number(p.importo||0),0)
    const apertiMese = delMese.filter((p:any)=>!p.pagato)

    const statoDi = (a:any) => a.esente ? 'esente' : a.congelato ? 'congelato'
      : a.scaduto_dal ? 'ritardo' : a.carta ? 'carta' : 'senza_carta'
    const FILTRI: {k:string,l:string}[] = [
      {k:'tutti',l:'Tutti'}, {k:'senza_carta',l:'Senza carta'}, {k:'ritardo',l:'In ritardo'},
      {k:'congelato',l:'Congelati'}, {k:'carta',l:'Carta attiva'}, {k:'esente',l:'Esenti'},
    ]
    const conta = (k:string) => k==='tutti' ? abbonati.length : abbonati.filter((a:any)=>statoDi(a)===k).length
    const visibili = filtro==='tutti' ? abbonati : abbonati.filter((a:any)=>statoDi(a)===filtro)

    const nCongelati = conta('congelato'), nSenzaCarta = conta('senza_carta'), nRitardo = conta('ritardo')

    return (
      <div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'10px',marginBottom:'16px'}}>
          <h1 style={{fontSize:'20px',fontWeight:700,color:'#1a1a1a',margin:0}}>Abbonamenti — Incassi</h1>
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <span style={{fontSize:'12px',color:'#777'}}>Mese</span>
            <select value={mese} onChange={e=>setMeseScelto(e.target.value)}
              style={{padding:'7px 10px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',fontWeight:600}}>
              {mesi.map(x=><option key={x} value={x}>{meseLabel(x)}</option>)}
            </select>
          </div>
        </div>
        {rifiutato && (
        <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'8px',padding:'14px 16px',marginBottom:'14px'}}>
          <div style={{fontSize:'14px',fontWeight:700,color:'#9a3412'}}>Il rinnovo automatico non è passato</div>
          <div style={{fontSize:'13.5px',color:'#9a3412',lineHeight:1.6,marginTop:'5px'}}>
            Succede con le carte aziendali e le prepagate, che spesso non accettano gli addebiti
            ricorrenti — non è un problema di saldo. Puoi pagare <strong>solo questo mese</strong> con la
            stessa carta: il mese prossimo dovrai rifarlo a mano.
          </div>
          <div style={{display:'flex',gap:'8px',marginTop:'10px',flexWrap:'wrap'}}>
            <button disabled={!!azione} onClick={()=>pagaConCarta(stato?.piano, 'singolo')}
              style={{background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',padding:'9px 16px',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>
              {azione ? '…' : 'Paga solo questo mese'}
            </button>
            <button onClick={()=>setRifiutato(false)}
              style={{background:'#fff',color:'#9a3412',border:'1px solid #fed7aa',borderRadius:'6px',padding:'9px 16px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>
              Riprova col rinnovo automatico
            </button>
          </div>
        </div>
      )}
      {msg && <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'6px',padding:'10px',marginBottom:'14px',fontSize:'13px',color:'#ea580c'}}>{msg}</div>}

        <div style={{...card, marginBottom:'16px', borderColor:'#fed7aa'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'10px'}}>
            <div style={{flex:1,minWidth:'240px'}}>
              <div style={{fontSize:'13px',fontWeight:800,color:'#1a1a1a'}}>Riallinea conguagli upgrade</div>
              <div style={{fontSize:'12px',color:'#777',marginTop:'2px',lineHeight:1.5}}>Toglie le differenze di piano PIENE rimaste in sospeso dalla vecchia gestione e mette il conguaglio proporzionato ai giorni. Si incassa al rinnovo di ogni master — nessun addebito adesso.</div>
            </div>
            {!riall && <button onClick={caricaRiallineo} disabled={!!riallAzione}
              style={{background:'#1a1a1a',color:'#fff',border:'none',borderRadius:'6px',padding:'9px 18px',fontSize:'13px',fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>{riallAzione==='carico'?'…':'Controlla'}</button>}
          </div>
          {riall && (
            riall.error ? <div style={{marginTop:'10px',fontSize:'13px',color:'#dc2626'}}>{riall.error}</div>
            : !riall.righe?.length ? <div style={{marginTop:'10px',fontSize:'13px',color:'#16a34a',fontWeight:600}}>✓ Tutto già allineato, niente da fare.</div>
            : <>
              <div style={{overflowX:'auto' as const,marginTop:'12px'}}>
                <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
                  <thead><tr style={{background:'#fafafa'}}>
                    {['Master','In sospeso (tolgo)','Conguaglio (metto)','Rinnovo'].map(h=>(<th key={h} style={{textAlign:'left' as const,padding:'8px 12px',fontSize:'11px',fontWeight:600,color:'#777',borderBottom:'1px solid #f0f0f0',whiteSpace:'nowrap' as const}}>{h}</th>))}
                  </tr></thead>
                  <tbody>
                    {riall.righe.map((r:any)=>(
                      <tr key={r.master} style={{borderBottom:'1px solid #f5f5f5',opacity:r.gia_allineato?0.5:1}}>
                        <td style={{padding:'8px 12px',fontWeight:600}}>{r.master}{r.gia_allineato && <span style={{fontSize:'10px',color:'#16a34a',marginLeft:'6px'}}>già ok</span>}</td>
                        <td style={{padding:'8px 12px',color:'#dc2626',fontWeight:700,whiteSpace:'nowrap' as const}}>€ {Number(r.in_sospeso).toFixed(2)}</td>
                        <td style={{padding:'8px 12px',color:'#16a34a',fontWeight:700,whiteSpace:'nowrap' as const}}>€ {Number(r.conguaglio).toFixed(2)}</td>
                        <td style={{padding:'8px 12px',color:'#555',whiteSpace:'nowrap' as const}}>{r.rinnovo||'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'10px',marginTop:'12px'}}>
                <div style={{fontSize:'12.5px',color:'#555'}}>Totale: <b style={{color:'#dc2626'}}>€ {Number(riall.totale_in_sospeso).toFixed(2)}</b> → <b style={{color:'#16a34a'}}>€ {Number(riall.totale_conguaglio).toFixed(2)}</b></div>
                <div style={{display:'flex',gap:'8px'}}>
                  <button onClick={caricaRiallineo} disabled={!!riallAzione} style={{background:'#fff',color:'#555',border:'1px solid #d1d5db',borderRadius:'6px',padding:'9px 16px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>{riallAzione==='carico'?'…':'Ricontrolla'}</button>
                  <button onClick={applicaRiallineo} disabled={!!riallAzione} style={{background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',padding:'9px 18px',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>{riallAzione==='applico'?'Applico…':'Applica riallineo'}</button>
                </div>
              </div>
            </>
          )}
        </div>

        <div style={{...card, marginBottom:'16px', borderColor:'#bfdbfe'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'10px'}}>
            <div style={{flex:1,minWidth:'240px'}}>
              <div style={{fontSize:'13px',fontWeight:800,color:'#1a1a1a'}}>Incassa il mese e allinea il rinnovo al 1°</div>
              <div style={{fontSize:'12px',color:'#777',marginTop:'2px',lineHeight:1.5}}>Addebita subito il canone del mese (+ conguaglio) come pagamento a sé, e mette l'abbonamento in pausa fino al 1°, poi rinnova sempre il 1°. Downgrade programmati, past-due e chi ha già rinnovato restano fuori.</div>
            </div>
            {!allinea && <button onClick={caricaAllinea} disabled={!!allineaAzione}
              style={{background:'#1a1a1a',color:'#fff',border:'none',borderRadius:'6px',padding:'9px 18px',fontSize:'13px',fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>{allineaAzione==='carico'?'…':'Controlla'}</button>}
          </div>
          {allinea && (
            allinea.error ? <div style={{marginTop:'10px',fontSize:'13px',color:'#dc2626'}}>{allinea.error}</div>
            : !allinea.righe?.length ? <div style={{marginTop:'10px',fontSize:'13px',color:'#16a34a',fontWeight:600}}>✓ Nessun abbonamento con carta da spostare.</div>
            : <>
              <div style={{overflowX:'auto' as const,marginTop:'12px'}}>
                <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
                  <thead><tr style={{background:'#fafafa'}}>
                    {['Master','Canone','Conguaglio','Addebito ora','Pagato fino a','Stato'].map(h=>(<th key={h} style={{textAlign:'left' as const,padding:'8px 12px',fontSize:'11px',fontWeight:600,color:'#777',borderBottom:'1px solid #f0f0f0',whiteSpace:'nowrap' as const}}>{h}</th>))}
                  </tr></thead>
                  <tbody>
                    {allinea.righe.map((r:any)=>(
                      <tr key={r.master_id} style={{borderBottom:'1px solid #f5f5f5',opacity:(r.gia_al_primo||r.gia_pagato||r.escluso)?0.55:1}}>
                        <td style={{padding:'8px 12px',fontWeight:600}}>{r.nome}</td>
                        <td style={{padding:'8px 12px',whiteSpace:'nowrap' as const}}>€ {Number(r.canone).toFixed(2)}</td>
                        <td style={{padding:'8px 12px',whiteSpace:'nowrap' as const,color:r.conguaglio>0?'#ea580c':'#999'}}>{r.conguaglio>0?'€ '+Number(r.conguaglio).toFixed(2):'—'}</td>
                        <td style={{padding:'8px 12px',fontWeight:700,whiteSpace:'nowrap' as const}}>{(r.escluso||r.gia_al_primo||r.gia_pagato)?'—':'€ '+Number(r.addebito).toFixed(2)}</td>
                        <td style={{padding:'8px 12px',color:'#555',whiteSpace:'nowrap' as const}}>{r.rinnovo_attuale||'—'}</td>
                        <td style={{padding:'8px 12px',whiteSpace:'nowrap' as const}}>
                          {r.escluso ? <span style={{fontSize:'11px',color:'#b45309'}}>fuori · {r.escluso.replace(/_/g,' ')}</span>
                            : r.gia_al_primo ? <span style={{fontSize:'11px',color:'#16a34a'}}>già al 1°</span>
                            : r.gia_pagato ? <span style={{fontSize:'11px',color:'#16a34a'}}>già pagato · intatto</span>
                            : <span style={{fontSize:'11px',color:'#2563eb',display:'inline-flex',alignItems:'center',gap:'7px'}}>addebito + pausa
                                <button onClick={()=>applicaAllinea({solo:r.master_id, nome:r.nome})} disabled={!!allineaAzione} title="Fai partire SOLO questo master, per verificarlo su Stripe" style={{fontSize:'10px',padding:'2px 8px',border:'1px solid #fed7aa',background:'#fff7ed',color:'#ea580c',borderRadius:'4px',cursor:'pointer',fontWeight:700}}>{allineaAzione===r.master_id?'…':'🧪 prova'}</button>
                              </span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'10px',marginTop:'12px'}}>
                <div style={{fontSize:'12.5px',color:'#555'}}>Addebito ora <b style={{color:'#1a1a1a'}}>€ {Number(allinea.totale_addebito||0).toFixed(2)}</b> · pausa fino al <b>{allinea.pausa_fino_al}</b>, poi rinnovo il 1°{(allinea.esclusi||[]).length?<> · {allinea.esclusi.length} esclusi</>:''}</div>
                <div style={{display:'flex',gap:'8px'}}>
                  <button onClick={caricaAllinea} disabled={!!allineaAzione} style={{background:'#fff',color:'#555',border:'1px solid #d1d5db',borderRadius:'6px',padding:'9px 16px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>{allineaAzione==='carico'?'…':'Ricontrolla'}</button>
                  <button onClick={()=>applicaAllinea()} disabled={!!allineaAzione} style={{background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',padding:'9px 18px',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>{allineaAzione==='applico'?'Eseguo…':'Addebita e allinea tutti'}</button>
                </div>
              </div>
            </>
          )}
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:'12px',marginBottom:'16px'}}>
          <div style={card}>
            <div style={{fontSize:'12px',color:'#777'}}>Incassato {meseLabel(mese)}</div>
            <div style={{fontSize:'22px',fontWeight:800,color:'#16a34a'}}>€ {incassatoMese.toFixed(2)}</div>
            <div style={{fontSize:'11px',color:'#999',marginTop:'2px'}}>
              {delMese.filter((p:any)=>p.pagato).length} pagamenti su {delMese.length}
              {attesoMese > incassatoMese ? ` · ${(attesoMese-incassatoMese).toFixed(2)} € ancora aperti` : ''}
            </div>
          </div>
          <div style={card}>
            <div style={{fontSize:'12px',color:'#777'}}>Incassato {stato?.annoCorrente||''}</div>
            <div style={{fontSize:'22px',fontWeight:800,color:'#16a34a'}}>€ {Number(stato?.incassatoAnno||0).toFixed(2)}</div>
            <div style={{fontSize:'11px',color:'#999',marginTop:'2px'}}>totale anno in corso</div>
          </div>
          <div style={card}>
            <div style={{fontSize:'12px',color:'#777'}}>Prossimo incasso stimato</div>
            <div style={{fontSize:'22px',fontWeight:800,color:'#16a34a'}}>€ {Number(stato?.incassoRealeStimato||0).toFixed(2)}</div>
            <div style={{fontSize:'11px',color:'#999',marginTop:'2px'}}>solo carte attive + conguagli (€ {Number(stato?.conguagliRete||0).toFixed(2)})</div>
          </div>
          <div style={card}>
            <div style={{fontSize:'12px',color:'#777'}}>Valore rete</div>
            <div style={{fontSize:'22px',fontWeight:800,color:ACCENT}}>€ {Number(stato?.previstoProssimoMese||0).toFixed(2)}</div>
            <div style={{fontSize:'11px',color:'#999',marginTop:'2px'}}>canoni pieni di tutti · {stato?.abbonatiAttivi||0} abbonati (esclusi esenti)</div>
          </div>
          <div style={{...card, borderColor: (nSenzaCarta+nRitardo)>0 ? '#fed7aa' : '#e8e8e8'}}>
            <div style={{fontSize:'12px',color:'#777'}}>Non stanno pagando</div>
            <div style={{fontSize:'22px',fontWeight:800,color:(nSenzaCarta+nRitardo)>0?'#b45309':'#16a34a'}}>{nSenzaCarta+nRitardo}</div>
            <div style={{fontSize:'11px',color:'#999',marginTop:'2px'}}>{nSenzaCarta} senza carta · {nRitardo} in ritardo</div>
          </div>
          <div style={{...card, borderColor: nCongelati>0 ? '#fecaca' : '#e8e8e8'}}>
            <div style={{fontSize:'12px',color:'#777'}}>Congelati</div>
            <div style={{fontSize:'22px',fontWeight:800,color:nCongelati>0?'#b91c1c':'#16a34a'}}>{nCongelati}</div>
            <div style={{fontSize:'11px',color:'#999',marginTop:'2px'}}>rete ferma finché non pagano</div>
          </div>
          {totaleAperto > 0 && (
            <div style={card}>
              <div style={{fontSize:'12px',color:'#777'}}>Vecchi bonifici aperti</div>
              <div style={{fontSize:'22px',fontWeight:800,color:'#dc2626'}}>€ {totaleAperto.toFixed(2)}</div>
              <div style={{fontSize:'11px',color:'#999',marginTop:'2px'}}>{daIncassare.length} da prima della carta</div>
            </div>
          )}
        </div>

        <div style={{display:'flex',gap:'7px',flexWrap:'wrap',marginBottom:'10px'}}>
          {FILTRI.map(f=>{
            const n = conta(f.k), on = filtro===f.k
            return (
              <button key={f.k} onClick={()=>setFiltro(f.k)}
                style={{background:on?'#1a1a1a':'#fff',color:on?'#fff':'#555',border:`1px solid ${on?'#1a1a1a':'#e8e8e8'}`,
                  borderRadius:'999px',padding:'6px 13px',fontSize:'12.5px',fontWeight:600,cursor:'pointer'}}>
                {f.l} <span style={{opacity:.65}}>{n}</span>
              </button>
            )
          })}
        </div>

        <div style={{...card, padding:0, overflow:'hidden'}}>
          <div style={{overflowX:'auto' as const}}>
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
            <thead>
              <tr style={{background:'#fafafa'}}>
                {['Master','Piano','Canone/mese','Ultimo pagamento','Stato',''].map(h=>(
                  <th key={h} style={{textAlign:'left' as const,padding:'9px 14px',fontSize:'11px',fontWeight:600,color:'#777',borderBottom:'1px solid #f0f0f0',whiteSpace:'nowrap' as const}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!visibili.length ? (
                <tr><td colSpan={6} style={{padding:'30px',textAlign:'center' as const,color:'#999',fontSize:'12px'}}>Nessun master in questo filtro</td></tr>
              ) : visibili.map((a:any)=>(
                <tr key={a.master_id} style={{borderBottom:'1px solid #f5f5f5'}}>
                  <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:600}}>{a.master_nome}</td>
                  <td style={{padding:'9px 14px',color:'#555',whiteSpace:'nowrap' as const}}>{(a.piano||'').replace('enterprise_','Enterprise ').toUpperCase() || '—'}</td>
                  <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:700,whiteSpace:'nowrap' as const}}>€ {Number(a.prezzo||0).toFixed(2)}{a.esente && <span style={{fontSize:'10px',color:'#4338ca',fontWeight:600}}> (gratis)</span>}</td>
                  <td style={{padding:'9px 14px',color:'#555',whiteSpace:'nowrap' as const}}>
                    {a.ultimo_mese_pagato
                      ? <>{meseLabel(a.ultimo_mese_pagato)}<div style={{fontSize:'10.5px',color:'#999'}}>{a.ultimo_metodo === 'carta' ? 'carta' : a.ultimo_metodo || ''}{a.ultimo_pagamento_il ? ` · ${new Date(a.ultimo_pagamento_il).toLocaleDateString('it-IT')}` : ''}</div></>
                      : <span style={{color:'#bbb'}}>mai</span>}
                  </td>
                  <td style={{padding:'9px 14px',whiteSpace:'nowrap' as const}}>
                    {a.esente
                      ? <span style={{background:'#eef2ff',color:'#4338ca',borderRadius:'999px',padding:'3px 10px',fontSize:'11px',fontWeight:700}}>Esente</span>
                      : a.congelato
                        ? <span style={{background:'#fef2f2',color:'#b91c1c',borderRadius:'999px',padding:'3px 10px',fontSize:'11px',fontWeight:700}}>Congelato</span>
                      : a.scaduto_dal
                        ? <span style={{background:'#fef2f2',color:'#b91c1c',borderRadius:'999px',padding:'3px 10px',fontSize:'11px',fontWeight:700}}>In ritardo dal {new Date(a.scaduto_dal).toLocaleDateString('it-IT')}</span>
                      : a.carta
                        ? <span style={{background:'#dcfce7',color:'#16a34a',borderRadius:'999px',padding:'3px 10px',fontSize:'11px',fontWeight:700}}>Carta attiva</span>
                        : <span style={{background:'#fef3c7',color:'#b45309',borderRadius:'999px',padding:'3px 10px',fontSize:'11px',fontWeight:700}}>Nessuna carta</span>}
                  </td>
                  <td style={{padding:'9px 14px',textAlign:'right' as const}}></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a',margin:'22px 0 10px'}}>
          Pagamenti di {meseLabel(mese)} <span style={{color:'#999',fontWeight:400}}>({delMese.length})</span>
          {apertiMese.length>0 && <span style={{color:'#b45309',fontWeight:600,fontSize:'12px'}}> · {apertiMese.length} non ancora incassati</span>}
        </div>
        <div style={{...card, padding:0, overflow:'hidden'}}>
          <div style={{overflowX:'auto' as const}}>
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
            <thead>
              <tr style={{background:'#fafafa'}}>
                {['Master','Importo','Stato','Incassato il','Metodo'].map(h=>(
                  <th key={h} style={{textAlign:'left' as const,padding:'9px 14px',fontSize:'11px',fontWeight:600,color:'#777',borderBottom:'1px solid #f0f0f0',whiteSpace:'nowrap' as const}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!delMese.length ? (
                <tr><td colSpan={5} style={{padding:'26px',textAlign:'center' as const,color:'#999',fontSize:'12px'}}>Nessun pagamento per {meseLabel(mese)}</td></tr>
              ) : delMese.map((p:any)=>(
                <tr key={p.pagamento_id} style={{borderBottom:'1px solid #f5f5f5'}}>
                  <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:600}}>{p.master_nome}</td>
                  <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:700,whiteSpace:'nowrap' as const}}>€ {Number(p.importo||0).toFixed(2)}</td>
                  <td style={{padding:'9px 14px'}}>
                    {p.pagato
                      ? <span style={{background:'#dcfce7',color:'#16a34a',borderRadius:'999px',padding:'3px 10px',fontSize:'11px',fontWeight:700}}>Incassato</span>
                      : <span style={{background:'#fef3c7',color:'#b45309',borderRadius:'999px',padding:'3px 10px',fontSize:'11px',fontWeight:700}}>Da incassare</span>}
                  </td>
                  <td style={{padding:'9px 14px',color:'#555',whiteSpace:'nowrap' as const}}>{p.pagato_il ? new Date(p.pagato_il).toLocaleDateString('it-IT') : '—'}</td>
                  <td style={{padding:'9px 14px',color:'#555'}}>{p.metodo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

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
                <tr key={r.mese} style={{borderBottom:'1px solid #f5f5f5',cursor:'pointer'}} onClick={()=>setMeseScelto(r.mese)}>
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
            {stato?.carta?.attiva && (
              <div style={{marginTop:'12px',display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
                <button onClick={areaFatture} disabled={!!azione}
                  style={{background:'#fff7ed',color:'#ea580c',border:'1px solid #fed7aa',borderRadius:'6px',padding:'7px 14px',fontSize:'12.5px',fontWeight:700,cursor:'pointer'}}>
                  {azione==='fatture'?'…':'Fatture e metodo di pagamento'}
                </button>
                {stato?.carta?.stato === 'past_due' && (
                  <span style={{fontSize:'12px',color:'#b91c1c',fontWeight:600}}>Ultimo addebito non riuscito: aggiorna la carta.</span>
                )}
                {stato?.carta?.stato === 'conferma_richiesta' && (
                  <span style={{fontSize:'12px',color:'#b45309',fontWeight:600}}>L'addebito attende la conferma della tua banca: controlla la mail del pagamento.</span>
                )}
              </div>
            )}
            <button onClick={disdici} disabled={!!azione}
              style={{marginTop:'14px',background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',borderRadius:'6px',padding:'7px 14px',fontSize:'12.5px',fontWeight:600,cursor:'pointer'}}>Disdici abbonamento</button>
          </>
        ) : (
          <div style={{fontSize:'13px',color:'#dc2626',fontWeight:600}}>Nessun abbonamento attivo — seleziona un piano per usare la piattaforma.</div>
        )}
      </div>

      {stato?.prossimoPagamento && (
        <div style={{...card, marginBottom:'16px', borderColor:ACCENT, background:'#fff7ed'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',flexWrap:'wrap',gap:'8px'}}>
            <div style={{fontSize:'12px',fontWeight:700,textTransform:'uppercase',letterSpacing:'.4px',color:'#9a3412'}}>Prossimo pagamento</div>
            <div style={{fontSize:'26px',fontWeight:800,color:'#ea580c'}}>€ {Number(stato.prossimoPagamento.totale).toFixed(2)}</div>
          </div>
          <div style={{fontSize:'13px',color:'#7c2d12',marginTop:'10px',lineHeight:1.7}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:'10px'}}>
              <span>Rinnovo {stato.prossimoPagamento.pianoRinnovo || ''}</span>
              <span style={{fontWeight:700,whiteSpace:'nowrap'}}>€ {Number(stato.prossimoPagamento.rinnovo).toFixed(2)}</span>
            </div>
            {(stato.prossimoPagamento.dettaglio||[]).map((d:any,i:number)=>(
              <div key={i} style={{display:'flex',justifyContent:'space-between',gap:'10px'}}>
                <span>Conguaglio {d.piano} · dal {d.giornoDa} al {d.giornoA} ({d.giorni} giorni)</span>
                <span style={{fontWeight:700,whiteSpace:'nowrap'}}>€ {Number(d.importo).toFixed(2)}</span>
              </div>
            ))}
          </div>
          {stato.prossimoPagamento.conguaglio > 0 && (
            <div style={{fontSize:'12px',color:'#9a3412',marginTop:'10px',borderTop:'1px dashed #fed7aa',paddingTop:'9px',lineHeight:1.6}}>
              Il <strong>conguaglio</strong> è la differenza dei piani che hai cambiato questo mese, contata
              solo sui giorni di effettivo utilizzo. Si paga <strong>insieme al rinnovo</strong>, non subito
              all&apos;upgrade.
            </div>
          )}
        </div>
      )}

      {conCarta && !stato?.carta?.attiva && stato?.attivo && (
        <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'8px',padding:'12px 16px',marginBottom:'14px',fontSize:'13.5px',color:'#9a3412',display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
          <span style={{fontSize:'15px'}}>💳</span>
          <div style={{flex:1,minWidth:'240px'}}>
            <strong>Non hai ancora attivato il pagamento con carta.</strong> Il canone si paga da qui, con
            rinnovo automatico il primo di ogni mese. Puoi farlo subito.
          </div>
          <button onClick={()=>pagaConCarta(stato.piano)} disabled={!!azione}
            style={{background:'#f97316',color:'#fff',border:'none',borderRadius:'8px',padding:'9px 18px',fontSize:'13px',fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>
            {azione===stato.piano?'…':'Attiva il pagamento'}
          </button>
        </div>
      )}
      {stato?.cambioProgrammato && (
        <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'8px',padding:'11px 16px',marginBottom:'14px',fontSize:'13px',color:'#9a3412'}}>
          {stato.cambioProgrammato.disdetta
            ? <>⏳ <strong>Abbonamento in disdetta.</strong> Resta tutto attivo fino al {new Date(stato.cambioProgrammato.dal).toLocaleDateString('it-IT')}; da quel giorno il portale si blocca finché non scegli un nuovo piano.</>
            : <>⏳ <strong>Passaggio a {stato.cambioProgrammato.piano} programmato</strong> per il {new Date(stato.cambioProgrammato.dal).toLocaleDateString('it-IT')}. Fino ad allora resti sul piano attuale, che hai già pagato.</>}
        </div>
      )}
      {!!(stato?.mieiPagamenti||[]).length && (
        <>
          <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a',margin:'0 0 10px'}}>I tuoi pagamenti</div>
          <div style={{...card, padding:0, overflow:'hidden', marginBottom:'18px'}}>
            <div style={{overflowX:'auto' as const}}>
            <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
              <thead>
                <tr style={{background:'#fafafa'}}>
                  {['Mese','Importo','Stato','Pagato il','Metodo'].map(h=>(
                    <th key={h} style={{textAlign:'left' as const,padding:'9px 14px',fontSize:'11px',fontWeight:600,color:'#777',borderBottom:'1px solid #f0f0f0',whiteSpace:'nowrap' as const}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(stato?.mieiPagamenti||[]).map((p:any)=>(
                  <tr key={p.id} style={{borderBottom:'1px solid #f5f5f5'}}>
                    <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:600,whiteSpace:'nowrap' as const}}>{meseLabel(p.mese)}</td>
                    <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:700,whiteSpace:'nowrap' as const}}>€ {Number(p.importo||0).toFixed(2)}</td>
                    <td style={{padding:'9px 14px'}}>
                      {p.pagato
                        ? <span style={{background:'#dcfce7',color:'#16a34a',borderRadius:'999px',padding:'3px 10px',fontSize:'11px',fontWeight:700}}>Pagato</span>
                        : <span style={{background:'#fef3c7',color:'#b45309',borderRadius:'999px',padding:'3px 10px',fontSize:'11px',fontWeight:700}}>In attesa</span>}
                    </td>
                    <td style={{padding:'9px 14px',color:'#555',whiteSpace:'nowrap' as const}}>{p.pagato_il ? new Date(p.pagato_il).toLocaleDateString('it-IT') : '—'}</td>
                    <td style={{padding:'9px 14px',color:'#555'}}>{p.metodo || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
          <div style={{fontSize:'12.5px',color:'#777',margin:'-8px 0 18px'}}>
            Le fatture, il cambio della carta e i dati di fatturazione si gestiscono da
            <strong> Fatture e metodo di pagamento</strong>, qui sopra.
          </div>
        </>
      )}

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',flexWrap:'wrap',gap:'8px',marginBottom:'10px'}}>
        <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a'}}>Piani disponibili</div>
        {conCarta && <div style={{fontSize:'11.5px',color:'#777'}}>{stato?.carta?.iva ? `Prezzi IVA ${stato.carta.iva}% compresa` : 'Prezzi finiti — fattura senza IVA (inversione contabile)'}</div>}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:'12px'}}>
        {(stato?.piani||[]).map((p:any)=>{
          const attuale = stato?.piano===p.id
          const isUp = p.prezzo > Number(stato?.prezzo||0)
          return (
            <div key={p.id} style={{...card, borderColor: attuale?ACCENT:'#e8e8e8'}}>
              <div style={{fontSize:'14px',fontWeight:800,color:'#1a1a1a'}}>{p.nome}</div>
              <div style={{fontSize:'12px',color:'#777'}}>fino a <b>{p.limite.toLocaleString('it-IT')}</b>/mese</div>
              <div style={{fontSize:'20px',fontWeight:800,color:ACCENT,margin:'6px 0'}}>€ {p.prezzo}<span style={{fontSize:'11px',color:'#999',fontWeight:600}}>/mese</span></div>
              {attuale && conCarta && !stato?.carta?.attiva ? (
                // Il piano ce l'ha gia', ma non ha ancora una carta: senza questo tasto non aveva
                // NESSUN modo di pagare il proprio canone — poteva solo cambiare piano.
                <>
                  <div style={{fontSize:'12px',fontWeight:700,color:'#16a34a',padding:'2px 0 6px'}}>✓ Piano attuale</div>
                  <button onClick={()=>pagaConCarta(p.id)} disabled={!!azione}
                    style={{width:'100%',background:ACCENT,color:'#fff',border:'none',borderRadius:'6px',padding:'8px',fontSize:'12.5px',fontWeight:700,cursor:'pointer',opacity:azione===p.id?0.6:1}}>
                    {azione===p.id?'…':'Attiva il pagamento'}
                  </button>
                </>
              ) : attuale ? (
                <div style={{fontSize:'12px',fontWeight:700,color:'#16a34a',padding:'8px 0'}}>✓ Piano attuale</div>
              ) : conCarta ? (
                <button onClick={()=>pagaConCarta(p.id)} disabled={!!azione}
                  style={{width:'100%',background: isUp?ACCENT:'#fff',color:isUp?'#fff':'#1a1a1a',border:isUp?'none':'1px solid #d1d5db',borderRadius:'6px',padding:'8px',fontSize:'12.5px',fontWeight:700,cursor:'pointer',opacity:azione===p.id?0.6:1}}>
                  {azione===p.id?'…':(!stato?.attivo?'Attiva con carta':isUp?'Upgrade':'Downgrade')}
                </button>
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
