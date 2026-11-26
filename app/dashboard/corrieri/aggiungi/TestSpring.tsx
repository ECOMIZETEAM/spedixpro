'use client'
import { useState } from 'react'

// Pulsante "Verifica connessione" del contratto Spring (solo proprietario, in modifica). Una lettura sola via
// /api/corrieri/spring/test: nessuna spedizione, nessun costo.
export default function TestSpring({ corriereId }: { corriereId: string }) {
  const [stato, setStato] = useState<'idle' | 'loading' | 'ok' | 'ko'>('idle')
  const [msg, setMsg] = useState('')

  async function verifica() {
    setStato('loading'); setMsg('')
    try {
      const res = await fetch('/api/corrieri/spring/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ corriereId }),
      })
      const d = await res.json().catch(() => ({}))
      if (!d?.ok) { setStato('ko'); setMsg(d?.error || 'Verifica non riuscita'); return }
      const righe = [
        'Chiave valida: Spring risponde.',
        d.inProva ? 'Contratto in ambiente PROVA: le spedizioni non partono. Per spedire davvero scegli Produzione nel contratto.' : 'Ambiente: produzione (spedizioni vere).',
        `Ambito del contratto: ${d.ambito || 'non scelto'}`,
        `Servizio del contratto: ${d.servizioContratto || 'non scelto'}${d.descrizioneServizio ? ` (${d.descrizioneServizio})` : ''}${d.servizioAttivo ? ' — attivo sul tuo account' : ' — NON attivo sul tuo account: le spedizioni verrebbero rifiutate'}`,
        `Servizi attivi sul tuo account: ${(d.servizi || []).join(', ') || 'nessuno'}`,
      ]
      setStato(d.servizioAttivo && !d.inProva && d.ambito ? 'ok' : 'ko'); setMsg(righe.join('\n'))
    } catch (e) {
      setStato('ko'); setMsg('Chiamata fallita: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  return (
    <div style={{ maxWidth: '520px', marginTop: '14px' }}>
      <button type="button" onClick={verifica} disabled={stato === 'loading'}
        style={{ padding: '9px 18px', background: '#111', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: stato === 'loading' ? 'default' : 'pointer', opacity: stato === 'loading' ? 0.6 : 1 }}>
        {stato === 'loading' ? 'Verifica in corso…' : 'Verifica connessione Spring'}
      </button>
      <div style={{ fontSize: '11.5px', color: '#9ca3af', marginTop: '6px' }}>
        Controlla la chiave salvata e i servizi attivi sul tuo account Spring. Non crea spedizioni e non costa nulla.
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
