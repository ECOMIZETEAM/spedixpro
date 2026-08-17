import { createServerSupabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'

async function salvaCorriere(formData: FormData) {
  'use server'
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) redirect('/dashboard/corrieri')

  const tipo = formData.get('tipo') as string
  const corriereId = formData.get('corriere_id') as string
  const credenziali: Record<string,string> = {}
  const settings: Record<string,string|boolean> = {}

  // Circuito interno: non c'e' nessun provider a cui chiedere le chiavi, il corriere siamo noi.
  // Il contratto serve comunque, perche' e' quello che porta zone, listino, credito e cascata.
  if (tipo === 'interno') {
    settings.filiale = formData.get('filiale') as string || ''
  } else if (tipo === 'spedisci') {
    credenziali.utente = formData.get('utente') as string || ''
    credenziali.password = formData.get('password') as string || ''
    credenziali.master_domain = formData.get('master_domain') as string || ''
    credenziali.codice_contratto = formData.get('codice_contratto') as string || ''
  } else if (tipo === 'gls') {
    credenziali.sigla_sede = formData.get('sigla_sede') as string || ''
    credenziali.user_webservice = formData.get('user_webservice') as string || ''
    credenziali.password_webservice = formData.get('password_webservice') as string || ''
    credenziali.codice_contratto = formData.get('codice_contratto') as string || ''
    settings.tipo_collo = formData.get('tipo_collo') as string || 'Normale'
  } else if (tipo === 'sda') {
    credenziali.utente = formData.get('utente') as string || ''
    credenziali.password = formData.get('password') as string || ''
    credenziali.cod_cliente = formData.get('cod_cliente') as string || ''
    credenziali.postazione = formData.get('postazione') as string || ''
    settings.tipo_contratto = formData.get('tipo_contratto_sda') as string || 'ZERO_TRE'
  } else if (tipo === 'brt') {
    // Web service BRT: credenziali del contratto diretto (form del mockup).
    credenziali.user = formData.get('user') as string || ''
    credenziali.password = formData.get('password') as string || ''
    credenziali.cod_cliente = formData.get('cod_cliente') as string || ''
    credenziali.cod_filiale = formData.get('cod_filiale') as string || ''
    credenziali.codice_tariffa = formData.get('codice_tariffa') as string || ''
    credenziali.orm_api_key = formData.get('orm_api_key') as string || ''
    settings.network = (formData.get('network') as string) || 'Italia'
    settings.sms_destinatario = formData.get('sms_destinatario') === 'on'
    // Metodi di incasso COD ammessi (checkbox multipli).
    settings.cod_contante = formData.get('cod_contante') === 'on'
    settings.cod_ass_banc_mittente = formData.get('cod_ass_banc_mittente') === 'on'
  } else {
    credenziali.utente = formData.get('utente') as string || ''
    credenziali.password = formData.get('password') as string || ''
  }

  if (corriereId) {
    // *** MODIFICA: aggiorna il corriere esistente ***
    // SOLO IL PROPRIETARIO (proprio=true) puo' modificare le credenziali. Un sotto-master ha una
    // COPIA propagata (proprio=false) del contratto: non deve poter vederne/cambiarne le chiavi.
    // Le impostazioni generali (settings) NON si toccano qui: le gestisce il popup Impostazioni;
    // sovrascriverle con i soli campi di questa form cancellerebbe misure/limiti configurati.
    const { data: esistente } = await supabase.from('corrieri').select('proprio,settings').eq('id', corriereId).eq('master_id', utente.master_id).maybeSingle()
    if (!esistente) redirect('/dashboard/corrieri?error=' + encodeURIComponent('Contratto non trovato'))
    if (!(esistente as any)?.proprio) redirect('/dashboard/corrieri?error=' + encodeURIComponent('Solo il proprietario del contratto puo\' modificarlo'))
    const settingsUniti = { ...((esistente as any)?.settings || {}), ...settings }
    const { error } = await supabase.from('corrieri').update({
      nome_contratto: formData.get('nome_contratto') as string,
      credenziali, settings: settingsUniti,
    }).eq('id', corriereId).eq('master_id', utente.master_id).eq('proprio', true)

    if (error) redirect(`/dashboard/corrieri?error=${encodeURIComponent(error.message)}`)
    redirect('/dashboard/corrieri?success=corriere_aggiornato')
  } else {
    // CREAZIONE: nuovo corriere
    const { error } = await supabase.from('corrieri').insert({
      master_id: utente.master_id,
      tipo, nome_contratto: formData.get('nome_contratto') as string,
      credenziali, settings, multicollo: true, inserimento_ritiri: true, attivo: true, livello: 1,
    })

    if (error) redirect(`/dashboard/corrieri?error=${encodeURIComponent(error.message)}`)
    redirect('/dashboard/corrieri?success=corriere_aggiunto')
  }
}

const CONFIGS: Record<string,{titolo:string,info:string,campi:[string,string,string,string,boolean?][],extra?:string}> = {
  interno: {
    titolo: 'Circuito interno',
    info: 'La tua rete di consegna: i pacchi li ritiri e li consegni tu, con i tuoi autisti. Nessuna credenziale da chiedere a nessuno. Dopo averlo creato imposta le Zone di consegna e i prezzi in Listini Prezzi, poi attivalo per i clienti.',
    campi: [
      ['nome_contratto','Nome del servizio','es. Consegne Città','text'],
      ['filiale','Filiale / deposito principale','es. Napoli Est','text'],
    ],
  },
  spedisci: {
    titolo: 'Spedisci.online',
    info: 'Vai su spedisci.online → Impostazioni → API Key per ottenere le credenziali.',
    campi: [
      ['nome_contratto','Nome Contratto','es. Ecomize GLS via Spedisci','text'],
      ['utente','Utente (email account spedisci.online)','tua@email.com','email'],
      ['password','Password (= API Key da Impostazioni → API Key)','incolla qui la API Key','text'],
      ['master_domain','Master Domain','es. ecomizell.spedisci.online','text'],
      ['codice_contratto','Codice Contratto','codice del contratto specifico','text'],
    ],
  },
  gls: {
    titolo: 'GLS',
    info: 'Credenziali fornite da GLS al momento della stipula del contratto.',
    campi: [
      ['nome_contratto','Nome Contratto','es. GLS TR','text'],
      ['sigla_sede','Sigla Sede','es. MI','text'],
      ['user_webservice','User Webservice (API)','username','text'],
      ['password_webservice','Password Webservice (API)','••••••••','password'],
      ['codice_contratto','Codice Contratto','es. 123456','text'],
    ],
  },
  sda: {
    titolo: 'SDA Express',
    info: 'Credenziali fornite da SDA/Poste Italiane.',
    campi: [
      ['nome_contratto','Nome Contratto','es. SDA Express','text'],
      ['utente','Utente','username SDA','text'],
      ['password','Password','••••••••','password'],
      ['cod_cliente','Cod Cliente','codice cliente SDA','text'],
      ['postazione','Postazione','codice postazione','text'],
    ],
  },
  brt: {
    titolo: 'BRT',
    info: 'Credenziali del web service BRT (fornite da BRT alla stipula del contratto diretto).',
    campi: [
      ['nome_contratto','Nome Contratto','es. BRT Standard','text'],
      ['user','User API','username web service BRT','text'],
      ['password','Password API','••••••••','password'],
      ['cod_cliente','Cod Cliente','codice cliente BRT','text'],
      ['cod_filiale','Cod Filiale partenza','es. 123','text',true],
      ['codice_tariffa','Codice tariffa','codice tariffa contrattuale','text',true],
      ['orm_api_key','ORM API Key','chiave ORM (facoltativa)','text',true],
    ],
  },
  dhl: {
    titolo: 'DHL Express',
    info: 'Credenziali API DHL dal portale MyDHL+.',
    campi: [
      ['nome_contratto','Nome Contratto','es. DHL Express','text'],
      ['account_number','Account Number','es. 123456789','text'],
      ['api_key','API Key','chiave API','text'],
      ['api_secret','API Secret','••••••••','password'],
    ],
  },
}

export default async function AggiungiCorrierePage({ searchParams }: { searchParams: Promise<{tipo?:string,id?:string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { tipo, id } = await searchParams
  const config = CONFIGS[tipo||'spedisci'] || CONFIGS['spedisci']

  // Se c'è un id, carica i dati esistenti per la modifica.
  // SOLO IL PROPRIETARIO (proprio=true) può vedere/modificare le credenziali: un sotto-master ha una
  // COPIA propagata del contratto e non deve vederne le chiavi. Se non è suo (proprio) → torna indietro.
  let corriereEsistente: any = null
  if (id) {
    const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
    const { data: c } = await supabase.from('corrieri').select('*').eq('id', id).eq('master_id', utente?.master_id).maybeSingle()
    if (!c) redirect('/dashboard/corrieri')
    if (!(c as any)?.proprio) redirect('/dashboard/corrieri?error=' + encodeURIComponent('Solo il proprietario del contratto può modificarlo'))
    corriereEsistente = c
  }

  const credenzialiEsistenti = corriereEsistente?.credenziali || {}
  const settingsEsistenti = corriereEsistente?.settings || {}

  return (
    <div>
      <div style={{marginBottom:'20px',fontSize:'13px',color:'#666'}}>
        ← <a href="/dashboard/corrieri" style={{color:'#f97316',textDecoration:'none'}}>Corrieri</a> / {corriereEsistente ? 'Modifica' : 'Aggiungi'} {config.titolo}
      </div>

      <h1 style={{fontSize:'20px',fontWeight:'800',color:'#1a1a1a',marginBottom:'20px'}}>🚛 {corriereEsistente ? 'Modifica' : 'Aggiungi'} {config.titolo}</h1>

      <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'8px',padding:'12px 16px',marginBottom:'20px',fontSize:'13px',color:'#ea580c',maxWidth:'520px'}}>
        💡 {config.info}
      </div>

      <div style={{maxWidth:'520px',background:'#fff',borderRadius:'10px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
        <div style={{padding:'14px 18px',background:'#fafafa',borderBottom:'1px solid #e8e8e8',fontSize:'13.5px',fontWeight:'700',color:'#1a1a1a'}}>
          Credenziali {config.titolo}
        </div>
        <form action={salvaCorriere} style={{padding:'20px',display:'flex',flexDirection:'column',gap:'14px'}}>
          <input type="hidden" name="tipo" value={tipo||'spedisci'}/>
          {corriereEsistente && <input type="hidden" name="corriere_id" value={corriereEsistente.id}/>}
          {config.campi.map(([name,label,placeholder,inputType,opzionale]) => (
            <div key={name}>
              <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>{label}{opzionale && <span style={{color:'#9ca3af',fontWeight:400}}> (facoltativo)</span>}</label>
              <input name={name} type={inputType} placeholder={placeholder} required={!opzionale}
                defaultValue={name === 'nome_contratto' ? (corriereEsistente?.nome_contratto || '') : (credenzialiEsistenti[name] || '')}
                style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box'}}/>
            </div>
          ))}
          {tipo === 'brt' && (
            <>
              <div>
                <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Network</label>
                <select name="network" defaultValue={settingsEsistenti.network || 'Italia'} style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                  <option>Italia</option><option>Europa</option><option>Internazionale</option>
                </select>
              </div>
              <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:'#1a1a1a',cursor:'pointer'}}>
                <input type="checkbox" name="sms_destinatario" defaultChecked={!!settingsEsistenti.sms_destinatario}/> Notifiche via SMS al destinatario
              </label>
              <div>
                <div style={{fontSize:'11.5px',fontWeight:'600',color:'#666',marginBottom:'6px'}}>Metodi di incasso COD</div>
                <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:'#1a1a1a',cursor:'pointer',marginBottom:'4px'}}>
                  <input type="checkbox" name="cod_contante" defaultChecked={settingsEsistenti.cod_contante !== false}/> Contante
                </label>
                <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:'#1a1a1a',cursor:'pointer'}}>
                  <input type="checkbox" name="cod_ass_banc_mittente" defaultChecked={!!settingsEsistenti.cod_ass_banc_mittente}/> Assegno bancario al mittente
                </label>
              </div>
            </>
          )}
          {tipo === 'gls' && (
            <div>
              <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Tipo Collo</label>
              <select name="tipo_collo" defaultValue={settingsEsistenti.tipo_collo || 'Normale'} style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                <option>Normale</option><option>Fragile</option>
              </select>
            </div>
          )}
          {tipo === 'sda' && (
            <div>
              <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Tipo Contratto</label>
              <select name="tipo_contratto_sda" defaultValue={settingsEsistenti.tipo_contratto || 'ZERO_TRE'} style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                <option value="ZERO_TRE">ZERO TRE</option><option value="STANDARD">STANDARD</option>
              </select>
            </div>
          )}
          <div style={{display:'flex',gap:'10px',justifyContent:'flex-end',marginTop:'8px'}}>
            <a href="/dashboard/corrieri" style={{padding:'9px 18px',background:'#f5f5f5',border:'1px solid #e8e8e8',borderRadius:'8px',fontSize:'13px',fontWeight:'600',color:'#666',textDecoration:'none'}}>Annulla</a>
            <button type="submit" style={{padding:'9px 22px',background:'#f97316',color:'#fff',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>💾 {corriereEsistente ? 'Salva Modifiche' : 'Salva Contratto'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
