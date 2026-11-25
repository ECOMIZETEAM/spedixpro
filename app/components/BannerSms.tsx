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

  // Nella Dashboard nuova (app/components/dashboard-finexy): un riquadro piccolo accanto al saluto, non una scheda della
  // griglia (Lorenzo 25/11: i blocchi in fila avevano proporzioni sbagliate). Si vede solo li', nella dashboard dello
  // staff del master; all'agente l'endpoint risponde 403 e non c'e'.
  return (
    <a className="fx-sms-mini" href="/dashboard/reports/storico-sms">
      <i aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 6h16v12H4z" /><path d="M4 7l8 6 8-6" /></svg></i>
      <span>
        <b>{rimasti > 0 ? `${rimasti.toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)} SMS disponibili` : 'SMS ai destinatari'}</b>
        <small>{rimasti > 0 ? "un SMS a ogni spedizione" : `non attivi · ${eur(costo)}/SMS`}</small>
      </span>
      <em>{rimasti > 0 ? 'Gestisci' : 'Attiva'} →</em>
    </a>
  )
}
