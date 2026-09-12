'use client'
import { useCallback, useEffect, useState } from 'react'
import { etichettaTipologia } from '@/lib/punti-poste'

// Punto scelto (quello che serve alla creazione: il codice va in pudo_mittente/pudo_destinatario).
export type PuntoScelto = { codice: string; nome: string; indirizzo: string; cap: string; localita: string; provincia: string }

// Selettore di un PuntoPoste / Ufficio Postale per un contratto DVA "porta a un PuntoPoste".
// Cerca i punti vicino a un CAP (ordinati per distanza) via /api/punti-poste, e ne fa scegliere uno.
// La mappa arriva in un secondo momento: qui la lista per distanza copre già il "vicino a te".
export default function PuntoPosteSelettore({ corriereId, lato, capIniziale, tipologia, valore, onChange, preferiti = [] }: {
  corriereId: string
  lato: 'partenza' | 'arrivo'
  capIniziale?: string
  tipologia?: string
  valore: PuntoScelto | null
  onChange: (p: PuntoScelto | null) => void
  preferiti?: PuntoScelto[]
}) {
  const [aperto, setAperto] = useState(false)
  const [cap, setCap] = useState((capIniziale || '').replace(/\D/g, '').slice(0, 5))
  const [punti, setPunti] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const label = etichettaTipologia(tipologia)

  const cerca = useCallback(async (c: string) => {
    if (!/^\d{5}$/.test(c)) { setErr('Inserisci un CAP di 5 cifre'); setPunti([]); return }
    setErr(''); setLoading(true)
    try {
      const r = await fetch(`/api/punti-poste?corriereId=${encodeURIComponent(corriereId)}&lato=${lato}&cap=${c}`)
      const d = await r.json()
      if (d.error) { setErr(d.error); setPunti([]) }
      else { setPunti(Array.isArray(d.punti) ? d.punti : []); if (!d.punti?.length) setErr('Nessun punto trovato vicino a questo CAP.') }
    } catch { setErr('Ricerca non riuscita, riprova.'); setPunti([]) } finally { setLoading(false) }
  }, [corriereId, lato])

  // All'apertura, se ho già un CAP (dal mittente/destinatario) cerco subito.
  useEffect(() => { if (aperto && cap && !punti.length && !loading) cerca(cap) /* eslint-disable-next-line */ }, [aperto])

  const scegli = (p: any) => {
    onChange({ codice: p.codice, nome: p.nome, indirizzo: p.indirizzo, cap: p.cap, localita: p.localita, provincia: p.provincia })
    setAperto(false)
  }

  const box: React.CSSProperties = { border: '1px solid #e8e8e8', borderRadius: '8px', padding: '10px 12px', background: '#fff' }
  const inp: React.CSSProperties = { padding: '7px 10px', border: '1px solid #e8e8e8', borderRadius: '6px', fontSize: '13px', width: '120px' }
  const btn: React.CSSProperties = { padding: '7px 12px', border: 'none', borderRadius: '6px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', background: '#f97316', color: '#fff' }

  if (valore) {
    return (
      <div style={box}>
        <div style={{ fontSize: '11.5px', color: '#16a34a', fontWeight: 700, marginBottom: '3px' }}>✓ {label} selezionato</div>
        <div style={{ fontSize: '13px', color: '#1a1a1a', fontWeight: 600 }}>{valore.nome || valore.codice}</div>
        <div style={{ fontSize: '12px', color: '#666' }}>{valore.indirizzo}, {valore.cap} {valore.localita} ({valore.provincia})</div>
        <button type="button" onClick={() => { onChange(null); setAperto(true) }} style={{ ...btn, background: '#6b7280', marginTop: '6px', padding: '5px 10px' }}>Cambia punto</button>
      </div>
    )
  }

  return (
    <div style={box}>
      {!aperto ? (
        <button type="button" onClick={() => setAperto(true)} style={btn}>Scegli {label}…</button>
      ) : (
        <>
          {preferiti.length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>I tuoi punti salvati</div>
              {preferiti.map(p => (
                <button key={p.codice} type="button" onClick={() => scegli(p)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', border: '1px solid #fed7aa', background: '#fff7ed', borderRadius: '6px', padding: '6px 9px', marginBottom: '4px', cursor: 'pointer', fontSize: '12.5px' }}>
                  ★ {p.nome || p.codice} — {p.indirizzo}, {p.cap} {p.localita}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
            <input value={cap} onChange={e => setCap(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="CAP" style={inp}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); cerca(cap) } }} />
            <button type="button" onClick={() => cerca(cap)} style={btn}>Cerca punti</button>
          </div>
          {loading && <div style={{ fontSize: '12px', color: '#666' }}>Ricerca in corso…</div>}
          {err && <div style={{ fontSize: '12px', color: '#dc2626' }}>{err}</div>}
          <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
            {punti.map((p: any) => (
              <button key={p.codice} type="button" onClick={() => scegli(p)}
                style={{ display: 'block', width: '100%', textAlign: 'left', border: '1px solid #eef2f6', background: '#fff', borderRadius: '6px', padding: '8px 10px', marginBottom: '5px', cursor: 'pointer' }}>
                <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#1a1a1a' }}>{p.nome || p.codice}</div>
                <div style={{ fontSize: '11.5px', color: '#666' }}>{p.indirizzo}, {p.cap} {p.localita} ({p.provincia}){p.distanzaKm != null ? ` · ${p.distanzaKm} km` : ''}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
