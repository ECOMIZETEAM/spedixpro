'use client'
import { useState, useEffect } from 'react'
import { useDialog } from '@/app/components/DialogProvider'
import { inp, card, cardH, th, td, lbl, btn, eur, Testata, Avviso, Vuoto } from '../comune'

// IL LISTINO DELLA LOGISTICA, che ha DUE sezioni diverse e non una:
//  - la GIACENZA si paga a posto occupato, al mese: il prezzo dipende dal TIPO di posto;
//  - l'USCITA si paga a fasce di peso, perche' li' un pacco vero da pesare c'e'.
//
// Compilare le fasce a un cliente e' il gesto che ACCENDE il servizio uscite per lui. Senza fasce
// non paga niente e il giro degli addebiti non lo guarda nemmeno.

export default function ListinoLogisticaPage() {
  const dialog = useDialog()
  const [tipi, setTipi] = useState<any[]>([])
  const [clienti, setClienti] = useState<any[]>([])
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const [nome, setNome] = useState(''); const [prezzo, setPrezzo] = useState('')
  const [cliente, setCliente] = useState('')
  const [fasce, setFasce] = useState<{ peso_max: string; prezzo: string }[]>([])
  const [salvo, setSalvo] = useState(false)

  useEffect(() => {
    ricaricaTipi()
    fetch('/api/clienti/lista').then(r => r.json()).then(d => setClienti(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])
  function ricaricaTipi() { fetch('/api/logistica/tipi').then(r => r.json()).then(d => setTipi(Array.isArray(d) ? d : [])).catch(() => {}) }
  useEffect(() => {
    setFasce([])
    if (!cliente) return
    fetch(`/api/logistica/fasce?cliente_id=${cliente}`).then(r => r.json())
      .then(d => setFasce(Array.isArray(d) ? d.map((x: any) => ({ peso_max: String(x.peso_max), prezzo: String(x.prezzo) })) : [])).catch(() => {})
  }, [cliente])

  async function salvaTipo() {
    if (!nome.trim()) { await dialog.alert({ title: 'Nome mancante', message: 'Come si chiama questo posto? Es. Bancale.' }); return }
    const r = await fetch('/api/logistica/tipi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, prezzo_mese: prezzo }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || d.error) { setMsg({ t: 'err', x: d.error || 'Errore' }); return }
    setNome(''); setPrezzo(''); setMsg({ t: 'ok', x: 'Tipo di posto aggiunto' }); ricaricaTipi()
  }
  async function salvaFasce() {
    if (!cliente) { await dialog.alert({ title: 'Cliente mancante', message: 'Scegli il cliente.' }); return }
    setSalvo(true)
    const r = await fetch('/api/logistica/fasce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cliente_id: cliente, fasce }) })
    const d = await r.json().catch(() => ({})); setSalvo(false)
    if (!r.ok || d.error) { setMsg({ t: 'err', x: d.error || 'Errore' }); return }
    setMsg({ t: 'ok', x: d.attivo ? `Listino salvato: ${d.fasce} fasce. Il servizio uscite è ATTIVO per questo cliente.` : 'Listino svuotato: per questo cliente le uscite non si addebitano.' })
  }

  return (
    <div>
      <Testata titolo="Listino logistica" sottotitolo="Due cose diverse: la giacenza si paga a posto occupato al mese, l'uscita a fasce di peso." />
      <Avviso msg={msg} />

      <div style={card}>
        <div style={cardH}>Giacenza — tipi di posto e prezzo al mese</div>
        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1.6fr 1fr auto', gap: '10px', alignItems: 'end' }}>
          <div><label style={lbl}>Nome</label><input value={nome} onChange={e => setNome(e.target.value)} placeholder="es. Bancale" style={inp} /></div>
          <div><label style={lbl}>Prezzo al mese (€)</label><input type="number" step="0.01" value={prezzo} onChange={e => setPrezzo(e.target.value)} placeholder="15.00" style={inp} /></div>
          <button onClick={salvaTipo} style={btn}>Aggiungi</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Posto</th><th style={th}>Al mese</th></tr></thead>
          <tbody>
            {tipi.map(t => <tr key={t.id}><td style={{ ...td, fontWeight: 600 }}>{t.nome}</td><td style={td}>{eur(t.prezzo_mese)}</td></tr>)}
            {!tipi.length && <tr><td colSpan={2}><Vuoto testo="Nessun tipo di posto. Comincia da qui: bancale, mezzo bancale, ripiano…" /></td></tr>}
          </tbody>
        </table>
        <div style={{ padding: '12px 16px', fontSize: '12px', color: '#9ca3af', borderTop: '1px solid #f5f5f5' }}>
          Un posto mezzo vuoto si paga intero, come in ogni magazzino.
        </div>
      </div>

      <div style={card}>
        <div style={cardH}>Uscita — fasce di peso, cliente per cliente</div>
        <div style={{ padding: '16px' }}>
          <div style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '12px' }}>
            <b>Compilare le fasce accende il servizio per quel cliente</b>: senza fasce non paga niente. Svuotarle lo spegne.
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'end', marginBottom: '14px' }}>
            <div style={{ flex: 1 }}><label style={lbl}>Cliente</label>
              <select value={cliente} onChange={e => setCliente(e.target.value)} style={inp}>
                <option value="">— scegli —</option>
                {clienti.map(c => <option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
              </select></div>
            <button onClick={() => setFasce(f => [...f, { peso_max: '', prezzo: '' }])} disabled={!cliente} style={{ background: '#fff', color: '#f97316', border: '1px dashed #fdba74', borderRadius: '6px', padding: '8px 14px', fontSize: '12.5px', fontWeight: 600, cursor: cliente ? 'pointer' : 'not-allowed', opacity: cliente ? 1 : 0.5 }}>+ fascia</button>
            <button onClick={salvaFasce} disabled={!cliente || salvo} style={{ ...btn, opacity: (!cliente || salvo) ? 0.5 : 1 }}>{salvo ? 'Salvo…' : 'Salva listino'}</button>
          </div>
          {cliente && fasce.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '12.5px', color: '#6b7280', width: '52px' }}>fino a</span>
              <input type="number" step="0.001" value={f.peso_max} onChange={e => setFasce(x => x.map((y, j) => j === i ? { ...y, peso_max: e.target.value } : y))} placeholder="kg" style={{ ...inp, width: '110px' }} />
              <span style={{ fontSize: '12.5px', color: '#6b7280' }}>kg costa</span>
              <input type="number" step="0.01" value={f.prezzo} onChange={e => setFasce(x => x.map((y, j) => j === i ? { ...y, prezzo: e.target.value } : y))} placeholder="€" style={{ ...inp, width: '110px' }} />
              <button onClick={() => setFasce(x => x.filter((_, j) => j !== i))} style={{ background: '#fff', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '6px', cursor: 'pointer', padding: '6px 11px', fontSize: '13px' }}>×</button>
            </div>
          ))}
          {cliente && !fasce.length && <div style={{ fontSize: '12.5px', color: '#9ca3af' }}>Nessuna fascia: per questo cliente le uscite non si addebitano.</div>}
          {!cliente && <Vuoto testo="Scegli un cliente per vedere e compilare il suo listino." />}
        </div>
      </div>
    </div>
  )
}
