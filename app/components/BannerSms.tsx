'use client'
import { useEffect, useState } from 'react'
import { useAppNativa } from '@/lib/app-nativa'
import { prendiAnticipata } from '@/lib/richieste-anticipate'

// Esportato perche' la home lo anticipa insieme a /api/dashboard (vedi lib/richieste-anticipate).
export const URL_STATO_SMS = '/api/sms/stato'

// Banner SMS nella home del master: mostra quanti SMS restano (o invita ad attivarli) e porta alla
// pagina SMS. Best-effort: se l'utente non è staff master (l'endpoint risponde 403), non si mostra.
// Nell'app iOS/Android niente prezzo né "Attiva SMS": gli SMS sono un servizio digitale, e per gli
// store un invito a comprarli fuori dal loro sistema è motivo di rifiuto (lib/app-nativa). Con SMS
// ancora disponibili resta il conteggio; a zero la scheda non compare. Si disegna solo dopo i dati,
// quindi nell'app non lampeggia nemmeno prima dell'idratazione.
export default function BannerSms() {
  const app = useAppNativa()
  const [d, setD] = useState<{ creditoSms: number; costoSms: number; gatewayPronto?: boolean } | null>(null)
  useEffect(() => {
    const risposta = prendiAnticipata(URL_STATO_SMS) ?? fetch(URL_STATO_SMS)
    risposta.then(r => r.ok ? r.json() : null).then(j => { if (j && typeof j.creditoSms === 'number') setD(j) }).catch(() => {})
  }, [])
  if (!d) return null

  const costo = d.costoSms || 0.10
  const rimasti = Math.floor(Number(d.creditoSms || 0) / costo)
  if (app && rimasti <= 0) return null
  const eur = (n: number) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

  // Nella Dashboard nuova (app/components/dashboard-finexy): la scheda col disegno delle altre. Si vede solo li', nella
  // dashboard dello staff del master; all'agente l'endpoint risponde 403 e la scheda non c'e'.
  return (
    <a className="fx-scheda fx-sms" href="/dashboard/reports/storico-sms">
      <div className="fx-testa"><h2>Notifiche SMS</h2><span className={`fx-chip ${rimasti > 0 ? 'fx-chip--bene' : 'fx-chip--neutro'}`}>{rimasti > 0 ? 'attive' : 'non attive'}</span></div>
      <div className="fx-grande">{rimasti > 0 ? `${rimasti.toLocaleString('it-IT')} SMS` : 'Avvisa i destinatari'}</div>
      <p className="fx-sotto">
        {rimasti > 0
          ? "disponibili. Un SMS a ogni spedizione: meno richieste «dov'è il pacco?»."
          : `via SMS con il link al tracking. ${eur(costo)}/SMS, pacchetti da 1000: paghi solo quel che usi.`}
      </p>
      <span className="fx-tasto fx-tasto--chiaro" style={{ marginTop: 14 }}>{rimasti > 0 ? 'Gestisci SMS' : 'Attiva SMS'} →</span>
    </a>
  )
}
