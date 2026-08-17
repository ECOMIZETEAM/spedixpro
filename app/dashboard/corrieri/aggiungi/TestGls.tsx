'use client'
import { useState } from 'react'

// Pulsante "Testa connessione" per il contratto GLS diretto (solo proprietario, in modifica).
// Fa un collo di prova via /api/corrieri/gls/test e lo cancella subito; mostra l'esito.
export default function TestGls({ corriereId }: { corriereId: string }) {
  const [stato, setStato] = useState<'idle'|'loading'|'ok'|'ko'>('idle')
  const [msg, setMsg] = useState<string>('')

  async function prova() {
    setStato('loading'); setMsg('')
    try {
      const res = await fetch('/api/corrieri/gls/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corriereId }),
      })
      const d = await res.json().catch(() => ({}))
      if (d?.ok) {
        setStato('ok')
        setMsg(`Connessione riuscita. Tracking di prova: ${d.tracking || d.numeroSpedizione}${d.haEtichetta ? ' · etichetta ricevuta' : ' · ⚠️ nessuna etichetta'}${d.collodProvaAnnullato === false ? ' · ⚠️ collo di prova NON annullato (cancellalo dal portale GLS)' : ''}`)
      } else {
        setStato('ko')
        setMsg((d?.errore || d?.error || 'Errore sconosciuto') + (d?.raw ? `\n\nRisposta GLS:\n${d.raw}` : ''))
      }
    } catch (e) {
      setStato('ko'); setMsg('Chiamata fallita: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  return (
    <div style={{maxWidth:'520px',marginTop:'14px'}}>
      <button type="button" onClick={prova} disabled={stato==='loading'}
        style={{padding:'9px 18px',background:'#111',color:'#fff',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'700',cursor:stato==='loading'?'default':'pointer',opacity:stato==='loading'?0.6:1}}>
        {stato==='loading' ? '⏳ Test in corso…' : '🔌 Testa connessione GLS'}
      </button>
      <div style={{fontSize:'11.5px',color:'#9ca3af',marginTop:'6px'}}>
        Crea un collo di prova con le credenziali salvate e lo cancella subito. Serve a verificare il collegamento prima di spedire davvero.
      </div>
      {msg && (
        <pre style={{marginTop:'10px',whiteSpace:'pre-wrap',wordBreak:'break-word',fontSize:'12px',lineHeight:1.5,padding:'12px 14px',borderRadius:'8px',
          background: stato==='ok' ? '#f0fdf4' : '#fef2f2', border:`1px solid ${stato==='ok' ? '#bbf7d0' : '#fecaca'}`, color: stato==='ok' ? '#166534' : '#b91c1c'}}>
          {msg}
        </pre>
      )}
    </div>
  )
}
