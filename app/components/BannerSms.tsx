'use client'
import { useEffect, useState } from 'react'

// Banner SMS nella home del master: mostra quanti SMS restano (o invita ad attivarli) e porta alla
// pagina SMS. Best-effort: se l'utente non è staff master (l'endpoint risponde 403), non si mostra.
export default function BannerSms() {
  const [d, setD] = useState<{ creditoSms: number; costoSms: number; gatewayPronto?: boolean } | null>(null)
  useEffect(() => {
    fetch('/api/sms/stato').then(r => r.ok ? r.json() : null).then(j => { if (j && typeof j.creditoSms === 'number') setD(j) }).catch(() => {})
  }, [])
  if (!d) return null

  const costo = d.costoSms || 0.10
  const rimasti = Math.floor(Number(d.creditoSms || 0) / costo)
  const eur = (n: number) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

  return (
    <a href="/dashboard/reports/storico-sms" style={{
      display: 'flex', alignItems: 'center', gap: '16px', textDecoration: 'none',
      background: 'linear-gradient(100deg,#fff7ed,#ffedd5)', border: '1px solid #fdba74',
      borderRadius: '10px', padding: '14px 20px', flexWrap: 'wrap',
    }}>
      <div style={{ width: '46px', height: '46px', background: '#fff', border: '1px solid #fdba74', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>✉</div>
      <div style={{ flex: 1, minWidth: '200px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: '#9a3412' }}>Notifiche SMS</div>
        <div style={{ fontSize: '16px', fontWeight: 800, color: '#1a1a1a', marginTop: '2px', lineHeight: 1.2 }}>
          {rimasti > 0 ? `Hai ${rimasti.toLocaleString('it-IT')} SMS disponibili` : 'Avvisa i destinatari via SMS con il link al tracking'}
        </div>
        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
          {rimasti > 0
            ? "Un SMS a ogni spedizione: meno richieste «dov'è il pacco?»."
            : `Attivale ora: ${eur(costo)}/SMS, pacchetti da 1000. Paghi solo quel che usi.`}
        </div>
      </div>
      <span style={{ background: '#f97316', color: '#fff', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {rimasti > 0 ? 'Gestisci SMS' : 'Attiva SMS'} →
      </span>
    </a>
  )
}
