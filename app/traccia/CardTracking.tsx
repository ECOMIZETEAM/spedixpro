'use client'
import React from 'react'

// Card di tracking pubblica, condivisa fra la pagina per-token (/traccia/[token], aperta da SMS/email)
// e il portale di ricerca (/traccia, dove il cliente digita il numero). Mostra solo stato + città +
// eventi (nessun dato personale), col marchio del master (white-label) o MoovExpress di ripiego.

export const ARANCIO = '#FD5304'
const FASI = ['In lavorazione', 'Presa in carico', 'In transito', 'In consegna', 'Consegnata']
const INDICE_FASE: Record<string, number> = {
  in_lavorazione: 0, spedita: 1, in_transito: 2, in_consegna: 3, consegnata: 4,
  in_giacenza: 2, non_consegnato: 3, reso_mittente: 2, annullamento_pending: 0,
}
const STATI_PROBLEMA = new Set(['in_giacenza', 'non_consegnato', 'reso_mittente'])
const STATI_ANNULLO = new Set(['annullata', 'annullamento_manuale'])

export interface DatiTracking {
  brand: { nome: string; logo: string | null }
  stato: string
  stato_label: string
  riferimento: string | null
  citta: string | null
  provincia: string | null
  aggiornato_il: string | null
  eventi: { descrizione: string; luogo: string; data: string }[]
}

export const cardStyle: React.CSSProperties = { width: '100%', maxWidth: '520px', background: '#fff', borderRadius: '14px', boxShadow: '0 2px 16px rgba(0,0,0,0.06)', overflow: 'hidden' }

export function dataIt(s: string | null): string {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function CardTracking({ dati }: { dati: DatiTracking }) {
  const problema = STATI_PROBLEMA.has(dati.stato)
  const annullata = STATI_ANNULLO.has(dati.stato)
  const consegnata = dati.stato === 'consegnata'
  const fase = INDICE_FASE[dati.stato] ?? 0
  const accent = annullata ? '#9ca3af' : problema ? '#d97706' : consegnata ? '#16a34a' : ARANCIO
  return (
    <div style={cardStyle}>
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

      {(problema || annullata) && (
        <div style={{ margin: '16px 18px 0', padding: '11px 13px', background: annullata ? '#f3f4f6' : '#fffbeb', border: `1px solid ${annullata ? '#e5e7eb' : '#fcd34d'}`, borderRadius: '9px', fontSize: '12.5px', color: annullata ? '#4b5563' : '#92400e', lineHeight: 1.45 }}>
          {dati.stato === 'in_giacenza' && 'La spedizione è in giacenza presso il corriere, in attesa di istruzioni o di un nuovo tentativo di consegna.'}
          {dati.stato === 'non_consegnato' && 'Il corriere ha tentato la consegna senza riuscirci. Verrà effettuato un nuovo tentativo.'}
          {dati.stato === 'reso_mittente' && 'La spedizione è in rientro verso il mittente.'}
          {annullata && 'Questa spedizione è stata annullata.'}
        </div>
      )}

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

      {dati.aggiornato_il && (
        <div style={{ padding: '12px 22px', background: '#fafafa', borderTop: '1px solid #f0f0f0', fontSize: '11.5px', color: '#9ca3af', textAlign: 'center' }}>
          Ultimo aggiornamento: {dataIt(dati.aggiornato_il)}
        </div>
      )}
    </div>
  )
}
