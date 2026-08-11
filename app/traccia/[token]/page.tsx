'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

// Pagina di tracking PUBBLICA (aperta dal destinatario tramite il link dell'SMS/email). Nessun login.
// Mobile-first: si apre quasi sempre dal telefono. Mostra solo stato + città + eventi (nessun dato
// personale), col marchio del master (white-label) o MoovExpress di ripiego.

const ARANCIO = '#FD5304'
const FASI = ['In lavorazione', 'Presa in carico', 'In transito', 'In consegna', 'Consegnata']
const INDICE_FASE: Record<string, number> = {
  in_lavorazione: 0, spedita: 1, in_transito: 2, in_consegna: 3, consegnata: 4,
  in_giacenza: 2, non_consegnato: 3, reso_mittente: 2, annullamento_pending: 0,
}
const STATI_PROBLEMA = new Set(['in_giacenza', 'non_consegnato', 'reso_mittente'])
const STATI_ANNULLO = new Set(['annullata', 'annullamento_manuale'])

interface Dati {
  brand: { nome: string; logo: string | null }
  stato: string
  stato_label: string
  riferimento: string | null
  citta: string | null
  provincia: string | null
  aggiornato_il: string | null
  eventi: { descrizione: string; luogo: string; data: string }[]
}

function dataIt(s: string | null): string {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function TrackingPubblico() {
  const params = useParams()
  const token = String((params as any)?.token || '')
  const [dati, setDati] = useState<Dati | null>(null)
  const [stato, setStato] = useState<'carico' | 'ok' | 'nontrovato'>('carico')

  useEffect(() => {
    if (!token) return
    ;(async () => {
      try {
        const r = await fetch('/api/pubblico/tracking?t=' + encodeURIComponent(token))
        if (!r.ok) { setStato('nontrovato'); return }
        setDati(await r.json()); setStato('ok')
      } catch { setStato('nontrovato') }
    })()
  }, [token])

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#f7f7f8', color: '#1a1a1a', fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 14px 40px' }
  const card: React.CSSProperties = { width: '100%', maxWidth: '520px', background: '#fff', borderRadius: '14px', boxShadow: '0 2px 16px rgba(0,0,0,0.06)', overflow: 'hidden' }

  const brandNome = dati?.brand?.nome || 'MoovExpress'
  const brandLogo = dati?.brand?.logo || null

  return (
    <div style={wrap}>
      {/* Intestazione brand */}
      <div style={{ width: '100%', maxWidth: '520px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', padding: '0 4px' }}>
        {brandLogo
          ? <img src={brandLogo} alt={brandNome} style={{ height: '30px', maxWidth: '160px', objectFit: 'contain' }} />
          : <span style={{ fontWeight: 800, fontSize: '20px', letterSpacing: '-0.3px' }}>{brandNome}</span>}
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#9ca3af', fontWeight: 600 }}>Tracking spedizione</span>
      </div>

      {stato === 'carico' && (
        <div style={card}><div style={{ padding: '48px 20px', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>Caricamento…</div></div>
      )}

      {stato === 'nontrovato' && (
        <div style={card}>
          <div style={{ padding: '44px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '34px', marginBottom: '10px' }}>🔍</div>
            <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '6px' }}>Spedizione non trovata</div>
            <div style={{ fontSize: '13.5px', color: '#6b7280', lineHeight: 1.5 }}>Controlla il link ricevuto: il codice potrebbe non essere corretto o la spedizione non è più disponibile.</div>
          </div>
        </div>
      )}

      {stato === 'ok' && dati && (() => {
        const problema = STATI_PROBLEMA.has(dati.stato)
        const annullata = STATI_ANNULLO.has(dati.stato)
        const consegnata = dati.stato === 'consegnata'
        const fase = INDICE_FASE[dati.stato] ?? 0
        const accent = annullata ? '#9ca3af' : problema ? '#d97706' : consegnata ? '#16a34a' : ARANCIO
        return (
          <div style={card}>
            {/* Stato principale */}
            <div style={{ padding: '26px 22px 18px', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Stato attuale</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: accent, flexShrink: 0 }} />
                <span style={{ fontSize: '22px', fontWeight: 800, color: accent }}>{dati.stato_label}</span>
              </div>
              {(dati.citta || dati.riferimento) && (
                <div style={{ marginTop: '10px', fontSize: '13.5px', color: '#6b7280', display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
                  {dati.citta && <span>📍 {dati.citta}{dati.provincia ? ` (${dati.provincia})` : ''}</span>}
                  {dati.riferimento && <span>🔖 {dati.riferimento}</span>}
                </div>
              )}
            </div>

            {/* Avviso per stati problematici */}
            {(problema || annullata) && (
              <div style={{ margin: '16px 18px 0', padding: '11px 13px', background: annullata ? '#f3f4f6' : '#fffbeb', border: `1px solid ${annullata ? '#e5e7eb' : '#fcd34d'}`, borderRadius: '9px', fontSize: '12.5px', color: annullata ? '#4b5563' : '#92400e', lineHeight: 1.45 }}>
                {dati.stato === 'in_giacenza' && 'La spedizione è in giacenza presso il corriere, in attesa di istruzioni o di un nuovo tentativo di consegna.'}
                {dati.stato === 'non_consegnato' && 'Il corriere ha tentato la consegna senza riuscirci. Verrà effettuato un nuovo tentativo.'}
                {dati.stato === 'reso_mittente' && 'La spedizione è in rientro verso il mittente.'}
                {annullata && 'Questa spedizione è stata annullata.'}
              </div>
            )}

            {/* Stepper (nascosto se annullata) */}
            {!annullata && (
              <div style={{ padding: '20px 22px 6px' }}>
                {FASI.map((f, i) => {
                  const fatto = i < fase
                  const corrente = i === fase
                  const attivo = fatto || corrente
                  const colore = corrente ? accent : fatto ? '#16a34a' : '#d1d5db'
                  return (
                    <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'stretch' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: attivo ? colore : '#fff', border: `2px solid ${colore}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '1px' }}>
                          {fatto && <span style={{ color: '#fff', fontSize: '11px', fontWeight: 900, lineHeight: 1 }}>✓</span>}
                          {corrente && <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#fff' }} />}
                        </div>
                        {i < FASI.length - 1 && <div style={{ width: '2px', flex: 1, minHeight: '20px', background: i < fase ? '#16a34a' : '#e5e7eb' }} />}
                      </div>
                      <div style={{ paddingBottom: '16px' }}>
                        <div style={{ fontSize: '14.5px', fontWeight: corrente ? 800 : 600, color: attivo ? '#1a1a1a' : '#9ca3af' }}>{f}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Timeline eventi reali (se presenti) */}
            {dati.eventi.length > 0 && (
              <div style={{ padding: '4px 22px 20px', borderTop: '1px solid #f0f0f0', marginTop: '6px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '16px 0 12px' }}>Storico movimenti</div>
                {dati.eventi.map((e, i) => (
                  <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: i === 0 ? accent : '#d1d5db', marginTop: '5px', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: '13.5px', color: '#1a1a1a', lineHeight: 1.4 }}>{e.descrizione}</div>
                      <div style={{ fontSize: '11.5px', color: '#9ca3af', marginTop: '2px' }}>{[dataIt(e.data), e.luogo].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Ultimo aggiornamento */}
            {dati.aggiornato_il && (
              <div style={{ padding: '12px 22px', background: '#fafafa', borderTop: '1px solid #f0f0f0', fontSize: '11.5px', color: '#9ca3af', textAlign: 'center' }}>
                Ultimo aggiornamento: {dataIt(dati.aggiornato_il)}
              </div>
            )}
          </div>
        )
      })()}

      <div style={{ marginTop: '18px', fontSize: '11.5px', color: '#b0b3ba' }}>Tracking fornito da {brandNome}</div>
    </div>
  )
}
