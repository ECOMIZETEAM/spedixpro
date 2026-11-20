'use client'
import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// I SUGGERIMENTI (rubrica, comuni) DISEGNATI FUORI DALLA SEZIONE. Le sezioni di vetro chiudono dentro di sé tutto ciò
// che è «fixed» o che sborda: una tendina dentro la sezione verrebbe tagliata al bordo. La si disegna in fondo alla
// pagina (createPortal su document.body), piazzata sul campo e ricalcolata su scorrimento e ridimensionamento; si
// apre verso l'alto se sotto non c'è spazio. Stessa soluzione della TendinaPortata dei moduli di oggi.
export default function Tendina({ ancora, aperta, maxAltezza = 240, children }: {
  ancora: { current: HTMLElement | null }; aperta: boolean; maxAltezza?: number; children: React.ReactNode
}) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [montata, setMontata] = useState(false)
  useEffect(() => { setMontata(true) }, [])
  useLayoutEffect(() => {
    if (!aperta) { setPos(null); return }
    const misura = () => {
      const r = ancora.current?.getBoundingClientRect()
      if (!r) return
      const sotto = window.innerHeight - r.bottom
      const inAlto = sotto < maxAltezza + 20 && r.top > sotto
      setPos({ top: inAlto ? Math.max(8, r.top - maxAltezza - 4) : r.bottom + 4, left: r.left, width: r.width })
    }
    misura()
    window.addEventListener('scroll', misura, true)
    window.addEventListener('resize', misura)
    return () => { window.removeEventListener('scroll', misura, true); window.removeEventListener('resize', misura) }
  }, [aperta, maxAltezza, ancora])
  if (!aperta || !montata || !pos) return null
  return createPortal(
    <div className="ns-tendina" role="listbox" style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: maxAltezza }}>{children}</div>,
    document.body)
}
