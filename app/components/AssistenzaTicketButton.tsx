'use client'
import { useState } from 'react'

// Icona assistenza (accanto al cestino della LDV): apre un popup con la LDV
// gia' compilata, si scrive la descrizione e con "Invia segnalazione" crea il ticket.
export default function AssistenzaTicketButton({ ldv }: { ldv: string }) {
  const [open, setOpen] = useState(false)
  const [desc, setDesc] = useState('')
  const [inviando, setInviando] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)

  async function invia() {
    if (!desc.trim()) { setMsg({ t: 'err', x: 'Inserisci una descrizione del problema' }); return }
    setInviando(true); setMsg(null)
    const r = await fetch('/api/assistenza/apri', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oggetto: ldv, messaggio: desc }) })
    const j = await r.json(); setInviando(false)
    if (j.error) { setMsg({ t: 'err', x: j.error }); return }
    setMsg({ t: 'ok', x: 'Segnalazione inviata! La trovi nella sezione Assistenza.' })
    setTimeout(() => { setOpen(false); setDesc(''); setMsg(null) }, 1100)
  }

  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); setMsg(null) }} title="Apri segnalazione assistenza"
        style={{ padding: '4px 8px', background: '#eff6ff', color: '#2563eb', borderRadius: '4px', fontSize: '14px', border: '1px solid #bfdbfe', cursor: 'pointer' }}>🎧</button>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '10px', width: '460px', maxWidth: '100%' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', fontSize: '15px', fontWeight: 700, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: '8px' }}>🎧 Segnalazione assistenza</div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a', display: 'block', marginBottom: '5px' }}>LDV</label>
                <input value={ldv} disabled style={{ width: '100%', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', background: '#f5f5f5', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a', display: 'block', marginBottom: '5px' }}>Descrizione del problema</label>
                <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={4} placeholder="Descrivi il problema su questa spedizione…" autoFocus style={{ width: '100%', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box', resize: 'vertical' }} />
              </div>
              {msg && <div style={{ padding: '8px 12px', borderRadius: '6px', fontSize: '12.5px', color: '#fff', background: msg.t === 'ok' ? '#16a34a' : '#dc2626' }}>{msg.x}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button onClick={() => setOpen(false)} style={{ padding: '9px 16px', border: '1px solid #d1d5db', background: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: '#1a1a1a' }}>Annulla</button>
                <button disabled={inviando} onClick={invia} style={{ padding: '9px 18px', border: 'none', background: '#f97316', color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: inviando ? 0.7 : 1 }}>{inviando ? 'Invio…' : 'Invia segnalazione'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
