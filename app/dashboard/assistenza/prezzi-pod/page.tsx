'use client'
import { useEffect, useState } from 'react'

// Listino POD del master: quanto paga il cliente per ogni richiesta di prova di consegna.
// Regole a PRIORITA' (dalla piu' specifica): cliente+corriere > cliente > corriere > predefinito.
// Il cliente vede il prezzo all'apertura della richiesta; l'addebito parte quando il master carica la POD.
type Regola = { id: string; cliente_id: string | null; corriere_id: string | null; prezzo: number; attivo: boolean }
type Opz = { id: string; nome: string }

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0)

export default function PrezziPodPage() {
  const [regole, setRegole] = useState<Regola[]>([])
  const [clienti, setClienti] = useState<Opz[]>([])
  const [corrieri, setCorrieri] = useState<Opz[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [nuovo, setNuovo] = useState({ cliente_id: '', corriere_id: '', prezzo: '' })

  const carica = async () => {
    setLoading(true)
    const r = await fetch('/api/assistenza/pod-prezzi')
    const j = await r.json().catch(() => ({}))
    if (r.ok) {
      setRegole(j.regole || [])
      setClienti((j.clienti || []).map((c: any) => ({ id: c.id, nome: c.ragione_sociale })))
      setCorrieri((j.corrieri || []).map((c: any) => ({ id: c.id, nome: c.nome_contratto })))
    } else setMsg({ t: 'err', x: j.error || 'Errore di caricamento' })
    setLoading(false)
  }
  useEffect(() => { carica() }, [])

  const nomeCliente = (id: string | null) => id ? (clienti.find(c => c.id === id)?.nome || 'Cliente') : 'Tutti i clienti'
  const nomeCorriere = (id: string | null) => id ? (corrieri.find(c => c.id === id)?.nome || 'Corriere') : 'Tutti i corrieri'
  // Ordine di lettura = ordine di priorita': predefinito, per corriere, per cliente, cliente+corriere.
  const rank = (r: Regola) => (r.cliente_id ? 2 : 0) + (r.corriere_id ? 1 : 0)
  const regoleOrd = [...regole].sort((a, b) => rank(a) - rank(b) || nomeCliente(a.cliente_id).localeCompare(nomeCliente(b.cliente_id)))

  const salva = async () => {
    const prezzo = Number(String(nuovo.prezzo).replace(',', '.'))
    if (!isFinite(prezzo) || prezzo < 0) { setMsg({ t: 'err', x: 'Inserisci un prezzo valido (0 = gratuita)' }); return }
    setSalvando(true); setMsg(null)
    const r = await fetch('/api/assistenza/pod-prezzi', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_id: nuovo.cliente_id || null, corriere_id: nuovo.corriere_id || null, prezzo }),
    })
    const j = await r.json().catch(() => ({}))
    setSalvando(false)
    if (r.ok) { setMsg({ t: 'ok', x: 'Regola salvata' }); setNuovo({ cliente_id: '', corriere_id: '', prezzo: '' }); carica() }
    else setMsg({ t: 'err', x: j.error || 'Errore nel salvataggio' })
  }

  const toggleAttivo = async (rg: Regola) => {
    const r = await fetch('/api/assistenza/pod-prezzi', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_id: rg.cliente_id, corriere_id: rg.corriere_id, prezzo: rg.prezzo, attivo: !rg.attivo }),
    })
    if (r.ok) carica(); else { const j = await r.json().catch(() => ({})); setMsg({ t: 'err', x: j.error || 'Errore' }) }
  }

  const elimina = async (id: string) => {
    if (!confirm('Eliminare questa regola? I clienti torneranno alla regola più generica (o gratuita).')) return
    const r = await fetch('/api/assistenza/pod-prezzi', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    if (r.ok) carica(); else { const j = await r.json().catch(() => ({})); setMsg({ t: 'err', x: j.error || 'Errore' }) }
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e5e7eb' }
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f0f0f0' }
  const inp: React.CSSProperties = { padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', background: '#fff', width: '100%' }
  const lbl: React.CSSProperties = { display: 'block', fontSize: '11px', fontWeight: 700, color: '#6b7280', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.03em' }

  return (
    <div>
      <div style={{ marginBottom: '18px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Prezzi POD</h1>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '4px', maxWidth: '760px' }}>
          Decidi quanto paga il cliente per ogni richiesta di prova di consegna. Vale la regola più specifica:
          <b> cliente + corriere</b> batte <b>cliente</b>, che batte <b>corriere</b>, che batte il <b>predefinito</b>.
          Senza nessuna regola la POD è gratuita. Il cliente vede il prezzo già all'apertura; l'addebito parte quando carichi la POD.
        </p>
      </div>

      {msg && (
        <div style={{ marginBottom: '14px', padding: '10px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
          background: msg.t === 'ok' ? '#ecfdf5' : '#fef2f2', color: msg.t === 'ok' ? '#065f46' : '#991b1b', border: `1px solid ${msg.t === 'ok' ? '#a7f3d0' : '#fecaca'}` }}>
          {msg.x}
        </div>
      )}

      {/* NUOVA / MODIFICA REGOLA */}
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', padding: '16px', marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a', marginBottom: '14px' }}>Aggiungi o aggiorna una regola</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 140px auto', gap: '12px', alignItems: 'end' }}>
          <div>
            <label style={lbl}>Cliente</label>
            <select value={nuovo.cliente_id} onChange={e => setNuovo(n => ({ ...n, cliente_id: e.target.value }))} style={inp}>
              <option value="">Tutti i clienti</option>
              {clienti.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Corriere</label>
            <select value={nuovo.corriere_id} onChange={e => setNuovo(n => ({ ...n, corriere_id: e.target.value }))} style={inp}>
              <option value="">Tutti i corrieri</option>
              {corrieri.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Prezzo (€)</label>
            <input value={nuovo.prezzo} onChange={e => setNuovo(n => ({ ...n, prezzo: e.target.value }))} inputMode="decimal" placeholder="es. 2,00" style={inp} />
          </div>
          <button disabled={salvando} onClick={salva} style={{ padding: '10px 20px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: salvando ? 0.7 : 1, whiteSpace: 'nowrap' }}>
            {salvando ? 'Salvo…' : 'Salva regola'}
          </button>
        </div>
        <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '10px', marginBottom: 0 }}>
          Prezzo <b>0</b> = POD gratuita esplicita (utile per esentare un cliente pur avendo un predefinito a pagamento).
        </p>
      </div>

      {/* REGOLE ESISTENTI */}
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Regole attive</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f9fafb' }}>{['Cliente', 'Corriere', 'Prezzo', 'Stato', ''].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#999' }}>Caricamento…</td></tr>
              ) : !regoleOrd.length ? (
                <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#999' }}>Nessuna regola: al momento le POD sono gratuite per tutti.</td></tr>
              ) : regoleOrd.map(rg => (
                <tr key={rg.id} style={{ opacity: rg.attivo ? 1 : 0.5 }}>
                  <td style={td}>{rg.cliente_id ? nomeCliente(rg.cliente_id) : <span style={{ color: '#6b7280', fontStyle: 'italic' }}>Tutti i clienti</span>}</td>
                  <td style={td}>{rg.corriere_id ? nomeCorriere(rg.corriere_id) : <span style={{ color: '#6b7280', fontStyle: 'italic' }}>Tutti i corrieri</span>}</td>
                  <td style={{ ...td, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{Number(rg.prezzo) === 0 ? <span style={{ color: '#059669' }}>Gratuita</span> : eur(rg.prezzo)}</td>
                  <td style={td}>
                    <button onClick={() => toggleAttivo(rg)} style={{ padding: '4px 10px', borderRadius: '999px', border: '1px solid', fontSize: '11.5px', fontWeight: 700, cursor: 'pointer',
                      background: rg.attivo ? '#ecfdf5' : '#f3f4f6', color: rg.attivo ? '#065f46' : '#6b7280', borderColor: rg.attivo ? '#a7f3d0' : '#d1d5db' }}>
                      {rg.attivo ? 'Attiva' : 'Sospesa'}
                    </button>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button onClick={() => elimina(rg.id)} style={{ padding: '4px 10px', background: 'none', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Elimina</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
