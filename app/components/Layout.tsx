'use client'
import { useState } from 'react'
import { usePathname } from 'next/navigation'

const NAV = [
  { label: 'Spedizioni', href: '/dashboard/spedizioni', icon: '◫', sub: [
    { label: 'Nuova Spedizione', href: '/dashboard/spedizioni/nuova' },
    { label: 'Elenco Spedizioni', href: '/dashboard/spedizioni' },
    { label: 'Giacenze', href: '/dashboard/spedizioni/giacenze' },
    { label: 'Rettifica Costi', href: '/dashboard/spedizioni/rettifica' },
    { label: 'Spedizioni Cancellate', href: '/dashboard/spedizioni/cancellate' },
  ]},
  { label: 'Contrassegni', href: '/dashboard/contrassegni', icon: '¤', sub: [
    { label: 'Lista Contrassegni', href: '/dashboard/contrassegni' },
    { label: 'Distinte Contrassegni', href: '/dashboard/contrassegni/distinte' },
  ]},
  { label: 'Ritiri', href: '/dashboard/ritiri', icon: '↩', sub: [
    { label: 'Nuovo Ritiro', href: '/dashboard/ritiri/nuovo' },
    { label: 'Elenco Ritiri', href: '/dashboard/ritiri/elenco' },
  ]},
  { label: 'Distinte', icon: '≡', sub: [
    { label: 'Crea Distinta', href: '/dashboard/distinte/crea' },
    { label: 'Elenco Distinte', href: '/dashboard/distinte/elenco' },
  ]},
  { label: 'Resi', href: '/dashboard/resi', icon: '↺', sub: [
    { label: 'Scansiona Resi', href: '/dashboard/resi/scansiona' },
    { label: 'Elenco Distinte Resi', href: '/dashboard/resi/distinte' },
  ]},
  { label: 'Dal mio network', href: '/dashboard/network', icon: '🌐' },
  { label: 'Tracking Interno', href: '/dashboard/tracking', icon: '◎' },
  { label: 'Listini Prezzi', href: '/dashboard/listini', icon: '€', sub: [
    { label: 'Nuovo Listino', href: '/dashboard/listini/clienti/nuovo' },
    { label: 'Listini Clienti', href: '/dashboard/listini' },
    { label: 'Listino Corrieri', href: '/dashboard/listini/corrieri/nuovo' },
    { label: 'Gestione Zone', href: '/dashboard/zone' },
  ]},
  { label: 'Clienti', href: '/dashboard/clienti', icon: '⊙', sub: [
    { label: 'Nuovo Cliente', href: '/dashboard/clienti/nuovo' },
    { label: 'Elenco Clienti', href: '/dashboard/clienti' },
    { label: 'Nuovo Master', href: '/dashboard/clienti/master/nuovo' },
    { label: 'Elenco Master', href: '/dashboard/clienti/master' },
    { label: 'Gerarchia', href: '/dashboard/clienti/gerarchia' },
  ]},
  { label: 'Autisti e Consegne', href: '/dashboard/autisti', icon: '⊡' },
  { label: 'Consumabili', href: '/dashboard/consumabili', icon: '▣', sub: [
    { label: 'Aggiungi Spesa', href: '/dashboard/consumabili/aggiungi' },
    { label: 'Storia', href: '/dashboard/consumabili/storia' },
  ]},
  { label: 'Fatture', href: '/dashboard/fatture', icon: '◻', sub: [
    { label: 'Elenco Fatture', href: '/dashboard/fatture' },
    { label: 'Nuova Fattura', href: '/dashboard/fatture/nuova' },
  ]},
  { label: 'Lista Movimenti', href: '/dashboard/movimenti', icon: '≣' },
  { label: 'Reports & SMS', href: '/dashboard/reports', icon: '◈', sub: [
    { label: 'Report Spedizioni', href: '/dashboard/reports/spedizioni' },
    { label: 'Report Giacenze', href: '/dashboard/reports/giacenze' },
    { label: 'Report Distinte', href: '/dashboard/reports/distinte' },
    { label: 'Report Contrassegni', href: '/dashboard/reports/contrassegni' },
    { label: 'Report Ritiri', href: '/dashboard/reports/ritiri' },
    { label: 'Report Rettifiche', href: '/dashboard/reports/rettifiche' },
    { label: 'Report Consumabili', href: '/dashboard/reports/consumabili' },
    { label: 'Report Fatture', href: '/dashboard/reports/fatture' },
    { label: 'Report Resi', href: '/dashboard/reports/resi' },
    { label: 'Report SMS Clienti', href: '/dashboard/reports/sms-clienti' },
    { label: 'Storico Credito SMS', href: '/dashboard/reports/storico-sms' },
  ]},
  { label: 'Impostazioni', href: '/dashboard/impostazioni', icon: '◉', sub: [
    { label: 'Azienda', href: '/dashboard/impostazioni' },
    { label: 'Logo', href: '/dashboard/impostazioni/logo' },
    { label: 'Filiale / Rete Interna', href: '/dashboard/impostazioni/filiale' },
    { label: 'Corrieri', href: '/dashboard/corrieri' },
    { label: 'Staff', href: '/dashboard/impostazioni/staff' },
    { label: 'Permessi', href: '/dashboard/impostazioni/permessi' },
    { label: 'Zone di Consegna', href: '/dashboard/listini/zone' },
    { label: 'Cambia Password', href: '/dashboard/impostazioni/password' },
  ]},
  { label: 'Centro Notifiche', href: '/dashboard/notifiche', icon: '🔔', sub: [
    { label: 'Invia Notifica', href: '/dashboard/notifiche/invia' },
  ]},
]

export default function Layout({ children, user }: { children: React.ReactNode, user?: { nome: string, ruolo: string, brandLogo?: string | null, brandNome?: string | null } }) {
  const path = usePathname()
  const [openMenus, setOpenMenus] = useState<Record<string,boolean>>(() => {
    const init: Record<string,boolean> = {}
    NAV.forEach(item => {
      if (item.sub && (path === item.href || path.startsWith(item.href + '/'))) {
        init[item.href] = true
      }
    })
    return init
  })

  function toggleMenu(href: string, el?: HTMLElement) {
    const staAprendo = !openMenus[href]
    setOpenMenus(prev => ({ [href]: !prev[href] }))
    if (staAprendo && el) {
      setTimeout(() => { el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 80)
    }
  }

  return (
    <div style={{display:'flex',minHeight:'100vh',background:'#f5f5f5',fontFamily:'var(--font-geist-sans),system-ui,sans-serif'}}>

      {/* SIDEBAR */}
      <aside style={{width:'220px',background:'#1a1a1a',display:'flex',flexDirection:'column',flexShrink:0,height:'100vh',position:'sticky',top:0,overflowY:'auto'}}>

        {/* Logo */}
        <a href="/dashboard" style={{padding:'16px 18px',borderBottom:'1px solid rgba(255,255,255,0.06)',display:'flex',alignItems:'center',gap:'10px',textDecoration:'none'}}>
          {user?.brandLogo ? (
            <div style={{width:'100%',aspectRatio:'300 / 90',display:'flex',alignItems:'center',justifyContent:'center'}}><img src={user.brandLogo} alt="Logo" style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain'}}/></div>
          ) : (
            <>
              <div style={{width:'32px',height:'32px',background:'#f97316',borderRadius:'7px',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:'900',fontSize:'16px',color:'#fff',flexShrink:0}}>{(user?.brandNome || 'S').substring(0,1).toUpperCase()}</div>
              <div>
                <div style={{fontSize:'15px',fontWeight:'800',color:'#fff',letterSpacing:'-0.3px',lineHeight:1}}>{user?.brandNome || 'MoovExpress'}</div>
                <div style={{fontSize:'9px',color:'#4a7090',textTransform:'uppercase',letterSpacing:'1px',marginTop:'2px'}}>Control Center</div>
              </div>
            </>
          )}
        </a>

        {/* User */}
        <div style={{padding:'12px 18px',borderBottom:'1px solid rgba(255,255,255,0.06)',display:'flex',alignItems:'center',gap:'10px'}}>
          <div style={{width:'32px',height:'32px',background:'#f97316',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:'700',fontSize:'12px',color:'#fff',flexShrink:0}}>
            {user?.nome?.substring(0,2).toUpperCase() || 'DA'}
          </div>
          <div>
            <div style={{fontSize:'13px',fontWeight:'600',color:'#fff',lineHeight:1}}>{user?.nome || 'Admin'}</div>
            <div style={{display:'flex',alignItems:'center',gap:'4px',marginTop:'3px'}}>
              <div style={{width:'6px',height:'6px',background:'#22c55e',borderRadius:'50%'}}></div>
              <div style={{fontSize:'10px',color:'#6b9ab8',fontWeight:'500'}}>Online</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{flex:1,padding:'8px 0',overflowY:'auto'}}>
          {NAV.map(item => {
            const isActive = path === item.href || path.startsWith(item.href + '/')
            const hasSub = item.sub && item.sub.length > 0
            const isOpen = openMenus[item.href]

            return (
              <div key={item.href}>
                {hasSub ? (
                  <div
                    onClick={(e) => toggleMenu(item.href, e.currentTarget as HTMLElement)}
                    style={{
                      display:'flex',alignItems:'center',gap:'9px',
                      padding:'8px 18px',cursor:'pointer',
                      color: isActive ? '#fff' : '#8aabb8',
                      fontSize:'12.5px',
                      background: isActive ? 'rgba(249,115,22,0.12)' : 'transparent',
                      borderLeft: isActive ? '3px solid #f97316' : '3px solid transparent',
                      fontWeight: isActive ? '600' : '400',
                      userSelect:'none',
                    }}>
                    <span style={{fontSize:'13px',width:'16px',textAlign:'center',opacity:.8}}>{item.icon}</span>
                    <span style={{flex:1}}>{item.label}</span>
                    <span style={{fontSize:'10px',color:'#4a7090',transition:'transform 0.2s',display:'inline-block',transform:isOpen?'rotate(90deg)':'rotate(0deg)'}}>▶</span>
                  </div>
                ) : (
                  <a href={item.href} style={{
                    display:'flex',alignItems:'center',gap:'9px',
                    padding:'8px 18px',
                    color: isActive ? '#fff' : '#8aabb8',
                    fontSize:'12.5px',textDecoration:'none',
                    background: isActive ? 'rgba(249,115,22,0.12)' : 'transparent',
                    borderLeft: isActive ? '3px solid #f97316' : '3px solid transparent',
                    fontWeight: isActive ? '600' : '400',
                  }}>
                    <span style={{fontSize:'13px',width:'16px',textAlign:'center',opacity:.8}}>{item.icon}</span>
                    <span style={{flex:1}}>{item.label}</span>
                  </a>
                )}

                {/* Submenu */}
                {hasSub && isOpen && (
                  <div style={{background:'rgba(0,0,0,0.25)'}}>
                    {item.sub?.map(sub => (
                      <a key={sub.href} href={sub.href} style={{
                        display:'block',
                        padding:'7px 18px 7px 44px',
                        color: path === sub.href ? '#f97316' : '#6b9ab8',
                        fontSize:'12px',textDecoration:'none',
                        borderLeft: path === sub.href ? '3px solid #f97316' : '3px solid transparent',
                        fontWeight: path === sub.href ? '600' : '400',
                        background: path === sub.href ? 'rgba(249,115,22,0.08)' : 'transparent',
                      }}>
                        {sub.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        <div style={{borderTop:'1px solid rgba(255,255,255,0.06)',padding:'8px 0'}}>
          <a href="/api/auth/logout" style={{display:'flex',alignItems:'center',gap:'9px',padding:'8px 18px',color:'#6b7280',fontSize:'12.5px',textDecoration:'none'}}>
            <span style={{fontSize:'13px'}}>⏻</span> Esci
          </a>
        </div>
      </aside>

      {/* MAIN */}
      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0}}>

        {/* TOPBAR */}
        <header style={{background:'#fff',height:'48px',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 24px',borderBottom:'1px solid #e8e8e8',flexShrink:0,position:'sticky',top:0,zIndex:10}}>
          <div></div>
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <div style={{position:'relative',cursor:'pointer'}}>
              <span style={{fontSize:'18px'}}>🔔</span>
              <span style={{position:'absolute',top:'-2px',right:'-4px',width:'8px',height:'8px',background:'#f97316',borderRadius:'50%',border:'2px solid #fff'}}></span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'6px',cursor:'pointer',padding:'4px 10px',borderRadius:'6px',border:'1px solid #e8e8e8'}}>
              <div style={{width:'26px',height:'26px',background:'#f97316',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:'700',fontSize:'11px',color:'#fff'}}>
                {user?.nome?.substring(0,2).toUpperCase() || 'DA'}
              </div>
              <span style={{fontSize:'13px',fontWeight:'500',color:'#333'}}>{user?.nome || 'Admin'}</span>
              <span style={{fontSize:'10px',color:'#bbb'}}>▾</span>
            </div>
          </div>
        </header>

        {/* CONTENT */}
        <main style={{flex:1,padding:'24px',overflowY:'auto'}}>
          {children}
        </main>
      </div>
    </div>
  )
}
