'use client'
// Le azioni di una riga dietro i tre puntini (18/11, Lorenzo: «raggrupparle coi tre puntini e una tendina»). Ogni voce
// ha il suo nome scritto accanto all'icona; quella che cancella sta in fondo, in rosso, dopo un filo.
// La tendina è «fixed» e si posiziona sul tasto: la tabella scorre in orizzontale e taglierebbe una tendina «absolute»
// sulle ultime righe. Se sotto non c'è spazio si apre verso l'alto. Si chiude con un clic fuori, con Esc o scorrendo.
import { useEffect, useRef, useState } from 'react'
import { Icona } from './icone'

export type VoceAzione = { k: string; etichetta: string; icona: string; fai: () => void; pericolo?: boolean; spenta?: boolean; titolo?: string }

export default function MenuAzioni({ voci, etichetta = 'Altre azioni' }: { voci: VoceAzione[]; etichetta?: string }) {
  const tasto = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ right: number; top?: number; bottom?: number } | null>(null)

  const apri = () => {
    if (pos) { setPos(null); return }
    const r = tasto.current!.getBoundingClientRect()
    const alto = voci.length * 40 + 24
    const right = Math.max(8, window.innerWidth - r.right)
    setPos(r.bottom + alto + 12 > window.innerHeight ? { right, bottom: window.innerHeight - r.top + 6 } : { right, top: r.bottom + 6 })
  }
  useEffect(() => {
    if (!pos) return
    const fuori = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !tasto.current?.contains(e.target as Node)) setPos(null) }
    const chiudi = () => setPos(null)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPos(null) }
    document.addEventListener('mousedown', fuori); window.addEventListener('scroll', chiudi, true); window.addEventListener('resize', chiudi); window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fuori); window.removeEventListener('scroll', chiudi, true); window.removeEventListener('resize', chiudi); window.removeEventListener('keydown', esc) }
  }, [pos])

  const pericolose = voci.filter(v => v.pericolo), normali = voci.filter(v => !v.pericolo)
  const voce = (v: VoceAzione) => (
    <button key={v.k} type="button" role="menuitem" className={'am-voce' + (v.pericolo ? ' am-pericolo' : '')} disabled={v.spenta} title={v.titolo}
      onClick={() => { setPos(null); if (!v.spenta) v.fai() }}>
      <Icona id={v.icona} /><span>{v.etichetta}</span>
    </button>
  )
  return (
    <>
      <button ref={tasto} type="button" className={'am-tasto' + (pos ? ' am-aperto' : '')} onClick={apri} aria-haspopup="menu" aria-expanded={!!pos} title={etichetta} aria-label={etichetta}>
        <Icona id="i-altro" />
      </button>
      {pos && (
        <div ref={menu} className={'am-menu' + (pos.bottom != null ? ' am-su' : '')} role="menu" style={{ right: pos.right, top: pos.top, bottom: pos.bottom }}>
          {normali.map(voce)}
          {pericolose.length > 0 && normali.length > 0 && <i className="am-filo" aria-hidden="true" />}
          {pericolose.map(voce)}
        </div>
      )}
    </>
  )
}
