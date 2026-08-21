'use client'
import { useState, useEffect } from 'react'

const ACCENT = '#f97316'
const card = { background: '#fff', borderRadius: '10px', border: '1px solid #e8e8e8', padding: '18px' } as const

export default function RettificheAutoPage() {
  const [dati, setDati] = useState<any>(null)
  const [copiato, setCopiato] = useState(false)

  async function carica() {
    const d = await fetch('/api/tracking/onetracking-sessione').then(r => r.json()).catch(() => null)
    if (d && !d.error) setDati(d)
  }
  useEffect(() => { carica(); const t = setInterval(carica, 20000); return () => clearInterval(t) }, [])

  const st = dati?.statistiche || {}
  const token = dati?.token || '—'

  return (
    <div style={{ maxWidth: '820px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: '0 0 4px' }}>Rettifiche automatiche</h1>
      <p style={{ color: '#999', fontSize: '13px', margin: '0 0 18px' }}>
        Ogni PDB consegnata viene controllata: se il ripesato è più alto, nasce una rettifica <b>in attesa</b>
        (la confermi tu in <b>Rettifica Costi</b>). Solo recuperi, mai rimborsi. La lettura del ripesato la fa
        lo <b>script sul tuo Mac</b> (Poste blocca i server esteri), che manda qui solo il peso/misure.
      </p>

      {/* Come si lancia */}
      <div style={{ ...card, marginBottom: '16px' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a', marginBottom: '10px' }}>Come si avvia (dal tuo Mac)</div>
        <ol style={{ fontSize: '13px', color: '#374151', lineHeight: 1.8, margin: 0, paddingLeft: '20px' }}>
          <li>Su <b>OneTracking</b> (loggato): F12 → Network → tasto destro su una richiesta a <code>one-tracking-filiali</code> → <b>Copy as cURL</b>.</li>
          <li>Incollalo nel file <code>onetracking.curl</code> accanto allo script <code>~/Desktop/moove-harvester-ripesature.py</code>.</li>
          <li>Nel Terminale: <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>python3 ~/Desktop/moove-harvester-ripesature.py</code></li>
        </ol>
        <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', color: '#6b7280' }}>Token (già dentro lo script):</span>
          <code style={{ background: '#111', color: '#fff', padding: '5px 10px', borderRadius: '6px', fontSize: '12px', userSelect: 'all' }}>{token}</code>
          <button onClick={() => { navigator.clipboard?.writeText(token); setCopiato(true); setTimeout(() => setCopiato(false), 1500) }}
            style={{ padding: '5px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
            {copiato ? '✓ copiato' : 'copia'}
          </button>
        </div>
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#8a8a8a' }}>
          Lo script si ferma da solo quando la sessione OneTracking scade: rifai il Copy-as-cURL nel file e rilancialo.
        </div>
      </div>

      {/* Riepilogo */}
      <div style={card}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a', marginBottom: '10px' }}>
          Riepilogo <span style={{ fontWeight: 400, color: '#6b7280' }}>· recuperato € {Number(dati?.recuperoTot || 0).toFixed(2)} · da controllare ancora {dati?.arretrato ?? '—'}</span>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[['rettificata', 'Rettificate', '#16a34a'], ['ok', 'Ok (niente)', '#6b7280'], ['gia-rettificata', 'Già fatte', '#6b7280'], ['no-misure', 'Senza misure', '#92400e'], ['errore', 'Errori', '#dc2626']].map(([k, label, col]) => (
            <div key={k} style={{ background: '#f9fafb', border: '1px solid #eee', borderRadius: '8px', padding: '10px 14px', minWidth: '110px' }}>
              <div style={{ fontSize: '20px', fontWeight: 800, color: col as string }}>{st[k as string] || 0}</div>
              <div style={{ fontSize: '11px', color: '#6b7280' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
