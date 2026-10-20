'use client'
import { useEffect } from 'react'

// ERRORE IMPREVISTO DENTRO IL PORTALE CLIENTE.
//
// Senza questo file un'eccezione in una pagina del cliente lasciava la pagina d'errore generica di
// Next.js, bianca e senza menu: per chi la vede e' «la pagina non funziona», e per Shopify e' uno degli
// errori web che fanno respingere l'app (requisiti 2.1.1-2.1.3). Qui l'errore resta DENTRO il portale:
// questo file si disegna sotto il layout di /cliente, quindi menu e intestazione restano al loro posto.
//
// Non mostra mai error.message: in produzione per gli errori del server e' generico, e per quelli del
// browser puo' contenere dettagli tecnici. Mostra il digest, che non dice niente a chi lo legge ma
// permette di ritrovare l'errore nei log del server se il cliente lo riporta in un ticket.
export default function ErroreCliente({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error('[CLIENTE][ERRORE PAGINA]', error) }, [error])

  return (
    <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', padding: '40px 24px', textAlign: 'center' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a', margin: '0 0 8px' }}>Questa pagina non si è caricata</h1>
      <p style={{ fontSize: '13.5px', color: '#666', margin: '0 0 20px', lineHeight: 1.5 }}>
        Si è verificato un errore imprevisto. Riprova; se si ripete, torna alla dashboard e apri un ticket in Assistenza.
      </p>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => retry()} style={{ background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
          Riprova
        </button>
        <a href="/cliente/dashboard" style={{ background: '#fff', color: '#333', border: '1px solid #ddd', borderRadius: '6px', padding: '9px 18px', fontSize: '13px', textDecoration: 'none' }}>
          Torna alla dashboard
        </a>
        <a href="/cliente/assistenza" style={{ background: '#fff', color: '#333', border: '1px solid #ddd', borderRadius: '6px', padding: '9px 18px', fontSize: '13px', textDecoration: 'none' }}>
          Apri un ticket
        </a>
      </div>
      {error.digest && <div style={{ marginTop: '18px', fontSize: '11px', color: '#999' }}>Codice errore: {error.digest}</div>}
    </div>
  )
}
