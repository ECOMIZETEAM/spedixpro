'use client'
import { useEffect, useState } from 'react'

// ANNUNCIO DELL'INTEGRAZIONE TIKTOK SHOP, in cima ai portali master e cliente.
//
// L'app MoovExpress e' sull'App Store di TikTok Shop dal 10/11/2026, e dal 12/11 il negozio si collega anche
// da Integrazioni. Lorenzo, 12/11: lo stesso banner fatto per Shopify (6/11), per vedere chi collega e cosa fa.
// Prende il posto di quello Shopify, scaduto l'11/11. Le notifiche non bastano: quelle di rete non arrivano ai
// clienti dei sotto-master.
//
// Si spegne da solo alla data qui sotto, senza rilascio: passata la data il componente non disegna nulla
// e si puo' togliere con calma. Chi lo chiude non lo rivede in quel browser; la memoria del browser puo'
// mancare (navigazione privata, dati cancellati) e allora il banner torna, che e' il male minore.
const FINE = Date.parse('2026-11-17T23:00:00Z') // mezzanotte italiana fra il 17 e il 18 novembre
const CHIAVE = 'banner-novita-tiktok-2026-11'

export default function BannerNovitaTiktok({ per }: { per: 'cliente' | 'master' }) {
  // Si decide dopo il caricamento: sul server non c'e' la memoria del browser, e l'ora la guarda il browser.
  const [visibile, setVisibile] = useState(false)

  useEffect(() => {
    if (Date.now() >= FINE) return
    let chiuso = false
    try { chiuso = localStorage.getItem(CHIAVE) === '1' } catch {}
    if (!chiuso) setVisibile(true)
  }, [])

  if (!visibile) return null

  const chiudi = () => {
    setVisibile(false)
    try { localStorage.setItem(CHIAVE, '1') } catch {}
  }

  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
      background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px',
      padding: '11px 16px', marginBottom: '16px', fontSize: '13px', color: '#0f172a',
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
      </svg>
      <div style={{ flex: 1, minWidth: '220px', lineHeight: 1.5 }}>
        <strong>Novità: integrazione TikTok Shop attiva.</strong>{' '}
        {per === 'cliente'
          ? <>Collega il tuo negozio TikTok Shop: gli ordini da spedire arrivano qui da soli e il numero di tracciamento torna su TikTok, con l&apos;ordine segnato come spedito.</>
          : <>I tuoi clienti possono collegare il loro negozio TikTok Shop dal portale, in Integrazioni, o installando MoovExpress dall&apos;App Store di TikTok: gli ordini arrivano da soli e il numero di tracciamento torna su TikTok.</>}
      </div>
      {per === 'cliente' && (
        <a href="/cliente/integrazioni" style={{
          background: '#111827', color: '#fff', textDecoration: 'none', borderRadius: '6px',
          padding: '7px 14px', fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap',
        }}>Collega il negozio</a>
      )}
      <button onClick={chiudi} aria-label="Chiudi" style={{
        background: 'transparent', border: 'none', color: '#0f172a', fontSize: '18px',
        lineHeight: 1, cursor: 'pointer', opacity: 0.6, padding: '0 2px',
      }}>×</button>
    </div>
  )
}
