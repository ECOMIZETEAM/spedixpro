'use client'
import { useState, useEffect, useMemo } from 'react'

interface Master { id: string; nome: string; email: string; parent_master_id: string | null; attivo: boolean }
interface Cliente { id: string; ragione_sociale: string; email: string; master_id: string; attivo: boolean }

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
      padre: m.parent_master_id ? nomeMaster(m.parent_master_id) : '—',
      profondita: m.id === rootId ? 0 : profondita(m.id),
    }))
    const clienteRighe = clienti.map(c => ({
      tipo: 'cliente' as const,
      id: c.id,
      nome: c.ragione_sociale,
      email: c.email,
      attivo: c.attivo,
      padre: nomeMaster(c.master_id),
      profondita: profondita(c.master_id) + 1,
    }))
    const tutte = [...masterRighe, ...clienteRighe].sort((a, b) => a.profondita - b.profondita || a.nome.localeCompare(b.nome))

    if (!search.trim()) return tutte
    const s = search.toLowerCase()
    return tutte.filter(r => r.nome.toLowerCase().includes(s) || r.email.toLowerCase().includes(s))
  }, [masters, clienti, search, rootId])

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Gerarchia Completa</h1>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>
          Vista completa di tutti i master e clienti nell'albero, con ricerca
        </p>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Cerca per nome o email..."
          style={{ width: '100%', maxWidth: '400px', padding: '9px 14px', border: '1px solid #e8e8e8', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
        />
      </div>

      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#999', padding: '40px' }}>Caricamento...</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  {['Tipo', 'Nome', 'Email', 'Livello', 'Appartiene a', 'Stato'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '9px 14px', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', color: '#1a1a1a', borderBottom: '1px solid #f0f0f0' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {righe.map(r => (
                  <tr key={`${r.tipo}-${r.id}`} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ fontSize: '14px' }}>{r.tipo === 'master' ? (r.id === rootId ? '👑' : '🏢') : '👤'}</span>
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: '600', color: '#1a1a1a' }}>
                      {'—'.repeat(r.profondita)} {r.nome}
                    </td>
                    <td style={{ padding: '10px 14px', color: '#666', fontSize: '12px' }}>{r.email}</td>
                    <td style={{ padding: '10px 14px', color: '#999', fontSize: '12px' }}>{r.profondita === 0 ? 'Root' : `Livello ${r.profondita}`}</td>
                    <td style={{ padding: '10px 14px', color: '#666', fontSize: '12px' }}>{r.padre}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ background: r.attivo ? '#f0fdf4' : '#fef2f2', color: r.attivo ? '#16a34a' : '#dc2626', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '500' }}>
                        {r.attivo ? 'Attivo' : 'Inattivo'}
                      </span>
                    </td>
                  </tr>
                ))}
                {!righe.length && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: '#999' }}>Nessun risultato</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
