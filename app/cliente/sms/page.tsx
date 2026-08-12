'use client'
import { useState, useEffect, useCallback } from 'react'

// Pagina SMS del CLIENTE — SOLA LETTURA. Il cliente NON compra gli SMS da solo: glieli gira il suo
// master (filiale). Qui vede quanti ne restano, quelli inviati, e le ricariche ricevute.

const eur = (n: number) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const dataIt = (s: string) => { const d = new Date(s); return isNaN(d.getTime()) ? s : d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }

interface Stato {
  creditoSms: number; costoSms: number; smsDisponibili: number; gatewayPronto: boolean
  inviati: { numero: string; quando: string }[]
  acquisti: { quantita: number; quando: string }[]
}

export default function ClienteSmsPage() {
  const [d, setD] = useState<Stato | null>(null)

  const carica = useCallback(async () => {
    try { const r = await fetch('/api/cliente/sms/stato'); if (r.ok) setD(await r.json()) } catch {}
  }, [])
  useEffect(() => { carica() }, [carica])

  const costoSms = d?.costoSms || 0.10

  const card: React.CSSProperties = { background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb', padding: '18px 20px' }
  const lbl: React.CSSProperties = { display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: '#9ca3af', marginBottom: '6px' }
  const th: React.CSSProperties = { textAlign: 'left', padding: '9px 16px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '9px 16px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f0f0f0' }

  return (
    <div style={{ maxWidth: '960px' }}>
      <div style={{ marginBottom: '18px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>SMS</h1>
        <span style={{ display: 'block', marginTop: '4px', fontSize: '13px', color: '#666' }}>
          Avvisa i tuoi destinatari via SMS con il link al tracking. Ogni SMS costa {eur(costoSms)}. Se sei a 0, l'SMS non parte.
        </span>
      </div>

      {d && !d.gatewayPronto && <div style={{ padding: '9px 12px', borderRadius: '6px', marginBottom: '14px', fontSize: '12.5px', color: '#9a3412', background: '#fff7ed', border: '1px solid #fdba74' }}>Le notifiche SMS sono in fase di attivazione sulla piattaforma.</div>}

      {/* Disponibili */}
      <div style={{ ...card, borderColor: '#fdba74', background: '#fff7ed', marginBottom: '16px', maxWidth: '360px' }}>
        <span style={lbl}>SMS disponibili</span>
        <div style={{ fontSize: '30px', fontWeight: 800, color: '#ea580c' }}>{(d?.smsDisponibili || 0).toLocaleString('it-IT')}</div>
        <div style={{ fontSize: '12.5px', color: '#9a3412', marginTop: '2px' }}>≈ {eur(d?.creditoSms || 0)} di credito · {eur(costoSms)}/SMS</div>
      </div>

      {/* Come ricaricare (il cliente non compra da solo) */}
      <div style={{ ...card, marginBottom: '16px', maxWidth: '520px', background: '#f8fafc' }}>
        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>Ti servono più SMS?</div>
        <div style={{ fontSize: '12.5px', color: '#6b7280' }}>Chiedi al tuo referente (la tua filiale) di ricaricarti il credito SMS: te lo aggiunge lui.</div>
      </div>

      {/* SMS inviati */}
      <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: '16px' }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid #e5e7eb', fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>SMS inviati</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead><tr style={{ background: '#f9fafb' }}>{['Spedizione', 'Inviato il'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {!d?.inviati?.length ? (
                <tr><td colSpan={2} style={{ padding: '22px 16px', color: '#9ca3af', fontSize: '13px', textAlign: 'center' }}>Nessun SMS inviato ancora</td></tr>
              ) : d.inviati.slice(0, 100).map((m, i) => (
                <tr key={i}><td style={{ ...td, fontWeight: 600 }}>{m.numero}</td><td style={{ ...td, color: '#6b7280' }}>{dataIt(m.quando)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ricariche ricevute */}
      {!!d?.acquisti?.length && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid #e5e7eb', fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Ricariche ricevute</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead><tr style={{ background: '#f9fafb' }}>{['SMS', 'Data'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {d.acquisti.map((m, i) => (
                  <tr key={i}><td style={{ ...td, fontWeight: 600 }}>+{(m.quantita || 0).toLocaleString('it-IT')}</td><td style={{ ...td, color: '#6b7280' }}>{dataIt(m.quando)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
