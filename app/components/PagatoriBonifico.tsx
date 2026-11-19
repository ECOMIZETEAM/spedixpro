'use client'
import { useEffect, useState } from 'react'
import { useDialog } from './DialogProvider'

// Sulla scheda di un cliente o sotto-master: chi gli paga i bonifici, come compare sull'estratto conto
// (lib/contabilita-banca). Piu' nomi per cliente (Lorenzo, 10/11: "magari ha due conti"), si aggiungono
// e si cancellano quelli scritti male. Si riempie anche da solo: dalla finestra di ricarica e, quando si
// abbina un bonifico dell'estratto, con il suo IBAN.
// `versione` cambia dopo una ricarica: il nome appena scritto compare senza ricaricare la pagina.

type P = { id: string, nome: string, iban: string | null, origine: string }
const ORIGINE: Record<string, string> = { manuale: 'scritto a mano', ricarica: 'dalla ricarica', estratto: "dall'estratto conto" }

export default function PagatoriBonifico({ target, versione = 0, style }: { target: string, versione?: number, style?: React.CSSProperties }) {
  const dialog = useDialog()
  const [attiva, setAttiva] = useState(false)
  const [lista, setLista] = useState<P[]>([])
  const [nome, setNome] = useState('')
  const [iban, setIban] = useState('')
  const [salvo, setSalvo] = useState(false)
  const [errore, setErrore] = useState('')

  useEffect(() => {
    if (!target) return
    fetch(`/api/contabilita/pagatori?target=${encodeURIComponent(target)}`)
      .then(r => r.json()).then(d => { setAttiva(d?.attiva === true); if (Array.isArray(d?.pagatori)) setLista(d.pagatori) })
      .catch(() => setAttiva(false))
  }, [target, versione])

  if (!attiva) return null

  async function aggiungi() {
    if (salvo || !nome.trim()) return
    setSalvo(true); setErrore('')
    try {
      const res = await fetch('/api/contabilita/pagatori', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, nome, iban }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.error) { setErrore(d.error || 'Salvataggio non riuscito'); return }
      setLista(d.pagatori || []); setNome(''); setIban('')
    } catch { setErrore('Errore di rete') } finally { setSalvo(false) }
  }

  async function elimina(p: P) {
    const ok = await dialog.confirm({
      title: `Togliere «${p.nome}»?`,
      message: "I bonifici con questo nome non verranno più riconosciuti come pagamenti di questo cliente. Le ricariche già fatte non cambiano.",
      confirmText: 'Togli', danger: true,
    })
    if (!ok) return
    setErrore('')
    const res = await fetch(`/api/contabilita/pagatori?target=${encodeURIComponent(target)}&id=${p.id}`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({}))
    if (!res.ok || d.error) { setErrore(d.error || 'Non riuscito'); return }
    setLista(d.pagatori || [])
  }

  return (
    <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', overflow: 'hidden', ...style }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Chi paga i bonifici</div>
      <div style={{ padding: '12px 16px' }}>
        {errore && <div style={{ marginBottom: '10px', padding: '8px 10px', borderRadius: '6px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '12px' }}>{errore}</div>}
        {lista.length === 0 ? (
          <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '10px' }}>
            Nessun nome. Scrivi come compare sul bonifico chi paga per questo cliente: servirà a ritrovarlo sull&apos;estratto conto.
          </div>
        ) : (
          <div style={{ marginBottom: '10px' }}>
            {lista.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid #f5f5f5' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nome}</div>
                  <div style={{ fontSize: '11px', color: '#9ca3af' }}>{p.iban ? `IBAN ${p.iban} · ` : ''}{ORIGINE[p.origine] || ''}</div>
                </div>
                <button onClick={() => elimina(p)} title="Togli questo nome" aria-label={`Togli ${p.nome}`}
                  style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: '16px', cursor: 'pointer', padding: '2px 6px', lineHeight: 1 }}>×</button>
              </div>
            ))}
          </div>
        )}
        <input value={nome} onChange={e => setNome(e.target.value)} maxLength={140} placeholder="Nome sul bonifico, es. SALVATORE PELLE" style={campo} />
        <input value={iban} onChange={e => setIban(e.target.value)} maxLength={40} placeholder="IBAN (facoltativo)" style={{ ...campo, marginTop: '6px' }} />
        <button onClick={aggiungi} disabled={salvo || !nome.trim()}
          style={{ marginTop: '8px', padding: '7px 14px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', opacity: salvo || !nome.trim() ? 0.6 : 1 }}>
          {salvo ? 'Salvo…' : '+ Aggiungi'}
        </button>
      </div>
    </div>
  )
}

const campo = { width: '100%', padding: '8px 11px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' as const, color: '#1a1a1a', background: '#fff' }
