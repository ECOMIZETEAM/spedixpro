'use client'
import { useEffect, useState } from 'react'
import { useAppNativa } from '@/lib/app-nativa'
import { prendiAnticipata } from '@/lib/richieste-anticipate'
import { URL_STATO_SMS } from '@/app/components/BannerSms'

// GLI SMS nella Dashboard nuova: un riquadro piccolo accanto al saluto (Lorenzo 25/11: i blocchi in fila avevano
// proporzioni sbagliate). Stesse regole del banner della dashboard di oggi (app/components/BannerSms), che resta com'e'
// per la grafica di oggi: si vede solo allo staff del master (agli altri l'endpoint risponde 403); nell'app iOS/Android
// niente prezzo ne' «Attiva», e a zero SMS il riquadro non c'e' (lib/app-nativa).
export default function SmsFinexy() {
  const app = useAppNativa()
  const [d, setD] = useState<{ creditoSms: number; costoSms: number } | null>(null)
  useEffect(() => {
    const risposta = prendiAnticipata(URL_STATO_SMS) ?? fetch(URL_STATO_SMS)
    risposta.then(r => r.ok ? r.json() : null).then(j => { if (j && typeof j.creditoSms === 'number') setD(j) }).catch(() => {})
  }, [])
  if (!d) return null
  const costo = d.costoSms || 0.10
  const rimasti = Math.floor(Number(d.creditoSms || 0) / costo)
  if (app && rimasti <= 0) return null
  const eur = (n: number) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  return (
    <a className="fx-sms-mini" href="/dashboard/reports/storico-sms">
      <i aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 6h16v12H4z" /><path d="M4 7l8 6 8-6" /></svg></i>
      <span>
        <b>{rimasti > 0 ? `${rimasti.toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)} SMS disponibili` : 'SMS ai destinatari'}</b>
        <small>{rimasti > 0 ? 'un SMS a ogni spedizione' : `non attivi · ${eur(costo)}/SMS`}</small>
      </span>
      <em>{rimasti > 0 ? 'Gestisci' : 'Attiva'} →</em>
    </a>
  )
}
