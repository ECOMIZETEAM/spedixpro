'use client'
import { useState, useEffect } from 'react'

// CHECK VOLUMETRICI — a colpo d'occhio, i contratti dove il divisore peso/volume che metti ai clienti
// è diverso dal tuo costo. Divisore più ALTO = volume più piccolo = più economico:
//  🔴 cliente > costo → vendi SOTTO COSTO sul volume (sui pacchi voluminosi incassi meno di quanto paghi)
//  🟡 cliente < costo → vendi sopra costo (ci guadagni; mostrato per consapevolezza)
// Ogni riga porta al listino: lo aggiusti, salvi, torni a controllare.

type Riga = {
  listino_id: string; listino_nome: string; clienti: string[]
  corriere_id: string; contratto: string
  divisore_costo: number; divisore_cliente: number; scarto: number
}

export default function CheckVolumetrici() {
  const [sottocosto, setSotto] = useState<Riga[]>([])
  const [sovracosto, setSopra] = useState<Riga[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [q, setQ] = useState('')

  const carica = () => {
    setLoading(true); setError(false)
    fetch('/api/listini/check-volumetrici')
      .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json() })
      .then(j => {
        setSotto(Array.isArray(j?.sottocosto) ? j.sottocosto : [])
        setSopra(Array.isArray(j?.sovracosto) ? j.sovracosto : [])
        setLoading(false)
      })
      .catch(() => { setError(true); setLoading(false) })   // niente falso "tutto ok" su errore
  }
  useEffect(() => { carica() }, [])

  const filtro = (righe: Riga[]) => q.trim()
    ? righe.filter(r => `${r.listino_nome} ${r.clienti.join(' ')} ${r.contratto}`.toLowerCase().includes(q.trim().toLowerCase()))
    : righe
  const sotto = filtro(sottocosto), sopra = filtro(sovracosto)

  const th: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#8a8a8a', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid #f4f4f4' }
  const linkListino = (r: Riga) => `/dashboard/listini/clienti/${r.listino_id}?corriere=${r.corriere_id}`

  const tabella = (righe: Riga[], tono: 'rosso' | 'giallo') => (
    <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={th}>Listino / clienti</th>
          <th style={th}>Contratto</th>
          <th style={{ ...th, textAlign: 'right' }}>Tu paghi su (÷)</th>
          <th style={{ ...th, textAlign: 'right' }}>Vendi su (÷)</th>
          <th style={th}></th>
        </tr></thead>
        <tbody>
          {righe.slice(0, 500).map(r => (
            <tr key={`${r.listino_id}|${r.corriere_id}`}>
              <td style={td}>
                <div style={{ fontWeight: 600 }}>{r.listino_nome}</div>
                <div style={{ fontSize: 11.5, color: '#888' }}>{r.clienti.slice(0, 3).join(', ') || 'nessun cliente assegnato'}{r.clienti.length > 3 ? ` +${r.clienti.length - 3}` : ''}</div>
              </td>
              <td style={td}>{r.contratto}</td>
              <td style={{ ...td, textAlign: 'right', color: '#64748b', fontWeight: 600 }}>{r.divisore_costo}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: tono === 'rosso' ? '#b91c1c' : '#b45309' }}>{r.divisore_cliente}</td>
              <td style={{ ...td, textAlign: 'right' }}>
                <a href={linkListino(r)} style={{ background: tono === 'rosso' ? '#b91c1c' : '#1a1a1a', color: '#fff', border: 0, borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                  Correggi →
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {righe.length > 500 && <div style={{ color: '#888', fontSize: 12.5, padding: '8px 12px' }}>Mostrate le prime 500 di {righe.length}.</div>}
    </div>
  )

  return (
    <div style={{ padding: '18px 20px', maxWidth: 1150, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Check Volumetrici</h1>
      <p style={{ color: '#666', fontSize: 13.5, margin: '0 0 8px', lineHeight: 1.5 }}>
        Il divisore peso/volume che metti ai clienti, confrontato col tuo costo, contratto per contratto.
        Un divisore <strong>più alto</strong> fa un peso volumetrico <strong>più piccolo</strong> (più economico):
        se lo metti ai clienti <strong>più alto del tuo costo</strong>, sui pacchi voluminosi incassi meno di quanto paghi.
        Clicca <strong>Correggi</strong> per andare al listino, sistemarlo e tornare qui.
      </p>

      {loading ? <div style={{ color: '#888', marginTop: 16 }}>Sto controllando i tuoi listini…</div>
       : error ? (
         <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 16, color: '#b91c1c', fontWeight: 600 }}>
           Non sono riuscito a controllare i listini. Riprova tra poco.
         </div>
       ) : (
        <>
          <div style={{ margin: '12px 0' }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cerca cliente, listino, contratto…"
              style={{ width: '100%', maxWidth: 420, padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }} />
          </div>

          {sottocosto.length === 0 && sovracosto.length === 0 ? (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 16, color: '#166534', fontWeight: 600 }}>
              ✓ Tutto allineato: nessun listino cliente ha il volumetrico diverso dal tuo costo.
            </div>
          ) : (sotto.length === 0 && sopra.length === 0) ? (
            <div style={{ color: '#888', fontSize: 13 }}>Nessun risultato per «{q}».</div>
          ) : null}

          {/* CARD 1 — SOTTO COSTO (rosso) */}
          {sotto.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px 10px 0 0', padding: '12px 16px' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#b91c1c' }}>🔴 Venduto sotto costo sul volume — {sotto.length}</div>
                <div style={{ fontSize: 12.5, color: '#991b1b', marginTop: 2 }}>
                  Il cliente ha il divisore <b>più alto</b> del tuo costo → sui pacchi voluminosi paga meno di quanto paghi tu. Da sistemare.
                </div>
              </div>
              {tabella(sotto, 'rosso')}
            </div>
          )}

          {/* CARD 2 — SOPRA COSTO (giallo, informativo) */}
          {sopra.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px 10px 0 0', padding: '12px 16px' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#b45309' }}>🟡 Venduto sopra costo sul volume — {sopra.length}</div>
                <div style={{ fontSize: 12.5, color: '#92400e', marginTop: 2 }}>
                  Il cliente ha il divisore <b>più basso</b> del tuo costo → ci guadagni. Nessun problema, te lo mostriamo solo per consapevolezza.
                </div>
              </div>
              {tabella(sopra, 'giallo')}
            </div>
          )}
        </>
      )}
    </div>
  )
}
