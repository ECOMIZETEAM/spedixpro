'use client'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'

// perm: chiave permesso richiesta (da Impostazioni Permessi). Assente = solo admin/master.
// always: sempre visibile a chiunque abbia accesso al portale.
type NavSub = { label: string, href: string, perm?: string, always?: boolean }
type NavItem = { label: string, href?: string, icon: string, perm?: string, always?: boolean, sub?: NavSub[] }

const NAV: NavItem[] = [
  { label: 'Spedizioni', href: '/dashboard/spedizioni', icon: '◫', sub: [
    { label: 'Nuova Spedizione', href: '/dashboard/spedizioni/nuova', perm: 'admin.shippings.create' },
    { label: 'Elenco Spedizioni', href: '/dashboard/spedizioni', perm: 'admin.shippings.index' },
    { label: 'Giacenze', href: '/dashboard/spedizioni/giacenze', perm: 'admin.stocks.index' },
    { label: 'Rettifica Costi', href: '/dashboard/spedizioni/rettifica', perm: 'admin.shippings.weight_corrections.index' },
    { label: 'Spedizioni Cancellate', href: '/dashboard/spedizioni/cancellate', perm: 'admin.shippings.cancelled.index' },
  ]},
  { label: 'Contrassegni', href: '/dashboard/contrassegni', icon: '¤', sub: [
    { label: 'Lista Contrassegni', href: '/dashboard/contrassegni', perm: 'admin.cod.index' },
    { label: 'Distinte Contrassegni', href: '/dashboard/contrassegni/distinte', perm: 'admin.codlists.index' },
  ]},
  { label: 'Ritiri', href: '/dashboard/ritiri', icon: '↩', sub: [
    { label: 'Nuovo Ritiro', href: '/dashboard/ritiri/nuovo', perm: 'admin.pickups.index' },
    { label: 'Elenco Ritiri', href: '/dashboard/ritiri/elenco', perm: 'admin.pickups.index' },
  ]},
  { label: 'Distinte', icon: '≡', sub: [
    { label: 'Crea Distinta', href: '/dashboard/distinte/crea', perm: 'admin.shippinglists.create' },
    { label: 'Elenco Distinte', href: '/dashboard/distinte/elenco', perm: 'admin.shippinglists.index' },
  ]},
  { label: 'Resi', href: '/dashboard/resi', icon: '↺', sub: [
    { label: 'Scansiona Resi', href: '/dashboard/resi/scansiona', perm: 'admin.renderlist.scan' },
    { label: 'Elenco Distinte Resi', href: '/dashboard/resi/distinte', perm: 'admin.renderlist.index' },
  ]},
  { label: 'Dal mio network', href: '/dashboard/network', icon: '🌐', perm: 'admin.interno.deliveries.in' },
  { label: 'Assistenza Clienti', icon: '🎧', always: true, sub: [
    { label: 'Ticket', href: '/dashboard/assistenza', always: true },
    { label: 'POD', href: '/dashboard/assistenza/pod', always: true },
  ]},
  { label: 'Tracking Interno', href: '/dashboard/tracking', icon: '◎', perm: 'admin.interno.deliveries.out' },
  { label: 'Listini Prezzi', href: '/dashboard/listini', icon: '€', sub: [
    { label: 'Nuovo Listino', href: '/dashboard/listini/clienti/nuovo', perm: 'admin.pricelists.create' },
    { label: 'Listini Clienti', href: '/dashboard/listini', perm: 'admin.pricelists.index' },
    { label: 'Listino Corrieri', href: '/dashboard/listini/corrieri/nuovo', perm: 'admin.pricelists.vector' },
    { label: 'Gestione Zone', href: '/dashboard/zone', perm: 'admin.pricelists.zones.index' },
  ]},
  { label: 'Clienti', href: '/dashboard/clienti', icon: '⊙', sub: [
    { label: 'Nuovo Cliente', href: '/dashboard/clienti/nuovo', perm: 'admin.clients.create' },
    { label: 'Elenco Clienti', href: '/dashboard/clienti', perm: 'admin.clients.index' },
    { label: 'Nuovo Master', href: '/dashboard/clienti/master/nuovo' },
    { label: 'Elenco Master', href: '/dashboard/clienti/master' },
    { label: 'Gerarchia', href: '/dashboard/clienti/gerarchia' },
  ]},
  { label: 'Autisti e Consegne', href: '/dashboard/autisti', icon: '⊡', perm: 'admin.drivers.index' },
  { label: 'Consumabili', href: '/dashboard/consumabili', icon: '▣', sub: [
    { label: 'Aggiungi Spesa', href: '/dashboard/consumabili/aggiungi', perm: 'admin.consumables.create' },
    { label: 'Storia', href: '/dashboard/consumabili/storia', perm: 'admin.consumables.index' },
  ]},
  { label: 'Fatture', href: '/dashboard/fatture', icon: '◻', sub: [
    { label: 'Elenco Fatture', href: '/dashboard/fatture', perm: 'admin.invoice.index' },
    { label: 'Nuova Fattura', href: '/dashboard/fatture/nuova', perm: 'admin.invoice.create' },
  ]},
  { label: 'Lista Movimenti', href: '/dashboard/movimenti', icon: '≣' },
  { label: 'Abbonamento', href: '/dashboard/abbonamento', icon: '★' },
  { label: 'Reports & SMS', href: '/dashboard/reports', icon: '◈', sub: [
    { label: 'Report Spedizioni', href: '/dashboard/reports/spedizioni', perm: 'admin.reports.shippings' },
    { label: 'Report Giacenze', href: '/dashboard/reports/giacenze', perm: 'admin.reports.stocks' },
    { label: 'Report Distinte', href: '/dashboard/reports/distinte', perm: 'admin.reports.shippinglists' },
    { label: 'Report Contrassegni', href: '/dashboard/reports/contrassegni', perm: 'admin.reports.cod' },
    { label: 'Report Ritiri', href: '/dashboard/reports/ritiri', perm: 'admin.reports.pickups' },
    { label: 'Report Rettifiche', href: '/dashboard/reports/rettifiche', perm: 'admin.reports.priceupdates' },
    { label: 'Report Consumabili', href: '/dashboard/reports/consumabili', perm: 'admin.reports.consumables' },
    { label: 'Report Fatture', href: '/dashboard/reports/fatture', perm: 'admin.reports.invoices' },
    { label: 'Report Resi', href: '/dashboard/reports/resi', perm: 'admin.reports.rendershippings' },
    { label: 'Report SMS Clienti', href: '/dashboard/reports/sms-clienti', perm: 'admin.reports.sms.clients' },
    { label: 'Storico Credito SMS', href: '/dashboard/reports/storico-sms', perm: 'admin.reports.sms.admin' },
  ]},
  { label: 'Impostazioni', href: '/dashboard/impostazioni', icon: '◉', sub: [
    { label: 'Azienda', href: '/dashboard/impostazioni' },
    { label: 'Logo', href: '/dashboard/impostazioni/logo' },
    { label: 'Filiale / Rete Interna', href: '/dashboard/impostazioni/filiale' },
    { label: 'Corrieri', href: '/dashboard/corrieri' },
    { label: 'Staff', href: '/dashboard/impostazioni/staff' },
    { label: 'Permessi', href: '/dashboard/impostazioni/permessi' },
    { label: 'Zone di Consegna', href: '/dashboard/listini/zone' },
    { label: 'Cambia Password', href: '/dashboard/impostazioni/password', always: true },
  ]},
  { label: 'Centro Notifiche', href: '/dashboard/notifiche', icon: '🔔', perm: 'admin.notification', sub: [
    { label: 'Invia Notifica', href: '/dashboard/notifiche/invia', perm: 'admin.notification' },
  ]},
]

export default function Layout({ children, user }: { children: React.ReactNode, user?: { nome: string, ruolo: string, brandLogo?: string | null, brandNome?: string | null, isFull?: boolean, permessi?: Record<string, boolean> } }) {
  const path = usePathname()
  const isFull = user?.isFull ?? true
  const permessi = user?.permessi || {}

  // Un elemento e visibile se: admin/master (isFull), oppure marcato always,
  // oppure ha una chiave permesso attiva. Senza perm e non-full = nascosto (solo admin).
  const puoVedere = (x: { perm?: string, always?: boolean }) =>
    isFull || x.always === true || (!!x.perm && permessi[x.perm] === true)

  const navVisibile = NAV.map(item => {
    if (item.sub && item.sub.length) {
      const sub = item.sub.filter(puoVedere)
      // Il genitore compare se ha almeno un sotto-elemento visibile
      // (o se e esso stesso esplicitamente permesso).
      if (sub.length === 0 && !(isFull || puoVedere(item))) return null
      if (sub.length === 0) return null
      return { ...item, sub }
    }
    return puoVedere(item) ? item : null
  }).filter(Boolean) as NavItem[]
  const [openMenus, setOpenMenus] = useState<Record<string,boolean>>(() => {
    const init: Record<string,boolean> = {}
    NAV.forEach(item => {
      if (!item.sub) return
      const key = item.href || item.label
      const match = (item.href && (path === item.href || path.startsWith(item.href + '/'))) ||
        item.sub.some(s => s.href && (path === s.href || path.startsWith(s.href + '/')))
      if (match) init[key] = true
    })
    return init
  })

  // Badge notifiche assistenza (ticket nuovi / aggiornamenti)
  const [ticketBadge, setTicketBadge] = useState<{ count: number; ticket: number; pod: number }>({ count: 0, ticket: 0, pod: 0 })
  useEffect(() => {
    const load = () => fetch('/api/assistenza/non-letti').then(r => r.json()).then(d => setTicketBadge({ count: d.count || 0, ticket: d.ticket || 0, pod: d.pod || 0 })).catch(() => {})
    load(); const t = setInterval(load, 30000); return () => clearInterval(t)
  }, [path])
  const badgeStyle = { background: '#dc2626', color: '#fff', fontSize: '10px', fontWeight: 700, minWidth: '17px', height: '17px', borderRadius: '9px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' } as const

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
          {navVisibile.map(item => {
            const key = item.href || item.label
            const isActive = !!item.href && (path === item.href || path.startsWith(item.href + '/'))
            const hasSub = item.sub && item.sub.length > 0
            const isOpen = openMenus[key]

            return (
              <div key={key}>
                {hasSub ? (
                  <div
                    onClick={(e) => toggleMenu(key, e.currentTarget as HTMLElement)}
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
                    {item.label === 'Assistenza Clienti' && !isOpen && ticketBadge.count > 0 && <span style={badgeStyle}>{ticketBadge.count}</span>}
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
                    {item.href === '/dashboard/assistenza' && ticketBadge > 0 && (
                      <span style={{background:'#dc2626',color:'#fff',fontSize:'10px',fontWeight:700,minWidth:'17px',height:'17px',borderRadius:'9px',display:'inline-flex',alignItems:'center',justifyContent:'center',padding:'0 5px'}}>{ticketBadge}</span>
                    )}
                  </a>
                )}

                {/* Submenu */}
                {hasSub && isOpen && (
                  <div style={{background:'rgba(0,0,0,0.25)'}}>
                    {item.sub?.map(sub => {
                      const subBadge = sub.href === '/dashboard/assistenza' ? ticketBadge.ticket : sub.href === '/dashboard/assistenza/pod' ? ticketBadge.pod : 0
                      return (
                      <a key={sub.href} href={sub.href} style={{
                        display:'flex',alignItems:'center',gap:'8px',
                        padding:'7px 18px 7px 44px',
                        color: path === sub.href ? '#f97316' : '#6b9ab8',
                        fontSize:'12px',textDecoration:'none',
                        borderLeft: path === sub.href ? '3px solid #f97316' : '3px solid transparent',
                        fontWeight: path === sub.href ? '600' : '400',
                        background: path === sub.href ? 'rgba(249,115,22,0.08)' : 'transparent',
                      }}>
                        <span style={{flex:1}}>{sub.label}</span>
                        {subBadge > 0 && <span style={badgeStyle}>{subBadge}</span>}
                      </a>
                    )})}
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
