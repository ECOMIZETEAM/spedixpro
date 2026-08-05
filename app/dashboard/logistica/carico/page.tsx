'use client'
import { useState, useEffect } from 'react'
import SelectCercabile from '@/app/components/SelectCercabile'
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
  // NUOVO ARTICOLO al volo: arriva merce che a catalogo non c'e' ancora, e chi sta al banco non
  // puo' fermarsi ad aprire un'altra pagina. Si crea qui e resta subito selezionato.
  const [nuovo, setNuovo] = useState(false)
  const [nSku, setNSku] = useState(''); const [nProdotto, setNProdotto] = useState('')
  const [nVariante, setNVariante] = useState(''); const [nPeso, setNPeso] = useState('')
  const [creo, setCreo] = useState(false)

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

  async function creaArticolo() {
    if (!cliente) { await dialog.alert({ title: 'Cliente mancante', message: 'Scegli prima di chi è la merce.' }); return }
    if (!nSku.trim()) { await dialog.alert({ title: 'SKU mancante', message: 'Lo SKU serve: è il codice con cui l\u2019articolo viene riconosciuto negli ordini.' }); return }
    setCreo(true)
    // La variante si scrive libera ("rosso, S") e diventa attributi: chi sta al banco non deve
    // ragionare per coppie chiave/valore.
    const parti = nVariante.split(',').map(x => x.trim()).filter(Boolean)
    const attributi: Record<string, string> = {}
    parti.forEach((v, i) => { attributi[`variante${parti.length > 1 ? ' ' + (i + 1) : ''}`] = v })
    const r = await fetch('/api/catalogo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_id: cliente, sku: nSku.trim(), nome: nProdotto.trim() || nSku.trim(),
        prodotto: nProdotto.trim() || null, attributi: parti.length ? attributi : null, peso: nPeso || null }),
    })
    const d = await r.json().catch(() => ({})); setCreo(false)
    if (!r.ok || d.error) { setMsg({ t: 'err', x: d.error || 'Errore' }); return }
    setMsg({ t: 'ok', x: `Articolo ${nSku.trim()} creato` })
    setNuovo(false); setNSku(''); setNProdotto(''); setNVariante(''); setNPeso('')
    // Si ricarica e si seleziona quello appena creato, cosi' si puo' caricare subito.
    const d2 = await fetch(`/api/catalogo?cliente_id=${cliente}`).then(x => x.json()).catch(() => null)
    const lista = Array.isArray(d2?.articoli) ? d2.articoli : []
    setCatalogo(lista)
    const creato = lista.find((a: any) => String(a.sku).toUpperCase() === nSku.trim().toUpperCase())
    if (creato) setArt(creato.id)
  }

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
            <SelectCercabile value={cliente} onChange={e => setCliente(e.target.value)} style={inp}>
              <option value="">— scegli —</option>
              {clienti.map(c => <option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </SelectCercabile></div>
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
          {cliente && !nuovo && (
            <button onClick={() => setNuovo(true)} style={{ marginTop: '10px', background: '#fff', color: '#f97316', border: '1px dashed #fdba74', borderRadius: '6px', padding: '8px 14px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}>
              + L&apos;articolo non c&apos;è a catalogo
            </button>
          )}
          {cliente && nuovo && (
            <div style={{ marginTop: '12px', border: '1px solid #fed7aa', background: '#fff7ed', borderRadius: '8px', padding: '14px' }}>
              <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#9a3412', marginBottom: '10px' }}>Nuovo articolo per questo cliente</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1.2fr 100px auto auto', gap: '8px', alignItems: 'end' }}>
                <div><label style={lbl}>SKU</label><input value={nSku} onChange={e => setNSku(e.target.value)} placeholder="obbligatorio" style={inp} /></div>
                <div><label style={lbl}>Prodotto</label><input value={nProdotto} onChange={e => setNProdotto(e.target.value)} placeholder="es. T-shirt logo" style={inp} /></div>
                <div><label style={lbl}>Variante</label><input value={nVariante} onChange={e => setNVariante(e.target.value)} placeholder="rosso, S" style={inp} /></div>
                <div><label style={lbl}>Peso (kg)</label><input type="number" step="0.001" value={nPeso} onChange={e => setNPeso(e.target.value)} style={inp} /></div>
                <button onClick={creaArticolo} disabled={creo} style={{ ...btn, opacity: creo ? 0.6 : 1 }}>{creo ? 'Creo…' : 'Crea'}</button>
                <button onClick={() => setNuovo(false)} style={{ background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '9px 14px', fontSize: '12.5px', cursor: 'pointer' }}>Annulla</button>
              </div>
              <div style={{ fontSize: '11.5px', color: '#9a3412', marginTop: '8px' }}>
                Più varianti si separano con la virgola: <b>rosso, S</b>. Appena creato resta selezionato, così puoi caricarlo subito.
              </div>
            </div>
          )}
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
