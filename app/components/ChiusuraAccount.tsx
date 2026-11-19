'use client'
import { useState } from 'react'

// «CHIEDI LA CHIUSURA DELL'ACCOUNT».
//
// Esiste per Apple (linea guida 5.1.1(v)) e Google Play: nelle app dove si creano account, l'utente
// deve poter avviare la chiusura del proprio da dentro l'app. L'app e' il portale, quindi la sezione
// sta nelle pagine di ogni ruolo e vale anche sul web. Non cancella niente: manda la richiesta a chi
// gestisce l'account (app/api/account/chiusura), che decide e toglie l'accesso.
//
// La finestra di conferma e' dentro il componente, non quella condivisa (DialogProvider): la schermata
// dell'autista non la monta, e qui serve anche un campo per il motivo.
// `compatto`: solo un collegamento discreto, per la schermata dell'autista.
export default function ChiusuraAccount({ compatto = false }: { compatto?: boolean }) {
  const [aperta, setAperta] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [invio, setInvio] = useState(false)
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null)

  async function invia() {
    setInvio(true)
    const r = await fetch('/api/account/chiusura', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo }),
    }).catch(() => null)
    const d = r ? await r.json().catch(() => ({})) : {}
    setInvio(false)
    if (!r || !r.ok || d?.error) { setEsito({ ok: false, testo: d?.error || 'Richiesta non inviata: controlla la connessione e riprova.' }); return }
    setEsito({ ok: true, testo: d.messaggio || 'Richiesta inviata.' })
    setAperta(false); setMotivo('')
  }

  const finestra = aperta && (
    <div onClick={() => !invio && setAperta(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div role="dialog" aria-modal="true" aria-labelledby="chiusura-account-titolo" onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: '10px', width: '100%', maxWidth: '440px', padding: '20px', boxShadow: '0 10px 30px rgba(0,0,0,.2)' }}>
        <div id="chiusura-account-titolo" style={{ fontSize: '16px', fontWeight: 700, color: '#1a1a1a', marginBottom: '10px' }}>Chiedere la chiusura dell&apos;account?</div>
        <div style={{ fontSize: '13px', color: '#555', lineHeight: 1.55, marginBottom: '12px' }}>
          La richiesta va a chi gestisce il tuo account, che ti contatterà e chiuderà l&apos;accesso.
          Spedizioni, fatture e movimenti restano conservati come prevede la legge.
        </div>
        <label style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a', display: 'block', marginBottom: '4px' }}>Motivo (facoltativo)</label>
        <textarea value={motivo} onChange={e => setMotivo(e.target.value.slice(0, 1000))} rows={3}
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#1a1a1a', background: '#fff', resize: 'vertical', fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
          <button onClick={() => setAperta(false)} disabled={invio}
            style={{ padding: '9px 16px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Annulla</button>
          <button onClick={invia} disabled={invio}
            style={{ padding: '9px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: invio ? 0.7 : 1 }}>
            {invio ? 'Invio…' : 'Invia la richiesta'}
          </button>
        </div>
      </div>
    </div>
  )

  const avviso = esito && (
    <div style={{ marginTop: '10px', padding: '10px 14px', borderRadius: '6px', fontSize: '13px', lineHeight: 1.5,
      background: esito.ok ? '#f0fdf4' : '#fef2f2', color: esito.ok ? '#166534' : '#991b1b', border: `1px solid ${esito.ok ? '#bbf7d0' : '#fecaca'}` }}>
      {esito.testo}
    </div>
  )

  if (compatto) return (
    <div style={{ textAlign: 'center' }}>
      <button onClick={() => { setEsito(null); setAperta(true) }}
        style={{ background: 'none', border: 'none', color: '#71717a', fontSize: '13px', fontWeight: 600, textDecoration: 'underline', padding: '10px', cursor: 'pointer' }}>
        Chiedi la chiusura dell&apos;account
      </button>
      {avviso}
      {finestra}
    </div>
  )

  return (
    <div id="chiusura-account" style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', padding: '16px', marginTop: '16px', maxWidth: '900px' }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>Chiusura dell&apos;account</div>
      <div style={{ fontSize: '13px', color: '#555', lineHeight: 1.5, marginBottom: '10px' }}>
        Se non vuoi più usare MoovExpress puoi chiedere di chiudere il tuo account. La richiesta arriva a chi lo gestisce;
        spedizioni, fatture e movimenti restano conservati come prevede la legge.
      </div>
      <button onClick={() => { setEsito(null); setAperta(true) }}
        style={{ padding: '8px 16px', background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
        Chiedi la chiusura dell&apos;account
      </button>
      {avviso}
      {finestra}
    </div>
  )
}
