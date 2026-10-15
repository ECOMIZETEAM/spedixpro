'use client'
import { useEffect, useRef, useState } from 'react'

// COSTO DI UNA RICHIESTA POD, PRIMA DI APRIRLA, E CONSENSO DEL CLIENTE.
// Decisione del committente (15/10/2026): il cliente vede quanto paga (dipende dal vettore della
// spedizione, dal listino POD del suo master), accetta, e la cifra gli viene addebitata subito
// all'apertura; la POD si chiede solo a pacco consegnato. Sta in un componente solo perche' le porte
// da cui il cliente apre una POD sono due — Assistenza → POD e il pulsante 🎧 sull'elenco spedizioni —
// e il testo del consenso dev'essere lo stesso. Il controllo vero lo rifa' il server
// (app/api/assistenza/apri): qui si mostra la cifra e si raccoglie il si'.
//
// onStato → { pronta, prezzo }: pronta = si puo' inviare; prezzo = la cifra accettata, da mandare
// all'apertura. Chi non e' un cliente (il master che chiede la POD alla sua linea superiore) non paga:
// l'anteprima non gli risponde e il componente non mostra niente.
export type StatoPodCosto = { pronta: boolean; prezzo: number | null }

type Info = { ldv: string; cliente: boolean; tentativo?: number; errore?: boolean; trovata?: boolean; consegnata?: boolean; prezzo?: number }
const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n)

export default function PodCosto({ ldv, onStato }: { ldv: string; onStato: (s: StatoPodCosto) => void }) {
  const l = ldv.trim()
  // Risposta e consenso valgono per la LDV (e la cifra) a cui si riferiscono: se il cliente cambia LDV,
  // o la cifra cambia, il si' dato prima non vale piu' e va ridato.
  const [risposta, setRisposta] = useState<Info | null>(null)
  const [accettato, setAccettato] = useState<string | null>(null)
  const [tentativo, setTentativo] = useState(0)   // "Riprova" dopo un errore: rilancia la verifica
  const onStatoRef = useRef(onStato)
  useEffect(() => { onStatoRef.current = onStato })

  useEffect(() => {
    if (l.length < 4) return
    let vivo = true
    // Senza un limite, una risposta che non arriva lasciava "Verifico la spedizione…" per sempre e il
    // pulsante bloccato: dopo 15 secondi vale come errore, e si puo' riprovare.
    const ctrl = new AbortController()
    const h = setTimeout(async () => {
      const limite = setTimeout(() => ctrl.abort(), 15000)
      try {
        const r = await fetch('/api/assistenza/pod-prezzo?ldv=' + encodeURIComponent(l), { signal: ctrl.signal })
        if (!vivo) return
        if (r.status === 403) { setRisposta({ ldv: l, cliente: false }); return }
        const d = await r.json()
        if (vivo) setRisposta(d && typeof d.trovata === 'boolean' ? { ...d, ldv: l, cliente: true, tentativo } : { ldv: l, cliente: true, errore: true, tentativo })
      } catch {
        if (vivo) setRisposta({ ldv: l, cliente: true, errore: true, tentativo })
      } finally {
        clearTimeout(limite)
      }
    }, 400)
    return () => { vivo = false; clearTimeout(h); ctrl.abort() }
  }, [l, tentativo])

  const info = risposta && risposta.ldv === l && l.length >= 4 && (risposta.tentativo ?? tentativo) === tentativo ? risposta : null
  const prezzo = Number(info?.prezzo || 0)
  const chiave = `${l}|${prezzo}`
  const accetto = accettato === chiave
  const pronta = !!info && (!info.cliente || (!!info.trovata && !!info.consegnata && (prezzo <= 0 || accetto)))
  const prezzoOut = info?.cliente && info.consegnata ? prezzo : null
  useEffect(() => { onStatoRef.current({ pronta, prezzo: prezzoOut }) }, [pronta, prezzoOut])

  if (l.length < 4 || (info && !info.cliente)) return null
  const box = (bg: string, bordo: string, colore: string) => ({ marginBottom: '12px', padding: '10px 12px', borderRadius: '6px', fontSize: '12.5px', fontWeight: 600 as const, background: bg, border: `1px solid ${bordo}`, color: colore })
  if (!info) return <div style={{ marginBottom: '12px', fontSize: '12px', color: '#6b7280' }}>Verifico la spedizione…</div>
  if (info.errore) return (
    <div style={box('#fef2f2', '#fecaca', '#b91c1c')}>
      Non riesco a verificare la spedizione.{' '}
      <button type="button" onClick={() => setTentativo(t => t + 1)} style={{ border: 'none', background: 'none', padding: 0, color: '#b91c1c', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', fontSize: '12.5px' }}>Riprova</button>
    </div>
  )
  if (!info.trovata) return <div style={box('#fffbeb', '#fde68a', '#b45309')}>Non troviamo questa LDV tra le tue spedizioni: controlla il numero.</div>
  if (!info.consegnata) return <div style={box('#fef2f2', '#fecaca', '#b91c1c')}>Questa spedizione non risulta ancora consegnata: la POD (prova di consegna) si può chiedere solo dopo la consegna.</div>
  if (prezzo <= 0) return <div style={box('#f0fdf4', '#bbf7d0', '#15803d')}>Questa richiesta POD è gratuita.</div>
  return (
    <div style={box('#fff7ed', '#fed7aa', '#c2410c')}>
      <div style={{ marginBottom: '8px' }}>La POD di questa spedizione costa {eur(prezzo)}.</div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', color: '#1a1a1a', fontWeight: 500 }}>
        <input type="checkbox" checked={accetto} onChange={e => setAccettato(e.target.checked ? chiave : null)} style={{ marginTop: '2px', accentColor: '#f97316' }} />
        <span>Accetto che mi vengano addebitati {eur(prezzo)} subito, all&apos;apertura della richiesta.</span>
      </label>
    </div>
  )
}
