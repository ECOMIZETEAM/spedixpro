'use client'
import { useEffect, useState } from 'react'

// Tutorial di primo accesso per il cliente: overlay con i passi principali del portale.
// Skippabile e mostrato UNA sola volta (flag su clienti.impostazioni.tutorial_visto, con
// fallback su localStorage). Riapribile dalla voce "Introduzione" nel menu (evento
// 'moovx-apri-tutorial': il vecchio pulsante "?" fisso copriva "Esci" in sidebar).
const STEPS: { icon: string; titolo: string; testo: string }[] = [
  { icon: '👋', titolo: 'Benvenuto in MoovExpress', testo: 'Questo è il tuo portale per creare e gestire le spedizioni. Ti mostriamo in pochi passi le funzioni principali. Puoi saltare quando vuoi.' },
  { icon: '📦', titolo: 'Nuova Spedizione', testo: 'Da "Nuova Spedizione" crei una spedizione: inserisci destinatario, peso e misure, scegli il contratto e stampi l\'etichetta. Puoi richiamare i pacchi salvati con un clic.' },
  { icon: '⬆️', titolo: 'Importa Ordini', testo: 'Hai un e-commerce o un file? Da "Importa Ordini" carichi Shopify, Amazon, eBay o un CSV/Excel: gli ordini diventano spedizioni pronte da confermare in blocco.' },
  { icon: '🗂️', titolo: 'Elenco e Distinte', testo: 'In "Elenco Spedizioni" trovi tutte le tue spedizioni con stato, tracking e costo. In "Distinte" chiudi le spedizioni della giornata da consegnare al corriere.' },
  { icon: '💳', titolo: 'Credito', testo: 'Le spedizioni vengono scalate dal tuo credito. Tieni d\'occhio il saldo in alto a sinistra e ricaricalo quando serve per non bloccare le spedizioni.' },
  { icon: '↺', titolo: 'Resi e Giacenze', testo: 'Se una spedizione torna indietro o va in giacenza, la gestisci dalle sezioni dedicate: puoi chiedere riconsegna, cambio indirizzo o reso al mittente.' },
  { icon: '🎙️', titolo: 'Moovy, il tuo assistente', testo: 'In basso a destra c\'è Moovy: chiedigli a voce o per iscritto di tracciare una spedizione, controllare il credito e altro. Buone spedizioni!' },
]

export default function TutorialCliente() {
  const [aperto, setAperto] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    // Mostra al primo accesso: chiede al server se il tutorial è già stato visto.
    let annulla = false
    const local = typeof window !== 'undefined' && window.localStorage.getItem('moov_tutorial_cliente') === 'done'
    if (local) return
    fetch('/api/cliente/tutorial').then(r => r.json()).then(d => {
      if (annulla) return
      if (!d?.visto) setAperto(true)
    }).catch(() => { if (!annulla) setAperto(true) })
    return () => { annulla = true }
  }, [])

  // Riapertura dalla voce "Introduzione" del menu (ClienteNav dispatcha l'evento).
  useEffect(() => {
    const riapri = () => { setStep(0); setAperto(true) }
    window.addEventListener('moovx-apri-tutorial', riapri)
    return () => window.removeEventListener('moovx-apri-tutorial', riapri)
  }, [])

  const chiudi = (salvaVisto: boolean) => {
    setAperto(false)
    if (salvaVisto) {
      try { window.localStorage.setItem('moov_tutorial_cliente', 'done') } catch {}
      fetch('/api/cliente/tutorial', { method: 'POST' }).catch(() => {})
    }
  }

  if (!aperto) return null

  const s = STEPS[step]
  const ultimo = step === STEPS.length - 1

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ background: '#fff', borderRadius: 16, maxWidth: 460, width: '100%', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.35)', fontFamily: 'var(--font-geist-sans),system-ui,sans-serif' }}>
          <div style={{ background: 'linear-gradient(135deg,#1a1a1a,#333)', padding: '26px 26px 22px', color: '#fff', position: 'relative' }}>
            <button onClick={() => chiudi(true)} style={{ position: 'absolute', top: 12, right: 14, background: 'transparent', border: 'none', color: '#bbb', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            <div style={{ fontSize: 40, marginBottom: 8 }}>{s.icon}</div>
            <div style={{ fontSize: 19, fontWeight: 800 }}>{s.titolo}</div>
          </div>
          <div style={{ padding: '22px 26px' }}>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: '#333' }}>{s.testo}</p>
            {/* Indicatori step */}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 22 }}>
              {STEPS.map((_, i) => (
                <span key={i} onClick={() => setStep(i)} style={{ width: i === step ? 22 : 8, height: 8, borderRadius: 4, background: i === step ? '#f97316' : '#ddd', cursor: 'pointer', transition: 'all .2s' }} />
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 26px 22px' }}>
            <button onClick={() => chiudi(true)} style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 13.5, cursor: 'pointer', fontWeight: 600 }}>Salta</button>
            <div style={{ display: 'flex', gap: 10 }}>
              {step > 0 && (
                <button onClick={() => setStep(step - 1)} style={{ padding: '9px 16px', borderRadius: 9, border: '1px solid #ddd', background: '#fff', color: '#333', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>Indietro</button>
              )}
              <button onClick={() => ultimo ? chiudi(true) : setStep(step + 1)} style={{ padding: '9px 20px', borderRadius: 9, border: 'none', background: '#f97316', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
                {ultimo ? 'Inizia' : 'Avanti'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
