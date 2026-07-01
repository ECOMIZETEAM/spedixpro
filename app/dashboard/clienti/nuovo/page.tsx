'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const inp = {width:'100%',padding:'8px 11px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}
const lbl = {fontSize:'11.5px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}
const sec = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden' as const,marginBottom:'16px'}
const sech = {padding:'12px 16px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700' as const,color:'#1a1a1a'}
const secb = {padding:'16px',display:'flex' as const,flexDirection:'column' as const,gap:'12px'}

const PROVINCE = ['AG','AL','AN','AO','AR','AP','AT','AV','BA','BT','BL','BN','BG','BI','BO','BZ','BS','BR','CA','CL','CB','CI','CE','CT','CZ','CH','CO','CS','CR','KR','CN','EN','FM','FE','FI','FG','FC','FR','GE','GO','GR','IM','IS','SP','AQ','LT','LE','LC','LI','LO','LU','MC','MN','MS','MT','VS','ME','MI','MO','MB','NA','NO','NU','OG','OT','OR','PD','PA','PR','PV','PG','PU','PE','PC','PI','PT','PN','PZ','PO','RG','RA','RC','RE','RI','RN','RO','SA','SS','SV','SI','SR','SO','TA','TE','TR','TO','TP','TN','TV','TS','UD','VA','VE','VB','VC','VR','VV','VI','VT']

export default function NuovoClientePage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [errore, setErrore] = useState('')
  const [listini, setListini] = useState<any[]>([])
  const [form, setForm] = useState({
    ragione_sociale:'',piva:'',cf:'',pec:'',cod_sdi:'',rappresentante_legale:'',telefono:'',
    sl_paese:'Italia',sl_indirizzo:'',sl_citta:'',sl_provincia:'',sl_cap:'',
    so_paese:'Italia',so_indirizzo:'',so_citta:'',so_provincia:'',so_cap:'',
    listino_cliente_id:'',tipo_contratto:'credito_scalare',aliquota_iva:'22',
    fattura_auto:false,metodo_pagamento:'sepa',diritto_fisso:false,agente:'',
    email:'',email_conferma:'',
    ritiro_tipo:'',ritiro_fascia:'',
    rimborso_freq:'giornaliero',rimborso_tipo:'sepa',
    iban:'',abi:'',cab:'',bic_swift:'',note_rimborso:'',
  })

  useEffect(() => {
    fetch('/api/listini/lista').then(r=>r.json()).then(d=>setListini(d||[])).catch(()=>{})
  }, [])

  const set = (k: string, v: any) => setForm(f => ({...f, [k]: v}))

  async function salva() {
    if (!form.ragione_sociale) { setErrore('Ragione sociale obbligatoria'); return }
    if (!form.email) { setErrore('Email obbligatoria'); return }
    if (form.email !== form.email_conferma) { setErrore('Le email non coincidono'); return }
    setSaving(true); setErrore('')
    const res = await fetch('/api/clienti/crea', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(form)
    })
    const data = await res.json()
    setSaving(false)
    if (data.error) { setErrore(data.error); return }
    router.push('/dashboard/clienti?success=1')
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'20px'}}>
        <div>
          <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Nuovo Cliente</h1>
          <p style={{color:'#1a1a1a',fontSize:'13px',marginTop:'4px'}}>Le credenziali di accesso verranno inviate automaticamente via email</p>
        </div>
        <div style={{display:'flex',gap:'10px'}}>
          <a href="/dashboard/clienti" style={{padding:'9px 20px',background:'#f5f5f5',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',fontWeight:'600',color:'#1a1a1a',textDecoration:'none'}}>Annulla</a>
          <button onClick={salva} disabled={saving} style={{padding:'9px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:saving?0.7:1}}>
            {saving?'Salvataggio...':'Salva'}
          </button>
        </div>
      </div>

      {errore && <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#dc2626'}}>⚠️ {errore}</div>}

      <div style={{display:'grid',gridTemplateColumns:'340px 1fr',gap:'20px',alignItems:'start'}}>

        {/* COLONNA SINISTRA */}
        <div>
          <div style={sec}>
            <div style={sech}>Dati Aziendali</div>
            <div style={secb}>
              <div><label style={lbl}>Ragione Sociale *</label><input value={form.ragione_sociale} onChange={e=>set('ragione_sociale',e.target.value)} placeholder="Es. Mario Rossi S.r.l." style={inp}/></div>
              <div><label style={lbl}>P.IVA</label><input value={form.piva} onChange={e=>set('piva',e.target.value)} placeholder="IT12345678901" style={inp}/></div>
              <div><label style={lbl}>Codice Fiscale</label><input value={form.cf} onChange={e=>set('cf',e.target.value)} style={inp}/></div>
              <div><label style={lbl}>PEC</label><input value={form.pec} onChange={e=>set('pec',e.target.value)} placeholder="pec@esempio.it" style={inp}/></div>
              <div><label style={lbl}>Cod Destinatario (fattura elettronica)</label><input value={form.cod_sdi} onChange={e=>set('cod_sdi',e.target.value)} style={inp}/></div>
              <div><label style={lbl}>Rappresentante Legale</label><input value={form.rappresentante_legale} onChange={e=>set('rappresentante_legale',e.target.value)} style={inp}/></div>
            </div>
          </div>

          <div style={sec}>
            <div style={sech}>Contratto</div>
            <div style={secb}>
              <div><label style={lbl}>Listino Prezzo</label>
                <select value={form.listino_cliente_id} onChange={e=>set('listino_cliente_id',e.target.value)} style={inp}>
                  <option value="">— nessun listino —</option>
                  {listini.map((l:any)=><option key={l.id} value={l.id}>{l.nome}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Tipo Contratto</label>
                <select value={form.tipo_contratto} onChange={e=>set('tipo_contratto',e.target.value)} style={inp}>
                  <option value="credito_scalare">Credito a scalare</option>
                  <option value="fattura_mensile">Fattura mensile</option>
                </select>
              </div>
              <div><label style={lbl}>Aliquota IVA</label>
                <select value={form.aliquota_iva} onChange={e=>set('aliquota_iva',e.target.value)} style={inp}>
                  <option value="22">22%</option><option value="10">10%</option><option value="4">4%</option><option value="0">0%</option>
                </select>
              </div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <label style={{...lbl,marginBottom:0}}>Fattura auto</label>
                <button type="button" onClick={()=>set('fattura_auto',!form.fattura_auto)}
                  style={{background:form.fattura_auto?'#f97316':'#e8e8e8',color:form.fattura_auto?'#fff':'#666',border:'none',borderRadius:'20px',padding:'4px 14px',fontSize:'12px',fontWeight:'600',cursor:'pointer',minWidth:'52px'}}>
                  {form.fattura_auto?'ON':'OFF'}
                </button>
              </div>
              <div><label style={lbl}>Metodo pagamento fattura</label>
                <select value={form.metodo_pagamento} onChange={e=>set('metodo_pagamento',e.target.value)} style={inp}>
                  <option value="sepa">sepa</option><option value="bonifico">Bonifico</option><option value="contanti">Contanti</option>
                </select>
              </div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <label style={{...lbl,marginBottom:0}}>Diritto Fisso</label>
                <button type="button" onClick={()=>set('diritto_fisso',!form.diritto_fisso)}
                  style={{background:form.diritto_fisso?'#f97316':'#e8e8e8',color:form.diritto_fisso?'#fff':'#666',border:'none',borderRadius:'20px',padding:'4px 14px',fontSize:'12px',fontWeight:'600',cursor:'pointer',minWidth:'52px'}}>
                  {form.diritto_fisso?'ON':'OFF'}
                </button>
              </div>
              <div><label style={lbl}>Agente</label>
                <select value={form.agente} onChange={e=>set('agente',e.target.value)} style={inp}>
                  <option value="">Seleziona...</option>
                </select>
              </div>
              <div><label style={lbl}>Telefono</label><input value={form.telefono} onChange={e=>set('telefono',e.target.value)} placeholder="+39 000 0000000" style={inp}/></div>
              <div><label style={lbl}>Codice cliente</label><input disabled style={{...inp,background:'#f5f5f5',color:'#1a1a1a'}} placeholder="Generato automaticamente"/></div>
            </div>
          </div>
        </div>

        {/* COLONNA DESTRA */}
        <div>
          <div style={sec}>
            <div style={sech}>Sede Legale (Dati Fatturazione)</div>
            <div style={{padding:'16px',display:'flex',flexDirection:'column',gap:'12px'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 2fr 1fr 1fr',gap:'8px'}}>
                <div><label style={lbl}>Paese</label>
                  <select value={form.sl_paese} onChange={e=>set('sl_paese',e.target.value)} style={inp}>
                    <option>Italia</option><option>Germania</option><option>Francia</option><option>Spagna</option>
                  </select>
                </div>
                <div><label style={lbl}>Indirizzo</label><input value={form.sl_indirizzo} onChange={e=>set('sl_indirizzo',e.target.value)} placeholder="Indirizzo" style={inp}/></div>
                <div><label style={lbl}>Città</label><input value={form.sl_citta} onChange={e=>set('sl_citta',e.target.value)} placeholder="Città" style={inp}/></div>
                <div><label style={lbl}>CAP</label><input value={form.sl_cap} onChange={e=>set('sl_cap',e.target.value)} placeholder="CAP" style={inp}/></div>
              </div>
              <div style={{width:'200px'}}>
                <label style={lbl}>Provincia</label>
                <select value={form.sl_provincia} onChange={e=>set('sl_provincia',e.target.value)} style={inp}>
                  <option value="">Seleziona provincia...</option>
                  {PROVINCE.map(p=><option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div style={sec}>
            <div style={sech}>Sede Operativa (Dati mittente)</div>
            <div style={{padding:'16px',display:'flex',flexDirection:'column',gap:'12px'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 2fr 1fr 1fr',gap:'8px'}}>
                <div><label style={lbl}>Paese</label>
                  <select value={form.so_paese} onChange={e=>set('so_paese',e.target.value)} style={inp}>
                    <option>Italia</option><option>Germania</option><option>Francia</option><option>Spagna</option>
                  </select>
                </div>
                <div><label style={lbl}>Indirizzo</label><input value={form.so_indirizzo} onChange={e=>set('so_indirizzo',e.target.value)} placeholder="Indirizzo" style={inp}/></div>
                <div><label style={lbl}>Città</label><input value={form.so_citta} onChange={e=>set('so_citta',e.target.value)} placeholder="Città" style={inp}/></div>
                <div><label style={lbl}>CAP</label><input value={form.so_cap} onChange={e=>set('so_cap',e.target.value)} placeholder="CAP" style={inp}/></div>
              </div>
              <div style={{width:'200px'}}>
                <label style={lbl}>Provincia</label>
                <select value={form.so_provincia} onChange={e=>set('so_provincia',e.target.value)} style={inp}>
                  <option value="">Seleziona provincia...</option>
                  {PROVINCE.map(p=><option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div style={sec}>
            <div style={sech}>Email Login Cliente</div>
            <div style={{padding:'16px',display:'flex',flexDirection:'column',gap:'12px'}}>
              <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:'6px',padding:'10px 12px',fontSize:'12px',color:'#1d4ed8',lineHeight:1.5}}>
                L&apos;email deve essere un indirizzo email valido. Verrà inviata una email con il link di accesso e la password provvisoria.
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
                <div><label style={lbl}>Email *</label><input value={form.email} onChange={e=>set('email',e.target.value)} type="email" placeholder="Email" style={inp}/></div>
                <div><label style={lbl}>Conferma Email *</label><input value={form.email_conferma} onChange={e=>set('email_conferma',e.target.value)} type="email" placeholder="Conferma Email" style={inp}/></div>
              </div>
            </div>
          </div>

          <div style={sec}>
            <div style={sech}>Ritiro</div>
            <div style={{padding:'16px'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 30px 1fr',gap:'8px',alignItems:'end'}}>
                <div><label style={lbl}>Tipo</label>
                  <select value={form.ritiro_tipo} onChange={e=>set('ritiro_tipo',e.target.value)} style={inp}>
                    <option value="">Seleziona tipo ritiro</option>
                    <option value="mattina">Mattina</option><option value="pomeriggio">Pomeriggio</option><option value="giornata">Giornata intera</option>
                  </select>
                </div>
                <div style={{textAlign:'center',color:'#1a1a1a',paddingBottom:'10px'}}>--</div>
                <div><label style={lbl}>Fascia oraria</label>
                  <select value={form.ritiro_fascia} onChange={e=>set('ritiro_fascia',e.target.value)} style={inp}>
                    <option value="">Seleziona fascia oraria</option>
                    <option value="8-12">08:00 - 12:00</option><option value="12-18">12:00 - 18:00</option><option value="8-18">08:00 - 18:00</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div style={sec}>
            <div style={sech}>Rimborso contrassegni</div>
            <div style={{padding:'16px',display:'flex',flexDirection:'column',gap:'12px'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 30px 1fr',gap:'8px',alignItems:'end'}}>
                <div><label style={lbl}>Rimborso</label>
                  <select value={form.rimborso_freq} onChange={e=>set('rimborso_freq',e.target.value)} style={inp}>
                    <option value="giornaliero">Giornaliero</option><option value="settimanale">Settimanale</option><option value="mensile">Mensile</option>
                  </select>
                </div>
                <div style={{textAlign:'center',color:'#1a1a1a',paddingBottom:'10px'}}>--</div>
                <div></div>
              </div>
              <div>
                <label style={lbl}>Tipo pagamento</label>
                <div style={{display:'flex',gap:'16px',marginTop:'4px'}}>
                  <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'13px',cursor:'pointer'}}>
                    <input type="checkbox" checked={form.rimborso_tipo==='sepa'} onChange={()=>set('rimborso_tipo','sepa')}/> SEPA
                  </label>
                  <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'13px',cursor:'pointer'}}>
                    <input type="checkbox" checked={form.rimborso_tipo==='contanti'} onChange={()=>set('rimborso_tipo','contanti')}/> Contanti
                  </label>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',gap:'8px'}}>
                <div><label style={lbl}>IBAN</label><input value={form.iban} onChange={e=>set('iban',e.target.value)} style={inp}/></div>
                <div><label style={lbl}>ABI</label><input value={form.abi} onChange={e=>set('abi',e.target.value)} style={inp}/></div>
                <div><label style={lbl}>CAB</label><input value={form.cab} onChange={e=>set('cab',e.target.value)} style={inp}/></div>
                <div><label style={lbl}>BIC/SWIFT</label><input value={form.bic_swift} onChange={e=>set('bic_swift',e.target.value)} style={inp}/></div>
              </div>
              <div><label style={lbl}>Note rimborso contrassegni</label>
                <textarea value={form.note_rimborso} onChange={e=>set('note_rimborso',e.target.value)} rows={2} style={{...inp,resize:'vertical' as const}}/>
              </div>
              <div style={{fontSize:'11px',color:'#1a1a1a'}}>* Le informazioni saranno stampate sulle distinte di pagamento per i contrassegni.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
