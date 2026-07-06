'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface Tariffa { carrierCode:string; contractCode:string; total_price:string; zona:string; peso_fatturato:string; peso_reale:number; peso_volume:string; prezzo_spedizione?:string; costo_contrassegno?:string; costo_assicurazione?:string; corriere_nome?:string }
interface Collo { lunghezza:string; larghezza:string; altezza:string }

const inp = {width:'100%',padding:'8px 11px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}
const lbl = {fontSize:'11.5px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px',whiteSpace:'nowrap' as const}
const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden' as const}
const cardH = {padding:'12px 16px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700' as const,color:'#1a1a1a'}
const cardB = {padding:'16px'}

const CARRIER_LABELS: Record<string,{nome:string,colore:string}> = {
  sda:{nome:'SDA Express',colore:'#e31837'},
  gls:{nome:'GLS',colore:'#f97316'},
  brt:{nome:'BRT',colore:'#e2001a'},
  poste:{nome:'Poste Italiane',colore:'#ffcc00'},
  dhl:{nome:'DHL Express',colore:'#ffcc00'},
}


function iconaCorriere(nome:string): string | null {
  const n = (nome||'').toUpperCase()
  const regole: [string,string][] = [
    ['DELIVERY BUSINESS','poste_delivery_business'],['POSTE','poste_delivery_business'],
    ['SDA','sda'], ['GLS','gls'], ['BRT','brt'], ['SPEDISCI','spedisci'], ['TNT','tnt'],
    ['DHL ECONNECT','dhl_econnect'], ['ECONNECT','dhl_econnect'], ['DHL','dhl'],
    ['FEDEX','fedex'], ['UPS','ups'], ['HERMES','hermes'], ['NEXIVE','nexive'],
    ['LICCARDI','liccardi'], ['SAILPOST','sailpost'], ['BDM','bdm'], ['NSSA','nssa'],
    ['HR PARCEL','hrp'], ['HRP','hrp'], ['PALLETWAYS','palletways'],
    ['CORREOS EXPRESS','correos_express'], ['CORREOS','correos'],
    ['INPOST','inpost'], ['SPRING','spring'], ['PAACK','paack'],['SPEEDY','speedy'],
    ['AMAZON','amazon_shipping'], ['CTT','ctt_express'], ['AIPACK','aipack'], ['ALT','alt'],
    ['GTECH','gtechgroup'], ['SPEDIAMOPRO','spedisci'], ['SPEDIAMO','spedisci'], ['SPEDISCI','spedisci'],
  ]
  for (const [chiave,file] of regole) { if (n.includes(chiave)) return `/corrieri/${file}.png` }
  return null
}
export default function NuovaSpedizioneCliente() {
  const router = useRouter()
  const [clienteData, setClienteData] = useState<any>(null)
  const [mitt, setMitt] = useState({nome:'',indirizzo:'',citta:'',provincia:'',cap:'',email:'',telefono:''})
  const [dest, setDest] = useState({nome:'',indirizzo:'',citta:'',provincia:'',cap:'',paese:'IT',email:'',telefono:'',note:''})
  const [suggComuni, setSuggComuni] = useState<any[]>([])
  const [showSugg, setShowSugg] = useState(false)
  const [richiediRitiro, setRichiediRitiro] = useState(false)
  const [ritiroData, setRitiroData] = useState(new Date().toISOString().split('T')[0])
  const [ritiroOrario, setRitiroOrario] = useState('mattina')
  const [numColli, setNumColli] = useState(1)
  const [colli, setColli] = useState<Collo[]>([{lunghezza:'',larghezza:'',altezza:''}])
  const [peso, setPeso] = useState('1')
  const [contenuto, setContenuto] = useState('')
  const [tipoContenuto, setTipoContenuto] = useState('Merce destinata alla vendita')
  const [valoreMerce, setValoreMerce] = useState('')
  const [contrassegno, setContrassegno] = useState('0')
  const [assicurazione, setAssicurazione] = useState('0')
  const [tariffe, setTariffe] = useState<Tariffa[]>([])
  const [selected, setSelected] = useState<Tariffa|null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [errore, setErrore] = useState('')
  const [vista, setVista] = useState<'dati'|'contratto'>('dati')
  const [successo, setSuccesso] = useState<{numero:string,id:string}|null>(null)
  const [daOrdine, setDaOrdine] = useState('')
  const [corrierePref, setCorrierePref] = useState('')

  // Precompilazione da ordine ecommerce (query param ?da_ordine=&nome=&...)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (!q.get('da_ordine') && !q.get('nome')) return
    setDaOrdine(q.get('da_ordine') || '')
    setCorrierePref(q.get('corriere') || '')
    setDest(d => ({...d,
      nome: q.get('nome') || d.nome,
      indirizzo: q.get('indirizzo') || d.indirizzo,
      citta: q.get('citta') || d.citta,
      provincia: q.get('provincia') || d.provincia,
      cap: q.get('cap') || d.cap,
      paese: q.get('paese') || d.paese,
      email: q.get('email') || d.email,
      telefono: q.get('telefono') || d.telefono,
    }))
  }, [])
  useEffect(() => {
    setTariffe([]); setSelected(null); setVista('dati')
  }, [dest, mitt, peso, colli, numColli, contrassegno, assicurazione])

  // Se il cliente modifica un dato che cambia il prezzo mentre la lista e' visibile,
  // azzera le tariffe: dovra' ricliccare "Seleziona Corriere" per vedere il prezzo aggiornato.
  const primoRender = useRef(true)
  useEffect(() => {
    if (primoRender.current) { primoRender.current = false; return }
    if (tariffe.length) { setTariffe([]); setSelected(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peso, numColli, colli, contrassegno, assicurazione])

  useEffect(() => {
    fetch('/api/cliente/dati').then(r=>r.json()).then(c => {
      if (!c || c.error) return
      setClienteData(c)
      setMitt({nome:c.ragione_sociale||'',indirizzo:c.so_indirizzo||'',citta:c.so_citta||'',provincia:c.so_provincia||'',cap:c.so_cap||'',email:c.email||'',telefono:c.telefono||''})
    })
  }, [])

  function aggiornaNumColli(n: number) {
    const num = Math.max(1, n)
    setNumColli(num)
    setColli(prev => {
      const next = [...prev]
      while (next.length < num) next.push({lunghezza:'',larghezza:'',altezza:''})
      return next.slice(0, num)
    })
    setTariffe([]); setSelected(null)
  }

  function aggiornaCollo(i: number, field: keyof Collo, val: string) {
    setColli(prev => { const next=[...prev]; next[i]={...next[i],[field]:val}; return next })
    setTariffe([]); setSelected(null)
  }

  function buildPackages() {
    const n = Math.max(1, colli.length)
    const pesoPerCollo = (+peso || 0) / n
    return colli.map(c => ({
      length: +c.lunghezza||20,
      width: +c.larghezza||15,
      height: +c.altezza||10,
      weight: pesoPerCollo
    }))
  }

  async function calcolaTariffe() {
    if (!dest.nome||!dest.indirizzo||!dest.citta||!dest.cap||!dest.email||!dest.telefono) {
      setErrore('Compila tutti i dati del destinatario (inclusi email e telefono)'); return
    }
    if (dest.paese==='IT' && !dest.provincia) {
      setErrore('La provincia è obbligatoria per le spedizioni in Italia'); return
    }
    setErrore(''); setLoading(true); setTariffe([]); setSelected(null)
    const res = await fetch('/api/spedizioni/tariffe', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        clienteId: clienteData?.id,
        packages: buildPackages(),
        shipFrom:{name:mitt.nome,company:mitt.nome,street1:mitt.indirizzo,street2:'',city:mitt.citta,state:mitt.provincia,postalCode:mitt.cap,country:'IT',phone:mitt.telefono,email:mitt.email},
        shipTo:{name:dest.nome,company:'',street1:dest.indirizzo,street2:'',city:dest.citta,state:dest.provincia,postalCode:dest.cap,country:dest.paese,phone:dest.telefono,email:dest.email},
        notes:dest.note, insuranceValue:+assicurazione, codValue:+contrassegno
      })
    })
    const data = await res.json()
    setLoading(false)
    if (data.error) { setErrore(data.error); return }
    if (!Array.isArray(data)||!data.length) { setErrore('Nessuna tariffa disponibile'); return }
    setTariffe(data)
    if (Array.isArray(data) && data.length) {
      const pref = corrierePref ? data.find((t:any)=>t.corriere_id===corrierePref || t._corriere_id===corrierePref) : null
      setSelected(pref || data[0])
    }
    setVista('contratto')
  }

  async function scaricaEtichetta(id:string) {
    try {
      const res = await fetch('/api/spedizioni/etichetta?id='+id)
      if (!res.ok) { alert('Errore: etichetta non generata'); return }
      const blob = await res.blob()
      const ct = res.headers.get('content-type')||''
      const ext = ct.includes('gif')?'gif':ct.includes('png')?'png':'pdf'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'etichetta_'+id+'.'+ext
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch { alert('Errore durante il download etichetta') }
  }
  async function creaSpedizione() {
    if (!selected) return
    setCreating(true)
    const res = await fetch('/api/spedizioni/crea', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        clienteId: clienteData?.id,
        carrierCode:selected.carrierCode, contractCode:selected.contractCode,
        _corriere_id: (selected as any)._corriere_id || (selected as any).corriere_id || null, _spediamopro_quotation: (selected as any)._spediamopro_quotation || null,
        totalPrice:selected.total_price,
        packages: buildPackages(),
        colliDettaglio: colli,
        shipFrom:{name:mitt.nome,company:mitt.nome,street1:mitt.indirizzo,street2:'',city:mitt.citta,state:mitt.provincia,postalCode:mitt.cap,country:'IT',phone:mitt.telefono,email:mitt.email},
        shipTo:{name:dest.nome,company:'',street1:dest.indirizzo,street2:'',city:dest.citta,state:dest.provincia,postalCode:dest.cap,country:dest.paese,phone:dest.telefono,email:dest.email},
        notes:dest.note, insuranceValue:+assicurazione, codValue:+contrassegno,
        contenuto, tipoContenuto, valoreMerce
      })
    })
    const data = await res.json()
    if (data.error) { setCreating(false); setErrore(data.error); return }
    if (richiediRitiro && data.spedizioneId) {
      try {
        await fetch('/api/ritiri/crea', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            spedizioneIds:[data.spedizioneId],
            mittNome:mitt.nome, mittIndirizzo:mitt.indirizzo, mittCitta:mitt.citta,
            mittProvincia:mitt.provincia, mittCap:mitt.cap, mittPaese:'IT',
            mittTelefono:mitt.telefono, mittEmail:mitt.email,
            dataRitiro:ritiroData, orarioRitiro:ritiroOrario,
          })
        })
      } catch {}
    }
    if (daOrdine) {
      try {
        await fetch('/api/ordini/segna-spedito', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ ordine_id: daOrdine, spedizione_id: data.spedizioneId||null })
        })
      } catch {}
    }
    setCreating(false)
    setSuccesso({numero:data.numero||'—', id:data.spedizioneId||''})
  }

  const pesoVol0 = colli[0]?.lunghezza&&colli[0]?.larghezza&&colli[0]?.altezza
    ? ((+colli[0].lunghezza * +colli[0].larghezza * +colli[0].altezza)/5000).toFixed(2) : null

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Nuova Spedizione</h1>
        <p style={{color:'#999',fontSize:'13px',marginTop:'4px'}}>Compila i dati e seleziona il corriere</p>
      </div>

      {errore && <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#dc2626'}}>⚠️ {errore}</div>}
      {successo && <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'12px 16px',marginBottom:'16px',fontSize:'14px',color:'#166534',display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px'}}>
        <span>✓ Spedizione <strong>{successo.numero}</strong> generata con successo</span>
        {successo.id
          ? <button onClick={()=>scaricaEtichetta(successo.id)} style={{background:'#fff7ed',color:'#ea580c',border:'1px solid #fed7aa',borderRadius:'6px',padding:'6px 12px',fontSize:'14px',cursor:'pointer',fontWeight:'600'}} title="Scarica etichetta">🖨️ Scarica LDV</button>
          : <span style={{color:'#dc2626',fontSize:'13px'}}>⚠️ Etichetta non generata</span>}
      </div>}

      <div style={{display:'grid',gridTemplateColumns:'1fr 400px',gap:'16px',alignItems:'start'}}>

        {/* COLONNA SINISTRA */}
        <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>

          {/* MITTENTE */}
          <div style={card}>
            <div style={{...cardH,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span>Dati Mittente</span>
              <span style={{fontSize:'11px',color:'#bbb',fontWeight:'400'}}>precompilato dal tuo profilo</span>
            </div>
            <div style={cardB}>
              <div style={{marginBottom:'12px'}}><label style={lbl}>Rif. Mittente</label><input value={mitt.nome} onChange={e=>setMitt({...mitt,nome:e.target.value})} style={inp}/></div>
              <div style={{marginBottom:'12px'}}><label style={lbl}>Indirizzo</label><input value={mitt.indirizzo} onChange={e=>setMitt({...mitt,indirizzo:e.target.value})} style={inp}/></div>
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:'8px',marginBottom:'12px'}}>
                <div><label style={lbl}>Città</label><input value={mitt.citta} onChange={e=>setMitt({...mitt,citta:e.target.value})} style={inp}/></div>
                <div><label style={lbl}>Prov.</label><input value={mitt.provincia} onChange={e=>setMitt({...mitt,provincia:e.target.value})} style={inp}/></div>
                <div><label style={lbl}>CAP</label><input value={mitt.cap} onChange={e=>setMitt({...mitt,cap:e.target.value})} style={inp}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                <div><label style={lbl}>Email</label><input value={mitt.email} onChange={e=>setMitt({...mitt,email:e.target.value})} style={inp}/></div>
                <div><label style={lbl}>Telefono</label><input value={mitt.telefono} onChange={e=>setMitt({...mitt,telefono:e.target.value})} style={inp}/></div>
              </div>
            </div>
          </div>

          {/* DESTINATARIO */}
          <div style={card}>
            <div style={cardH}>Dati Destinatario</div>
            <div style={cardB}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'12px'}}>
                <div><label style={lbl}>Nominativo *</label><input value={dest.nome} onChange={e=>setDest({...dest,nome:e.target.value})} placeholder="Mario Rossi" style={inp}/></div>
                <div><label style={lbl}>Paese</label>
                  <select value={dest.paese} onChange={e=>setDest({...dest,paese:e.target.value})} style={inp}>
                    <option value="IT">Italia</option><option value="AT">Austria</option><option value="BE">Belgio</option><option value="BG">Bulgaria</option><option value="HR">Croazia</option><option value="DK">Danimarca</option><option value="EE">Estonia</option><option value="FI">Finlandia</option><option value="FR">Francia</option><option value="DE">Germania</option><option value="GR">Grecia</option><option value="IE">Irlanda</option><option value="LV">Lettonia</option><option value="LT">Lituania</option><option value="LU">Lussemburgo</option><option value="MC">Monaco</option><option value="NL">Paesi Bassi</option><option value="PL">Polonia</option><option value="PT">Portogallo</option><option value="GB">Regno Unito</option><option value="CZ">Rep. Ceca</option><option value="RO">Romania</option><option value="SK">Slovacchia</option><option value="SI">Slovenia</option><option value="ES">Spagna</option><option value="SE">Svezia</option><option value="HU">Ungheria</option>
                  </select>
                </div>
              </div>
              <div style={{marginBottom:'12px'}}><label style={lbl}>Indirizzo *</label><input value={dest.indirizzo} onChange={e=>setDest({...dest,indirizzo:e.target.value})} placeholder="Via Roma 1" style={inp}/></div>
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:'8px',marginBottom:'12px'}}>
                <div style={{position:'relative'}}>
                  <label style={lbl}>Città *</label>
                  <input value={dest.citta} autoComplete="off"
                    onChange={async e=>{
                      const v=e.target.value
                      setDest(d=>({...d,citta:v}))
                      if(v.trim().length>=2){
                        try{ const r=await fetch('/api/comuni?q='+encodeURIComponent(v)); const j=await r.json(); setSuggComuni(Array.isArray(j)?j:[]); setShowSugg(true) }catch{ setSuggComuni([]) }
                      } else { setSuggComuni([]); setShowSugg(false) }
                    }}
                    onFocus={()=>{ if(suggComuni.length) setShowSugg(true) }}
                    onBlur={()=>setTimeout(()=>setShowSugg(false),200)}
                    placeholder="Roma" style={inp}/>
                  {showSugg && suggComuni.length>0 && (
                    <div style={{position:'absolute',top:'100%',left:0,right:0,zIndex:50,background:'#fff',border:'1px solid #d1d5db',borderRadius:'6px',maxHeight:'220px',overflowY:'auto',boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}>
                      {suggComuni.map((c:any,i:number)=>(
                        <div key={i} onMouseDown={()=>{ setDest(d=>({...d,citta:c.nome,provincia:c.sigla,cap:c.cap})); setShowSugg(false) }}
                          style={{padding:'7px 10px',fontSize:'12px',cursor:'pointer',borderBottom:'1px solid #f0f0f0',color:'#1a1a1a'}}
                          onMouseEnter={e=>(e.currentTarget.style.background='#f9fafb')}
                          onMouseLeave={e=>(e.currentTarget.style.background='#fff')}>
                          {c.nome} <span style={{color:'#999'}}>({c.sigla}) - {c.cap}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div><label style={lbl}>Prov. *</label><input value={dest.provincia} onChange={e=>setDest({...dest,provincia:e.target.value})} placeholder="RM" style={inp}/></div>
                <div><label style={lbl}>CAP *</label><input value={dest.cap} onChange={e=>setDest({...dest,cap:e.target.value})} placeholder="00100" style={inp}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'12px'}}>
                <div><label style={lbl}>Email</label><input value={dest.email} onChange={e=>setDest({...dest,email:e.target.value})} style={inp}/></div>
                <div><label style={lbl}>Telefono</label><input value={dest.telefono} onChange={e=>setDest({...dest,telefono:e.target.value})} style={inp}/></div>
              </div>
              <div><label style={lbl}>Note</label><input value={dest.note} onChange={e=>setDest({...dest,note:e.target.value})} style={inp}/></div>
              <div style={{marginTop:'12px',padding:'10px 12px',background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'6px'}}>
                <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',fontWeight:'600',color:'#1a1a1a',cursor:'pointer'}}>
                  <input type="checkbox" checked={richiediRitiro} onChange={e=>setRichiediRitiro(e.target.checked)} style={{width:'16px',height:'16px',cursor:'pointer'}}/>
                  📦 Richiedi ritiro con questa spedizione
                </label>
                {richiediRitiro && (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginTop:'10px'}}>
                    <div><label style={lbl}>Data ritiro</label><input type="date" value={ritiroData} onChange={e=>setRitiroData(e.target.value)} style={inp}/></div>
                    <div><label style={lbl}>Orario</label>
                      <select value={ritiroOrario} onChange={e=>setRitiroOrario(e.target.value)} style={inp}>
                        <option value="mattina">Mattina</option>
                        <option value="pomeriggio">Pomeriggio</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* COLONNA DESTRA */}
        <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>

          {/* DATI SPEDIZIONE */}
          {vista==='dati' && (<div style={card}>
            <div style={cardH}>Dati Spedizione</div>
            <div style={cardB}>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'8px',marginBottom:'14px'}}>
                <div>
                  <label style={lbl}>Colli</label>
                  <input type="number" value={numColli} min="1"
                    onChange={e=>aggiornaNumColli(parseInt(e.target.value)||1)} style={inp}/>
                </div>
                <div>
                  <label style={lbl}>Peso totale</label>
                  <input type="number" value={peso} min="0.1" step="0.1"
                    onChange={e=>{setPeso(e.target.value);setTariffe([]);setSelected(null)}} style={inp}/>
                </div>
                <div>
                  <label style={lbl}>Contrassegno €</label>
                  <input type="number" value={contrassegno} min="0" step="0.01"
                    onChange={e=>setContrassegno(e.target.value)} style={inp}/>
                </div>
                <div>
                  <label style={lbl}>Assicurazione €</label>
                  <input type="number" value={assicurazione} min="0" step="0.01"
                    onChange={e=>setAssicurazione(e.target.value)} style={inp}/>
                </div>
              </div>

              <div style={{marginBottom:'14px'}}>
                <div style={{display:'grid',gridTemplateColumns:'32px 1fr 1fr 1fr',gap:'6px',marginBottom:'6px'}}>
                  <div style={{...lbl,marginBottom:0}}>#</div>
                  <div style={{...lbl,marginBottom:0}}>Lunghezza (cm)</div>
                  <div style={{...lbl,marginBottom:0}}>Larghezza (cm)</div>
                  <div style={{...lbl,marginBottom:0}}>Altezza (cm)</div>
                </div>
                {colli.map((c,i)=>(
                  <div key={i} style={{display:'grid',gridTemplateColumns:'32px 1fr 1fr 1fr',gap:'6px',marginBottom:'6px',alignItems:'center'}}>
                    <div style={{fontSize:'12px',color:'#999',fontWeight:'600',textAlign:'center'}}>📦{i+1}</div>
                    <input type="number" value={c.lunghezza} placeholder="es. 30"
                      onChange={e=>aggiornaCollo(i,'lunghezza',e.target.value)} style={inp}/>
                    <input type="number" value={c.larghezza} placeholder="es. 20"
                      onChange={e=>aggiornaCollo(i,'larghezza',e.target.value)} style={inp}/>
                    <input type="number" value={c.altezza} placeholder="es. 15"
                      onChange={e=>aggiornaCollo(i,'altezza',e.target.value)} style={inp}/>
                  </div>
                ))}
              </div>



              <div style={{marginBottom:'10px'}}>
                <label style={lbl}>Contenuto</label>
                <input value={contenuto} onChange={e=>setContenuto(e.target.value)} style={inp}/>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                <div>
                  <label style={lbl}>Tipo contenuto</label>
                  <select value={tipoContenuto} onChange={e=>setTipoContenuto(e.target.value)} style={inp}>
                    <option>Merce destinata alla vendita</option>
                    <option>Campioni commerciali</option>
                    <option>Documenti</option>
                    <option>Regalo</option>
                    <option>Uso personale</option>
                  </select>
                </div>
                <div>
                  <label style={lbl}>Valore merce €</label>
                  <input type="number" value={valoreMerce} onChange={e=>setValoreMerce(e.target.value)} min="0" step="0.01" style={inp}/>
                </div>
              </div>
            </div>
          </div>)}

          {/* CORRIERI E COSTI */}
          {vista==='dati' && (<div style={card}>
            <div style={{...cardH,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span>Corrieri e Costi</span>
              <button onClick={calcolaTariffe} disabled={loading}
                style={{background:'#f97316',color:'#fff',border:'none',padding:'5px 14px',borderRadius:'5px',fontSize:'12px',fontWeight:'600',cursor:'pointer',opacity:loading?0.7:1}}>
                {loading?'Calcolo...':'Seleziona Corriere'}
              </button>
            </div>
            <div style={cardB}>
              {!tariffe.length&&!loading && (
                <div style={{textAlign:'center',color:'#bbb',fontSize:'13px',padding:'20px 0'}}>
                  Compila i dati e clicca "Seleziona Corriere"
                </div>
              )}
              {tariffe.map((r,i)=>{
                const carrier = CARRIER_LABELS[r.carrierCode]||{nome:r.carrierCode.toUpperCase(),colore:'#666'}
                const isSelected = ((selected as any)?._corriere_id && (r as any)?._corriere_id) ? ((selected as any)._corriere_id===(r as any)._corriere_id && selected?.zona===r.zona) : (selected?.carrierCode===r.carrierCode&&selected?.contractCode===r.contractCode&&selected?.zona===r.zona)
                return (
                  <div key={i} onClick={()=>setSelected(r)}
                    style={{display:'flex',alignItems:'center',gap:'12px',padding:'12px',border:`2px solid ${isSelected?'#f97316':'#e8e8e8'}`,borderRadius:'8px',marginBottom:'8px',cursor:'pointer',background:isSelected?'#fffbeb':'#fff',transition:'all .15s'}}>
                    {iconaCorriere(r.corriere_nome||r.carrierCode||carrier.nome) ? (
                      <img src={iconaCorriere(r.corriere_nome||r.carrierCode||carrier.nome)!} alt="" style={{width:'56px',height:'34px',objectFit:'contain',border:'1px solid #e8e8e8',borderRadius:'5px',background:'#fff',padding:'2px',flexShrink:0}}/>
                    ) : (
                      <div style={{width:'48px',height:'30px',border:'1px solid #e8e8e8',borderRadius:'5px',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                        <span style={{fontSize:'8px',fontWeight:'900',color:carrier.colore,textTransform:'uppercase'}}>{r.carrierCode.toUpperCase()}</span>
                      </div>
                    )}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:'700',color:'#1a1a1a',fontSize:'13px'}}>{carrier.nome}</div>
                      <div style={{fontSize:'11px',color:'#999',marginTop:'1px'}}>{r.peso_fatturato}kg · zona {r.zona}{parseFloat(r.peso_volume)>r.peso_reale?' (vol.)':''}</div>
                    </div>
                    <div style={{textAlign:'right',flexShrink:0}}>
                      {(Number(r.costo_contrassegno||0) > 0 || Number(r.costo_assicurazione||0) > 0) ? (
                        <>
                          <div style={{fontSize:'11px',color:'#666'}}>Spedizione: € {r.prezzo_spedizione||r.total_price}</div>
                          {Number(r.costo_contrassegno||0) > 0 && <div style={{fontSize:'11px',color:'#666'}}>Contrassegno: € {r.costo_contrassegno}</div>}
                          {Number(r.costo_assicurazione||0) > 0 && <div style={{fontSize:'11px',color:'#666'}}>Assicurazione: € {r.costo_assicurazione}</div>}
                          <div style={{fontSize:'18px',fontWeight:'800',color:'#f97316',marginTop:'2px'}}>Totale € {r.total_price}</div>
                          <div style={{fontSize:'10px',color:'#bbb',marginTop:'1px'}}>iva esclusa</div>
                        </>
                      ) : (
                        <>
                          <div style={{fontSize:'18px',fontWeight:'800',color:'#f97316'}}>€ {r.total_price}</div>
                          <div style={{fontSize:'10px',color:'#bbb',marginTop:'1px'}}>iva esclusa</div>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
              {selected && (
                <button onClick={creaSpedizione} disabled={creating}
                  style={{width:'100%',marginTop:'4px',padding:'12px',background:'#1a1a1a',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13.5px',fontWeight:'700',cursor:'pointer',opacity:creating?0.7:1}}>
                  {creating?'Creazione in corso...':'✓ Crea Spedizione — € '+selected.total_price}
                </button>
              )}
            </div>
          </div>)}
          {vista==='contratto' && (
        <div style={card}>
          <div style={{...cardH,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <span>Seleziona contratto</span>
            <button onClick={()=>{setVista('dati');setTariffe([]);setSelected(null)}}
              style={{background:'#eef2f7',color:'#334155',border:'1px solid #d7dee8',padding:'6px 14px',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
              Modifica dati Spedizione
            </button>
          </div>
          <div style={cardB}>
            {tariffe.map((r,i)=>{
              const carrier = CARRIER_LABELS[r.carrierCode]||{nome:r.carrierCode.toUpperCase(),colore:'#666'}
              const isSelected = ((selected as any)?._corriere_id && (r as any)?._corriere_id) ? ((selected as any)._corriere_id===(r as any)._corriere_id && selected?.zona===r.zona) : (selected?.carrierCode===r.carrierCode&&selected?.contractCode===r.contractCode&&selected?.zona===r.zona)
              return (
                <div key={i} onClick={()=>setSelected(r)}
                  style={{display:'flex',alignItems:'center',gap:'12px',padding:'12px',border:`2px solid ${isSelected?'#f97316':'#e8e8e8'}`,borderRadius:'8px',marginBottom:'8px',cursor:'pointer',background:isSelected?'#fffbeb':'#fff'}}>
                  {iconaCorriere(r.corriere_nome||r.carrierCode||carrier.nome) ? (
                    <img src={iconaCorriere(r.corriere_nome||r.carrierCode||carrier.nome)!} alt="" style={{width:'56px',height:'34px',objectFit:'contain',border:'1px solid #e8e8e8',borderRadius:'5px',background:'#fff',padding:'2px',flexShrink:0}}/>
                  ) : (
                    <div style={{width:'48px',height:'30px',border:'1px solid #e8e8e8',borderRadius:'5px',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      <span style={{fontSize:'8px',fontWeight:'900',color:carrier.colore,textTransform:'uppercase'}}>{r.carrierCode.toUpperCase()}</span>
                    </div>
                  )}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:'700',color:'#1a1a1a',fontSize:'14px'}}>{r.corriere_nome||carrier.nome}</div>
                    <div style={{fontSize:'11px',color:'#999',marginTop:'1px'}}>{r.peso_fatturato}kg · zona {r.zona}</div>
                  </div>
                  <div style={{fontSize:'18px',fontWeight:'800',color:'#f97316',flexShrink:0}}>€ {r.total_price}</div>
                </div>
              )
            })}

            {selected && (
              <div style={{marginTop:'8px',borderTop:'1px solid #eee',paddingTop:'14px'}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px',marginBottom:'14px'}}>
                  <div>
                    <label style={lbl}>Servizi accessori</label>
                    <input style={inp} placeholder="—" disabled />
                  </div>
                  <div>
                    <label style={lbl}>Modalità di incasso contrassegno</label>
                    <select style={inp} defaultValue="contante"><option value="contante">CONTANTE</option></select>
                  </div>
                </div>
                <div style={{fontSize:'15px',fontWeight:'700',color:'#1a1a1a',marginBottom:'8px'}}>Costi</div>
                <div style={{border:'1px solid #eee',borderRadius:'8px',overflow:'hidden',marginBottom:'14px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',padding:'9px 14px',background:'#fff',fontSize:'13px',color:'#000'}}><span>Costo spedizione</span><span>€ {selected.prezzo_spedizione||selected.total_price}</span></div>
                  {Number(selected.costo_contrassegno||0)>0 && <div style={{display:'flex',justifyContent:'space-between',padding:'9px 14px',fontSize:'13px'}}><span>Costo Contrassegno</span><span>€ {selected.costo_contrassegno}</span></div>}
                  {Number(selected.costo_assicurazione||0)>0 && <div style={{display:'flex',justifyContent:'space-between',padding:'9px 14px',background:'#fafafa',fontSize:'13px'}}><span>Costo Assicurazione</span><span>€ {selected.costo_assicurazione}</span></div>}
                  <div style={{display:'flex',justifyContent:'space-between',padding:'11px 14px',borderTop:'1px solid #eee',fontSize:'14px',fontWeight:'800',color:'#f97316'}}><span>Costo Totale</span><span>€ {selected.total_price}</span></div>
                </div>
                <button onClick={creaSpedizione} disabled={creating}
                  style={{width:'100%',padding:'12px',background:'#1a1a1a',color:'#fff',border:'none',borderRadius:'7px',fontSize:'13.5px',fontWeight:'700',cursor:'pointer',opacity:creating?0.7:1}}>
                  {creating?'Creazione in corso...':'✓ Crea Spedizione — € '+selected.total_price}
                </button>
              </div>
            )}
        </div>
      </div>

      )}
        </div>

    </div>
      </div>
  )
}
