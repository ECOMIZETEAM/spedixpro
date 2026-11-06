'use client'
import { useEffect, useState } from 'react'

// ANNUNCIO DELL'INTEGRAZIONE SHOPIFY, in cima ai portali master e cliente.
//
// L'app MoovExpress e' sull'App Store di Shopify dal 6/11/2026: da quel giorno qualunque cliente collega
// il suo negozio da Integrazioni. Lorenzo, 6/11: avvisare tutti i master e tutti i clienti con un banner
// che resta 5 giorni. Le notifiche non bastavano: quelle di rete non arrivano ai clienti dei sotto-master.
//
// Si spegne da solo alla data qui sotto, senza rilascio: passata la data il componente non disegna nulla
// e si puo' togliere con calma. Chi lo chiude non lo rivede in quel browser; la memoria del browser puo'
// mancare (navigazione privata, dati cancellati) e allora il banner torna, che e' il male minore.
const FINE = Date.parse('2026-11-11T23:00:00Z') // mezzanotte italiana fra l'11 e il 12 novembre
const CHIAVE = 'banner-novita-shopify-2026-11'

export default function BannerNovitaShopify({ per }: { per: 'cliente' | 'master' }) {
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
      background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px',
      padding: '11px 16px', marginBottom: '16px', fontSize: '13px', color: '#166534',
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
      <div style={{ flex: 1, minWidth: '220px', lineHeight: 1.5 }}>
        <strong>Novità: integrazione Shopify attiva.</strong>{' '}
        {per === 'cliente'
          ? <>Collega il tuo negozio Shopify: gli ordini arrivano qui da soli e il numero di tracciamento torna su Shopify, con l&apos;ordine segnato come evaso.</>
          : <>I tuoi clienti possono collegare il loro negozio Shopify dal portale, in Integrazioni: gli ordini arrivano da soli e il numero di tracciamento torna su Shopify.</>}
      </div>
      {per === 'cliente' && (
        <a href="/cliente/integrazioni" style={{
          background: '#16a34a', color: '#fff', textDecoration: 'none', borderRadius: '6px',
          padding: '7px 14px', fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap',
        }}>Collega il negozio</a>
      )}
      <button onClick={chiudi} aria-label="Chiudi" style={{
        background: 'transparent', border: 'none', color: '#166534', fontSize: '18px',
        lineHeight: 1, cursor: 'pointer', opacity: 0.7, padding: '0 2px',
      }}>×</button>
    </div>
  )
}
