'use client'
import { useState, useEffect, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'

const NOMI: Record<string,string> = { shopify:'Shopify', prestashop:'PrestaShop', woocommerce:'WooCommerce' }
const ACCENT = '#f97316'
const BORDER = '#e8e8e8'

const lbl: React.CSSProperties = { fontSize:'11px', fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.3px', marginBottom:'6px', display:'block' }
const inp: React.CSSProperties = { width:'100%', boxSizing:'border-box', padding:'9px 10px', fontSize:'13px', border:'1px solid '+BORDER, borderRadius:'8px', background:'#fff', color:'#1a1a1a', outline:'none' }
const field: React.CSSProperties = { flex:'1 1 160px', minWidth:'150px' }
const card: React.CSSProperties = { background:'#fff', border:'1px solid '+BORDER, borderRadius:'10px', padding:'18px' }
const th: React.CSSProperties = { padding:'11px 14px', color:'#6b7280', fontSize:'11px', fontWeight:700, textTransform:'uppercase', letterSpacing:'.3px', whiteSpace:'nowrap', userSelect:'none' }
const td: React.CSSProperties = { padding:'12px 14px', fontSize:'13px', color:'#1a1a1a', borderTop:'1px solid #f0f0f0', verticalAlign:'middle' }

function fmtData(v:any){
  if(!v) return '—'
  const d = new Date(v)
  if(isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('it-IT')+' '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})
}
function getData(o:any){ return o.created_at || o.creato_il || o.data_ordine || o.raw?.created_at || null }
function getTags(o:any){ const t = o.tags ?? o.raw?.tags; return Array.isArray(t)?t.join(', '):(t||'') }
function labelPag(s:any){ const m:Record<string,string>={ paid:'Pagato', pending:'In attesa', refunded:'Rimborsato', partially_paid:'Parziale', voided:'Annullato' }; return m[s]||s||'—' }
function coloriPag(s:any){ if(s==='paid') return {bg:'#dcfce7',fg:'#166534'}; if(s==='refunded'||s==='voided') return {bg:'#fee2e2',fg:'#991b1b'}; return {bg:'#fef3c7',fg:'#92400e'} }

export default function OrdiniPage() {
  const params = useParams()
  const router = useRouter()
  const piattaforma = String(params.piattaforma || 'shopify')
  const nome = NOMI[piattaforma] || piattaforma

  const [ordini, setOrdini] = useState<any[]>([])
  const [integrazioni, setIntegrazioni] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sincronizzando, setSincronizzando] = useState(false)
  const [msg, setMsg] = useState('')

  const [fStore, setFStore] = useState('')
  const [fStatoPag, setFStatoPag] = useState('')
  const [fStatoEv, setFStatoEv] = useState('')
  const [fPaese, setFPaese] = useState('')
  const [fNum, setFNum] = useState('')
  const [fSku, setFSku] = useState('')
  const [fTags, setFTags] = useState('')
  const [fArch, setFArch] = useState(false)
  const [fDa, setFDa] = useState('')
  const [fA, setFA] = useState('')

  const [search, setSearch] = useState('')
  const [perPage, setPerPage] = useState(10)
  const [page, setPage] = useState(1)
  const [sel, setSel] = useState<Record<string,boolean>>({})
  const [sort, setSort] = useState<{k:string,d:1|-1}|null>(null)

  const [spedisciCon, setSpedisciCon] = useState('auto')
  const [sms, setSms] = useState('no')
  const [corrieri, setCorrieri] = useState<any[]>([])

  async function carica() {
    setLoading(true)
    const [ord, integr] = await Promise.all([
      fetch('/api/ordini/lista?piattaforma='+piattaforma).then(r=>r.json()).catch(()=>[]),
      fetch('/api/integrazioni/lista').then(r=>r.json()).catch(()=>[]),
    ])
    setOrdini(Array.isArray(ord)?ord:[])
    const listaIntegr = Array.isArray(integr) ? integr : (integr?.integrazioni || [])
    setIntegrazioni(listaIntegr.filter((i:any)=>i.piattaforma===piattaforma))
    setLoading(false)
  }
  useEffect(()=>{ carica() }, [piattaforma])
  useEffect(()=>{ fetch('/api/cliente/corrieri').then(r=>r.json()).then(d=>setCorrieri(Array.isArray(d?.corrieri)?d.corrieri:[])).catch(()=>{}) }, [])

  async function sincronizza() {
    const attiva = integrazioni.find((i:any)=>i.stato==='attivo')
    const id = fStore || attiva?.id
    if (!id) { setMsg('Nessun negozio '+nome+' collegato'); return }
    setSincronizzando(true); setMsg('')
    try {
      const res = await fetch('/api/integrazioni/'+piattaforma+'/sync', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ integrazione_id: id })
      })
      const d = await res.json()
      if (d.error) setMsg('Errore: '+d.error)
      else setMsg('Sincronizzati '+d.importati+' ordini (letti '+d.letti+')')
      carica()
    } catch { setMsg('Errore di connessione') }
    setSincronizzando(false)
  }

  function creaSpedizione(o:any) {
    const d = o.destinatario || {}
    const qs = new URLSearchParams({
      da_ordine: o.id,
      nome: d.nome||'', indirizzo: d.indirizzo||'', citta: d.citta||'',
      provincia: d.provincia||'', cap: d.cap||'', paese: d.paese||'IT',
      email: d.email||'', telefono: d.telefono||'',
    })
    if (spedisciCon && spedisciCon !== 'auto') qs.set('corriere', spedisciCon)
    router.push('/cliente/spedizioni/nuova?'+qs.toString())
  }

  const paesi = useMemo(()=>Array.from(new Set(ordini.map(o=>o.destinatario?.paese).filter(Boolean))), [ordini])
  const statiPag = useMemo(()=>Array.from(new Set(ordini.map(o=>o.stato_pagamento).filter(Boolean))), [ordini])

  const filtrati = useMemo(()=>{
    let arr = ordini.filter(o=>{
      const d = o.destinatario || {}
      if (fStore && o.integrazione_id !== fStore) return false
      if (fStatoPag && o.stato_pagamento !== fStatoPag) return false
      if (fStatoEv && o.stato !== fStatoEv) return false
      if (fPaese && d.paese !== fPaese) return false
      if (fNum && !String(o.numero_ordine||'').toLowerCase().includes(fNum.toLowerCase())) return false
      if (fSku) {
        const arts = Array.isArray(o.articoli)?o.articoli:[]
        if (!arts.some((a:any)=>String(a.sku||'').toLowerCase().includes(fSku.toLowerCase()))) return false
      }
      if (fTags && !getTags(o).toLowerCase().includes(fTags.toLowerCase())) return false
      if (fArch && !o.archiviato) return false
      if (fDa || fA) {
        const t = getData(o); const ts = t?new Date(t).getTime():0
        if (fDa && ts < new Date(fDa).getTime()) return false
        if (fA && ts > new Date(fA).getTime()+86400000) return false
      }
      if (search) {
        const blob = (o.numero_ordine+' '+(d.nome||'')+' '+(d.citta||'')+' '+(d.email||'')).toLowerCase()
        if (!blob.includes(search.toLowerCase())) return false
      }
      return true
    })
    if (sort) {
      const acc:Record<string,(o:any)=>any> = {
        data:o=>new Date(getData(o)||0).getTime(),
        numero_ordine:o=>String(o.numero_ordine||''),
        destinatario:o=>String(o.destinatario?.nome||''),
        stato_pagamento:o=>String(o.stato_pagamento||''),
        stato:o=>String(o.stato||''),
        totale:o=>Number(o.totale||0),
      }
      const f = acc[sort.k]; if(f){ arr=[...arr].sort((a,b)=>{ const x=f(a),y=f(b); return x<y?-1*sort.d:x>y?1*sort.d:0 }) }
    }
    return arr
  }, [ordini, fStore, fStatoPag, fStatoEv, fPaese, fNum, fSku, fTags, fArch, fDa, fA, search, sort])

  const totale = filtrati.length
  const nPagine = Math.max(1, Math.ceil(totale/perPage))
  const start = (page-1)*perPage
  const pagina = filtrati.slice(start, start+perPage)
  useEffect(()=>{ setPage(1) }, [fStore,fStatoPag,fStatoEv,fPaese,fNum,fSku,fTags,fArch,fDa,fA,search,perPage])

  const idsPagina = pagina.map(o=>o.id)
  const tuttiSel = idsPagina.length>0 && idsPagina.every(id=>sel[id])
  function toggleTutti(){ const n={...sel}; if(tuttiSel){idsPagina.forEach(id=>delete n[id])} else {idsPagina.forEach(id=>n[id]=true)}; setSel(n) }
  function toggleUno(id:string){ setSel(s=>({...s,[id]:!s[id]})) }
  const nSel = Object.values(sel).filter(Boolean).length

  function ordina(k:string){ setSort(s=> s&&s.k===k ? {k,d:(s.d===1?-1:1) as 1|-1} : {k,d:1}) }
  function frecc(k:string){ if(!sort||sort.k!==k) return '↕'; return sort.d===1?'↑':'↓' }

  const [spedendo, setSpedendo] = useState(false)

  async function spedisciSelezionati(){
    const ids = Object.keys(sel).filter(id=>sel[id])
    if (ids.length===0){ setMsg('Seleziona almeno un ordine'); return }
    setSpedendo(true)
    let okCount = 0; const errori: string[] = []
    try {
      const cli = await fetch('/api/cliente/dati').then(r=>r.json())
      if (!cli || cli.error) { setMsg('Errore: dati cliente non disponibili'); setSpedendo(false); return }
      const shipFrom = { name:cli.ragione_sociale||'', company:cli.ragione_sociale||'', street1:cli.so_indirizzo||'', street2:'', city:cli.so_citta||'', state:cli.so_provincia||'', postalCode:cli.so_cap||'', country:'IT', phone:cli.telefono||'', email:cli.email||'' }
      for (const id of ids) {
        const o = ordini.find(x=>x.id===id)
        if (!o || o.stato==='spedito') continue
        const d = o.destinatario || {}
        const num = o.numero_ordine || id
        setMsg('Spedizione ordine '+num+'… ('+(okCount+1)+'/'+ids.length+')')
        if (!d.nome || !d.indirizzo || !d.citta || !d.cap) { errori.push(num+': destinatario incompleto'); continue }
        const arts = Array.isArray(o.articoli)?o.articoli:[]
        const grammi = arts.reduce((s:number,a:any)=>s+(Number(a.grammi)||0)*(Number(a.quantita)||1),0)
        const peso = Math.max(1, grammi/1000)
        const packages = [{ length:20, width:15, height:10, weight:peso }]
        const shipTo = { name:d.nome, company:'', street1:d.indirizzo, street2:'', city:d.citta, state:d.provincia||'', postalCode:d.cap, country:d.paese||'IT', phone:d.telefono||'', email:d.email||'' }
        const tarRes = await fetch('/api/spedizioni/tariffe', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ clienteId:cli.id, packages, shipFrom, shipTo, notes:'', insuranceValue:0, codValue:0 })
        }).then(r=>r.json()).catch(()=>null)
        if (!Array.isArray(tarRes) || !tarRes.length) { errori.push(num+': nessuna tariffa'); continue }
        let t = null
        if (spedisciCon && spedisciCon!=='auto') t = tarRes.find((x:any)=>x.corriere_id===spedisciCon || x._corriere_id===spedisciCon)
        if (!t) t = tarRes[0]
        const creaRes = await fetch('/api/spedizioni/crea', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            clienteId:cli.id, carrierCode:t.carrierCode, contractCode:t.contractCode, totalPrice:t.total_price,
            packages, colliDettaglio:[{lunghezza:'20',larghezza:'15',altezza:'10'}],
            shipFrom, shipTo, notes:'', insuranceValue:0, codValue:0,
            contenuto: arts.map((a:any)=>a.nome).join(', ').slice(0,100), tipoContenuto:'Merce destinata alla vendita', valoreMerce:String(o.totale||'')
          })
        }).then(r=>r.json()).catch(()=>null)
        if (!creaRes || creaRes.error) { errori.push(num+': '+(creaRes?.error||'errore creazione')); continue }
        await fetch('/api/ordini/segna-spedito', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ ordine_id:id, spedizione_id:creaRes.spedizioneId||null })
        }).catch(()=>{})
        okCount++
      }
    } catch { errori.push('errore imprevisto') }
    setSel({})
    setMsg('Spedite '+okCount+' spedizioni'+(errori.length?' — Errori: '+errori.join(' | '):''))
    setSpedendo(false)
    carica()
  }
  function cancellaSelezionati(){
    const ids = Object.keys(sel).filter(id=>sel[id])
    if (ids.length===0){ setMsg('Seleziona almeno un ordine'); return }
    setMsg('Eliminazione multipla in arrivo ('+ids.length+' selezionati)')
  }

  const Th = ({k, children, right}:{k?:string, children:any, right?:boolean}) => (
    <th style={{...th, cursor:k?'pointer':'default', textAlign:right?'right':'left'}} onClick={k?()=>ordina(k):undefined}>
      {children}{k && <span style={{marginLeft:'6px',color:'#c4c4c4'}}>{frecc(k)}</span>}
    </th>
  )

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px',gap:'12px',flexWrap:'wrap'}}>
        <h1 style={{fontSize:'24px',fontWeight:800,color:'#1a1a1a',margin:0}}>Ordini da {nome}</h1>
        <button onClick={sincronizza} disabled={sincronizzando} style={{background:ACCENT,color:'#fff',border:'none',borderRadius:'8px',padding:'10px 18px',fontSize:'13px',fontWeight:700,cursor:sincronizzando?'default':'pointer',opacity:sincronizzando?.6:1}}>
          {sincronizzando ? 'Sincronizzazione…' : '↻ Sincronizza ordini'}
        </button>
      </div>

      {msg && <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:'8px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#1d4ed8'}}>{msg}</div>}

      <div style={{...card, marginBottom:'20px'}}>
        <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a',marginBottom:'16px'}}>▾ Filtri</div>
        <div style={{display:'flex',gap:'14px',flexWrap:'wrap',marginBottom:'14px'}}>
          <div style={field}><label style={lbl}>Data da</label><input type="date" value={fDa} onChange={e=>setFDa(e.target.value)} style={inp}/></div>
          <div style={field}><label style={lbl}>Data a</label><input type="date" value={fA} onChange={e=>setFA(e.target.value)} style={inp}/></div>
          <div style={field}><label style={lbl}>{nome} Store</label>
            <select value={fStore} onChange={e=>setFStore(e.target.value)} style={inp}>
              <option value="">Tutti</option>
              {integrazioni.map(i=><option key={i.id} value={i.id}>{i.nome_negozio||i.identificativo||i.id}</option>)}
            </select>
          </div>
          <div style={field}><label style={lbl}>Stato pagamento</label>
            <select value={fStatoPag} onChange={e=>setFStatoPag(e.target.value)} style={inp}>
              <option value="">Tutti</option>
              {statiPag.map(s=><option key={s} value={s}>{labelPag(s)}</option>)}
            </select>
          </div>
          <div style={field}><label style={lbl}>Stato evasione</label>
            <select value={fStatoEv} onChange={e=>setFStatoEv(e.target.value)} style={inp}>
              <option value="">Tutti</option>
              <option value="da_spedire">Da spedire</option>
              <option value="spedito">Spedito</option>
            </select>
          </div>
          <div style={field}><label style={lbl}>Paese</label>
            <select value={fPaese} onChange={e=>setFPaese(e.target.value)} style={inp}>
              <option value="">Tutti</option>
              {paesi.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div style={{display:'flex',gap:'14px',flexWrap:'wrap',alignItems:'flex-end'}}>
          <div style={field}><label style={lbl}>N. Ordine</label><input value={fNum} onChange={e=>setFNum(e.target.value)} style={inp} placeholder="es. 1024"/></div>
          <div style={field}><label style={lbl}>SKU</label><input value={fSku} onChange={e=>setFSku(e.target.value)} style={inp}/></div>
          <div style={field}><label style={lbl}>Tags</label><input value={fTags} onChange={e=>setFTags(e.target.value)} style={inp}/></div>
          <label style={{...field, display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:'#1a1a1a',cursor:'pointer',paddingBottom:'9px'}}>
            <input type="checkbox" checked={fArch} onChange={e=>setFArch(e.target.checked)} style={{accentColor:ACCENT,width:'16px',height:'16px'}}/> Ordini Archiviati
          </label>
        </div>
      </div>

      <div style={{...card, padding:0, overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap',padding:'16px 18px',borderBottom:'1px solid #f0f0f0'}}>
          <span style={{fontSize:'13px',fontWeight:700,color:'#6b7280'}}>Spedisci con:</span>
          <select value={spedisciCon} onChange={e=>setSpedisciCon(e.target.value)} style={{...inp,width:'auto',minWidth:'260px'}}>
            <option value="auto">Assegnazione automatica (prezzo minore)</option>
            {corrieri.map((c:any)=><option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <span style={{fontSize:'13px',fontWeight:700,color:'#6b7280'}}>Notifiche SMS</span>
          <select value={sms} onChange={e=>setSms(e.target.value)} style={{...inp,width:'auto',minWidth:'80px'}}>
            <option value="no">No</option><option value="si">Sì</option>
          </select>
          <div style={{flex:1}}/>
          <button onClick={spedisciSelezionati} disabled={spedendo} style={{opacity:spedendo?.6:1,background:'#2563eb',color:'#fff',border:'none',borderRadius:'8px',padding:'9px 16px',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>Spedisci selezionati{nSel>0?' ('+nSel+')':''}</button>
          <button onClick={cancellaSelezionati} style={{background:'#dc2626',color:'#fff',border:'none',borderRadius:'8px',padding:'9px 16px',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>Cancella selezionati</button>
        </div>

        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'10px',padding:'14px 18px'}}>
          <div style={{fontSize:'13px',color:'#6b7280'}}>Mostra&nbsp;
            <select value={perPage} onChange={e=>setPerPage(Number(e.target.value))} style={{...inp,width:'auto',display:'inline-block',padding:'5px 8px'}}>
              {[10,25,50,100].map(n=><option key={n} value={n}>{n}</option>)}
            </select>&nbsp;elementi
          </div>
          <div style={{fontSize:'13px',color:'#6b7280'}}>Cerca:&nbsp;
            <input value={search} onChange={e=>setSearch(e.target.value)} style={{...inp,width:'auto',display:'inline-block',padding:'6px 10px'}}/>
          </div>
        </div>

        {loading ? (
          <div style={{padding:'40px',textAlign:'center',color:'#999'}}>Caricamento…</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:'#f9fafb',textAlign:'left'}}>
                <th style={{...th,width:'40px'}}><input type="checkbox" checked={tuttiSel} onChange={toggleTutti} style={{accentColor:ACCENT,width:'16px',height:'16px'}}/></th>
                <Th k="data">Data e Ora</Th>
                <Th k="numero_ordine">ID Ordine</Th>
                <Th k="destinatario">Destinatario</Th>
                <Th>Articoli</Th>
                <Th k="stato_pagamento">Stato pagamento</Th>
                <Th k="stato">Stato evasione</Th>
                <Th k="totale" right>Totale</Th>
                <Th>Tags</Th>
                <Th>N. Spedizione</Th>
                <Th right>Azioni</Th>
              </tr></thead>
              <tbody>
                {pagina.length===0 ? (
                  <tr><td colSpan={11} style={{...td,textAlign:'center',color:'#999',padding:'40px'}}>Nessun dato disponibile nella tabella</td></tr>
                ) : pagina.map((o:any)=>{
                  const d = o.destinatario||{}; const cp = coloriPag(o.stato_pagamento)
                  return (
                  <tr key={o.id} style={{background:sel[o.id]?'#fff7ed':'#fff'}}>
                    <td style={td}><input type="checkbox" checked={!!sel[o.id]} onChange={()=>toggleUno(o.id)} style={{accentColor:ACCENT,width:'16px',height:'16px'}}/></td>
                    <td style={{...td,color:'#6b7280',whiteSpace:'nowrap'}}>{fmtData(getData(o))}</td>
                    <td style={{...td,fontWeight:600}}>{o.numero_ordine}</td>
                    <td style={td}>{d.nome||'—'}<div style={{fontSize:'11px',color:'#999'}}>{d.citta}{d.provincia?' ('+d.provincia+')':''} {d.paese||''}</div></td>
                    <td style={{...td,maxWidth:'240px'}}>
                      {(Array.isArray(o.articoli)?o.articoli:[]).map((a:any,i:number)=>(
                        <div key={i} style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px'}}>
                          {a.immagine
                            ? <img src={a.immagine} alt="" style={{width:'32px',height:'32px',objectFit:'cover',borderRadius:'6px',border:'1px solid #e8e8e8',flexShrink:0}}/>
                            : <div style={{width:'32px',height:'32px',borderRadius:'6px',border:'1px solid #e8e8e8',background:'#f9fafb',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'14px',flexShrink:0}}>📦</div>}
                          <div style={{minWidth:0}}>
                            <div style={{fontSize:'12px',color:'#1a1a1a',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.quantita}× {a.nome}</div>
                            {a.sku && <div style={{fontSize:'10px',color:'#999'}}>SKU: {a.sku}</div>}
                          </div>
                        </div>
                      ))}
                    </td>
                    <td style={td}><span style={{fontSize:'11px',fontWeight:600,padding:'3px 9px',borderRadius:'999px',background:cp.bg,color:cp.fg}}>{labelPag(o.stato_pagamento)}</span></td>
                    <td style={td}><span style={{fontSize:'11px',fontWeight:600,padding:'3px 9px',borderRadius:'999px',background:o.stato==='spedito'?'#dcfce7':'#fef3c7',color:o.stato==='spedito'?'#166534':'#92400e'}}>{o.stato==='spedito'?'Spedito':'Da spedire'}</span></td>
                    <td style={{...td,textAlign:'right',whiteSpace:'nowrap'}}>{o.totale?Number(o.totale).toFixed(2):'—'} {o.valuta||''}</td>
                    <td style={{...td,color:'#6b7280',maxWidth:'140px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{getTags(o)||'—'}</td>
                    <td style={{...td,color:'#6b7280'}}>{o.spedizione_id?String(o.spedizione_id).slice(0,8):'—'}</td>
                    <td style={{...td,textAlign:'right',whiteSpace:'nowrap'}}>
                      {o.stato!=='spedito'
                        ? <button onClick={()=>creaSpedizione(o)} style={{background:'#eff6ff',color:'#1d4ed8',border:'1px solid #bfdbfe',borderRadius:'6px',padding:'6px 12px',fontSize:'12px',fontWeight:600,cursor:'pointer'}}>Crea spedizione</button>
                        : <span style={{color:'#166534',fontSize:'12px',fontWeight:600}}>✓ Spedito</span>}
                    </td>
                  </tr>)
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'10px',padding:'14px 18px',borderTop:'1px solid #f0f0f0'}}>
          <div style={{fontSize:'13px',color:'#6b7280'}}>Risultati da {totale===0?0:start+1} a {Math.min(start+perPage,totale)} di {totale} elementi</div>
          <div style={{display:'flex',gap:'8px'}}>
            <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page<=1} style={{background:'#fff',border:'1px solid '+BORDER,borderRadius:'6px',padding:'7px 14px',fontSize:'13px',cursor:page<=1?'default':'pointer',opacity:page<=1?.5:1}}>Precedente</button>
            <span style={{fontSize:'13px',color:'#6b7280',padding:'7px 4px'}}>{page} / {nPagine}</span>
            <button onClick={()=>setPage(p=>Math.min(nPagine,p+1))} disabled={page>=nPagine} style={{background:'#fff',border:'1px solid '+BORDER,borderRadius:'6px',padding:'7px 14px',fontSize:'13px',cursor:page>=nPagine?'default':'pointer',opacity:page>=nPagine?.5:1}}>Successivo</button>
          </div>
        </div>
      </div>
    </div>
  )
}
