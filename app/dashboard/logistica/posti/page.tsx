'use client'
import { useState, useEffect } from 'react'
import SelectCercabile from '@/app/components/SelectCercabile'
import { useDialog } from '@/app/components/DialogProvider'
import { inp, card, cardH, th, td, lbl, btn, eur, Testata, Avviso, Vuoto } from '../comune'

// I POSTI OCCUPATI: chi tiene cosa, e dove sta fisicamente.
//
// Un posto liberato NON si cancella: resta come storico e come prova di cosa e' stato addebitato.
// E' la stessa regola di spedizioni, ritiri e distinte.

export default function PostiPage() {
  const dialog = useDialog()
  const [blocchi, setBlocchi] = useState<any[]>([])
  const [tipi, setTipi] = useState<any[]>([])
  const [clienti, setClienti] = useState<any[]>([])
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const [cliente, setCliente] = useState(''); const [tipo, setTipo] = useState(''); const [ubic, setUbic] = useState('')
  const [mostraLiberati, setMostraLiberati] = useState(false)

  useEffect(() => {
    ricarica()
    fetch('/api/clienti/lista').then(r => r.json()).then(d => setClienti(Array.isArray(d) ? d : [])).catch(() => {})
    fetch('/api/logistica/tipi').then(r => r.json()).then(d => setTipi(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])
  function ricarica() { fetch('/api/logistica/blocchi').then(r => r.json()).then(d => setBlocchi(Array.isArray(d) ? d : [])).catch(() => {}) }

  async function occupa() {
    if (!cliente) { await dialog.alert({ title: 'Cliente mancante', message: 'Scegli di chi è la merce.' }); return }
    const r = await fetch('/api/logistica/blocchi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cliente_id: cliente, tipo_id: tipo || null, ubicazione: ubic }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || d.error) { setMsg({ t: 'err', x: d.error || 'Errore' }); return }
    setUbic(''); setMsg({ t: 'ok', x: 'Posto occupato' }); ricarica()
  }
  async function libera(b: any) {
    const ok = await dialog.confirm({ title: 'Liberare il posto?', message: `${b.ubicazione || 'senza ubicazione'} — da oggi non verrà più fatturato. La riga resta nello storico.`, confirmText: 'Libera' })
    if (!ok) return
    await fetch('/api/logistica/blocchi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libera: true, id: b.id }) })
    ricarica()
  }

  const occupati = blocchi.filter(b => !b.liberato_il)
  const mensile = occupati.reduce((s, b) => s + Number(b.logistica_tipi_blocco?.prezzo_mese || 0), 0)
  const visibili = mostraLiberati ? blocchi : occupati

  return (
    <div>
      <Testata titolo="Magazzino" sottotitolo="I posti occupati dai tuoi clienti e dove stanno fisicamente. La giacenza si paga a posto, al mese." />
      <Avviso msg={msg} />

      <div style={{ display: 'flex', gap: '14px', marginBottom: '18px', flexWrap: 'wrap' }}>
        <div style={{ ...card, flex: 1, minWidth: '190px', marginBottom: 0, padding: '16px' }}>
          <div style={{ fontSize: '11.5px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.03em', fontWeight: 700 }}>Posti occupati</div>
          <div style={{ fontSize: '26px', fontWeight: 700, color: '#1a1a1a', marginTop: '4px' }}>{occupati.length}</div>
        </div>
        <div style={{ ...card, flex: 1, minWidth: '190px', marginBottom: 0, padding: '16px' }}>
          <div style={{ fontSize: '11.5px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.03em', fontWeight: 700 }}>Ricavo mensile</div>
          <div style={{ fontSize: '26px', fontWeight: 700, color: '#15803d', marginTop: '4px' }}>{eur(mensile)}</div>
        </div>
        <div style={{ ...card, flex: 1, minWidth: '190px', marginBottom: 0, padding: '16px' }}>
          <div style={{ fontSize: '11.5px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.03em', fontWeight: 700 }}>Clienti serviti</div>
          <div style={{ fontSize: '26px', fontWeight: 700, color: '#1a1a1a', marginTop: '4px' }}>{new Set(occupati.map(b => b.cliente_id)).size}</div>
        </div>
      </div>

      <div style={card}>
        <div style={cardH}>Occupa un posto</div>
        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1.4fr 1.3fr 1.4fr auto', gap: '10px', alignItems: 'end' }}>
          <div><label style={lbl}>Cliente</label>
            <SelectCercabile value={cliente} onChange={e => setCliente(e.target.value)} style={inp}>
              <option value="">— scegli —</option>
              {clienti.map(c => <option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </SelectCercabile></div>
          <div><label style={lbl}>Tipo di posto</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)} style={inp}>
              <option value="">— nessuno —</option>
              {tipi.map(t => <option key={t.id} value={t.id}>{t.nome} · {eur(t.prezzo_mese)}/mese</option>)}
            </select></div>
          <div><label style={lbl}>Ubicazione</label><input value={ubic} onChange={e => setUbic(e.target.value)} placeholder="es. Reparto A - 52" style={inp} /></div>
          <button onClick={occupa} style={btn}>Occupa</button>
        </div>
        {!tipi.length && <div style={{ padding: '0 16px 14px', fontSize: '12.5px', color: '#b45309' }}>Non hai ancora definito i tipi di posto: falli nel <b>Listino</b>, altrimenti il posto non ha un prezzo.</div>}
      </div>

      <div style={card}>
        <div style={{ ...cardH, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Posti</span>
          <label style={{ fontSize: '12.5px', color: '#6b7280', fontWeight: 400, cursor: 'pointer' }}>
            <input type="checkbox" checked={mostraLiberati} onChange={e => setMostraLiberati(e.target.checked)} style={{ marginRight: '6px' }} />
            mostra anche quelli liberati
          </label>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Cliente</th><th style={th}>Tipo</th><th style={th}>Ubicazione</th><th style={th}>Dal</th><th style={th}>Al mese</th><th style={th}></th></tr></thead>
            <tbody>
              {visibili.map(b => (
                <tr key={b.id} style={b.liberato_il ? { opacity: 0.55 } : undefined}>
                  <td style={td}>{b.clienti?.ragione_sociale || '—'}</td>
                  <td style={td}>{b.logistica_tipi_blocco?.nome || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{b.ubicazione || <span style={{ color: '#cbd5e1', fontWeight: 400 }}>—</span>}</td>
                  <td style={td}>{b.occupato_dal}{b.liberato_il ? ` → ${b.liberato_il}` : ''}</td>
                  <td style={td}>{b.liberato_il ? <span style={{ color: '#9ca3af' }}>liberato</span> : eur(b.logistica_tipi_blocco?.prezzo_mese)}</td>
                  <td style={td}>{!b.liberato_il && <button onClick={() => libera(b)} style={{ background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb', padding: '5px 11px', borderRadius: '6px', fontSize: '12.5px', cursor: 'pointer' }}>Libera</button>}</td>
                </tr>
              ))}
              {!visibili.length && <tr><td colSpan={6}><Vuoto testo="Nessun posto occupato. Definisci i tipi nel Listino, poi assegnane uno a un cliente." /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
