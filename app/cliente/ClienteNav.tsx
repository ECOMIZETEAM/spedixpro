'use client'

import { usePathname } from 'next/navigation'
import { useState } from 'react'

const ACCENT = '#f97316'

type SubItem = { label: string; href: string }
type NavItem = { id: string; label: string; icon: string; href?: string; sub?: SubItem[] }

// ── Voci del menu (modifica qui per aggiungere/rinominare) ──────────────────
const NAV: NavItem[] = [
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
  { id: 'resi', label: 'Resi', icon: '↺', href: '/cliente/resi' },
  { id: 'fatture', label: 'Fatture', icon: '◻', href: '/cliente/fatture' },
  { id: 'reports', label: 'Reports', icon: '◈', href: '/cliente/reports' },
  {
    id: 'account', label: 'Mio Account', icon: '⊙',
    sub: [
      { label: 'Listino Prezzi', href: '/cliente/listino' },
      { label: 'Lista Movimenti', href: '/cliente/movimenti' },
      { label: 'Dati Account', href: '/cliente/account' },
    ],
  },
  { id: 'impostazioni', label: 'Impostazioni', icon: '◉', href: '/cliente/impostazioni' },
]

export default function ClienteNav() {
  const pathname = usePathname() || ''

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

  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    NAV.forEach(i => { if (sectionActive(i)) init[i.id] = true })
    return init
  })
  const toggle = (id: string) => setOpen(prev => ({ ...prev, [id]: !prev[id] }))

  return (
    <nav style={{ flex: 1, padding: '6px 0' }}>
      <style>{`
        .spx-item{
          display:flex;align-items:center;gap:8px;padding:8px 16px;
          font-size:12.5px;text-decoration:none;cursor:pointer;
          border:none;background:transparent;width:100%;text-align:left;
          color:#777;font-family:inherit;
        }
        .spx-item:hover{background:#242424;color:#d4d4d4}
        .spx-sub{
          display:block;padding:6px 16px 6px 38px;font-size:12px;
          text-decoration:none;color:#666;border-left:2px solid transparent;
        }
        .spx-sub:hover{background:#202020;color:#d4d4d4}
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
                onClick={() => toggle(item.id)}
                style={{
                  justifyContent: 'space-between',
                  ...(active ? { color: ACCENT, fontWeight: 600 } : {}),
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '11px', width: '14px', opacity: active ? 1 : 0.55 }}>{item.icon}</span>
                  {item.label}
                </span>
                <span style={{
                  fontSize: '9px', opacity: 0.7,
                  transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .12s',
                }}>▶</span>
              </button>

              {isOpen && (
                <div style={{ padding: '2px 0 6px' }}>
                  {item.sub!.map(s => {
                    const sActive = leafActive(s.href)
                    return (
                      <a
                        key={s.href}
                        href={s.href}
                        className="spx-sub"
                        style={sActive ? {
                          color: ACCENT, fontWeight: 600,
                          background: 'rgba(249,115,22,.12)',
                          borderLeft: `2px solid ${ACCENT}`,
                        } : {}}
                      >
                        {s.label}
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
            style={active ? { background: ACCENT, color: '#fff', fontWeight: 600 } : {}}
          >
            <span style={{ fontSize: '11px', width: '14px', opacity: active ? 1 : 0.55 }}>{item.icon}</span>
            {item.label}
          </a>
        )
      })}
    </nav>
  )
}
