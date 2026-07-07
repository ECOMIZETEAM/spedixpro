import { createServerSupabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import ClienteNav from './ClienteNav'

export default async function ClienteLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  // Se non loggato, mostra solo il contenuto (es. la pagina di login /cliente) SENZA
  // reindirizzare: il layout avvolge anche il login, e un redirect qui creerebbe un loop.
  // Le pagine interne restano protette dal middleware.
  if (!user) return <>{children}</>
  const { data: utente } = await supabase.from('utenti').select('cliente_id,ruolo').eq('id', user.id).single()
  if (!utente?.cliente_id) return <>{children}</>
  const { data: cliente } = await supabase.from('clienti').select('ragione_sociale,credito').eq('id', utente.cliente_id).single()

  return (
    <div style={{display:'flex',minHeight:'100vh',background:'#f5f5f5',fontFamily:'var(--font-geist-sans),system-ui,sans-serif'}}>
      <aside style={{width:'200px',background:'#1a1a1a',flexShrink:0,display:'flex',flexDirection:'column',position:'sticky',top:0,height:'100vh',overflowY:'auto'}}>
        <a href="/cliente/dashboard" style={{padding:'18px',borderBottom:'1px solid #2a2a2a',display:'block',textDecoration:'none'}}>
          <div style={{fontSize:'16px',fontWeight:'800',color:'#fff'}}>Moov<span style={{color:'#f97316'}}>Express</span></div>
          <div style={{fontSize:'9px',color:'#fff',marginTop:'2px',textTransform:'uppercase',letterSpacing:'1px'}}>Portale Cliente</div>
        </a>
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

        {/* Navigazione (client component: highlight sezione attiva + dropdown) */}
        <ClienteNav />

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
