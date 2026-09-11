'use client'
import { useState, useEffect } from 'react'

const ACCENT = '#f97316'
const card = { background: '#fff', borderRadius: '10px', border: '1px solid #e8e8e8', padding: '18px' } as const

export default function RettificheAutoPage() {
  const [dati, setDati] = useState<any>(null)

  async function carica() {
    const d = await fetch('/api/tracking/onetracking-sessione').then(r => r.json()).catch(() => null)
    if (d && !d.error) setDati(d)
  }
  useEffect(() => { carica(); const t = setInterval(carica, 20000); return () => clearInterval(t) }, [])

  const st = dati?.statistiche || {}

  return (
    <div style={{ maxWidth: '820px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: '0 0 4px' }}>Rettifiche automatiche</h1>
      <p style={{ color: '#999', fontSize: '13px', margin: '0 0 18px' }}>
        Ogni consegnata dei contratti Poste di MULTIEXPRESS viene ricontrollata sulla misura vera del
        corriere: se il collo è <b>più grande</b> di quello pagato <i>e</i> col listino di quel livello
        cambia il prezzo, nasce una rettifica <b>in attesa</b> (la confermi tu in <b>Rettifica Costi</b>).
        Se resta nello stesso scaglione non nasce niente. <b>Solo recuperi, mai rimborsi.</b>
      </p>

      {/* Come funziona — non c'è piu' niente da lanciare a mano */}
      <div style={{ ...card, marginBottom: '16px' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a', marginBottom: '10px' }}>Gira da solo</div>
        <ol style={{ fontSize: '13px', color: '#374151', lineHeight: 1.8, margin: 0, paddingLeft: '20px' }}>
          <li>Il Mac legge le misure del corriere e le porta qui (login automatico, 3 volte al giorno).</li>
          <li>Ogni 20 minuti il conto viene rifatto sulle consegnate che hanno una misura nuova.</li>
          <li>Quello che esce lo trovi in <b>Rettifica Costi</b>, da confermare.</li>
        </ol>
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#8a8a8a' }}>
          Restano fuori: i <b>multicollo</b> (una misura sola non è la spedizione) e i contratti Poste di
          altri master, che pagano il proprio fornitore.
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
