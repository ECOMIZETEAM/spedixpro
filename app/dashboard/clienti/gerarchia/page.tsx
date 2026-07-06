'use client'
import { useState, useEffect, useMemo } from 'react'

interface Master { id: string; nome: string; email: string; parent_master_id: string | null; attivo: boolean }
interface Cliente { id: string; ragione_sociale: string; email: string; master_id: string; attivo: boolean }

const LIVELLO_COLORI = [
  { bg: '#fff7ed', text: '#f97316', border: '#fed7aa' }, // root
  { bg: '#fff7ed', text: '#f97316', border: '#fed7aa' }, // livello 1
  { bg: '#f0fdf4', text: '#16a34a', border: '#bbf7d0' }, // livello 2
  { bg: '#fdf4ff', text: '#a21caf', border: '#f0abfc' }, // livello 3
  { bg: '#fefce8', text: '#ca8a04', border: '#fde68a' }, // livello 4+
]

export default function GerarchiaPage() {
  const [masters, setMasters] = useState<Master[]>([])
  const [clienti, setClienti] = useState<Cliente[]>([])
  const [rootId, setRootId] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/master/gerarchia').then(r => r.json()).then(d => {
      setMasters(d.masters || [])
      setClienti(d.clienti || [])
      setRootId(d.rootId || '')
      setLoading(false)
    })
  }, [])

  function nomeMaster(id: string) {
    return masters.find(m => m.id === id)?.nome || '—'
  }

  function profondita(id: string): number {
    let curr = id, depth = 0
    for (let i = 0; i < 20; i++) {
      const m = masters.find(x => x.id === curr)
      if (!m?.parent_master_id) break
      curr = m.parent_master_id
      depth++
    }
    return depth
  }

  const righe = useMemo(() => {
    const masterRighe = masters.map(m => ({
      tipo: 'master' as const,
      id: m.id,
      nome: m.nome,
      email: m.email,
      attivo: m.attivo,
      padreId: m.parent_master_id,
      padre: m.parent_master_id ? nomeMaster(m.parent_master_id) : '—',
      profondita: m.id === rootId ? 0 : profondita(m.id),
    }))
    const clienteRighe = clienti.map(c => ({
      tipo: 'cliente' as const,
      id: c.id,
      nome: c.ragione_sociale,
      email: c.email,
      attivo: c.attivo,
      padreId: c.master_id,
      padre: nomeMaster(c.master_id),
      profondita: profondita(c.master_id) + 1,
    }))
    const tutte = [...masterRighe, ...clienteRighe].sort((a, b) => {
      if (a.profondita !== b.profondita) return a.profondita - b.profondita
      if (a.padreId !== b.padreId) return (a.padreId || '').localeCompare(b.padreId || '')
      return a.nome.localeCompare(b.nome)
    })

    if (!search.trim()) return tutte
    const s = search.toLowerCase()
    return tutte.filter(r => r.nome.toLowerCase().includes(s) || r.email.toLowerCase().includes(s))
  }, [masters, clienti, search, rootId])

  const stats = useMemo(() => ({
    totMaster: masters.length,
    totClienti: clienti.length,
    maxProfondita: Math.max(0, ...masters.map(m => profondita(m.id))),
  }), [masters, clienti])

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Gerarchia Completa</h1>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>
          Vista completa di tutti i master e clienti nell'albero, con ricerca
        </p>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '8px', padding: '12px 18px', flex: 1 }}>
          <div style={{ fontSize: '11px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Master Totali</div>
          <div style={{ fontSize: '22px', fontWeight: '800', color: '#1a1a1a', marginTop: '2px' }}>{stats.totMaster}</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '8px', padding: '12px 18px', flex: 1 }}>
          <div style={{ fontSize: '11px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Clienti Totali</div>
          <div style={{ fontSize: '22px', fontWeight: '800', color: '#1a1a1a', marginTop: '2px' }}>{stats.totClienti}</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '8px', padding: '12px 18px', flex: 1 }}>
          <div style={{ fontSize: '11px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Profondità Massima</div>
          <div style={{ fontSize: '22px', fontWeight: '800', color: '#1a1a1a', marginTop: '2px' }}>{stats.maxProfondita} livelli</div>
        </div>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Cerca per nome o email..."
          style={{ width: '100%', maxWidth: '420px', padding: '10px 16px', border: '1px solid #e8e8e8', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
        />
      </div>

      <div style={{ background: '#fff', borderRadius: '10px', border: '1px solid #e8e8e8', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#999', padding: '50px' }}>Caricamento...</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  {['', 'Nome', 'Email', 'Livello', 'Appartiene a', 'Stato'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '11px 16px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#999', borderBottom: '1px solid #f0f0f0' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {righe.map(r => {
                  const colore = LIVELLO_COLORI[Math.min(r.profondita, LIVELLO_COLORI.length - 1)]
                  const isMaster = r.tipo === 'master'
                  return (
                    <tr key={`${r.tipo}-${r.id}`} style={{ borderBottom: '1px solid #f5f5f5' }}>
                      <td style={{ padding: '12px 16px 12px 16px', width: '40px' }}>
                        <div style={{
                          width: '30px', height: '30px', borderRadius: '8px',
                          background: colore.bg, border: `1px solid ${colore.border}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px',
                        }}>
                          {r.profondita === 0 ? '👑' : isMaster ? '🏢' : '👤'}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: `${r.profondita * 18}px` }}>
                          {r.profondita > 0 && <span style={{ color: '#ddd', fontSize: '13px' }}>└</span>}
                          <span style={{ fontWeight: isMaster ? '700' : '500', color: '#1a1a1a' }}>{r.nome}</span>
                          {isMaster && r.profondita > 0 && (
                            <span style={{ fontSize: '9px', fontWeight: '700', color: colore.text, background: colore.bg, border: `1px solid ${colore.border}`, padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase' }}>Master</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#666', fontSize: '12px' }}>{r.email}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ fontSize: '11px', fontWeight: '600', color: colore.text, background: colore.bg, border: `1px solid ${colore.border}`, padding: '3px 9px', borderRadius: '5px' }}>
                          {r.profondita === 0 ? 'ROOT' : `LIV. ${r.profondita}`}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#666', fontSize: '12px' }}>{r.padre}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ background: r.attivo ? '#f0fdf4' : '#fef2f2', color: r.attivo ? '#16a34a' : '#dc2626', padding: '3px 9px', borderRadius: '5px', fontSize: '11px', fontWeight: '600' }}>
                          {r.attivo ? '● Attivo' : '● Inattivo'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {!righe.length && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: '50px', color: '#999' }}>Nessun risultato</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
