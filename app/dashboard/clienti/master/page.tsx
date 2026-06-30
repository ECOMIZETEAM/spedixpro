'use client'
import { useState, useEffect } from 'react'

interface NodoMaster {
  id: string
  nome: string
  email: string
  attivo: boolean
}
interface NodoCliente {
  id: string
  ragione_sociale: string
  email: string
  attivo: boolean
}

function NodoAlbero({ masterId, nome, isRoot }: { masterId: string; nome: string; isRoot?: boolean }) {
  const [espanso, setEspanso] = useState(false)
  const [caricato, setCaricato] = useState(false)
  const [masters, setMasters] = useState<NodoMaster[]>([])
  const [clienti, setClienti] = useState<NodoCliente[]>([])
  const [loading, setLoading] = useState(false)

  async function toggleEspandi() {
    if (!espanso && !caricato) {
      setLoading(true)
      const res = await fetch(`/api/master/figli?parent_id=${masterId}`)
      const data = await res.json()
      setMasters(data.masters || [])
      setClienti(data.clienti || [])
      setCaricato(true)
      setLoading(false)
    }
    setEspanso(!espanso)
  }

  return (
    <div style={{ marginLeft: isRoot ? 0 : '24px' }}>
      <div onClick={toggleEspandi} style={{
        display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px',
        cursor: 'pointer', borderRadius: '6px', background: isRoot ? '#fff7ed' : '#fff',
        border: '1px solid #e8e8e8', marginBottom: '4px',
      }}>
        <span style={{ fontSize: '11px', color: '#999', width: '14px', display: 'inline-block', transform: espanso ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>▶</span>
        <span style={{ fontSize: '14px' }}>{isRoot ? '👑' : '🏢'}</span>
        <span style={{ fontWeight: '700', fontSize: '13px', color: '#1a1a1a' }}>{nome}</span>
        {isRoot && <span style={{ fontSize: '10px', color: '#f97316', fontWeight: '700', background: '#fff7ed', padding: '2px 6px', borderRadius: '4px' }}>ROOT</span>}
      </div>

      {espanso && (
        <div style={{ marginLeft: '14px', borderLeft: '1px dashed #ddd', paddingLeft: '10px' }}>
          {loading && <div style={{ fontSize: '12px', color: '#999', padding: '8px' }}>Caricamento...</div>}

          {!loading && masters.map(m => (
            <NodoAlbero key={m.id} masterId={m.id} nome={m.nome} />
          ))}

          {!loading && clienti.map(c => (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 12px',
              borderRadius: '6px', background: '#f9fafb', border: '1px solid #f0f0f0',
              marginBottom: '4px', marginLeft: '24px',
            }}>
              <span style={{ fontSize: '13px' }}>👤</span>
              <span style={{ fontSize: '12.5px', color: '#1a1a1a' }}>{c.ragione_sociale}</span>
              <span style={{ fontSize: '11px', color: '#999' }}>{c.email}</span>
            </div>
          ))}

          {!loading && !masters.length && !clienti.length && (
            <div style={{ fontSize: '12px', color: '#bbb', padding: '8px 12px' }}>Nessun figlio</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ElencoMasterPage() {
  const [root, setRoot] = useState<{ id: string; nome: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/master/root').then(r => r.json()).then(d => {
      setRoot(d)
      setLoading(false)
    })
  }, [])

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Elenco Master</h1>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>
          Clicca sulle tendine per espandere e vedere i master e clienti sottostanti
        </p>
      </div>

      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', padding: '20px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#999', padding: '40px' }}>Caricamento...</div>
        ) : root ? (
          <NodoAlbero masterId={root.id} nome={root.nome} isRoot />
        ) : (
          <div style={{ textAlign: 'center', color: '#999', padding: '40px' }}>Master non trovato</div>
        )}
      </div>
    </div>
  )
}
