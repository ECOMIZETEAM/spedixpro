'use client'
import { useEffect, useRef, useState } from 'react'

// UN NUMERO CHE CONTA fino al suo valore (Lorenzo 25/11: «manca qualche animazione»): all'apertura da zero, poi da quello
// che c'era quando la dashboard si aggiorna da sola. Chi nel sistema ha chiesto meno movimento vede subito il numero.
export default function Conta({ n, formato, durata = 900 }: { n: number, formato: (x: number) => string, durata?: number }) {
  const [v, setV] = useState(0)
  const da = useRef(0)
  useEffect(() => {
    const fine = Number(n) || 0
    const fermo = typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (fermo) { setV(fine); da.current = fine; return }
    const inizio = da.current, t0 = performance.now()
    let id = 0
    const passo = (t: number) => {
      const k = Math.min(1, (t - t0) / durata), e = 1 - Math.pow(1 - k, 3)
      const x = inizio + (fine - inizio) * e
      setV(k < 1 ? x : fine)
      if (k < 1) id = requestAnimationFrame(passo); else da.current = fine
    }
    id = requestAnimationFrame(passo)
    return () => { cancelAnimationFrame(id); da.current = fine }
  }, [n, durata])
  return <>{formato(v)}</>
}
