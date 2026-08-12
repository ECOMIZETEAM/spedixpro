'use client'
import { useState, useEffect, useCallback } from 'react'

// Gestione ACCOUNT DEMO (solo super master): genera un account di prova pronto e pieno di dati finti,
// mostra le credenziali da consegnare al potenziale cliente, elenca le demo attive e permette di
// terminarle. Tutto quello che il demo fa è simulato: niente spedizioni, soldi, SMS o email reali.

interface Demo { id: string; nome: string; email: string; scadenza: string | null; creata: string; scaduta: boolean }

const dataIt = (s: string | null) => { if (!s) return '—'; const d = new Date(s); return isNaN(d.getTime()) ? '—' : d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }

export default function DemoPage() {
  const [demos, setDemos] = useState<Demo[]>([])
  const [nome, setNome] = useState('')
  const [creando, setCreando] = useState(false)
  const [nuovo, setNuovo] = useState<{ email: string; password: string; url: string; scadenza: string; spedizioni: number; clienti: number } | null>(null)
  const [errore, setErrore] = useState<string | null>(null)

  const carica = useCallback(async () => {
    try { const r = await fetch('/api/master/demo/lista'); if (r.ok) { const j = await r.json(); setDemos(j.demos || []) } } catch {}
  }, [])
  useEffect(() => { carica() }, [carica])

  const crea = async () => {
    setCreando(true); setErrore(null); setNuovo(null)
    try {
      const r = await fetch('/api/master/demo/crea', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome }) })
      const j = await r.json()
      if (!r.ok) { setErrore(j.error || 'Errore'); return }
      setNuovo(j); setNome(''); carica()
    } catch (e: any) { setErrore(String(e?.message || e)) } finally { setCreando(false) }
  }

  const termina = async (id: string) => {
    if (!confirm('Terminare questa prova? L\'accesso viene bloccato subito.')) return
    try { await fetch('/api/master/demo/termina', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); carica() } catch {}
  }

  const copia = (t: string) => { navigator.clipboard?.writeText(t).catch(() => {}) }

  const card: React.CSSProperties = { background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb', padding: '20px 22px' }
  const th: React.CSSProperties = { textAlign: 'left', padding: '9px 14px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '10px 14px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f0f0f0' }

  return (
    <div style={{ maxWidth: '900px' }}>
      <div style={{ marginBottom: '18px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Account Demo</h1>
        <span style={{ display: 'block', marginTop: '4px', fontSize: '13px', color: '#666' }}>
          Genera un account di prova per far toccare con mano il gestionale ai potenziali clienti. Dura 3 giorni,
          è già pieno di dati finti, e <strong>non spedisce né addebita nulla di reale</strong>.
        </span>
      </div>

      {/* Crea nuova demo */}
      <div style={{ ...card, marginBottom: '18px' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a', marginBottom: '10px' }}>Crea un nuovo account demo</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome (es. cliente / fiera) — facoltativo"
            style={{ flex: 1, minWidth: '220px', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px' }} />
          <button onClick={crea} disabled={creando} style={{ background: creando ? '#9ca3af' : '#f97316', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 22px', fontSize: '13px', fontWeight: 700, cursor: creando ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
            {creando ? 'Creazione…' : 'Crea demo →'}
          </button>
        </div>
        {errore && <div style={{ marginTop: '10px', color: '#b91c1c', fontSize: '13px' }}>{errore}</div>}
      </div>

      {/* Credenziali appena create */}
      {nuovo && (
        <div style={{ ...card, marginBottom: '18px', borderColor: '#fdba74', background: '#fff7ed' }}>
          <div style={{ fontSize: '14px', fontWeight: 800, color: '#9a3412', marginBottom: '10px' }}>✅ Demo pronta — consegna queste credenziali</div>
          <div style={{ background: '#fff', border: '1px solid #fed7aa', borderRadius: '8px', padding: '14px 16px', fontSize: '13.5px', display: 'grid', gap: '8px' }}>
            {[['Portale', nuovo.url], ['Email', nuovo.email], ['Password', nuovo.password]].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                <span style={{ color: '#9ca3af', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{k}</span>
                <span style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <strong style={{ fontFamily: 'monospace', color: '#1a1a1a' }}>{v}</strong>
                  <button onClick={() => copia(String(v))} style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: '6px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer', color: '#6b7280' }}>copia</button>
                </span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: '10px', fontSize: '12.5px', color: '#9a3412' }}>
            Scade il <strong>{dataIt(nuovo.scadenza)}</strong> · già dentro: {nuovo.spedizioni} spedizioni, {nuovo.clienti} clienti finti.
            <span style={{ display: 'block', marginTop: '4px', color: '#b45309' }}>Copiala ora: la password non viene più mostrata dopo.</span>
          </div>
        </div>
      )}

      {/* Elenco demo */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid #e5e7eb', fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Demo generate</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f9fafb' }}>{['Nome', 'Accesso', 'Scadenza', 'Stato', ''].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {!demos.length ? (
                <tr><td colSpan={5} style={{ padding: '22px 16px', color: '#9ca3af', fontSize: '13px', textAlign: 'center' }}>Nessuna demo ancora. Creane una qui sopra.</td></tr>
              ) : demos.map(d => (
                <tr key={d.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{d.nome}</td>
                  <td style={{ ...td, fontFamily: 'monospace', color: '#6b7280' }}>{d.email}</td>
                  <td style={{ ...td, color: '#6b7280' }}>{dataIt(d.scadenza)}</td>
                  <td style={td}>
                    <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '20px', background: d.scaduta ? '#f3f4f6' : '#dcfce7', color: d.scaduta ? '#6b7280' : '#166534' }}>
                      {d.scaduta ? 'Scaduta' : 'Attiva'}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {!d.scaduta && <button onClick={() => termina(d.id)} style={{ border: '1px solid #fecaca', background: '#fff', color: '#b91c1c', borderRadius: '6px', padding: '5px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Termina</button>}
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
