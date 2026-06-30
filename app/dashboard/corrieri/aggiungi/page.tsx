import { createServerSupabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'

async function salvaCorreiere(formData: FormData) {
  'use server'
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) redirect('/dashboard/corrieri')

  const tipo = formData.get('tipo') as string
  const credenziali: Record<string,string> = {}
  const settings: Record<string,string> = {}

  if (tipo === 'spedisci') {
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
  } else {
    credenziali.utente = formData.get('utente') as string || ''
    credenziali.password = formData.get('password') as string || ''
  }

  const { error } = await supabase.from('corrieri').insert({
    master_id: utente.master_id,
    tipo, nome_contratto: formData.get('nome_contratto') as string,
    credenziali, settings, multicollo: true, inserimento_ritiri: true, attivo: true, livello: 1,
  })

  if (error) redirect(`/dashboard/corrieri?error=${encodeURIComponent(error.message)}`)
  redirect('/dashboard/corrieri?success=corriere_aggiunto')
}

const CONFIGS: Record<string,{titolo:string,info:string,campi:[string,string,string,string][],extra?:string}> = {
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
    info: 'Credenziali fornite da BRT.',
    campi: [
      ['nome_contratto','Nome Contratto','es. BRT Standard','text'],
      ['user','Username','username BRT','text'],
      ['password','Password','••••••••','password'],
      ['codice_mittente','Codice Mittente','es. 123456','text'],
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

export default async function AggiungCorriereePage({ searchParams }: { searchParams: Promise<{tipo?:string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { tipo } = await searchParams
  const config = CONFIGS[tipo||'spedisci'] || CONFIGS['spedisci']

  return (
    <div style={{display:'flex',minHeight:'100vh',background:'#f0f4f8',fontFamily:'Segoe UI,system-ui,sans-serif'}}>
      <aside style={{width:'230px',background:'#0f1623',flexShrink:0,display:'flex',flexDirection:'column'}}>
        <div style={{padding:'20px 18px',borderBottom:'1px solid rgba(255,255,255,.06)',display:'flex',alignItems:'center',gap:'10px'}}>
          <div style={{width:'36px',height:'36px',background:'linear-gradient(135deg,#3b82f6,#1d4ed8)',borderRadius:'9px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px'}}>📦</div>
          <div><div style={{fontSize:'17px',fontWeight:'800',color:'#fff'}}>Spedix<span style={{color:'#60a5fa'}}>Pro</span></div></div>
        </div>
        <nav style={{padding:'8px 0',flex:1}}>
          {[['📊','Dashboard','/dashboard'],['📦','Spedizioni','/dashboard/spedizioni'],['👥','Clienti','/dashboard/clienti'],['🚛','Corrieri','/dashboard/corrieri'],['💶','Listini','/dashboard/listini'],['🧾','Fatture','/dashboard/fatture'],['⚙️','Impostazioni','/dashboard/impostazioni']].map(([ico,lbl,href]) => (
            <a key={String(href)} href={String(href)} style={{display:'flex',alignItems:'center',gap:'10px',padding:'9px 18px',color:String(href)==='/dashboard/corrieri'?'#60a5fa':'#64748b',fontSize:'13px',textDecoration:'none',background:String(href)==='/dashboard/corrieri'?'rgba(59,130,246,.15)':'transparent',borderRight:String(href)==='/dashboard/corrieri'?'3px solid #3b82f6':'3px solid transparent'}}>
              <span style={{fontSize:'15px',width:'20px',textAlign:'center'}}>{ico}</span>{lbl}
            </a>
          ))}
        </nav>
        <div style={{borderTop:'1px solid rgba(255,255,255,.05)',padding:'10px 0'}}>
          <a href="/api/auth/logout" style={{display:'flex',alignItems:'center',gap:'10px',padding:'9px 18px',color:'#64748b',fontSize:'13px',textDecoration:'none'}}><span>🚪</span>Esci</a>
        </div>
      </aside>

      <div style={{flex:1,display:'flex',flexDirection:'column'}}>
        <header style={{background:'#1a2235',height:'54px',display:'flex',alignItems:'center',padding:'0 24px',borderBottom:'1px solid rgba(255,255,255,.06)'}}>
          <div style={{color:'#94a3b8',fontSize:'13px'}}>← <a href="/dashboard/corrieri" style={{color:'#60a5fa',textDecoration:'none'}}>Corrieri</a> / Aggiungi {config.titolo}</div>
        </header>

        <main style={{flex:1,padding:'24px'}}>
          <h1 style={{fontSize:'20px',fontWeight:'800',color:'#1e293b',marginBottom:'20px'}}>🚛 Aggiungi {config.titolo}</h1>

          <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:'8px',padding:'12px 16px',marginBottom:'20px',fontSize:'13px',color:'#1d4ed8',maxWidth:'520px'}}>
            💡 {config.info}
          </div>

          <div style={{maxWidth:'520px',background:'#fff',borderRadius:'10px',border:'1px solid #e2e8f0',overflow:'hidden'}}>
            <div style={{padding:'14px 18px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0',fontSize:'13.5px',fontWeight:'700',color:'#1e293b'}}>
              Credenziali {config.titolo}
            </div>
            <form action={salvaCorreiere} style={{padding:'20px',display:'flex',flexDirection:'column',gap:'14px'}}>
              <input type="hidden" name="tipo" value={tipo||'spedisci'}/>
              {config.campi.map(([name,label,placeholder,inputType]) => (
                <div key={name}>
                  <label style={{fontSize:'11.5px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>{label}</label>
                  <input name={name} type={inputType} placeholder={placeholder} required
                    style={{width:'100%',padding:'9px 12px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'13px',color:'#1e293b',background:'#fff',boxSizing:'border-box'}}/>
                </div>
              ))}
              {tipo === 'gls' && (
                <div>
                  <label style={{fontSize:'11.5px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>Tipo Collo</label>
                  <select name="tipo_collo" style={{width:'100%',padding:'9px 12px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                    <option>Normale</option><option>Fragile</option>
                  </select>
                </div>
              )}
              {tipo === 'sda' && (
                <div>
                  <label style={{fontSize:'11.5px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>Tipo Contratto</label>
                  <select name="tipo_contratto_sda" style={{width:'100%',padding:'9px 12px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                    <option value="ZERO_TRE">ZERO TRE</option><option value="STANDARD">STANDARD</option>
                  </select>
                </div>
              )}
              <div style={{display:'flex',gap:'10px',justifyContent:'flex-end',marginTop:'8px'}}>
                <a href="/dashboard/corrieri" style={{padding:'9px 18px',background:'#f1f5f9',border:'1px solid #e2e8f0',borderRadius:'8px',fontSize:'13px',fontWeight:'600',color:'#64748b',textDecoration:'none'}}>Annulla</a>
                <button type="submit" style={{padding:'9px 22px',background:'#2563eb',color:'#fff',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>💾 Salva Contratto</button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  )
}
