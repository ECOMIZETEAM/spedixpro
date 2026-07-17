'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden' as const}
const cardHead = {padding:'14px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'14px',fontWeight:'700' as const,color:'#1a1a1a'}
const sel = {padding:'7px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',minWidth:'80px'}
const selSmall = {padding:'6px 10px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'12.5px',color:'#1a1a1a',background:'#fff',width:'100%',boxSizing:'border-box' as const}
const selWide = {padding:'8px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',minWidth:'340px',boxSizing:'border-box' as const}
const inpWide = {padding:'8px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',minWidth:'340px',boxSizing:'border-box' as const}
const rowFull = {display:'flex',alignItems:'center',justifyContent:'space-between',gap:'16px',padding:'13px 18px',borderBottom:'1px solid #f5f5f5'}
const lblStrong = {fontSize:'13px',fontWeight:'700' as const,color:'#1a1a1a'}

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
    ['GTECH','gtechgroup'],
  ]
  for (const [chiave,file] of regole) { if (n.includes(chiave)) return `/corrieri/${file}.png` }
  return null
}

const ADMIN_FIELDS = [
  {key:'attivo', label:'Account Attivo', desc:'Attiva / Disattiva profilo cliente.'},
  {key:'prezzi_in_distinta', label:'Prezzi in distinta', desc:'Visualizza / Nascondi i prezzi nella distinta di spedizione PDF.'},
  {key:'visualizza_fatture', label:'Visualizza fatture', desc:'Visualizza / Nascondi la sezione Fatture.'},
  {key:'vieta_inserimento', label:'Vieta inserimento Spedizione', desc:'Se attivo, il cliente NON puo creare spedizioni.'},
]

const DEF_SETT: Record<string,string> = { contrassegno:'si', inserimento_ritiri:'predefinito', autogenera_distinta:'predefinito', formato_stampa:'A4' }
const CAMPI_CONTRATTO: {key:string,label:string,opts:[string,string][]}[] = [
  {key:'contrassegno', label:'Contrassegno', opts:[['si','Si'],['no','No']]},
  {key:'inserimento_ritiri', label:'Inserimento ritiri', opts:[['predefinito','Predefinito'],['si','Si'],['no','No']]},
  {key:'autogenera_distinta', label:'Autogenera distinta gg', opts:[['predefinito','Predefinito'],['si','Si'],['no','No']]},
]

const DEF_IMP: Record<string,any> = {
  pdf_visualizzazione:'acrobat', stampa_riepilogo:'no', stampa_barcode:'no',
  nascondi_prezzi:false, ordina_stampe:'default', spedizioni_multiple:false,
  soglia_credito:30, zpl_abilita:'no', zpl_stampante:'',
  notifica_email_dest:true, email_giacenze:'si', notifica_sms:false,
  testo_sms:'Gentile Cliente, la spedizione {numero-spedizione} e stata creata. Segui il tracking sul sito del corriere {sito-corriere}.',
  peso_minimo:1,
}

function Toggle({on, onToggle}:{on:boolean,onToggle:()=>void}) {
  return (
    <button onClick={onToggle} style={{display:'inline-flex',alignItems:'center',justifyContent:on?'flex-start':'flex-end',width:'58px',height:'26px',borderRadius:'13px',border:'none',cursor:'pointer',background:on?'#f97316':'#e5e7eb',padding:'0 8px',color:on?'#fff':'#6b7280',fontSize:'10px',fontWeight:'700'}}>
      {on?'ON':'OFF'}
    </button>
  )
}

function formatiPerCorriere(nome:string): [string,string][] {
  const n = (nome||'').toUpperCase()
  if (n.includes('SDA')) return [['A4','A4'],['A6','A6'],['ZPL','ZPL']]
  if (n.includes('DELIVERY BUSINESS') || n.includes('POSTE')) return [['A4','A4'],['10x11','10x11'],['ZPL','ZPL']]
  if (n.includes('BRT')) return [['A4','A4'],['A6','A6'],['ZPL','ZPL']]
  if (n.includes('GLS')) return [['A4','A4'],['A6','A6'],['ZPL','ZPL']]
  if (n.includes('DHL')) return [['A4','A4'],['10x15','10x15'],['ZPL','ZPL']]
  if (n.includes('SPEDIAMO') || n.includes('SPEDISCI')) return [['A4','A4'],['A6','A6'],['ZPL','ZPL']]
  return [['A4','A4'],['A6','A6']]
}
export default function ImpostazioniClientePage() {
  const id = ''
  const [cliente, setCliente] = useState<any>(null)
  const [contratti, setContratti] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    fetch('/api/cliente/dati').then(r=>r.json()).then(d => { setCliente(d); setLoading(false) })
    fetch('/api/cliente/corrieri-abilitati').then(r=>r.json()).then(d => setContratti(Array.isArray(d)?d:[]))
  }, [id])

  function setAdmin(key:string, value:boolean) { setCliente((prev:any) => ({ ...prev, [key]: value })) }

  const imp = (k:string) => (cliente?.impostazioni && cliente.impostazioni[k] !== undefined) ? cliente.impostazioni[k] : DEF_IMP[k]
  function setImp(k:string, v:any) {
    setCliente((prev:any) => ({ ...prev, impostazioni: { ...DEF_IMP, ...((prev && prev.impostazioni)||{}), [k]: v } }))
  }

  async function salvaAdmin() {
    setSaving(true); setMsg('')
    const res = await fetch('/api/cliente/dati', {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ...cliente, impostazioni: { ...DEF_IMP, ...((cliente && cliente.impostazioni)||{}) } })
    })
    const data = await res.json()
    setSaving(false)
    if (data.error) { setMsg('Errore: '+data.error); return }
    setMsg('Impostazioni salvate!')
    setTimeout(()=>setMsg(''), 3000)
  }

  async function toggleContratto(corriereId:string, abilitato:boolean) {
    setContratti(prev => prev.map(c => c.id===corriereId ? {...c, abilitato} : c))
    await fetch('/api/cliente/corrieri-abilitati', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ corriereId, abilitato })
    })
  }

  async function setContrattoSetting(corriereId:string, key:string, value:string) {
    const contratto = contratti.find(c => c.id === corriereId)
    const s = { ...DEF_SETT, ...((contratto && contratto.settings)||{}), [key]: value }
    setContratti(prev => prev.map(c => c.id===corriereId ? {...c, settings:s} : c))
    await fetch('/api/cliente/corrieri-abilitati', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ corriereId, settings: s })
    })
  }

  const gSet = (c:any, k:string) => (c.settings && c.settings[k] !== undefined) ? c.settings[k] : DEF_SETT[k]

  if (loading) return <div style={{padding:'40px',textAlign:'center',color:'#1a1a1a'}}>Caricamento...</div>
  if (!cliente || cliente.error) return <div style={{padding:'40px',textAlign:'center',color:'#dc2626'}}>Cliente non trovato</div>

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <a href={'/cliente/dashboard'} style={{fontSize:'12px',color:'#f97316',textDecoration:'none'}}>{'<'} {cliente.ragione_sociale}</a>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:'4px 0 0'}}>Impostazioni</h1>
      </div>

      {msg && <div style={{background:msg.startsWith('Errore')?'#fef2f2':'#f0fdf4',border:`1px solid ${msg.startsWith('Errore')?'#fecaca':'#bbf7d0'}`,borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:msg.startsWith('Errore')?'#dc2626':'#15803d'}}>{msg}</div>}

      <div style={{marginTop:'20px',display:'flex',flexDirection:'column',gap:'20px'}}>

        <div style={card}>
          <div style={cardHead}>PDF</div>
          <div style={rowFull}><span style={lblStrong}>Visualizzazione del PDF</span>
            <select value={imp('pdf_visualizzazione')} onChange={e=>setImp('pdf_visualizzazione',e.target.value)} style={selWide}>
              <option value="acrobat">Sul PC con Acrobat Reader</option>
              <option value="browser">Nel browser</option>
            </select></div>
          <div style={rowFull}><span style={lblStrong}>Stampa riepilogo ordine</span>
            <select value={imp('stampa_riepilogo')} onChange={e=>setImp('stampa_riepilogo',e.target.value)} style={selWide}>
              <option value="no">No</option><option value="si">Si</option>
            </select></div>
          <div style={rowFull}><span style={lblStrong}>Stampa Barcode SKU/QrCode</span>
            <select value={imp('stampa_barcode')} onChange={e=>setImp('stampa_barcode',e.target.value)} style={selWide}>
              <option value="no">No</option><option value="si">Si</option>
            </select></div>
          <div style={rowFull}><span style={lblStrong}>Nascondere i prezzi prodotti</span>
            <Toggle on={imp('nascondi_prezzi')===true} onToggle={()=>setImp('nascondi_prezzi', !(imp('nascondi_prezzi')===true))} /></div>
          <div style={rowFull}><span style={lblStrong}>Ordina stampe multiple</span>
            <select value={imp('ordina_stampe')} onChange={e=>setImp('ordina_stampe',e.target.value)} style={selWide}>
              <option value="default">Default (nel ordine della colonna selezionata)</option>
              <option value="peso">Per peso</option>
              <option value="destinatario">Per destinatario</option>
            </select></div>
          <div style={{...rowFull,borderBottom:'none'}}><span style={lblStrong}>Spedizioni multiple per stesso ordine</span>
            <Toggle on={imp('spedizioni_multiple')===true} onToggle={()=>setImp('spedizioni_multiple', !(imp('spedizioni_multiple')===true))} /></div>
        </div>

        <div style={card}>
          <div style={cardHead}>Configura Avviso di Credito</div>
          <div style={{...rowFull,borderBottom:'none'}}>
            <div><div style={lblStrong}>Soglia di Avviso Credito</div>
              <div style={{fontSize:'11.5px',color:'#888',marginTop:'2px'}}>Valore al quale il cliente viene avvisato che il credito sta per esaurirsi.</div></div>
            <input type="number" value={imp('soglia_credito')} onChange={e=>setImp('soglia_credito', e.target.value===''?'':Number(e.target.value))} style={inpWide} />
          </div>
        </div>

        <div style={card}>
          <div style={cardHead}>Stampa ZPL</div>
          <div style={rowFull}><span style={lblStrong}>Abilita la stampa ZPL</span>
            <select value={imp('zpl_abilita')} onChange={e=>setImp('zpl_abilita',e.target.value)} style={selWide}>
              <option value="no">No</option><option value="si">Si</option>
            </select></div>
          <div style={{...rowFull,borderBottom:'none'}}><span style={lblStrong}>Stampante Zebra predefinita</span>
            <input type="text" value={imp('zpl_stampante')} onChange={e=>setImp('zpl_stampante',e.target.value)} placeholder="Nome stampante" style={inpWide} /></div>
        </div>

        <div style={card}>
          <div style={cardHead}>Notifiche email & sms</div>
          <div style={rowFull}><span style={lblStrong}>Attiva notifica email destinatario</span>
            <Toggle on={imp('notifica_email_dest')===true} onToggle={()=>setImp('notifica_email_dest', !(imp('notifica_email_dest')===true))} /></div>
          <div style={rowFull}><span style={lblStrong}>Abilita email di notifica giacenze</span>
            <select value={imp('email_giacenze')} onChange={e=>setImp('email_giacenze',e.target.value)} style={selWide}>
              <option value="si">Si</option><option value="no">No</option>
            </select></div>
          <div style={rowFull}><span style={lblStrong}>Attiva notifica SMS</span>
            <Toggle on={imp('notifica_sms')===true} onToggle={()=>setImp('notifica_sms', !(imp('notifica_sms')===true))} /></div>
          <div style={{padding:'13px 18px'}}>
            <div style={{...lblStrong,marginBottom:'8px'}}>Testo sms</div>
            <textarea value={imp('testo_sms')} onChange={e=>setImp('testo_sms',e.target.value)} rows={4}
              style={{width:'100%',padding:'10px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',boxSizing:'border-box',resize:'vertical'}} />
            <div style={{fontSize:'11.5px',color:'#888',marginTop:'6px'}}>Variabili disponibili: {'{numero-spedizione}'} e {'{sito-corriere}'}. Max 160 caratteri.</div>
          </div>
        </div>

        <div style={card}>
          <div style={cardHead}>Peso minimo predefinito</div>
          <div style={{...rowFull,borderBottom:'none'}}><span style={lblStrong}>Peso minimo (kg)</span>
            <input type="number" step="0.1" value={imp('peso_minimo')} onChange={e=>setImp('peso_minimo', e.target.value===''?'':Number(e.target.value))} style={inpWide} /></div>
        </div>

        <div style={card}>
          <div style={cardHead}>Formato di stampa per contratto</div>
          {contratti.filter(c=>c.abilitato).length===0 ? (
            <div style={{padding:'24px',textAlign:'center',color:'#999',fontSize:'13px'}}>Nessun contratto attivo</div>
          ) : contratti.filter(c=>c.abilitato).map(c => (
            <div key={c.id} style={rowFull}>
              <span style={{display:'flex',alignItems:'center',gap:'12px'}}>
                {iconaCorriere(c.nome_contratto) ? (
                  <img src={iconaCorriere(c.nome_contratto)!} alt="" style={{width:'64px',height:'40px',objectFit:'contain',border:'1px solid #eee',borderRadius:'6px',background:'#fff',padding:'3px'}} />
                ) : (
                  <span style={{width:'64px',height:'40px',borderRadius:'6px',background:'#f0f0f0',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:'11px',color:'#999'}}>-</span>
                )}
                <span style={lblStrong}>{c.nome_contratto}</span>
              </span>
              <select value={gSet(c,'formato_stampa')} onChange={e=>setContrattoSetting(c.id,'formato_stampa',e.target.value)} style={selWide}>
                {formatiPerCorriere(c.nome_contratto).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div style={{display:'flex',justifyContent:'flex-end'}}>
          <button onClick={salvaAdmin} disabled={saving}
            style={{background:'#f97316',color:'#fff',border:'none',padding:'12px 32px',borderRadius:'6px',fontSize:'14px',fontWeight:'700',cursor:'pointer',opacity:saving?0.7:1}}>
            {saving?'Salvataggio...':'Salva Impostazioni'}
          </button>
        </div>

      </div>
    </div>
  )
}