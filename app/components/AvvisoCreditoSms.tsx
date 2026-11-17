'use client'
import { useEffect, useState } from 'react'
import { useAppNativa } from '@/lib/app-nativa'
import { COSTO_SMS_EUR } from '@/lib/sms-prezzo'

// ACCANTO ALL'INTERRUTTORE "ATTIVA NOTIFICA SMS": QUANTI SMS RESTANO, E SE SONO ZERO LO DICE.
//
// L'SMS parte solo se il titolare ha credito SMS (sms_consuma): a zero non parte, e non lo segna da
// nessuna parte. L'interruttore pero' non diceva niente del credito, e chi lo accendeva era convinto di
// avvisare i suoi destinatari. Il 17/11/2026 erano 13 i clienti con l'interruttore acceso e il credito a
// zero: ~650 spedizioni a un cellulare in 7 giorni, nessun SMS, e nessuno lo sapeva.
//
// Cosa si mostra a chi:
//  - al CLIENTE, il collegamento alla pagina SMS solo se l'acquisto gli e' aperto. Lo dice la stessa rotta
//    che lo rifiuta (GET /api/sms/acquista): i negozi dell'app sotto MOOVY pagano solo etichette e non
//    devono vedere un invito a comprare. Nell'app iOS/Android nemmeno (lib/app-nativa).
//  - al MASTER, solo il fatto. Come il cliente possa ricaricare dipende da regole sue (negozio dell'app o
//    no) che da questa pagina non si leggono, e un'istruzione sbagliata e' peggio di nessuna.
export default function AvvisoCreditoSms({ attiva, credito, vista }: {
  attiva: boolean
  credito: number | string | null | undefined
  vista: 'cliente' | 'master'
}) {
  const app = useAppNativa()
  // null finche' non si sa: il collegamento all'acquisto aspetta la risposta, come in /cliente/sms.
  const [acquistabile, setAcquistabile] = useState<boolean | null>(null)
  useEffect(() => {
    if (vista !== 'cliente') return
    fetch('/api/sms/acquista').then(r => r.ok ? r.json() : null)
      .then(x => setAcquistabile(x?.disponibile === true))
      .catch(() => setAcquistabile(false))
  }, [vista])

  // undefined = dato non arrivato: meglio nessun avviso che un "zero" falso. null in tabella vale zero.
  if (!attiva || credito === undefined) return null
  const disponibili = Math.floor(Number(credito || 0) / COSTO_SMS_EUR + 1e-9)

  if (disponibili > 0) {
    return (
      <div style={{ padding: '0 18px 12px', fontSize: '12px', color: '#6b7280' }}>
        {vista === 'cliente'
          ? `Hai ${disponibili.toLocaleString('it-IT')} SMS disponibili: ne usa uno ogni spedizione verso un cellulare.`
          : `Il cliente ha ${disponibili.toLocaleString('it-IT')} SMS disponibili.`}
      </div>
    )
  }

  return (
    <div style={{ padding: '0 18px 13px' }}>
      <div style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: '6px', padding: '10px 12px', fontSize: '12.5px', color: '#9a3412', lineHeight: 1.45 }}>
        <strong>{vista === 'cliente' ? 'Non hai SMS disponibili.' : 'Questo cliente non ha SMS disponibili.'}</strong>{' '}
        {vista === 'cliente'
          ? 'Con la notifica attiva, ai tuoi destinatari gli SMS non partono finché il credito SMS è a zero.'
          : 'Con la notifica attiva, ai suoi destinatari gli SMS non partono finché il credito SMS è a zero.'}
        {vista === 'cliente' && acquistabile === true && !app && (
          <>{' '}<a href="/cliente/sms" style={{ color: '#c2410c', fontWeight: 700 }}>Vai agli SMS →</a></>
        )}
      </div>
    </div>
  )
}
