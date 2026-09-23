'use client'

import { useState } from 'react'
import { LDV_IN_ELABORAZIONE } from '@/lib/numero-spedizione'

// LA RIGA FERMA SUL NUMERO PROVVISORIO, spiegata a chi la guarda.
//
// Prima c'era solo il badge "LDV in elaborazione": chi aspettava non sapeva da quanto, ne' se
// doveva fare qualcosa — e su questi contratti "rifare la spedizione" significa pagarla due volte
// (l'ordine dal fornitore e' gia' pagato e non si puo' annullare). Qui si dice da quanti minuti si
// aspetta e si da' un modo per chiedere subito la lettera di vettura, invece di aspettare il giro
// automatico. Se il fornitore non ce l'ha ancora, lo si scrive: e' lui che deve produrla.
export default function LdvInElaborazione({
  id, createdAt, onCompletata,
}: { id: string; createdAt?: string | null; onCompletata?: () => void }) {
  const [inCorso, setInCorso] = useState(false)
  const [esito, setEsito] = useState<string | null>(null)

  const minuti = createdAt ? Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 60000)) : null
  const da = minuti == null ? '' : minuti < 60 ? ` · da ${minuti} min` : ` · da ${Math.floor(minuti / 60)}h`

  async function riprova() {
    if (inCorso) return
    setInCorso(true); setEsito(null)
    try {
      const r = await fetch('/api/spedizioni/completa-ldv', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      })
      const d = await r.json().catch(() => ({}))
      if (d?.fatta || d?.gia) { onCompletata ? onCompletata() : window.location.reload(); return }
      setEsito(d?.messaggio || d?.error || 'Il corriere non ha ancora la lettera di vettura.')
    } catch {
      setEsito('Non sono riuscito a contattare il corriere: riprova fra poco.')
    }
    setInCorso(false)
  }

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
      <span
        title="Il corriere non ha ancora assegnato la lettera di vettura. La spedizione è creata: numero ed etichetta compaiono da soli appena il corriere li rilascia. Non rifarla."
        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700, color: '#b45309', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '10px', padding: '2px 8px', fontSize: '11px', whiteSpace: 'nowrap' }}
      >⏳ {LDV_IN_ELABORAZIONE}{da}</span>
      <button
        onClick={riprova}
        disabled={inCorso}
        style={{ background: 'none', border: 'none', padding: 0, fontSize: '11px', color: inCorso ? '#9ca3af' : '#f97316', cursor: inCorso ? 'default' : 'pointer', textDecoration: 'underline', fontWeight: 600 }}
      >{inCorso ? 'sto chiedendo al corriere…' : 'Riprova adesso'}</button>
      {esito && <span style={{ fontSize: '10.5px', color: '#6b7280', maxWidth: '240px', lineHeight: 1.35 }}>{esito}</span>}
    </div>
  )
}
