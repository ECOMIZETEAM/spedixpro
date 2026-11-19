'use client'
// I DATI DELLA PLANCIA, uguali per le quattro proposte (27/10): le stesse rotte della Plancia di oggi e della v11,
// lette dal browser con la sessione di chi guarda. Nessun numero scritto a mano. Si rileggono ogni 2 minuti a
// scheda visibile e al ritorno sulla scheda, come la Plancia di oggi.
//   /api/dashboard               il quadro del master (vedi la forma in fondo)
//   /api/dashboard/giornata      le create di oggi ora per ora
//   /api/network/badge           rettifiche da confermare, richieste della rete
// Le altre rotte (soldi per periodo, destinazioni, resi, contratti di oggi) le legge chi le usa, con usaJson.
import { useContext, useEffect, useState } from 'react'
import { GraficaNuova } from '../contesto'

export function useDatiPlancia() {
  const g = useContext(GraficaNuova)
  const chiave = 'plancia_proposte_v1|' + g.chi
  const [data, setData] = useState<any>(null)
  const [giornata, setGiornata] = useState<any>(null)
  const [badge, setBadge] = useState<any>(null)
  const [quando, setQuando] = useState<Date | null>(null)
  useEffect(() => {
    // la copia di sessione si legge DOPO l'apertura (letta subito, server e browser disegnerebbero due pagine diverse)
    try { const c = sessionStorage.getItem(chiave); if (c) setData(JSON.parse(c)) } catch {}
    setQuando(new Date())
    let vivo = true, ultimo = 0
    const carica = () => {
      const t = Date.now(); if (t - ultimo < 1000) return; ultimo = t
      fetch('/api/dashboard', { cache: 'no-store' }).then(r => r.json()).then(d => { if (vivo && d && !d.error) { setData(d); setQuando(new Date()); try { sessionStorage.setItem(chiave, JSON.stringify(d)) } catch {} } }).catch(() => {})
      fetch('/api/dashboard/giornata', { cache: 'no-store' }).then(r => r.json()).then(d => { if (vivo && d && !d.error) setGiornata(d) }).catch(() => {})
      fetch('/api/network/badge', { cache: 'no-store' }).then(r => r.json()).then(d => { if (vivo && d && !d.error) setBadge(d) }).catch(() => {})
    }
    carica()
    const t = setInterval(() => { if (document.visibilityState === 'visible') carica() }, 120000)
    const torna = () => { if (document.visibilityState === 'visible') carica() }
    document.addEventListener('visibilitychange', torna); window.addEventListener('focus', torna)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', torna); window.removeEventListener('focus', torna) }
  }, [chiave])
  return { data, giornata, badge, quando, luce: g.luce, tema: g.tema, entrata: g.entrata }
}
