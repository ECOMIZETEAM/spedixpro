import { createServerSupabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'

export default async function ClienteLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/cliente')
  const { data: utente } = await supabase.from('utenti').select('cliente_id,ruolo').eq('id', user.id).single()
  if (!utente?.cliente_id) redirect('/cliente')
  const { data: cliente } = await supabase.from('clienti').select('ragione_sociale,credito').eq('id', utente.cliente_id).single()

  const nav = [
    { label:'Dashboard', href:'/cliente/dashboard', icon:'⊞' },
    { label:'Spedizioni', href:'/cliente/spedizioni', icon:'◫', sub:[
      { label:'Nuova Spedizione', href:'/cliente/spedizioni/nuova' },
      { label:'Elenco Spedizioni', href:'/cliente/spedizioni' },
    ]},
    { label:'Importa Ordini', href:'/cliente/importa', icon:'↓' },
    { label:'Ritiri', href:'/cliente/ritiri', icon:'↩' },
    { label:'Resi', href:'/cliente/resi', icon:'↺' },
    { label:'Fatture', href:'/cliente/fatture', icon:'◻' },
    { label:'Reports', href:'/cliente/reports', icon:'◈' },
    { label:'Il mio Listino', href:'/cliente/listino', icon:'€' },
    { label:'Mio Account', href:'/cliente/account', icon:'⊙' },
    { label:'Integrazioni', href:'/cliente/integrazioni', icon:'⊡' },
    { label:'Impostazioni', href:'/cliente/impostazioni', icon:'◉' },
  ]

  return (
    <div style={{display:'flex',minHeight:'100vh',background:'#f5f5f5',fontFamily:'"Inter",-apple-system,sans-serif'}}>
      <aside style={{width:'200px',background:'#1a1a1a',flexShrink:0,display:'flex',flexDirection:'column',position:'sticky',top:0,height:'100vh',overflowY:'auto'}}>
        <div style={{padding:'18px',borderBottom:'1px solid #2a2a2a'}}>
          <div style={{fontSize:'16px',fontWeight:'800',color:'#fff'}}>Spedix<span style={{color:'#f97316'}}>Pro</span></div>
          <div style={{fontSize:'9px',color:'#555',marginTop:'2px',textTransform:'uppercase',letterSpacing:'1px'}}>Portale Cliente</div>
        </div>
        <div style={{padding:'8px 0',borderBottom:'1px solid #2a2a2a'}}>
          <div style={{padding:'8px 16px',display:'flex',alignItems:'center',gap:'8px'}}>
            <div style={{width:'28px',height:'28px',background:'#f97316',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:'700',color:'#fff',flexShrink:0}}>
              {cliente?.ragione_sociale?.substring(0,2).toUpperCase()}
            </div>
            <div>
              <div style={{fontSize:'11.5px',fontWeight:'600',color:'#e5e5e5',lineHeight:1}}>{cliente?.ragione_sociale}</div>
              <div style={{fontSize:'10px',color:'#f97316',marginTop:'2px'}}>€ {Number(cliente?.credito||0).toFixed(2)}</div>
            </div>
          </div>
        </div>
        <nav style={{flex:1,padding:'6px 0'}}>
          {nav.map(item => (
            <div key={item.href}>
              <a href={item.href} style={{display:'flex',alignItems:'center',gap:'8px',padding:'7px 16px',color:'#777',fontSize:'12.5px',textDecoration:'none'}}>
                <span style={{fontSize:'11px',width:'14px',opacity:.6}}>{item.icon}</span>
                {item.label}
              </a>
            </div>
          ))}
        </nav>
        <div style={{borderTop:'1px solid #2a2a2a',padding:'6px 0'}}>
          <a href="/api/auth/logout" style={{display:'flex',alignItems:'center',gap:'8px',padding:'7px 16px',color:'#555',fontSize:'12.5px',textDecoration:'none'}}>
            <span style={{fontSize:'11px'}}>→</span> Esci
          </a>
        </div>
      </aside>

      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0}}>
        <header style={{background:'#fff',height:'48px',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 24px',borderBottom:'1px solid #e8e8e8',position:'sticky',top:0,zIndex:10}}>
          <div style={{fontSize:'13px',color:'#999'}}>{cliente?.ragione_sociale}</div>
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <span style={{background:'#f5f5f5',border:'1px solid #e8e8e8',borderRadius:'20px',padding:'4px 12px',fontSize:'12px',fontWeight:'600',color:'#1a1a1a'}}>
              Credito: <span style={{color:Number(cliente?.credito)>0?'#16a34a':'#dc2626'}}>€ {Number(cliente?.credito||0).toFixed(2)}</span>
            </span>
          </div>
        </header>
        <main style={{flex:1,padding:'24px',overflowY:'auto'}}>
          {children}
        </main>
      </div>
    </div>
  )
}
