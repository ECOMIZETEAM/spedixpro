'use client'
import { useState, useEffect } from 'react'
import { useDialog } from '@/app/components/DialogProvider'
import { inp, card, cardH, th, td, lbl, btn, Testata, Avviso, Vuoto, variante } from '../comune'

// CARICO MERCE: arriva roba, si registra a nome del cliente.
//
// La quantita' finisce nello STESSO registro del portale cliente (articoli_movimenti), non in una
// tabella parallela: il cliente vede il carico nel suo magazzino e il saldo e' uno solo.

export default function CaricoPage() {
  const dialog = useDialog()
  const [clienti, setClienti] = useState<any[]>([])
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const [cliente, setCliente] = useState('')
  const [catalogo, setCatalogo] = useState<any[]>([])
  const [blocchi, setBlocchi] = useState<any[]>([])
  const [art, setArt] = useState(''); const [qta, setQta] = useState('')
  const [blocco, setBlocco] = useState(''); const [nota, setNota] = useState('')
  const [salvo, setSalvo] = useState(false)

  useEffect(() => { fetch('/api/clienti/lista').then(r => r.json()).then(d => setClienti(Array.isArray(d) ? d : [])).catch(() => {}) }, [])
  function ricaricaCatalogo(id = cliente) {
    if (!id) { setCatalogo([]); return }
    fetch(`/api/catalogo?cliente_id=${id}`).then(r => r.json()).then(d => setCatalogo(Array.isArray(d?.articoli) ? d.articoli : [])).catch(() => setCatalogo([]))
  }
  useEffect(() => {
    setArt(''); setBlocco(''); ricaricaCatalogo()
    if (!cliente) { setBlocchi([]); return }
    fetch(`/api/logistica/blocchi?cliente_id=${cliente}&solo_occupati=1`).then(r => r.json()).then(d => setBlocchi(Array.isArray(d) ? d : [])).catch(() => {})
  }, [cliente])

  async function carica() {
    const n = parseInt(qta, 10)
    if (!art || !isFinite(n) || n === 0) { await dialog.alert({ title: 'Dati mancanti', message: 'Scegli l\'articolo e quanti pezzi sono arrivati.' }); return }
    setSalvo(true)
    const r = await fetch('/api/logistica/carico', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ articolo_id: art, quantita: n, blocco_id: blocco || null, nota }) })
    const d = await r.json().catch(() => ({})); setSalvo(false)
    if (!r.ok || d.error) { setMsg({ t: 'err', x: d.error || 'Errore' }); return }
    setQta(''); setNota(''); setMsg({ t: 'ok', x: `Caricato. Adesso ne risultano ${d.quantita}` })
    ricaricaCatalogo()
  }

  return (
    <div>
      <Testata titolo="Carico merce" sottotitolo="Arriva merce di un cliente: la registri qui, a mano. Non serve una bolla." />
      <Avviso msg={msg} />

      <div style={card}>
        <div style={cardH}>Registra un arrivo</div>
        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1.3fr 1.7fr 90px 1.2fr auto', gap: '10px', alignItems: 'end' }}>
          <div><label style={lbl}>Cliente</label>
            <select value={cliente} onChange={e => setCliente(e.target.value)} style={inp}>
              <option value="">— scegli —</option>
              {clienti.map(c => <option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select></div>
          <div><label style={lbl}>Articolo</label>
            <select value={art} onChange={e => setArt(e.target.value)} disabled={!cliente} style={inp}>
              <option value="">{cliente ? (catalogo.length ? '— scegli —' : 'nessun articolo a catalogo') : 'scegli prima il cliente'}</option>
              {catalogo.map(a => <option key={a.id} value={a.id}>{(a.prodotto || a.nome || a.sku)}{variante(a) ? ' · ' + variante(a) : ''} — {a.sku} (ne ha {a.quantita ?? 0})</option>)}
            </select></div>
          <div><label style={lbl}>Pezzi</label><input type="number" step="1" value={qta} onChange={e => setQta(e.target.value)} style={inp} /></div>
          <div><label style={lbl}>Dove l&apos;hai messa</label>
            <select value={blocco} onChange={e => setBlocco(e.target.value)} disabled={!cliente} style={inp}>
              <option value="">— non indicato —</option>
              {blocchi.map(b => <option key={b.id} value={b.id}>{b.ubicazione || 'senza ubicazione'}</option>)}
            </select></div>
          <button onClick={carica} disabled={salvo} style={{ ...btn, opacity: salvo ? 0.6 : 1 }}>{salvo ? 'Carico…' : 'Carica'}</button>
        </div>
        <div style={{ padding: '0 16px 16px' }}>
          <input value={nota} onChange={e => setNota(e.target.value)} placeholder="Nota (facoltativa): es. bolla 1234, arrivo del 5 agosto" style={inp} />
        </div>
      </div>

      {cliente && (
        <div style={card}>
          <div style={cardH}>Magazzino di questo cliente</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Prodotto</th><th style={th}>Variante</th><th style={th}>SKU</th><th style={th}>Giacenza</th><th style={th}>Posto</th></tr></thead>
            <tbody>
              {catalogo.map(a => (
                <tr key={a.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{a.prodotto || a.nome || '—'}</td>
                  <td style={{ ...td, color: '#6b7280' }}>{variante(a) || '—'}</td>
                  <td style={{ ...td, color: '#f97316' }}>{a.sku}</td>
                  <td style={{ ...td, fontWeight: 700, color: Number(a.quantita) < 0 ? '#b91c1c' : Number(a.quantita) > 0 ? '#15803d' : '#9ca3af' }}>{Number(a.quantita ?? 0)}</td>
                  <td style={td}>{blocchi.find(b => b.id === a.blocco_id)?.ubicazione || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                </tr>
              ))}
              {!catalogo.length && <tr><td colSpan={5}><Vuoto testo="Questo cliente non ha ancora articoli a catalogo." /></td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
