'use client'
import { useEffect, useState } from 'react'
import { useDialog } from '@/app/components/DialogProvider'

// PREVENTIVI (Fase 1): lista (clienti e sotto-master separati) + crea bozza + elimina.
// L'editor a sezioni, l'invio email, la pagina pubblica e l'accetta→listino arrivano nelle fasi dopo.

const card: any = { background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', overflow: 'hidden', marginBottom: '18px' }
const th: any = { padding: '9px 12px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#666', textAlign: 'left', whiteSpace: 'nowrap' }
const td: any = { padding: '9px 12px', fontSize: '12.5px', color: '#1a1a1a', borderTop: '1px solid #f0f0f0' }
const inp: any = { width: '100%', padding: '9px 11px', border: '1px solid #d5d5d5', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', background: '#fff', boxSizing: 'border-box' }

const STATO_STILE: Record<string, { bg: string; col: string; label: string }> = {
  bozza: { bg: '#f3f4f6', col: '#4b5563', label: '📝 Bozza' },
  inviato: { bg: '#dbeafe', col: '#1d4ed8', label: '📤 Inviato' },
  visto: { bg: '#e0e7ff', col: '#4338ca', label: '👁 Visto' },
  accettato: { bg: '#dcfce7', col: '#15803d', label: '✅ Accettato' },
  rifiutato: { bg: '#fee2e2', col: '#b91c1c', label: '✖ Rifiutato' },
  scaduto: { bg: '#fef3c7', col: '#92400e', label: '⏳ Scaduto' },
}

export default function Preventivi() {
  const dialog = useDialog()
  const [clienti, setClienti] = useState<any[]>([])
  const [master, setMaster] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)
  const [creando, setCreando] = useState(false)
  // form crea
  const [destTipo, setDestTipo] = useState<'cliente_nuovo' | 'cliente' | 'master'>('cliente_nuovo')
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [oggetto, setOggetto] = useState('Preventivo di spedizione')

  function carica() {
    setLoading(true)
    fetch('/api/preventivi').then(r => r.json()).then(d => {
      if (d?.error) { setErr(d.error); setLoading(false); return }
      setClienti(Array.isArray(d?.clienti) ? d.clienti : [])
      setMaster(Array.isArray(d?.master) ? d.master : [])
      setLoading(false)
    }).catch(() => { setErr('Errore nel caricamento'); setLoading(false) })
  }
  useEffect(() => { carica() }, [])

  function apri() { setDestTipo('cliente_nuovo'); setNome(''); setEmail(''); setOggetto('Preventivo di spedizione'); setErr(''); setOpen(true) }

  async function crea() {
    if (!nome.trim()) { setErr('Inserisci il nome del destinatario'); return }
    setCreando(true); setErr('')
    try {
      const res = await fetch('/api/preventivi', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dest_tipo: destTipo, dest_nome: nome.trim(), dest_email: email.trim(), oggetto: oggetto.trim() }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d?.error) { setErr(d?.error || 'Creazione non riuscita'); setCreando(false); return }
      setOpen(false); carica()
    } catch { setErr('Errore di rete') } finally { setCreando(false) }
  }

  async function elimina(id: string, nomeDest: string) {
    const ok = await dialog.confirm({ title: 'Eliminare il preventivo?', message: `Elimina la bozza per "${nomeDest}". Operazione irreversibile.`, danger: true, confirmText: 'Elimina' })
    if (!ok) return
    const res = await fetch(`/api/preventivi?id=${id}`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({}))
    if (!res.ok || d?.error) { await dialog.alert({ title: 'Errore', message: d?.error || 'Eliminazione non riuscita' }); return }
    carica()
  }

  const dataBreve = (s: any) => { try { return new Date(s).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }) } catch { return '' } }
  const badge = (st: string) => { const s = STATO_STILE[st] || STATO_STILE.bozza; return <span style={{ background: s.bg, color: s.col, fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{s.label}</span> }

  const Tabella = ({ righe, vuoto }: { righe: any[]; vuoto: string }) => (
    righe.length === 0 ? <div style={{ padding: '30px', textAlign: 'center', color: '#9aa', fontSize: '13px' }}>{vuoto}</div> : (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
          <thead><tr style={{ background: '#fafafa' }}>
            <th style={th}>Destinatario</th><th style={th}>Oggetto</th><th style={th}>Stato</th><th style={th}>Creato</th><th style={{ ...th, textAlign: 'right' }}></th>
          </tr></thead>
          <tbody>
            {righe.map(r => (
              <tr key={r.id}>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{r.dest_nome || '—'}</div>
                  {r.dest_email && <div style={{ fontSize: '11px', color: '#999' }}>{r.dest_email}</div>}
                  {r.dest_tipo === 'cliente_nuovo' && <span style={{ fontSize: '10px', fontWeight: 700, color: '#0891b2', background: '#ecfeff', padding: '1px 6px', borderRadius: '4px' }}>cliente nuovo</span>}
                </td>
                <td style={td}>{r.oggetto || '—'}</td>
                <td style={td}>{badge(r.stato)}</td>
                <td style={{ ...td, whiteSpace: 'nowrap', color: '#666' }}>{dataBreve(r.created_at)}</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {r.stato !== 'accettato' && (
                    <button onClick={() => elimina(r.id, r.dest_nome || '')} title="Elimina" style={{ background: 'transparent', border: 'none', color: '#b91c1c', fontSize: '15px', cursor: 'pointer' }}>🗑</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  )

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '22px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Preventivi</h1>
          <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>Crea e invia preventivi brandizzati a clienti e sotto-master. All'accettazione diventano il loro listino.</p>
        </div>
        <button onClick={apri} style={{ background: '#f97316', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 18px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>+ Crea preventivo</button>
      </div>

      <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '10px 14px', fontSize: '12.5px', color: '#9a3412', marginBottom: '16px' }}>
        Prima di inviare, imposta <b>logo e colori</b> in <b>Impostazioni → Logo e Nome Azienda</b>: preventivi ed email usano il tuo brand.
      </div>

      {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '14px' }}>{err}</div>}

      <div style={card}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Preventivi a clienti {!loading && `(${clienti.length})`}</div>
        {loading ? <div style={{ padding: '30px', textAlign: 'center', color: '#999' }}>Carico…</div> : <Tabella righe={clienti} vuoto="Nessun preventivo a clienti. Creane uno con + Crea preventivo." />}
      </div>

      <div style={card}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Preventivi a sotto-master {!loading && `(${master.length})`}</div>
        {loading ? <div style={{ padding: '30px', textAlign: 'center', color: '#999' }}>Carico…</div> : <Tabella righe={master} vuoto="Nessun preventivo a sotto-master." />}
      </div>

      {open && (
        <div onClick={() => !creando && setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '460px', padding: '22px' }}>
            <div style={{ fontSize: '17px', fontWeight: 800, color: '#1a1a1a', marginBottom: '14px' }}>Nuovo preventivo</div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#1a1a1a', display: 'block', marginBottom: '4px' }}>A chi</label>
            <select value={destTipo} onChange={e => setDestTipo(e.target.value as any)} style={{ ...inp, marginBottom: '12px' }}>
              <option value="cliente_nuovo">Cliente nuovo (non ancora registrato)</option>
              <option value="cliente">Cliente esistente</option>
              <option value="master">Sotto-master</option>
            </select>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#1a1a1a', display: 'block', marginBottom: '4px' }}>Nome destinatario</label>
            <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Es. Rossi Srl" autoFocus style={{ ...inp, marginBottom: '12px' }} />
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#1a1a1a', display: 'block', marginBottom: '4px' }}>Email (per l'invio)</label>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@azienda.it" type="email" style={{ ...inp, marginBottom: '12px' }} />
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#1a1a1a', display: 'block', marginBottom: '4px' }}>Oggetto</label>
            <input value={oggetto} onChange={e => setOggetto(e.target.value)} style={{ ...inp, marginBottom: '18px' }} />
            {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '6px', padding: '8px 12px', fontSize: '12.5px', marginBottom: '12px' }}>{err}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setOpen(false)} disabled={creando} style={{ background: '#fff', color: '#1a1a1a', border: '1px solid #ddd', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Annulla</button>
              <button onClick={crea} disabled={creando} style={{ background: '#f97316', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 20px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: creando ? 0.6 : 1 }}>{creando ? 'Creo…' : 'Crea bozza'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
