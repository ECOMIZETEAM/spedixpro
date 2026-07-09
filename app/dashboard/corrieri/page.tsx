'use client'
import { useState, useEffect } from 'react'

const DISPONIBILI = [
  {tipo:'gls',nome:'GLS',icona:'gls'},
  {tipo:'sda',nome:'SDA Express',icona:'sda'},
  {tipo:'generico',nome:'Nexive',icona:'nexive'},
  {tipo:'spedisci',nome:'Spedisci.online',icona:'spedisci'},
  {tipo:'poste',nome:'Poste Italiane',icona:'poste_pt'},
  {tipo:'generico',nome:'TNT',icona:'tnt'},
  {tipo:'dhl',nome:'DHL Express',icona:'dhl'},
  {tipo:'generico',nome:'Hermes',icona:'hermes'},
  {tipo:'generico',nome:'Liccardi',icona:'liccardi'},
  {tipo:'generico',nome:'SailPost',icona:'sailpost'},
  {tipo:'generico',nome:'BDM',icona:'bdm'},
  {tipo:'generico',nome:'NSSA',icona:'nssa'},
  {tipo:'brt',nome:'BRT',icona:'brt'},
  {tipo:'poste',nome:'Poste Delivery Business',icona:'poste_delivery_business'},
  {tipo:'generico',nome:'GTech Group',icona:'gtechgroup'},
  {tipo:'generico',nome:'HR Parcel',icona:'hrp'},
  {tipo:'generico',nome:'FedEx',icona:'fedex'},
  {tipo:'generico',nome:'Palletways',icona:'palletways'},
  {tipo:'generico',nome:'Correos Express',icona:'correos_express'},
  {tipo:'generico',nome:'InPost',icona:'inpost'},
  {tipo:'generico',nome:'Spring',icona:'spring'},
  {tipo:'generico',nome:'Paack',icona:'paack'},
  {tipo:'generico',nome:'Speedy',icona:'speedy'},
  {tipo:'generico',nome:'Amazon Shipping',icona:'amazon_shipping'},
  {tipo:'generico',nome:'Correos',icona:'correos'},
  {tipo:'generico',nome:'DHL eConnect',icona:'dhl_econnect'},
  {tipo:'generico',nome:'UPS',icona:'ups'},
  {tipo:'generico',nome:'ALT',icona:'alt'},
  {tipo:'generico',nome:'CTT Express',icona:'ctt_express'},
  {tipo:'generico',nome:'AiPack',icona:'aipack'},
]

function iconaCorriere(nome){
  const n = (nome||'').toUpperCase()
  const regole = [
    ['DELIVERY BUSINESS','poste_delivery_business'],['POSTE','poste_delivery_business'],
    ['SDA','sda'],['GLS','gls'],['BRT','brt'],['SPEDISCI','spedisci'],['TNT','tnt'],
    ['DHL ECONNECT','dhl_econnect'],['ECONNECT','dhl_econnect'],['DHL','dhl'],
    ['FEDEX','fedex'],['UPS','ups'],['HERMES','hermes'],['NEXIVE','nexive'],
    ['LICCARDI','liccardi'],['SAILPOST','sailpost'],['BDM','bdm'],['NSSA','nssa'],
    ['HR PARCEL','hrp'],['HRP','hrp'],['PALLETWAYS','palletways'],
    ['CORREOS EXPRESS','correos_express'],['CORREOS','correos'],
    ['INPOST','inpost'],['SPRING','spring'],['PAACK','paack'],['SPEEDY','speedy'],
    ['AMAZON','amazon_shipping'],['CTT','ctt_express'],['AIPACK','aipack'],['GTECH','gtechgroup'],
  ]
  for (const [k,file] of regole) { if (n.includes(k)) return '/corrieri/'+file+'.png' }
  return null
}

export default function CorrieriPage() {
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [confermaElimina, setConfermaElimina] = useState<string | null>(null)
  const [eliminando, setEliminando] = useState(false)
  const [popup, setPopup] = useState<any>(null)
  const [salvandoPopup, setSalvandoPopup] = useState(false)

  useEffect(() => {
    fetch('/api/corrieri/lista').then(r => r.json()).then(d => {
      setCorrieri(Array.isArray(d) ? d : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  async function toggleAttivo(id: string, attivoAttuale: boolean) {
    setCorrieri(prev => prev.map(c => c.id === id ? { ...c, attivo: !attivoAttuale } : c))
    await fetch('/api/corrieri/'+id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attivo: !attivoAttuale })
    })
  }

  async function confermaEliminazione() {
    if (!confermaElimina) return
    setEliminando(true)
    const res = await fetch('/api/corrieri/'+confermaElimina, { method: 'DELETE' })
    setEliminando(false)
    if (res.ok) {
      setCorrieri(prev => prev.filter(c => c.id !== confermaElimina))
      setConfermaElimina(null)
    }
  }

  function apriImpostazioni(c:any) {
    setPopup({
      id: c.id, nome_contratto: c.nome_contratto,
      multicollo: c.multicollo !== false,
      inserimento_ritiri: c.inserimento_ritiri !== false,
      mittente: (c.settings && c.settings.mittente) || 'cliente',
      agevolazione_peso_reale: !!(c.settings && c.settings.agevolazione_peso_reale),
      peso_reale_soglia_on: !!(c.settings?.peso_reale_soglia?.attivo),
      peso_reale_soglia_kg: (c.settings?.peso_reale_soglia?.kg ?? 5) || 5,
      // Misure massime a scaglioni di peso (sul PESO REALE, non volumetrico)
      misura_soglia: (c.settings?.misure_scaglioni?.soglia_kg ?? '') || '',
      sotto_l: (c.settings?.misure_scaglioni?.sotto?.lunghezza ?? c.settings?.misure_max?.lunghezza) || '',
      sotto_w: (c.settings?.misure_scaglioni?.sotto?.larghezza ?? c.settings?.misure_max?.larghezza) || '',
      sotto_h: (c.settings?.misure_scaglioni?.sotto?.altezza ?? c.settings?.misure_max?.altezza) || '',
      sopra_l: (c.settings?.misure_scaglioni?.sopra?.lunghezza) || '',
      sopra_w: (c.settings?.misure_scaglioni?.sopra?.larghezza) || '',
      sopra_h: (c.settings?.misure_scaglioni?.sopra?.altezza) || '',
    })
  }

  async function salvaImpostazioni() {
    if (!popup) return
    setSalvandoPopup(true)
    const scaglioni = {
      soglia_kg: popup.misura_soglia !== '' ? Number(popup.misura_soglia) : null,
      sotto: { lunghezza: popup.sotto_l||null, larghezza: popup.sotto_w||null, altezza: popup.sotto_h||null },
      sopra: { lunghezza: popup.sopra_l||null, larghezza: popup.sopra_w||null, altezza: popup.sopra_h||null },
    }
    // misure_max (legacy) = tier "sotto" come default per i lettori vecchi
    const misureMax = { lunghezza: popup.sotto_l||null, larghezza: popup.sotto_w||null, altezza: popup.sotto_h||null }
    const pesoRealeSoglia = { attivo: !!popup.peso_reale_soglia_on, kg: Number(popup.peso_reale_soglia_kg) || 5 }
    const nuoviSettings = (base:any) => ({ ...(base||{}), mittente: popup.mittente, agevolazione_peso_reale: popup.agevolazione_peso_reale, misure_max: misureMax, misure_scaglioni: scaglioni, peso_reale_soglia: pesoRealeSoglia })
    await fetch('/api/corrieri/'+popup.id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        multicollo: popup.multicollo,
        inserimento_ritiri: popup.inserimento_ritiri,
        settings: nuoviSettings(null),
      })
    })
    setCorrieri(prev => prev.map(c => c.id === popup.id ? { ...c, multicollo: popup.multicollo, inserimento_ritiri: popup.inserimento_ritiri, settings: nuoviSettings(c.settings) } : c))
    setSalvandoPopup(false)
    setPopup(null)
  }

  const selStyle = {width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Corrieri</h1>
        <p style={{color:'#1a1a1a',fontSize:'13px',marginTop:'4px'}}>{corrieri.length} contratti configurati</p>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px',alignItems:'start'}}>
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'13.5px',fontWeight:'600',color:'#1a1a1a'}}>Contratti Configurati</div>
          {loading ? (
            <div style={{padding:'30px',textAlign:'center',color:'#1a1a1a',fontSize:'13px'}}>Caricamento...</div>
          ) : !corrieri.length ? (
            <div style={{padding:'30px',textAlign:'center',color:'#1a1a1a',fontSize:'13px'}}>Nessun contratto — aggiungine uno</div>
          ) : corrieri.map(c => (
            <div key={c.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 18px',borderBottom:'1px solid #f5f5f5',gap:'10px'}}>
              <div style={{display:'flex',alignItems:'center',gap:'12px',flex:1,minWidth:0}}>
                {iconaCorriere(c.nome_contratto) ? (
                  <img src={iconaCorriere(c.nome_contratto)!} alt="" style={{width:'96px',height:'58px',objectFit:'contain',border:'1px solid #eee',borderRadius:'6px',background:'#fff',flexShrink:0}}/>
                ) : (
                  <div style={{width:'96px',height:'58px',background:'#f5f5f5',border:'1px solid #e8e8e8',borderRadius:'6px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'700',color:'#333',textTransform:'uppercase',flexShrink:0}}>{['spediamopro','spedisci','generico'].includes(c.tipo) ? (c.nome_contratto||'').slice(0,6) : c.tipo}</div>
                )}
                <div style={{minWidth:0}}>
                  <div style={{fontSize:'13px',fontWeight:'600',color:'#1a1a1a'}}>{c.nome_contratto}</div>
                  <div style={{display:'flex',alignItems:'center',gap:'6px',marginTop:'4px'}}>
                    <span style={{background:c.attivo?'#f0fdf4':'#fef2f2',color:c.attivo?'#16a34a':'#dc2626',padding:'2px 9px',borderRadius:'20px',fontSize:'11px',fontWeight:'700'}}>{c.attivo?'Attivo':'In pausa'}</span>
                    <span style={{background:'#fff7ed',color:'#f97316',padding:'2px 8px',borderRadius:'20px',fontSize:'11px',fontWeight:'700'}}>L{c.livello}</span>
                  </div>
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:'6px',flexShrink:0}}>
                <button onClick={() => toggleAttivo(c.id, c.attivo)}
                  style={{background:c.attivo?'#fef2f2':'#f0fdf4',color:c.attivo?'#dc2626':'#16a34a',padding:'5px 10px',borderRadius:'6px',fontSize:'11px',fontWeight:'600',border:'none',cursor:'pointer'}}>
                  {c.attivo?'|| In pausa':'▶ Riattiva'}
                </button>
                <button onClick={() => apriImpostazioni(c)} title="Impostazioni"
                  style={{padding:'5px 10px',background:'#fff7ed',color:'#f97316',borderRadius:'6px',fontSize:'11px',border:'1px solid #fed7aa',cursor:'pointer'}}>⚙ Impostazioni</button>
                <button onClick={() => setConfermaElimina(c.id)} title="Elimina"
                  style={{padding:'5px 9px',background:'#fef2f2',color:'#dc2626',borderRadius:'6px',fontSize:'11px',border:'1px solid #fecaca',cursor:'pointer'}}>Elimina</button>
              </div>
            </div>
          ))}
        </div>

        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'13.5px',fontWeight:'600',color:'#1a1a1a'}}>Aggiungi Corriere</div>
          <div style={{padding:'16px',display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px'}}>
            {DISPONIBILI.map((c,i) => (
              <a key={i} href={'/dashboard/corrieri/aggiungi?tipo='+c.tipo}
                style={{border:'1px solid #e8e8e8',borderRadius:'8px',textDecoration:'none',display:'block',overflow:'hidden',background:'#fff'}}>
                <img src={'/corrieri/'+c.icona+'.png'} alt={c.nome} style={{width:'100%',height:'90px',objectFit:'contain',display:'block'}}/>
              </a>
            ))}
          </div>
        </div>
      </div>

      {popup && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'20px'}}>
          <div style={{background:'#fff',borderRadius:'12px',width:'100%',maxWidth:'560px',overflow:'hidden'}}>
            <div style={{display:'flex',alignItems:'center',gap:'12px',padding:'18px 22px',borderBottom:'1px solid #f0f0f0'}}>
              {iconaCorriere(popup.nome_contratto) && <img src={iconaCorriere(popup.nome_contratto)!} alt="" style={{width:'54px',height:'32px',objectFit:'contain'}}/>}
              <div style={{fontSize:'15px',fontWeight:'700',color:'#1a1a1a'}}>{popup.nome_contratto} — Impostazioni</div>
            </div>
            <div style={{padding:'22px'}}>
              <div style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px'}}>Agevolazione peso</div><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'16px',marginBottom:'14px'}}><label style={{fontSize:'13px',fontWeight:'600',color:'#1a1a1a'}}>Agevolazione peso reale (&le; 50&times;28&times;32 cm)</label><select value={popup.agevolazione_peso_reale?'si':'no'} onChange={e=>setPopup({...popup,agevolazione_peso_reale:e.target.value==='si'})} style={{...selStyle,maxWidth:'260px'}}><option value="no">No</option><option value="si">Si</option></select></div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'16px',marginBottom:'6px'}}>
                <label style={{fontSize:'13px',fontWeight:'600',color:'#1a1a1a'}}>Peso reale fino a
                  <input type="number" value={popup.peso_reale_soglia_kg||''} onChange={e=>setPopup({...popup,peso_reale_soglia_kg:e.target.value})} style={{...selStyle,width:'70px',display:'inline-block',margin:'0 6px',padding:'4px 8px'}}/> kg
                </label>
                <select value={popup.peso_reale_soglia_on?'si':'no'} onChange={e=>setPopup({...popup,peso_reale_soglia_on:e.target.value==='si'})} style={{...selStyle,maxWidth:'120px'}}><option value="no">No</option><option value="si">Si</option></select>
              </div>
              <div style={{fontSize:'11.5px',color:'#888',marginBottom:'14px'}}>Se attivo: fino a quel peso reale si tassa sul <b>peso reale</b> (niente volumetrico); oltre, torna al peso volumetrico. Vale per il master e i suoi clienti.</div>
              <div style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a',margin:'14px 0 4px'}}>Misure massime per peso (cm)</div>
              <div style={{fontSize:'11.5px',color:'#888',marginBottom:'12px'}}>Limiti diversi in base al <b>peso reale</b> dichiarato dal cliente (non il volumetrico). Una spedizione oltre i limiti del suo scaglione non mostrerà questo corriere. Lascia vuoto per nessun limite.</div>
              <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'14px'}}>
                <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a'}}>Soglia di peso</label>
                <input type="number" value={popup.misura_soglia||''} onChange={e=>setPopup({...popup,misura_soglia:e.target.value})} placeholder="es. 30" style={{...selStyle,width:'110px'}}/>
                <span style={{fontSize:'12px',color:'#666'}}>kg</span>
              </div>
              <div style={{fontSize:'12px',fontWeight:'700',color:'#f97316',marginBottom:'8px'}}>Sotto la soglia (peso ≤ {popup.misura_soglia||'…'} kg)</div>
              <div style={{display:'flex',gap:'10px',marginBottom:'14px'}}>
                <div style={{flex:1}}><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a'}}>Lunghezza</label><input type="number" value={popup.sotto_l||''} onChange={e=>setPopup({...popup,sotto_l:e.target.value})} style={{...selStyle,width:'100%'}}/></div>
                <div style={{flex:1}}><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a'}}>Larghezza</label><input type="number" value={popup.sotto_w||''} onChange={e=>setPopup({...popup,sotto_w:e.target.value})} style={{...selStyle,width:'100%'}}/></div>
                <div style={{flex:1}}><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a'}}>Altezza</label><input type="number" value={popup.sotto_h||''} onChange={e=>setPopup({...popup,sotto_h:e.target.value})} style={{...selStyle,width:'100%'}}/></div>
              </div>
              <div style={{fontSize:'12px',fontWeight:'700',color:'#f97316',marginBottom:'8px'}}>Sopra la soglia (peso &gt; {popup.misura_soglia||'…'} kg)</div>
              <div style={{display:'flex',gap:'10px',marginBottom:'14px'}}>
                <div style={{flex:1}}><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a'}}>Lunghezza</label><input type="number" value={popup.sopra_l||''} onChange={e=>setPopup({...popup,sopra_l:e.target.value})} style={{...selStyle,width:'100%'}}/></div>
                <div style={{flex:1}}><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a'}}>Larghezza</label><input type="number" value={popup.sopra_w||''} onChange={e=>setPopup({...popup,sopra_w:e.target.value})} style={{...selStyle,width:'100%'}}/></div>
                <div style={{flex:1}}><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a'}}>Altezza</label><input type="number" value={popup.sopra_h||''} onChange={e=>setPopup({...popup,sopra_h:e.target.value})} style={{...selStyle,width:'100%'}}/></div>
              </div><div style={{borderTop:'1px solid #eee',margin:'4px 0 18px'}}></div><div style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px'}}>Impostazioni Generale</div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'16px',marginBottom:'14px'}}>
                <label style={{fontSize:'13px',fontWeight:'600',color:'#1a1a1a'}}>Multicollo</label>
                <select value={popup.multicollo?'si':'no'} onChange={e=>setPopup({...popup,multicollo:e.target.value==='si'})} style={{...selStyle,maxWidth:'260px'}}>
                  <option value="si">Si</option><option value="no">No</option>
                </select>
              </div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'16px',marginBottom:'20px'}}>
                <label style={{fontSize:'13px',fontWeight:'600',color:'#1a1a1a'}}>Inserimento ritiri</label>
                <select value={popup.inserimento_ritiri?'si':'no'} onChange={e=>setPopup({...popup,inserimento_ritiri:e.target.value==='si'})} style={{...selStyle,maxWidth:'260px'}}>
                  <option value="si">Si</option><option value="no">No</option>
                </select>
              </div>
              <div style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a',margin:'20px 0 14px',paddingTop:'16px',borderTop:'1px solid #f0f0f0'}}>Mittente predefinito</div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'16px'}}>
                <label style={{fontSize:'13px',fontWeight:'600',color:'#1a1a1a'}}>Dati mittente</label>
                <select value={popup.mittente} onChange={e=>setPopup({...popup,mittente:e.target.value})} style={{...selStyle,maxWidth:'260px'}}>
                  <option value="cliente">Cliente</option>
                  <option value="azienda">Azienda (fisso)</option>
                </select>
              </div>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',padding:'16px 22px',borderTop:'1px solid #f0f0f0'}}>
              <button onClick={()=>setPopup(null)} style={{padding:'9px 20px',background:'#f5f5f5',border:'1px solid #e8e8e8',borderRadius:'8px',fontSize:'13px',fontWeight:'600',color:'#1a1a1a',cursor:'pointer'}}>Chiudi</button>
              <button onClick={salvaImpostazioni} disabled={salvandoPopup} style={{padding:'9px 22px',background:'#f97316',color:'#fff',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:salvandoPopup?0.7:1}}>{salvandoPopup?'Salvataggio...':'Salva'}</button>
            </div>
          </div>
        </div>
      )}

      {confermaElimina && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
          <div style={{background:'#fff',borderRadius:'10px',padding:'28px',maxWidth:'380px',textAlign:'center'}}>
            <div style={{fontSize:'32px',marginBottom:'12px'}}>!</div>
            <div style={{fontSize:'15px',fontWeight:'700',color:'#1a1a1a',marginBottom:'8px'}}>Sei sicuro di voler eliminare?</div>
            <div style={{fontSize:'13px',color:'#666',marginBottom:'20px'}}>Tutti i dati di questo contratto andranno persi. Questa azione non e reversibile.</div>
            <div style={{display:'flex',gap:'10px',justifyContent:'center'}}>
              <button onClick={() => setConfermaElimina(null)} disabled={eliminando} style={{padding:'9px 20px',background:'#f5f5f5',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',fontWeight:'600',color:'#1a1a1a',cursor:'pointer'}}>Annulla</button>
              <button onClick={confermaEliminazione} disabled={eliminando} style={{padding:'9px 20px',background:'#dc2626',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',color:'#fff',cursor:'pointer',opacity:eliminando?0.7:1}}>{eliminando?'Eliminazione...':'Si, elimina'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}