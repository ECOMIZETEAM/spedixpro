'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'

interface Master { id: string; nome: string; email: string; parent_master_id: string | null; attivo: boolean }
interface Cliente { id: string; ragione_sociale: string; email: string; master_id: string; attivo: boolean }

// Palette per livello (niente blu: arancio → verde → viola → ambra)
const LIV = [
  { bg: '#fff7ed', text: '#ea580c', border: '#fed7aa', line: '#fdba74' }, // root
  { bg: '#fff7ed', text: '#f97316', border: '#fed7aa', line: '#fed7aa' }, // liv 1
  { bg: '#f0fdf4', text: '#16a34a', border: '#bbf7d0', line: '#bbf7d0' }, // liv 2
  { bg: '#fdf4ff', text: '#a21caf', border: '#f0abfc', line: '#f0abfc' }, // liv 3
  { bg: '#fefce8', text: '#ca8a04', border: '#fde68a', line: '#fde68a' }, // liv 4+
]
const livOf = (d: number) => LIV[Math.min(d, LIV.length - 1)]
const iniziali = (s: string) => (s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'

export default function GerarchiaPage() {
  const [masters, setMasters] = useState<Master[]>([])
  const [clienti, setClienti] = useState<Cliente[]>([])
  const [rootId, setRootId] = useState('')
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [mostraClienti, setMostraClienti] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/master/gerarchia').then(r => r.json()).then(d => {
      const ms: Master[] = d.masters || []
      setMasters(ms)
      setClienti(d.clienti || [])
      setRootId(d.rootId || '')
      setExpanded(new Set(ms.map(m => m.id))) // tutto espanso di default
      setLoading(false)
    })
  }, [])

  // Indici
  const figliMaster = useMemo(() => {
    const m = new Map<string, Master[]>()
    for (const x of masters) {
      const k = x.parent_master_id || '__root__'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(x)
    }
    for (const arr of m.values()) arr.sort((a, b) => a.nome.localeCompare(b.nome))
    return m
  }, [masters])

  const clientiDi = useMemo(() => {
    const m = new Map<string, Cliente[]>()
    for (const c of clienti) {
      if (!m.has(c.master_id)) m.set(c.master_id, [])
      m.get(c.master_id)!.push(c)
    }
    for (const arr of m.values()) arr.sort((a, b) => a.ragione_sociale.localeCompare(b.ragione_sociale))
    return m
  }, [clienti])

  const depthOf = useCallback((id: string): number => {
    if (id === rootId) return 0
    const byId = new Map(masters.map(m => [m.id, m]))
    let curr = id, d = 0
    for (let i = 0; i < 30; i++) {
      const m = byId.get(curr)
      if (!m?.parent_master_id) break
      curr = m.parent_master_id; d++
      if (curr === rootId) return d
    }
    return d
  }, [masters, rootId])

  const maxDepth = useMemo(() => Math.max(0, ...masters.map(m => depthOf(m.id))), [masters, depthOf])

  const stats = useMemo(() => ({
    totMaster: masters.length,
    totClienti: clienti.length,
    livelli: maxDepth,
  }), [masters, clienti, maxDepth])

  // Ricerca: id che matchano + antenati da tenere visibili
  const { matchSet, keepSet } = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return { matchSet: new Set<string>(), keepSet: null as Set<string> | null }
    const match = new Set<string>()
    const keep = new Set<string>()
    const byId = new Map(masters.map(m => [m.id, m]))
    const risali = (masterId: string) => {
      let curr: string | null = masterId
      for (let i = 0; i < 30 && curr; i++) { keep.add(curr); curr = byId.get(curr)?.parent_master_id || null }
    }
    for (const m of masters) {
      if (m.nome.toLowerCase().includes(s) || (m.email || '').toLowerCase().includes(s)) { match.add(m.id); risali(m.id) }
    }
    if (mostraClienti) for (const c of clienti) {
      if (c.ragione_sociale.toLowerCase().includes(s) || (c.email || '').toLowerCase().includes(s)) { match.add(c.id); keep.add(c.id); risali(c.master_id) }
    }
    return { matchSet: match, keepSet: keep }
  }, [search, masters, clienti, mostraClienti])

  function toggle(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const espandiTutto = () => setExpanded(new Set(masters.map(m => m.id)))
  const comprimiTutto = () => setExpanded(new Set())
  const espandiFinoA = (liv: number) => setExpanded(new Set(masters.filter(m => depthOf(m.id) < liv).map(m => m.id)))

  // Se sto cercando, forzo l'espansione dei rami che contengono match
  const effExpanded = useMemo(() => {
    if (!keepSet) return expanded
    return new Set([...expanded, ...keepSet])
  }, [expanded, keepSet])

  const Highlight = ({ text }: { text: string }) => {
    const s = search.trim()
    if (!s) return <>{text}</>
    const i = text.toLowerCase().indexOf(s.toLowerCase())
    if (i < 0) return <>{text}</>
    return <>{text.slice(0, i)}<mark style={{ background: '#fed7aa', color: '#9a3412', padding: '0 1px', borderRadius: '2px' }}>{text.slice(i, i + s.length)}</mark>{text.slice(i + s.length)}</>
  }

  function ClienteRow({ c }: { c: Cliente }) {
    if (keepSet && !keepSet.has(c.id)) return null
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', borderRadius: '8px', margin: '2px 0' }}
        onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
        <span style={{ width: '16px' }} />
        <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: '#f4f4f5', color: '#71717a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '700', flexShrink: 0 }}>{iniziali(c.ragione_sociale)}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '13px', color: '#1a1a1a', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><Highlight text={c.ragione_sociale} /></div>
          <div style={{ fontSize: '11px', color: '#a1a1aa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.email}</div>
        </div>
        <span style={{ fontSize: '10px', fontWeight: '600', color: '#71717a', background: '#f4f4f5', padding: '2px 7px', borderRadius: '5px' }}>Cliente</span>
        <span title={c.attivo ? 'Attivo' : 'Inattivo'} style={{ width: '8px', height: '8px', borderRadius: '50%', background: c.attivo ? '#22c55e' : '#ef4444', flexShrink: 0 }} />
      </div>
    )
  }

  function MasterNode({ m }: { m: Master }) {
    const d = depthOf(m.id)
    const col = livOf(d)
    const subMasters = figliMaster.get(m.id) || []
    const subClienti = mostraClienti ? (clientiDi.get(m.id) || []) : []
    const nFigli = subMasters.length + subClienti.length
    const isOpen = effExpanded.has(m.id)
    const isRoot = m.id === rootId

    // Con ricerca attiva: mostro solo rami che portano a un match
    const visSubMasters = keepSet ? subMasters.filter(s => keepSet.has(s.id)) : subMasters
    const visClienti = keepSet ? subClienti.filter(c => keepSet.has(c.id)) : subClienti
    const isMatch = matchSet.has(m.id)

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px', borderRadius: '9px', margin: '2px 0', border: isMatch ? '1px solid #fed7aa' : '1px solid transparent', background: isMatch ? '#fff7ed' : 'transparent' }}
          onMouseEnter={e => { if (!isMatch) e.currentTarget.style.background = '#fafafa' }} onMouseLeave={e => { if (!isMatch) e.currentTarget.style.background = 'transparent' }}>
          <button onClick={() => toggle(m.id)} disabled={!nFigli}
            style={{ width: '18px', height: '18px', flexShrink: 0, border: 'none', background: 'none', cursor: nFigli ? 'pointer' : 'default', color: nFigli ? '#a1a1aa' : 'transparent', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</button>
          <div style={{ width: '32px', height: '32px', borderRadius: '9px', background: isRoot ? '#f97316' : col.bg, color: isRoot ? '#fff' : col.text, border: `1px solid ${isRoot ? '#f97316' : col.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800', flexShrink: 0 }}>{iniziali(m.nome)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <span style={{ fontSize: '13.5px', fontWeight: '700', color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><Highlight text={m.nome} /></span>
              <span style={{ fontSize: '9px', fontWeight: '700', color: col.text, background: col.bg, border: `1px solid ${col.border}`, padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase', flexShrink: 0 }}>{isRoot ? 'ROOT' : `LIV. ${d}`}</span>
            </div>
            <div style={{ fontSize: '11px', color: '#a1a1aa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</div>
          </div>
          {nFigli > 0 && (
            <span style={{ fontSize: '11px', color: '#71717a', whiteSpace: 'nowrap' }}>
              {subMasters.length > 0 && <><b style={{ color: '#52525b' }}>{subMasters.length}</b> master</>}
              {subMasters.length > 0 && subClienti.length > 0 && ' · '}
              {subClienti.length > 0 && <><b style={{ color: '#52525b' }}>{subClienti.length}</b> clienti</>}
            </span>
          )}
          <span title={m.attivo ? 'Attivo' : 'Inattivo'} style={{ width: '8px', height: '8px', borderRadius: '50%', background: m.attivo ? '#22c55e' : '#ef4444', flexShrink: 0 }} />
        </div>
        {isOpen && nFigli > 0 && (
          <div style={{ marginLeft: '25px', paddingLeft: '10px', borderLeft: `1.5px solid ${col.line}` }}>
            {visSubMasters.map(s => <MasterNode key={s.id} m={s} />)}
            {visClienti.map(c => <ClienteRow key={c.id} c={c} />)}
          </div>
        )}
      </div>
    )
  }

  const root = masters.find(m => m.id === rootId)
  const statCard = (label: string, val: any) => (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '13px 18px', flex: 1 }}>
      <div style={{ fontSize: '11px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: '800', color: '#1a1a1a', marginTop: '2px' }}>{val}</div>
    </div>
  )

  const chip = (attivo: boolean): React.CSSProperties => ({
    padding: '6px 12px', borderRadius: '7px', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
    border: `1px solid ${attivo ? '#f97316' : '#e8e8e8'}`, background: attivo ? '#fff7ed' : '#fff', color: attivo ? '#ea580c' : '#666',
  })

  return (
    <div>
      <div style={{ marginBottom: '18px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Gerarchia della Rete</h1>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>Albero completo di master, sotto-master e clienti — espandibile, con ricerca e filtri per livello</p>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        {statCard('Master Totali', stats.totMaster)}
        {statCard('Clienti Totali', stats.totClienti)}
        {statCard('Profondità', `${stats.livelli} ${stats.livelli === 1 ? 'livello' : 'livelli'}`)}
      </div>

      {/* Toolbar */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '14px 16px', marginBottom: '14px', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Cerca master o cliente per nome o email..."
          style={{ flex: '1 1 260px', padding: '9px 14px', border: '1px solid #e8e8e8', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box', color: '#1a1a1a' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12.5px', color: '#555', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={mostraClienti} onChange={e => setMostraClienti(e.target.checked)} style={{ width: '15px', height: '15px', accentColor: '#f97316' }} />
          Mostra clienti
        </label>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', color: '#999', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.5px', marginRight: '2px' }}>Livello</span>
          <button style={chip(false)} onClick={espandiTutto}>Tutti</button>
          {Array.from({ length: maxDepth + 1 }, (_, i) => (
            <button key={i} style={chip(false)} onClick={() => espandiFinoA(i)}>{i === 0 ? 'Root' : `L${i}`}</button>
          ))}
          <button style={{ ...chip(false), color: '#999' }} onClick={comprimiTutto}>Comprimi</button>
        </div>
      </div>

      {/* Albero */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e8e8e8', padding: '10px 14px', minHeight: '200px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#999', padding: '50px' }}>Caricamento...</div>
        ) : !root ? (
          <div style={{ textAlign: 'center', color: '#999', padding: '50px' }}>Nessun dato disponibile</div>
        ) : (keepSet && keepSet.size === 0) ? (
          <div style={{ textAlign: 'center', color: '#999', padding: '50px' }}>Nessun risultato per "{search}"</div>
        ) : (
          <MasterNode m={root} />
        )}
      </div>
    </div>
  )
}
