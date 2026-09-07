'use client'
import { useState, useEffect } from 'react'
import { useDialog } from '@/app/components/DialogProvider'

// Pannello WEBHOOK dentro Impostazioni del contratto: elenca/aggiunge/elimina i secret di verifica
// firma (es. spedisci / Poste Crono). Riservato al super master (l'API lo verifica): se non
// autorizzato non si mostra nulla. Il secret in lettura è mascherato; in aggiunta lo incolli qui
// (HTTPS), non in chat. Config di piattaforma: vale per tutti i contratti dello stesso provider.
export default function WebhookSecretsPanel({ provider, contrattoNome }: { provider: string; contrattoNome: string }) {
  const dialog = useDialog()
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [secrets, setSecrets] = useState<any[]>([])
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)

  const carica = () => {
    fetch('/api/corrieri/webhook-secrets?provider=' + encodeURIComponent(provider)).then(r => r.ok ? r.json() : { authorized: false })
      .then(j => { setAuthorized(!!j.authorized); setSecrets(Array.isArray(j.secrets) ? j.secrets : []) })
      .catch(() => setAuthorized(false))
  }
  useEffect(() => { carica() }, [provider])
  if (authorized !== true) return null

  async function aggiungi() {
    if (!secret.trim()) return
    setBusy(true)
    try {
      const r = await fetch('/api/corrieri/webhook-secrets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, label: label.trim() || contrattoNome, secret: secret.trim() }) })
      const j = await r.json()
      if (j.success) { setSecret(''); setLabel(''); carica() }
      else await dialog.alert({ title: 'Errore', message: j.error || 'Non aggiunto.' })
    } finally { setBusy(false) }
  }
  async function elimina(id: string) {
    if (!await dialog.confirm({ title: 'Eliminare il secret?', message: 'Il webhook firmato con questo secret non verrà più verificato.', danger: true, confirmText: 'Elimina' })) return
    await fetch('/api/corrieri/webhook-secrets?id=' + id, { method: 'DELETE' }); carica()
  }

  const inp = { padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12px', color: '#1a1a1a' } as const
  return (
    <div style={{ borderTop: '1px solid #eee', marginTop: '14px', paddingTop: '14px' }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>Webhook — secret di verifica firma</div>
      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '10px' }}>Valgono per tutti i contratti «{provider}». Incolla qui il/i <code>whsec_</code> del pannello del corriere (uno per evento).</div>
      {secrets.length > 0 && (
        <div style={{ marginBottom: '10px' }}>
          {secrets.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', borderBottom: '1px solid #f5f5f5', fontSize: '12px' }}>
              <span style={{ minWidth: '160px', color: '#374151' }}>{s.label || '—'}</span>
              <span style={{ flex: 1, fontFamily: 'monospace', color: '#9ca3af' }}>{s.secret_masked}</span>
              <button onClick={() => elimina(s.id)} style={{ border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', borderRadius: '5px', fontSize: '11px', padding: '3px 8px', cursor: 'pointer' }}>Elimina</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Etichetta (es. invoice)" style={{ ...inp, width: '170px' }} />
        <input value={secret} onChange={e => setSecret(e.target.value)} placeholder="whsec_…" style={{ ...inp, flex: 1, minWidth: '200px', fontFamily: 'monospace' }} />
        <button disabled={busy || !secret.trim()} onClick={aggiungi} style={{ padding: '8px 16px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy || !secret.trim() ? 0.6 : 1 }}>{busy ? 'Aggiungo…' : 'Aggiungi'}</button>
      </div>
    </div>
  )
}
