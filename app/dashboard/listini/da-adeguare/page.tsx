'use client'
import { useState, useEffect } from 'react'
import { useDialog } from '@/app/components/DialogProvider'

type Fascia = { peso_max: number; zona?: string | null; prezzo: number; pavimento: number }
type Gruppo = { listino_id: string; listino_nome: string; corriere_nome: string; clienti: string[]; fasce: Fascia[] }

export default function ListiniDaAdeguare() {
  const dialog = useDialog()
  const [gruppi, setGruppi] = useState<Gruppo[]>([])
  const [tot, setTot] = useState(0)
  const [loading, setLoading] = useState(true)
  const [base, setBase] = useState<'pavimento' | 'attuale'>('pavimento')
  const [margineTipo, setMargineTipo] = useState<'fisso' | 'perc'>('perc')
  const [margineValore, setMargineValore] = useState('0')
  const [salvando, setSalvando] = useState(false)

  const carica = () => {
    setLoading(true)
    fetch('/api/network/pavimento-da-adeguare').then(r => r.json()).then(j => {
      setGruppi(Array.isArray(j?.gruppi) ? j.gruppi : []); setTot(Number(j?.totaleFasce) || 0); setLoading(false)
    }).catch(() => setLoading(false))
  }
  useEffect(() => { carica() }, [])

  const eur = (n: number) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  const mv = Math.max(0, parseFloat(margineValore.replace(',', '.')) || 0)
  const nuovoPrezzo = (f: Fascia) => {
    const partenza = base === 'attuale' ? f.prezzo : f.pavimento
    const n = margineTipo === 'perc' ? partenza * (1 + mv / 100) : partenza + mv
    return Math.round(n * 100) / 100
  }

  async function applica() {
    const msg = base === 'pavimento'
      ? `Porto al minimo tutte le ${tot} fasce sotto pavimento e aggiungo ${margineTipo === 'perc' ? mv + '%' : eur(mv)} di margine. Solo aumenti. Procedo?`
      : `Aggiungo ${margineTipo === 'perc' ? mv + '%' : eur(mv)} al prezzo attuale delle ${tot} fasce sotto pavimento. Procedo?`
    if (!await dialog.confirm({ title: 'Allinea listini', message: msg, confirmText: 'Allinea' })) return
    setSalvando(true)
    try {
      const r = await fetch('/api/network/pavimento-allinea', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base, margineTipo, margineValore: mv }),
      })
      const j = await r.json()
      if (j?.success) { await dialog.alert({ title: 'Fatto', message: `${j.aggiornate} fasce aggiornate.` }); carica() }
      else await dialog.alert({ title: 'Errore', message: j?.error || 'Allineamento non riuscito.' })
    } finally { setSalvando(false) }
  }

  const card = { background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb', padding: '18px', marginBottom: '16px' } as const
  const radio = (attivo: boolean) => ({ padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + (attivo ? '#f97316' : '#d1d5db'), background: attivo ? '#fff7ed' : '#fff', color: attivo ? '#9a3412' : '#374151', fontWeight: attivo ? 700 : 500, cursor: 'pointer', fontSize: '13px' } as const)
  const th = { padding: '8px 10px', textAlign: 'left' as const, fontSize: '11px', fontWeight: 700, color: '#6b7280', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' as const }
  const td = { padding: '8px 10px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f3f4f6' }

  return (
    <div style={{ maxWidth: '1000px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#1a1a1a', margin: '0 0 6px' }}>Listini da adeguare</h1>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 18px' }}>
        Fasce dei tuoi listini cliente sotto il <b>prezzo minimo</b> del contratto. Su quelle fasce/zone il cliente
        non vede il prezzo e non può spedire finché non le adegui. Riguarda solo i listini ai clienti finali (non l'ingrosso ai sotto-master).
      </p>

      {!loading && tot > 0 && (
        <div style={card}>
          <div style={{ fontWeight: 700, color: '#1a1a1a', marginBottom: '12px' }}>Allinea in un clic</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px', fontWeight: 600 }}>Parti da</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button style={radio(base === 'pavimento')} onClick={() => setBase('pavimento')}>Prezzo minimo</button>
                <button style={radio(base === 'attuale')} onClick={() => setBase('attuale')}>Prezzo attuale</button>
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px', fontWeight: 600 }}>Margine</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button style={radio(margineTipo === 'perc')} onClick={() => setMargineTipo('perc')}>%</button>
                <button style={radio(margineTipo === 'fisso')} onClick={() => setMargineTipo('fisso')}>€ fisso</button>
                <input value={margineValore} onChange={e => setMargineValore(e.target.value)} inputMode="decimal"
                  style={{ width: '90px', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', color: '#1a1a1a' }} />
                <span style={{ fontSize: '13px', color: '#6b7280' }}>{margineTipo === 'perc' ? '%' : '€'}</span>
              </div>
            </div>
            <button disabled={salvando} onClick={applica}
              style={{ padding: '10px 22px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: salvando ? 'default' : 'pointer', opacity: salvando ? 0.6 : 1 }}>
              {salvando ? 'Allineo…' : `Allinea ${tot} fasce`}
            </button>
          </div>
          <div style={{ fontSize: '12px', color: '#9a3412', marginTop: '10px' }}>
            Solo aumenti: nessun prezzo verrà mai abbassato. {base === 'attuale' && mv === 0 ? 'Con margine 0 sul prezzo attuale non cambia nulla.' : ''}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>Caricamento…</div>
      ) : tot === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: '#16a34a', fontWeight: 600 }}>✓ Nessun listino sotto il prezzo minimo. Tutto in regola.</div>
      ) : gruppi.map(g => (
        <div key={g.listino_id + g.corriere_nome} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
            <div>
              <span style={{ fontWeight: 700, color: '#1a1a1a' }}>{g.corriere_nome}</span>
              <span style={{ color: '#9ca3af' }}> · {g.listino_nome}</span>
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280', maxWidth: '480px', textAlign: 'right' }}>{(g.clienti || []).join(' · ') || '—'}</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Fascia', 'Zona', 'Prezzo attuale', 'Minimo', 'Nuovo prezzo'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {g.fasce.map((f, i) => {
                  const np = nuovoPrezzo(f)
                  const ancoraSotto = np < f.pavimento - 0.0001
                  return (
                    <tr key={i}>
                      <td style={td}>fino a {f.peso_max} kg</td>
                      <td style={{ ...td, color: '#6b7280' }}>{f.zona || '—'}</td>
                      <td style={{ ...td, color: '#dc2626' }}>{eur(f.prezzo)}</td>
                      <td style={td}>{eur(f.pavimento)}</td>
                      <td style={{ ...td, fontWeight: 700, color: ancoraSotto ? '#dc2626' : '#16a34a' }}>{eur(np)}{ancoraSotto ? ' ⚠️ ancora sotto' : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
