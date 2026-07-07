'use client'

import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'

const ACCENT = '#f97316'

type SubItem = { label: string; href: string }
type NavItem = { id: string; label: string; icon: string; href?: string; sub?: SubItem[] }

// ── Voci del menu (modifica qui per aggiungere/rinominare) ──────────────────
const NAV_BASE: NavItem[] = [
  {
    id: 'spedizioni', label: 'Spedizioni', icon: '◫',
    sub: [
      { label: 'Nuova Spedizione', href: '/cliente/spedizioni/nuova' },
      { label: 'Elenco Spedizioni', href: '/cliente/spedizioni' },
      { label: 'Crea Distinta', href: '/cliente/distinte/nuova' },
      { label: 'Lista Distinte', href: '/cliente/distinte' },
      { label: 'Giacenze', href: '/cliente/spedizioni/giacenze' },
      { label: 'Contrassegni', href: '/cliente/contrassegni' },
      { label: 'Spedizioni Cancellate', href: '/cliente/spedizioni/cancellate' },
    ],
  },
  {
    id: 'importa', label: 'Importa Ordini', icon: '↓',
    sub: [
      { label: 'Da file CSV', href: '/cliente/importa' },
      { label: 'Negozi collegati', href: '/cliente/integrazioni' },
    ],
  },
  {
    id: 'ritiri', label: 'Ritiri', icon: '↩',
    sub: [
      { label: 'Nuovo Ritiro', href: '/cliente/ritiri/nuovo' },
      { label: 'Elenco Ritiri', href: '/cliente/ritiri' },
    ],
  },
  { id: 'resi', label: 'Resi', icon: '↺', href: '/cliente/resi/distinte' },
  { id: 'fatture', label: 'Fatture', icon: '◻', href: '/cliente/fatture' },
  {
    id: 'assistenza', label: 'Assistenza', icon: '🎧',
    sub: [
      { label: 'Ticket', href: '/cliente/assistenza' },
      { label: 'POD', href: '/cliente/assistenza/pod' },
    ],
  },
  {
    id: 'reports', label: 'Reports', icon: '◈',
    sub: [
      { label: 'Report Spedizioni', href: '/cliente/reports/spedizioni' },
      { label: 'Report Distinte', href: '/cliente/reports/distinte' },
      { label: 'Report Contrassegni', href: '/cliente/reports/contrassegni' },
      { label: 'Report Consumabili', href: '/cliente/reports/consumabili' },
      { label: 'Report Rettifiche', href: '/cliente/reports/rettifiche' },
    ],
  },
  {
    id: 'account', label: 'Mio Account', icon: '⊙',
    sub: [
      { label: 'Listino Prezzi', href: '/cliente/listino' },
      { label: 'Lista Movimenti', href: '/cliente/movimenti' },
    ],
  },
  {
    id: 'impostazioni', label: 'Impostazioni', icon: '◉',
    sub: [
      { label: 'Pacchi', href: '/cliente/impostazioni/pacchi' },
      { label: 'Stampa e Notifiche', href: '/cliente/impostazioni/stampa-notifiche' },
      { label: 'Cambia Password', href: '/cliente/impostazioni/cambia-password' },
      { label: 'API Key', href: '/cliente/impostazioni/api-key' },
      { label: 'Logo', href: '/cliente/impostazioni/logo' },
    ],
  },
]

export default function ClienteNav() {
  const pathname = usePathname() || ''
  // Sottovoci dinamiche "Ordini {Piattaforma}" per ogni integrazione attiva del cliente
  const [integrazioni, setIntegrazioni] = useState<any[]>([])
  useEffect(() => {
    fetch('/api/integrazioni/lista').then(r=>r.json()).then(d=>{
      const lista = Array.isArray(d) ? d : (d?.integrazioni || [])
      setIntegrazioni(lista.filter((i:any)=>i.stato==='attivo'))
    }).catch(()=>{})
  }, [])
  // Badge notifiche assistenza (aggiornamenti ai propri ticket)
  const [ticketBadge, setTicketBadge] = useState<{ count: number; ticket: number; pod: number }>({ count: 0, ticket: 0, pod: 0 })
  useEffect(() => {
    const load = () => fetch('/api/assistenza/non-letti').then(r=>r.json()).then(d=>setTicketBadge({ count: d.count||0, ticket: d.ticket||0, pod: d.pod||0 })).catch(()=>{})
    load(); const t = setInterval(load, 30000); return () => clearInterval(t)
  }, [pathname])
  const badgeStyle = { background: '#dc2626', color: '#fff', fontSize: '10px', fontWeight: 700, minWidth: '17px', height: '17px', borderRadius: '9px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' } as const
  const NOMI_PIATT: Record<string,string> = { shopify:'Shopify', prestashop:'PrestaShop', woocommerce:'WooCommerce' }
  const piattAttive = Array.from(new Set(integrazioni.map((i:any)=>i.piattaforma)))
  const NAV: NavItem[] = NAV_BASE.map(sec => {
    if (sec.id !== 'importa') return sec
    const extra = piattAttive.map((p:string)=> ({ label: 'Ordini '+(NOMI_PIATT[p]||p), href: '/cliente/ordini/'+p }))
    return { ...sec, sub: [ ...(sec.sub||[]), ...extra ] }
  })

  // Href attivo = il prefisso più lungo che combacia col path corrente
  // (gestisce correttamente /spedizioni vs /spedizioni/nuova)
  const allHrefs: string[] = []
  NAV.forEach(i => {
    if (i.href) allHrefs.push(i.href)
    i.sub?.forEach(s => allHrefs.push(s.href))
  })
  const activeHref =
    allHrefs
      .filter(h => pathname === h || pathname.startsWith(h + '/'))
      .sort((a, b) => b.length - a.length)[0] || ''

  const leafActive = (href?: string) => !!href && href === activeHref
  const sectionActive = (item: NavItem) =>
    leafActive(item.href) || (item.sub?.some(s => leafActive(s.href)) ?? false)

  // Come il master: all'avvio apre solo la sezione attiva.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    NAV.forEach(i => { if (i.sub?.length && sectionActive(i)) init[i.id] = true })
    return init
  })
  // Come il master: apre una sola tendina alla volta (chiude le altre) e, se la si apre,
  // la porta in vista con lo scroll cosi si vede per intero senza scendere a mano.
  const toggle = (id: string, el?: HTMLElement) => {
    const staAprendo = !open[id]
    setOpen(prev => ({ [id]: !prev[id] }))
    if (staAprendo && el) {
      setTimeout(() => { el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 80)
    }
  }

  return (
    <nav style={{ flex: 1, padding: '6px 0' }}>
      <style>{`
        .spx-item{
          display:flex;align-items:center;gap:9px;padding:8px 18px;
          font-size:12.5px;text-decoration:none;cursor:pointer;
          background:transparent;width:100%;text-align:left;
          color:#8aabb8;font-family:inherit;
          border:none;border-left:3px solid transparent;
        }
        .spx-item:hover{color:#fff}
        .spx-sub{
          display:block;padding:7px 18px 7px 44px;font-size:12px;
          text-decoration:none;color:#6b9ab8;border-left:3px solid transparent;
        }
        .spx-sub:hover{color:#fff}
      `}</style>

      {NAV.map(item => {
        const hasSub = !!item.sub?.length
        const active = sectionActive(item)

        if (hasSub) {
          const isOpen = !!open[item.id]
          return (
            <div key={item.id}>
              <button
                type="button"
                className="spx-item"
                onClick={(e) => toggle(item.id, e.currentTarget as HTMLElement)}
                style={{
                  justifyContent: 'space-between',
                  ...(active ? { color: '#fff', fontWeight: 600, background: 'rgba(249,115,22,0.12)', borderLeft: `3px solid ${ACCENT}` } : {}),
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '11px', width: '14px', opacity: active ? 1 : 0.55 }}>{item.icon}</span>
                  {item.label}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {item.id === 'assistenza' && !isOpen && ticketBadge.count > 0 && <span style={badgeStyle}>{ticketBadge.count}</span>}
                  <span style={{
                    fontSize: '9px', opacity: 0.7,
                    transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .12s',
                  }}>▶</span>
                </span>
              </button>

              {isOpen && (
                <div style={{ padding: '2px 0 6px', background: 'rgba(0,0,0,0.25)' }}>
                  {item.sub!.map(s => {
                    const sActive = leafActive(s.href)
                    const sBadge = s.href === '/cliente/assistenza' ? ticketBadge.ticket : s.href === '/cliente/assistenza/pod' ? ticketBadge.pod : 0
                    return (
                      <a
                        key={s.href}
                        href={s.href}
                        className="spx-sub"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', ...(sActive ? {
                          color: ACCENT, fontWeight: 600,
                          background: 'rgba(249,115,22,0.08)',
                          borderLeft: `3px solid ${ACCENT}`,
                        } : {}) }}
                      >
                        <span style={{ flex: 1 }}>{s.label}</span>
                        {sBadge > 0 && <span style={badgeStyle}>{sBadge}</span>}
                      </a>
                    )
                  })}
                </div>
              )}
            </div>
          )
        }

        // Voce singola (leaf)
        return (
          <a
            key={item.id}
            href={item.href}
            className="spx-item"
            style={active ? { background: 'rgba(249,115,22,0.12)', color: '#fff', fontWeight: 600, borderLeft: `3px solid ${ACCENT}` } : {}}
          >
            <span style={{ fontSize: '11px', width: '14px', opacity: active ? 1 : 0.55 }}>{item.icon}</span>
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.id === 'assistenza' && ticketBadge > 0 && (
              <span style={{ background: '#dc2626', color: '#fff', fontSize: '10px', fontWeight: 700, minWidth: '17px', height: '17px', borderRadius: '9px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{ticketBadge}</span>
            )}
          </a>
        )
      })}
    </nav>
  )
}
