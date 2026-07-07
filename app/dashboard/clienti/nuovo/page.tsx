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
  const [credenziali, setCredenziali] = useState<any>(null)
  const [staffList, setStaffList] = useState<any[]>([])
  useEffect(() => { fetch('/api/staff').then(r=>r.json()).then((d:any[])=>{ const ruoliOk=['agente','operatore','admin']; const arr=(Array.isArray(d)?d:[]).filter(u=>ruoliOk.includes((u.ruolo||'').toLowerCase())).map(u=>({...u, _nome:((u.nome||'')+' '+(u.cognome||'')).trim()})).filter(u=>u._nome).sort((a,b)=>a._nome.localeCompare(b._nome)); setStaffList(arr) }).catch(()=>setStaffList([])) }, [])
  const [saving, setSaving] = useState(false)
  const [errore, setErrore] = useState('')
  const [estraendo, setEstraendo] = useState(false)
  const [visuraOk, setVisuraOk] = useState('')
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

  // Carica il PDF della visura camerale e compila i campi automaticamente (via AI)
  async function caricaVisura(file: File) {
    setErrore(''); setVisuraOk(''); setEstraendo(true)
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file)
      })
      const resp = await fetch('/api/clienti/estrai-visura', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pdfBase64: b64 })
      })
      const j = await resp.json()
      if (j.error) { setErrore(j.error); setEstraendo(false); return }
      const d = j.dati || {}
      const prov = String(d.provincia || '').toUpperCase().slice(0, 2)
      setForm(f => ({ ...f,
        ragione_sociale: d.ragione_sociale || f.ragione_sociale,
        piva: String(d.piva || '').replace(/^IT/i, '') || f.piva,
        cf: d.cf || f.cf,
        pec: d.pec || f.pec,
        cod_sdi: d.cod_sdi || f.cod_sdi,
        rappresentante_legale: d.rappresentante_legale || f.rappresentante_legale,
        telefono: d.telefono || f.telefono,
        sl_indirizzo: d.indirizzo || f.sl_indirizzo,
        sl_citta: d.citta || f.sl_citta,
        sl_provincia: prov || f.sl_provincia,
        sl_cap: d.cap || f.sl_cap,
        so_indirizzo: d.indirizzo || f.so_indirizzo,
        so_citta: d.citta || f.so_citta,
        so_provincia: prov || f.so_provincia,
        so_cap: d.cap || f.so_cap,
      }))
      setVisuraOk('Dati compilati dalla visura. Controlla e completa i campi mancanti.')
    } catch {
      setErrore('Impossibile leggere il PDF della visura')
    }
    setEstraendo(false)
  }

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
    // mostro le credenziali a schermo (da condividere a mano finché Resend non è verificato)
    setCredenziali({ email: data.email, password: data.password })
  }

  if (credenziali) return (
    <div style={{maxWidth:'560px',margin:'40px auto'}}>
      <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'10px',padding:'24px'}}>
        <div style={{fontSize:'16px',fontWeight:800,color:'#16a34a',marginBottom:'6px'}}>✓ Cliente creato</div>
        <p style={{fontSize:'13px',color:'#555',margin:'0 0 16px'}}>Condividi queste credenziali con il cliente (le email automatiche partiranno quando il dominio sarà verificato).</p>
        <div style={{background:'#fff',border:'1px solid #d1fae5',borderRadius:'8px',padding:'14px'}}>
          <div style={{fontSize:'11px',color:'#999',textTransform:'uppercase',letterSpacing:'0.5px'}}>Email</div>
          <div style={{fontSize:'14px',fontWeight:700,color:'#1a1a1a',marginBottom:'10px',fontFamily:'monospace'}}>{credenziali.email}</div>
          <div style={{fontSize:'11px',color:'#999',textTransform:'uppercase',letterSpacing:'0.5px'}}>Password</div>
          <div style={{fontSize:'16px',fontWeight:700,color:'#f97316',fontFamily:'monospace'}}>{credenziali.password}</div>
        </div>
        <div style={{display:'flex',gap:'8px',marginTop:'16px'}}>
          <button onClick={()=>{navigator.clipboard?.writeText(`Email: ${credenziali.email}\nPassword: ${credenziali.password}\nPortale: https://moovexpress.com/cliente`)}}
            style={{background:'#16a34a',color:'#fff',border:'none',borderRadius:'6px',padding:'9px 16px',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>Copia credenziali</button>
          <button onClick={()=>router.push('/dashboard/clienti')}
            style={{background:'#fff',color:'#1a1a1a',border:'1px solid #ddd',borderRadius:'6px',padding:'9px 16px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>Vai ai clienti</button>
        </div>
      </div>
    </div>
  )

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

      {/* Compilazione automatica da visura camerale */}
      <div style={{background:'#fff',border:'2px dashed #f97316',borderRadius:'10px',padding:'18px 20px',marginBottom:'18px',display:'flex',alignItems:'center',gap:'16px',flexWrap:'wrap' as const}}>
        <div style={{width:'52px',height:'52px',borderRadius:'12px',background:'#fff7ed',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'26px',flexShrink:0}}>📄</div>
        <div style={{flex:1,minWidth:'220px'}}>
          <div style={{fontSize:'15px',fontWeight:'700',color:'#1a1a1a'}}>Inserisci la visura camerale</div>
          <div style={{fontSize:'12.5px',color:'#666',marginTop:'3px',lineHeight:1.4}}>Carica il PDF della visura e compiliamo automaticamente i dati aziendali (ragione sociale, P.IVA, indirizzo, PEC…).</div>
          {visuraOk && <div style={{fontSize:'12px',color:'#16a34a',marginTop:'7px',fontWeight:600}}>✓ {visuraOk}</div>}
        </div>
        <label style={{padding:'11px 22px',background:estraendo?'#fbbf24':'#f97316',color:'#fff',borderRadius:'8px',fontSize:'13px',fontWeight:'700',cursor:estraendo?'default':'pointer',whiteSpace:'nowrap' as const,flexShrink:0}}>
          {estraendo ? '⏳ Lettura in corso...' : '⬆ Carica visura PDF'}
          <input type="file" accept="application/pdf" disabled={estraendo}
            onChange={e=>{ const f=e.target.files?.[0]; if(f) caricaVisura(f); e.currentTarget.value='' }}
            style={{display:'none'}}/>
        </label>
      </div>

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
                  {staffList.map((u:any)=>(<option key={u.id} value={u._nome}>{u._nome}</option>))}
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
              <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'6px',padding:'10px 12px',fontSize:'12px',color:'#ea580c',lineHeight:1.5}}>
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
