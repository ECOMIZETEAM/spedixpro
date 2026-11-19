'use client'
import { useState } from 'react'

// Pulsante "Verifica connessione" del contratto Ecosmos (solo proprietario, in modifica). Solo letture
// via /api/corrieri/ecosmos/test: nessuna spedizione, nessun costo. Mostra a quale account appartiene la
// chiave, cosi' una chiave di un altro cliente Ecosmos si vede subito.
export default function TestEcosmos({ corriereId }: { corriereId: string }) {
  const [stato, setStato] = useState<'idle' | 'loading' | 'ok' | 'ko'>('idle')
  const [msg, setMsg] = useState('')

  async function verifica() {
    setStato('loading'); setMsg('')
    try {
      const res = await fetch('/api/corrieri/ecosmos/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ corriereId }),
      })
      const d = await res.json().catch(() => ({}))
      if (!d?.ok) { setStato('ko'); setMsg(d?.error || 'Verifica non riuscita'); return }
      const righe = [
        `Chiave valida. Account Ecosmos: ${d.account || '(nome non indicato)'}${d.ambiente ? ` · ambiente ${d.ambiente}` : ''}`,
        `Servizio di questo contratto: ${d.servizioContratto}${d.servizioAttivo ? ' — attivo sull\'account' : ' — NON attivo sull\'account: le spedizioni verrebbero rifiutate'}`,
        `Servizi attivi: ${(d.servizi || []).join(', ') || 'nessuno'}`,
        `Orario limite per il ritiro in giornata: ${d.orarioLimite || 'non indicato'}`,
        `Contrassegno: ${d.contrassegno ? 'disponibile (solo contanti)' : 'non disponibile'} · peso massimo ${d.pesoMassimo} kg`,
        `Fasce di peso: ${(d.fasce || []).join(', ') || 'non indicate'}`,
        `Prova di copertura, CAP ${d.coperturaRoma?.cap}: ${d.coperturaRoma?.servito ? 'servito (' + (d.coperturaRoma.servizi || []).join(', ') + ')' : 'NON servito'}`,
        d.richiedeConferma ? 'Canale in due passi: ogni spedizione viene confermata subito dopo la creazione.' : '',
      ].filter(Boolean)
      setStato(d.servizioAttivo ? 'ok' : 'ko'); setMsg(righe.join('\n'))
    } catch (e) {
      setStato('ko'); setMsg('Chiamata fallita: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  return (
    <div style={{ maxWidth: '520px', marginTop: '14px' }}>
      <button type="button" onClick={verifica} disabled={stato === 'loading'}
        style={{ padding: '9px 18px', background: '#111', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: stato === 'loading' ? 'default' : 'pointer', opacity: stato === 'loading' ? 0.6 : 1 }}>
        {stato === 'loading' ? 'Verifica in corso…' : 'Verifica connessione Ecosmos'}
      </button>
      <div style={{ fontSize: '11.5px', color: '#9ca3af', marginTop: '6px' }}>
        Controlla la chiave salvata, i servizi attivi e la copertura su un CAP di Roma. Non crea spedizioni e non costa nulla.
      </div>
      {msg && (
        <pre style={{ marginTop: '10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', lineHeight: 1.5, padding: '12px 14px', borderRadius: '8px',
          background: stato === 'ok' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${stato === 'ok' ? '#bbf7d0' : '#fecaca'}`, color: stato === 'ok' ? '#166534' : '#b91c1c' }}>
          {msg}
        </pre>
      )}
    </div>
  )
}
