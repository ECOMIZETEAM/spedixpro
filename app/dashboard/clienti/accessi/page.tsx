'use client'
import { useEffect, useMemo, useState } from 'react'

// ACCESSI RETE: elenco PIATTO di tutti i master e tutti i clienti della rete, con ricerca e accesso
// diretto (impersona). Serve al vertice (root) per entrare ovunque senza scalare l'albero: la
// navigazione ad albero si ferma sui nodi senza gestione_rete, questa no (l'autorizzazione la fa la
// rotta impersona, che per i discendenti e' gia' consentita a chi vede la rete completa).

type Master = { id: string; nome: string; email: string | null; telefono: string | null; parent_master_id: string | null; attivo: boolean | null }
type Cliente = { id: string; ragione_sociale: string | null; email: string | null; telefono: string | null; codice_cliente: string | null; master_id: string; attivo: boolean | null }

const PER_PAGINA = 20
const inp: React.CSSProperties = { padding: '10px 12px', border: '1px solid #e2e2e2', borderRadius: 8, fontSize: 14, width: '100%', boxSizing: 'border-box' }

export default function AccessiRetePage() {
  const [masters, setMasters] = useState<Master[]>([])
  const [clienti, setClienti] = useState<Cliente[]>([])
  const [nomi, setNomi] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [errore, setErrore] = useState<string | null>(null)
  const [tab, setTab] = useState<'master' | 'cliente'>('master')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    fetch('/api/rete/elenco')
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) { setErrore(d?.error || 'Errore nel caricamento'); return }
        setMasters(d.masters || []); setClienti(d.clienti || []); setNomi(d.masterNomi || {})
      })
      .catch(() => setErrore('Rete non raggiungibile'))
      .finally(() => setLoading(false))
  }, [])

  // Cambio scheda o ricerca → torno a pagina 1 (altrimenti si finisce su una pagina vuota).
  useEffect(() => { setPage(1) }, [tab, q])

  const term = q.trim().toLowerCase()
  const match = (...campi: (string | null | undefined)[]) =>
    !term || campi.some(c => (c || '').toLowerCase().includes(term))

  const mastersFiltrati = useMemo(() => masters.filter(m =>
    match(m.nome, m.email, m.telefono, m.parent_master_id ? nomi[m.parent_master_id] : '')), [masters, nomi, term])
  const clientiFiltrati = useMemo(() => clienti.filter(c =>
    match(c.ragione_sociale, c.email, c.telefono, c.codice_cliente, nomi[c.master_id])), [clienti, nomi, term])

  const lista = tab === 'master' ? mastersFiltrati : clientiFiltrati
  const totale = lista.length
  const pagine = Math.max(1, Math.ceil(totale / PER_PAGINA))
  const pageSafe = Math.min(page, pagine)
  const slice = lista.slice((pageSafe - 1) * PER_PAGINA, pageSafe * PER_PAGINA)

  const Badge = ({ attivo }: { attivo: boolean | null }) => (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
      background: attivo === false ? '#fef2f2' : '#ecfdf5', color: attivo === false ? '#b91c1c' : '#047857' }}>
      {attivo === false ? 'Inattivo' : 'Attivo'}
    </span>
  )
  const Accedi = ({ href }: { href: string }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" title="Accedi al portale"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8,
        background: '#f97316', color: '#fff', fontSize: 13, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
      ↪ Accedi
    </a>
  )

  const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#6b7280', borderBottom: '1px solid #e8e8e8' }
  const td: React.CSSProperties = { padding: '12px', fontSize: 14, color: '#1a1a1a', borderBottom: '1px solid #f0f0f0', verticalAlign: 'middle' }

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a', margin: '0 0 4px' }}>Accessi Rete</h1>
      <p style={{ color: '#6b7280', fontSize: 14, margin: '0 0 20px' }}>
        Entra direttamente in qualunque master o cliente della tua rete, senza passare per i livelli intermedi.
      </p>

      {/* Schede */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {([['master', 'Master', masters.length], ['cliente', 'Clienti', clienti.length]] as const).map(([k, label, n]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ padding: '8px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
              border: tab === k ? '1px solid #f97316' : '1px solid #e2e2e2',
              background: tab === k ? '#fff7ed' : '#fff', color: tab === k ? '#c2410c' : '#374151' }}>
            {label} <span style={{ opacity: 0.6 }}>({n})</span>
          </button>
        ))}
      </div>

      {/* Ricerca */}
      <div style={{ marginBottom: 16 }}>
        <input style={inp} placeholder="Cerca per nome, email, telefono…" value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Caricamento…</div>
      ) : errore ? (
        <div style={{ padding: 20, background: '#fef2f2', color: '#b91c1c', borderRadius: 8, fontSize: 14 }}>{errore}</div>
      ) : (
        <>
          <div style={{ border: '1px solid #e8e8e8', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={th}>{tab === 'master' ? 'Master' : 'Ragione sociale'}</th>
                    <th style={th}>Email</th>
                    <th style={th}>Telefono</th>
                    <th style={th}>{tab === 'master' ? 'Capo rete' : 'Master'}</th>
                    <th style={th}>Stato</th>
                    <th style={{ ...th, textAlign: 'right' }}>Accesso</th>
                  </tr>
                </thead>
                <tbody>
                  {slice.length === 0 && (
                    <tr><td style={{ ...td, textAlign: 'center', color: '#9ca3af' }} colSpan={6}>Nessun risultato</td></tr>
                  )}
                  {tab === 'master' && (slice as Master[]).map(m => (
                    <tr key={m.id}>
                      <td style={{ ...td, fontWeight: 600 }}>{m.nome}</td>
                      <td style={td}>{m.email || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                      <td style={td}>{m.telefono || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                      <td style={{ ...td, color: '#6b7280' }}>{m.parent_master_id ? (nomi[m.parent_master_id] || '—') : '—'}</td>
                      <td style={td}><Badge attivo={m.attivo} /></td>
                      <td style={{ ...td, textAlign: 'right' }}><Accedi href={`/api/master/${m.id}/impersona`} /></td>
                    </tr>
                  ))}
                  {tab === 'cliente' && (slice as Cliente[]).map(c => (
                    <tr key={c.id}>
                      <td style={{ ...td, fontWeight: 600 }}>
                        {c.ragione_sociale || <span style={{ color: '#9ca3af' }}>(senza nome)</span>}
                        {c.codice_cliente && <span style={{ color: '#9ca3af', fontWeight: 400, marginLeft: 6, fontSize: 12 }}>#{c.codice_cliente}</span>}
                      </td>
                      <td style={td}>{c.email || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                      <td style={td}>{c.telefono || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                      <td style={{ ...td, color: '#6b7280' }}>{nomi[c.master_id] || '—'}</td>
                      <td style={td}><Badge attivo={c.attivo} /></td>
                      <td style={{ ...td, textAlign: 'right' }}><Accedi href={`/api/clienti/${c.id}/impersona`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Paginazione */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, fontSize: 14, color: '#6b7280' }}>
            <span>{totale} {tab === 'master' ? 'master' : 'clienti'}{term ? ' trovati' : ''}</span>
            {pagine > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={pageSafe <= 1}
                  style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e2e2e2', background: '#fff', cursor: pageSafe <= 1 ? 'default' : 'pointer', opacity: pageSafe <= 1 ? 0.5 : 1 }}>‹ Prec.</button>
                <span>{pageSafe} / {pagine}</span>
                <button onClick={() => setPage(p => Math.min(pagine, p + 1))} disabled={pageSafe >= pagine}
                  style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e2e2e2', background: '#fff', cursor: pageSafe >= pagine ? 'default' : 'pointer', opacity: pageSafe >= pagine ? 0.5 : 1 }}>Succ. ›</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
