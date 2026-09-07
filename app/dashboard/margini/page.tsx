'use client'
import { useState, useEffect, useMemo } from 'react'

type Racc = {
  tipo: 'cambia' | 'aggiungi'; zona: string; peso: number; per_spedizione: number
  usa?: string; margine_usa?: number; invece_di?: string; margine_invece?: number
  corriere?: string; margine_stimato?: number; nota?: string
}
type Cli = { listino_id: string; clienti: string[]; spedizioni_90gg: number; stima_guadagno_90gg: number; raccomandazioni: Racc[] }

export default function OttimizzaMargini() {
  const [attivo, setAttivo] = useState(true)
  const [totale, setTotale] = useState(0)
  const [data, setData] = useState<Cli[]>([])
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const [aperto, setAperto] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/network/ottimizza-margini').then(r => r.json()).then(j => {
      setAttivo(j?.attivo !== false); setTotale(Number(j?.totale_potenziale_90gg) || 0)
      setData(Array.isArray(j?.clienti) ? j.clienti : []); setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const eur = (n: number) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  const nomeCli = (c: Cli) => (c.clienti || []).join(', ') || 'Listino'
  const visibili = useMemo(() => data.filter(c => !cerca || nomeCli(c).toLowerCase().includes(cerca.toLowerCase())), [data, cerca])

  const card = { background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb', marginBottom: '12px', overflow: 'hidden' } as const

  if (!loading && !attivo) return <div style={{ maxWidth: 800 }}><h1 style={{ fontSize: 20, fontWeight: 800 }}>Ottimizza margini</h1><div style={{ ...card, padding: 20, color: '#9ca3af' }}>Funzione non attiva per questo master.</div></div>

  return (
    <div style={{ maxWidth: '1000px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#1a1a1a', margin: '0 0 6px' }}>Ottimizza margini</h1>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 14px' }}>
        Per ogni cliente ti dico <b>quale corriere usare</b> (e quali <b>aggiungere</b>) per guadagnare di più, con il <b>guadagno per spedizione</b>.
        Margine tutto incluso (prezzo cliente − tuo costo, nolo+fuel). Solo consiglio: nessun prezzo viene modificato.
      </p>

      {!loading && totale > 0 && (
        <div style={{ background: 'linear-gradient(100deg,#f0fdf4,#dcfce7)', border: '1px solid #86efac', borderRadius: '10px', padding: '14px 18px', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Guadagno potenziale stimato</div>
          <div style={{ fontSize: '26px', fontWeight: 800, color: '#15803d' }}>{eur(totale)} <span style={{ fontSize: '13px', fontWeight: 500, color: '#4b5563' }}>in 90 giorni</span></div>
          <div style={{ fontSize: '12px', color: '#4b5563', marginTop: '2px' }}>Stima sul tuo volume reale (spedizioni ultimi 90 giorni) spostando ogni rotta sul corriere a margine più alto.</div>
        </div>
      )}

      <input value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Cerca cliente…"
        style={{ width: '100%', maxWidth: '340px', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', color: '#1a1a1a', marginBottom: '16px' }} />

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>Calcolo margini…</div>
      ) : !visibili.length ? (
        <div style={{ ...card, padding: '20px', textAlign: 'center', color: '#9ca3af' }}>Nessuna opportunità: i corrieri attuali sono già i migliori su ogni rotta.</div>
      ) : visibili.map(c => {
        const isOpen = aperto === c.listino_id
        return (
          <div key={c.listino_id} style={card}>
            <button onClick={() => setAperto(isOpen ? null : c.listino_id)}
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: '#1a1a1a' }}>{nomeCli(c)}</span>
              <span style={{ display: 'flex', gap: '14px', alignItems: 'center', fontSize: '12px', color: '#6b7280' }}>
                <span>{c.spedizioni_90gg} sped./90gg</span>
                {c.stima_guadagno_90gg > 0 && <span style={{ color: '#15803d', fontWeight: 700 }}>+{eur(c.stima_guadagno_90gg)} potenziali</span>}
                <span>{c.raccomandazioni.length} consigli · {isOpen ? '▲' : '▼'}</span>
              </span>
            </button>
            {isOpen && (
              <div style={{ borderTop: '1px solid #eee', padding: '8px 16px 14px' }}>
                {c.raccomandazioni.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', padding: '8px 0', borderBottom: '1px solid #f5f5f5', fontSize: '13px', flexWrap: 'wrap' }}>
                    <span style={{ minWidth: '150px', color: '#6b7280' }}>{r.zona} · fino a {r.peso}kg</span>
                    {r.tipo === 'cambia' ? (
                      <span style={{ flex: 1, color: '#1a1a1a' }}>
                        Usa <b style={{ color: '#0369a1' }}>{r.usa}</b> ({eur(r.margine_usa!)}) anziché {r.invece_di} ({eur(r.margine_invece!)})
                      </span>
                    ) : (
                      <span style={{ flex: 1, color: '#1a1a1a' }}>
                        <b style={{ color: '#9a3412' }}>Vendigli anche {r.corriere}</b> — margine stimato {eur(r.margine_stimato!)} vs il tuo migliore {r.invece_di} ({eur(r.margine_invece!)})
                      </span>
                    )}
                    <span style={{ fontWeight: 700, color: '#15803d', whiteSpace: 'nowrap' }}>+{eur(r.per_spedizione)}/sped.</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
