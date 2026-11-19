'use client'
// IL MOVIMENTO della Plancia nuova (27/10, Lorenzo: «i riferimenti hanno transizioni e animazioni migliori, anche nello
// scroll»). Niente che segua il mouse (gli dà mal di testa): solo lo scorrimento, l'entrata, i numeri.
// - scorrimento morbido (Lenis) sul contenitore della pagina, solo sulla Plancia;
// - Conta: un numero sale dal valore di prima a quello nuovo (da zero la prima volta che si vede);
// - useRivela: le sezioni sotto la prima schermata entrano quando arrivano (classe pn-visto, il disegno è nei fogli).
// Chi ha chiesto meno movimento al sistema (prefers-reduced-motion) vede tutto fermo e subito.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Lenis from 'lenis'

export const calmo = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// lo scorrimento morbido: l'inerzia dei siti premium. Ritorna l'istanza (per ascoltare lo scorrimento), o null
export function useScorrimentoMorbido(radice: React.RefObject<HTMLElement | null>) {
  const [lenis, setLenis] = useState<Lenis | null>(null)
  useEffect(() => {
    const contenuto = radice.current, pagina = contenuto?.closest('.gx-pagina') as HTMLElement | null
    if (!pagina || !contenuto || calmo()) return
    const l = new Lenis({ wrapper: pagina, content: pagina, eventsTarget: pagina, lerp: 0.085, smoothWheel: true, autoRaf: true, allowNestedScroll: true })
    // la pagina si allunga quando arrivano i dati (le sezioni, la mappa): Lenis misura il contenitore, che non cambia
    // di misura, e senza questo lo scorrimento si fermava all'Italia
    const ro = new ResizeObserver(() => l.resize()); ro.observe(contenuto)
    setLenis(l)
    return () => { ro.disconnect(); l.destroy(); setLenis(null) }
  }, [radice])
  return lenis
}

// Conta: il numero sale fino al valore. La prima volta parte da zero quando entra nello schermo; dopo, a ogni
// aggiornamento dei dati, scorre dal vecchio al nuovo (mezzo secondo). `children` riceve il valore da disegnare.
const facile = (k: number) => 1 - Math.pow(1 - k, 4)
export function Conta({ v, children, durata }: { v: number; children: (n: number) => ReactNode; durata?: number }) {
  const box = useRef<HTMLSpanElement>(null)
  const [n, setN] = useState(v)
  const visto = useRef(false), ultimo = useRef(0), raf = useRef(0)
  useEffect(() => {
    if (!isFinite(v)) return
    const corri = (da: number, a: number, ms: number) => {
      cancelAnimationFrame(raf.current)
      if (calmo() || da === a) { setN(a); ultimo.current = a; return }
      const t0 = performance.now()
      const passo = (t: number) => {
        // il primo fotogramma può avere un orario di poco precedente a t0: senza il limite a zero usciva «−0»
        const k = Math.min(1, Math.max(0, (t - t0) / ms)), x = da + (a - da) * facile(k)
        setN(x); if (k < 1) raf.current = requestAnimationFrame(passo); else ultimo.current = a
      }
      raf.current = requestAnimationFrame(passo)
    }
    if (visto.current) { corri(ultimo.current, v, 600); return }
    // la prima volta: aspetta di essere nello schermo, poi da zero
    const el = box.current
    if (!el || !('IntersectionObserver' in window)) { visto.current = true; setN(v); ultimo.current = v; return }
    setN(0)
    const oss = new IntersectionObserver((e) => {
      if (!e[0].isIntersecting) return
      oss.disconnect(); visto.current = true
      corri(0, v, durata || (Math.abs(v) > 1000 ? 1400 : 1100))
    }, { threshold: 0.4 })
    oss.observe(el)
    return () => { oss.disconnect(); cancelAnimationFrame(raf.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v])
  // i decimali solo dove il valore li ha (gli euro): un intero resta intero anche a metà corsa
  const mostra = Number.isInteger(v) ? Math.round(n) : Math.round(n * 100) / 100
  return <span ref={box} className="pn-conta">{children(mostra)}</span>
}

// le sezioni entrano quando arrivano: pn-anima sulla radice (solo col JavaScript acceso: senza, tutto resta visibile),
// pn-visto su ogni sezione la prima volta che ne compare un terzo
export function useRivela(radice: React.RefObject<HTMLElement | null>, dipende: unknown) {
  useEffect(() => {
    const r = radice.current
    if (!r || calmo() || !('IntersectionObserver' in window)) return
    r.classList.add('pn-anima')
    const oss = new IntersectionObserver((voci) => {
      for (const v of voci) if (v.isIntersecting) { v.target.classList.add('pn-visto'); oss.unobserve(v.target) }
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' })
    r.querySelectorAll('.pn-dati > section:not(.pn-visto)').forEach(s => oss.observe(s))
    return () => oss.disconnect()
  }, [radice, dipende])
}
