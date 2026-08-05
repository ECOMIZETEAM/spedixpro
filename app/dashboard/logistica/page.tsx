'use client'
import { useState, useEffect } from 'react'
import { useDialog } from '@/app/components/DialogProvider'

// LOGISTICA CONTO TERZI: la merce del cliente sta da noi e la gestiamo noi.
//
// Tre cose, in ordine di come si usano davvero:
//  1. i TIPI DI POSTO col prezzo al mese — si impostano una volta e non si toccano piu';
//  2. i POSTI OCCUPATI — chi tiene cosa, e dove sta fisicamente;
//  3. il CARICO — arriva merce, si registra a nome del cliente.
//
// La giacenza si paga a BLOCCHI: un posto occupato si paga intero anche se dentro c'e' poca roba,
// come nei magazzini veri. Il peso conta sull'uscita, non qui.

const inp: any = { width: '100%', padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box' }
const card: any = { background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', overflow: 'hidden', marginBottom: '18px' }
const cardH: any = { padding: '13px 16px', borderBottom: '1px solid #f0f0f0', fontSize: '13.5px', fontWeight: 700, color: '#1a1a1a' }
const th: any = { textAlign: 'left', padding: '9px 14px', fontSize: '11.5px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.03em', borderBottom: '1px solid #eee' }
const td: any = { padding: '10px 14px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f5f5f5' }
const lbl: any = { fontSize: '11.5px', fontWeight: 600, color: '#1a1a1a', display: 'block', marginBottom: '4px' }
const btn: any = { background: '#f97316', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }
const eur = (n: any) => `€ ${Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function LogisticaPage() {
  const dialog = useDialog()
  const [tipi, setTipi] = useState<any[]>([])
  const [blocchi, setBlocchi] = useState<any[]>([])
  const [clienti, setClienti] = useState<any[]>([])
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  // ANTEPRIMA DELL'ADDEBITO: si guarda cosa verrebbe fatturato PRIMA che parta qualcosa.
  // E' una lettura, non muove un centesimo.
  const [anteprima, setAnteprima] = useState<any>(null)

  // tipo di posto
  const [tNome, setTNome] = useState(''); const [tPrezzo, setTPrezzo] = useState('')
  // posto occupato
  const [bCliente, setBCliente] = useState(''); const [bTipo, setBTipo] = useState('')
  const [bUbic, setBUbic] = useState('')
  // carico merce
  const [cCliente, setCCliente] = useState(''); const [cCatalogo, setCCatalogo] = useState<any[]>([])
  const [cArt, setCArt] = useState(''); const [cQta, setCQta] = useState(''); const [cBlocco, setCBlocco] = useState('')
  const [cNota, setCNota] = useState('')

  useEffect(() => { ricarica(); fetch('/api/clienti/lista').then(r => r.json()).then(d => setClienti(Array.isArray(d) ? d : [])).catch(() => {}) }, [])
  function ricarica() {
    fetch('/api/logistica/tipi').then(r => r.json()).then(d => setTipi(Array.isArray(d) ? d : [])).catch(() => {})
    fetch('/api/logistica/blocchi').then(r => r.json()).then(d => setBlocchi(Array.isArray(d) ? d : [])).catch(() => {})
  }
  // Il catalogo si carica quando si sceglie il cliente: e' il suo magazzino.
  useEffect(() => {
    setCArt('')
    if (!cCliente) { setCCatalogo([]); return }
    fetch(`/api/catalogo?cliente_id=${cCliente}`).then(r => r.json())
      .then(d => setCCatalogo(Array.isArray(d?.articoli) ? d.articoli : [])).catch(() => setCCatalogo([]))
  }, [cCliente])

  async function salvaTipo() {
    if (!tNome.trim()) { await dialog.alert({ title: 'Nome mancante', message: 'Come si chiama questo posto? Es. Bancale.' }); return }
    const r = await fetch('/api/logistica/tipi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: tNome, prezzo_mese: tPrezzo }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || d.error) { setMsg({ t: 'err', x: d.error || 'Errore' }); return }
    setTNome(''); setTPrezzo(''); setMsg({ t: 'ok', x: 'Posto aggiunto' }); ricarica()
  }
  async function occupaPosto() {
    if (!bCliente) { await dialog.alert({ title: 'Cliente mancante', message: 'Scegli di chi e la merce.' }); return }
    const r = await fetch('/api/logistica/blocchi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cliente_id: bCliente, tipo_id: bTipo || null, ubicazione: bUbic }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || d.error) { setMsg({ t: 'err', x: d.error || 'Errore' }); return }
    setBUbic(''); setMsg({ t: 'ok', x: 'Posto occupato' }); ricarica()
  }
  async function liberaPosto(b: any) {
    const ok = await dialog.confirm({
      title: 'Liberare il posto?',
      message: `${b.ubicazione || 'senza ubicazione'} — da oggi non verra piu fatturato. La riga resta nello storico.`,
      confirmText: 'Libera',
    })
    if (!ok) return
    await fetch('/api/logistica/blocchi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libera: true, id: b.id }) })
    ricarica()
  }
  async function caricaMerce() {
    const n = parseInt(cQta, 10)
    if (!cArt || !isFinite(n) || n === 0) { await dialog.alert({ title: 'Dati mancanti', message: 'Scegli l\'articolo e quanti pezzi sono arrivati.' }); return }
    const r = await fetch('/api/logistica/carico', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ articolo_id: cArt, quantita: n, blocco_id: cBlocco || null, nota: cNota }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || d.error) { setMsg({ t: 'err', x: d.error || 'Errore' }); return }
    setCQta(''); setCNota(''); setMsg({ t: 'ok', x: `Caricato. Adesso ne risultano ${d.quantita}` })
    fetch(`/api/catalogo?cliente_id=${cCliente}`).then(r => r.json()).then(d2 => setCCatalogo(Array.isArray(d2?.articoli) ? d2.articoli : [])).catch(() => {})
  }

  async function guardaAnteprima() {
    setAnteprima(null)
    const r = await fetch('/api/logistica/addebito-mensile?anteprima=1')
    const d = await r.json().catch(() => ({}))
    if (!r.ok || d.error) { setMsg({ t: 'err', x: d.error || 'Errore' }); return }
    setAnteprima(d)
  }

  const occupati = blocchi.filter(b => !b.liberato_il)
  const mensile = occupati.reduce((s, b) => s + Number(b.logistica_tipi_blocco?.prezzo_mese || 0), 0)
  const blocchiDelCliente = blocchi.filter(b => !b.liberato_il && b.cliente_id === cCliente)

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#1a1a1a', margin: '0 0 6px' }}>Logistica</h1>
      <p style={{ color: '#666', fontSize: '13px', margin: '0 0 20px' }}>
        La merce dei tuoi clienti tenuta da te. La giacenza si paga <b>a posto occupato, al mese</b>: un
        posto mezzo vuoto si paga intero, come in ogni magazzino.
      </p>

      {msg && <div style={{ background: msg.t === 'ok' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msg.t === 'ok' ? '#bbf7d0' : '#fecaca'}`, color: msg.t === 'ok' ? '#15803d' : '#b91c1c', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '14px' }}>{msg.x}</div>}

      {/* ── CARICO MERCE: e' il gesto piu' frequente, quindi sta in cima ── */}
      <div style={card}>
        <div style={cardH}>Carico merce</div>
        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1.4fr 1.6fr 90px 1.2fr auto', gap: '10px', alignItems: 'end' }}>
          <div><label style={lbl}>Cliente</label>
            <select value={cCliente} onChange={e => setCCliente(e.target.value)} style={inp}>
              <option value="">— scegli —</option>
              {clienti.map(c => <option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select></div>
          <div><label style={lbl}>Articolo</label>
            <select value={cArt} onChange={e => setCArt(e.target.value)} disabled={!cCliente} style={inp}>
              <option value="">{cCliente ? (cCatalogo.length ? '— scegli —' : 'nessun articolo a catalogo') : 'scegli prima il cliente'}</option>
              {cCatalogo.map(a => (
                <option key={a.id} value={a.id}>
                  {(a.prodotto || a.nome || a.sku)}{a.attributi && Object.keys(a.attributi).length ? ' · ' + Object.values(a.attributi).join(' · ') : ''} — {a.sku} (ne ha {a.quantita ?? 0})
                </option>
              ))}
            </select></div>
          <div><label style={lbl}>Pezzi</label><input type="number" step="1" value={cQta} onChange={e => setCQta(e.target.value)} style={inp} /></div>
          <div><label style={lbl}>Dove l&apos;hai messa</label>
            <select value={cBlocco} onChange={e => setCBlocco(e.target.value)} disabled={!cCliente} style={inp}>
              <option value="">— non indicato —</option>
              {blocchiDelCliente.map(b => <option key={b.id} value={b.id}>{b.ubicazione || 'senza ubicazione'}</option>)}
            </select></div>
          <button onClick={caricaMerce} style={btn}>Carica</button>
        </div>
        <div style={{ padding: '0 16px 14px' }}>
          <input value={cNota} onChange={e => setCNota(e.target.value)} placeholder="Nota (facoltativa): es. bolla 1234, arrivo del 5 agosto" style={inp} />
          <div style={{ fontSize: '11.5px', color: '#9ca3af', marginTop: '6px' }}>
            La quantità finisce nel magazzino del cliente, che la vede dal suo portale: il saldo è uno solo, non ce ne sono due.
          </div>
        </div>
      </div>

      {/* ── POSTI OCCUPATI ── */}
      <div style={card}>
        <div style={{ ...cardH, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Posti occupati</span>
          <span style={{ fontWeight: 400, fontSize: '12.5px', color: '#6b7280' }}>
            {occupati.length} posti · <b style={{ color: '#15803d' }}>{eur(mensile)}</b> al mese
          </span>
        </div>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={guardaAnteprima} style={{ background: '#fff', color: '#f97316', border: '1px solid #fdba74', padding: '7px 14px', borderRadius: '6px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}>
            Anteprima addebito del mese
          </button>
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>Mostra chi pagherebbe quanto. Non addebita niente.</span>
          {anteprima && (
            <div style={{ width: '100%', marginTop: '4px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '12px 14px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#92400e', marginBottom: '6px' }}>
                {anteprima.mese}: {anteprima.posti_da_fatturare} posti · {eur(anteprima.totale)}
                {anteprima.gia_fatturati > 0 && <span style={{ fontWeight: 400 }}> — {anteprima.gia_fatturati} gia fatturati questo mese, non si ripetono</span>}
              </div>
              {(anteprima.clienti || []).map((c: any, i: number) => (
                <div key={i} style={{ fontSize: '12.5px', color: '#78350f' }}>{c.cliente}: {c.posti} posti · <b>{eur(c.importo)}</b></div>
              ))}
              {!anteprima.clienti?.length && <div style={{ fontSize: '12.5px', color: '#78350f' }}>Niente da fatturare.</div>}
            </div>
          )}
        </div>
        <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: '1.4fr 1.2fr 1.4fr auto', gap: '10px', alignItems: 'end', background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
          <div><label style={lbl}>Cliente</label>
            <select value={bCliente} onChange={e => setBCliente(e.target.value)} style={inp}>
              <option value="">— scegli —</option>
              {clienti.map(c => <option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select></div>
          <div><label style={lbl}>Tipo di posto</label>
            <select value={bTipo} onChange={e => setBTipo(e.target.value)} style={inp}>
              <option value="">— nessuno —</option>
              {tipi.map(t => <option key={t.id} value={t.id}>{t.nome} · {eur(t.prezzo_mese)}/mese</option>)}
            </select></div>
          <div><label style={lbl}>Ubicazione</label><input value={bUbic} onChange={e => setBUbic(e.target.value)} placeholder="es. Reparto A - 52" style={inp} /></div>
          <button onClick={occupaPosto} style={btn}>Occupa</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Cliente</th><th style={th}>Posto</th><th style={th}>Ubicazione</th><th style={th}>Dal</th><th style={th}>Al mese</th><th style={th}></th></tr></thead>
            <tbody>
              {blocchi.map(b => (
                <tr key={b.id} style={b.liberato_il ? { opacity: 0.5 } : undefined}>
                  <td style={td}>{b.clienti?.ragione_sociale || '—'}</td>
                  <td style={td}>{b.logistica_tipi_blocco?.nome || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{b.ubicazione || <span style={{ color: '#cbd5e1', fontWeight: 400 }}>—</span>}</td>
                  <td style={td}>{b.occupato_dal}{b.liberato_il ? ` → ${b.liberato_il}` : ''}</td>
                  <td style={td}>{b.liberato_il ? <span style={{ color: '#9ca3af' }}>liberato</span> : eur(b.logistica_tipi_blocco?.prezzo_mese)}</td>
                  <td style={td}>{!b.liberato_il && <button onClick={() => liberaPosto(b)} style={{ background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb', padding: '5px 11px', borderRadius: '6px', fontSize: '12.5px', cursor: 'pointer' }}>Libera</button>}</td>
                </tr>
              ))}
              {!blocchi.length && <tr><td colSpan={6} style={{ padding: '26px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>Nessun posto ancora. Definisci i tipi qui sotto, poi assegnane uno a un cliente.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── TIPI DI POSTO: si impostano una volta ── */}
      <div style={card}>
        <div style={cardH}>Tipi di posto e prezzo</div>
        <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: '1.6fr 1fr auto', gap: '10px', alignItems: 'end', background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
          <div><label style={lbl}>Nome</label><input value={tNome} onChange={e => setTNome(e.target.value)} placeholder="es. Bancale" style={inp} /></div>
          <div><label style={lbl}>Prezzo al mese (€)</label><input type="number" step="0.01" value={tPrezzo} onChange={e => setTPrezzo(e.target.value)} placeholder="15.00" style={inp} /></div>
          <button onClick={salvaTipo} style={btn}>Aggiungi</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Posto</th><th style={th}>Al mese</th><th style={th}>Occupati ora</th></tr></thead>
          <tbody>
            {tipi.map(t => (
              <tr key={t.id}>
                <td style={{ ...td, fontWeight: 600 }}>{t.nome}</td>
                <td style={td}>{eur(t.prezzo_mese)}</td>
                <td style={td}>{occupati.filter(b => b.tipo_id === t.id).length}</td>
              </tr>
            ))}
            {!tipi.length && <tr><td colSpan={3} style={{ padding: '22px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>Nessun tipo di posto. Comincia da qui: bancale, mezzo bancale, ripiano…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
