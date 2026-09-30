'use client'
import { useState, useEffect } from 'react'
import { useDialog } from '@/app/components/DialogProvider'

// CHECK SOTTO COSTO — le righe dei tuoi listini cliente che vendi sotto quello che paghi tu.
// Non e' il "pavimento" (un minimo teorico): qui il confronto e' col TUO costo, riga per riga.
// Si sistema una riga alla volta col suo bottone, oppure tutte insieme con Adegua.

type Riga = {
  chiave: string; listino_id: string; listino_nome: string; clienti: string[]
  corriere: string; zona: string; tipo: 'fascia' | 'supplemento'; descrizione: string
  prezzo_cliente: number; costo_tuo: number; differenza: number
}

export default function CheckSottoCosto() {
  const dialog = useDialog()
  const [righe, setRighe] = useState<Riga[]>([])
  const [totale, setTotale] = useState(0)
  const [listiniCoinvolti, setListini] = useState(0)
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<string[]>([])
  const [margine, setMargine] = useState('0')
  const [salvando, setSalvando] = useState(false)
  const [q, setQ] = useState('')

  const carica = () => {
    setLoading(true); setSel([])
    fetch('/api/listini/check-sotto-costo').then(r => r.json()).then(j => {
      setRighe(Array.isArray(j?.righe) ? j.righe : []); setTotale(Number(j?.totale) || 0)
      setListini(Number(j?.listiniCoinvolti) || 0); setLoading(false)
    }).catch(() => setLoading(false))
  }
  useEffect(() => { carica() }, [])

  const eur = (n: number) => '€ ' + Number(n).toFixed(2).replace('.', ',')
  const mv = Math.max(0, parseFloat(margine.replace(',', '.')) || 0)
  const filtrate = q.trim()
    ? righe.filter(r => `${r.listino_nome} ${r.clienti.join(' ')} ${r.corriere} ${r.zona} ${r.descrizione}`.toLowerCase().includes(q.trim().toLowerCase()))
    : righe
  const persoTotale = filtrate.reduce((s, r) => s + r.differenza, 0)

  async function adegua(chiavi: string[]) {
    if (!chiavi.length) return
    const quante = chiavi.length
    const ok = await dialog.confirm({
      title: quante === 1 ? 'Adeguare questa riga?' : `Adeguare ${quante} righe?`,
      message: mv > 0
        ? `Il prezzo al cliente diventa il tuo costo + ${mv}%. Non tocca le righe che nel frattempo qualcuno ha già alzato.`
        : 'Il prezzo al cliente diventa esattamente il tuo costo: smetti di perderci, senza guadagnarci. Se vuoi un margine, scrivilo qui sopra prima di confermare.',
      confirmText: 'Adegua',
    })
    if (!ok) return
    setSalvando(true)
    const res = await fetch('/api/listini/check-sotto-costo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chiavi, marginePerc: mv }),
    }).then(r => r.json()).catch(() => null)
    setSalvando(false)
    if (!res || res.error) { await dialog.alert({ title: 'Errore', message: res?.error || 'Non sono riuscito ad adeguare.' }); return }
    await dialog.alert({
      title: 'Fatto',
      message: `${res.adeguate} righe adeguate.${res.saltate ? ` ${res.saltate} saltate: erano già a posto o non sono tue.` : ''}`,
    })
    carica()
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#8a8a8a', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid #f4f4f4' }

  return (
    <div style={{ padding: '18px 20px', maxWidth: 1250, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Check sotto costo</h1>
      <p style={{ color: '#666', fontSize: 13.5, margin: '0 0 16px', lineHeight: 1.5 }}>
        Le righe dei tuoi listini cliente dove <strong>vendi sotto quello che paghi tu</strong>: zona, fascia di peso,
        reso, assicurazione, contrassegno. Ogni spedizione su una di queste righe ti fa perdere la differenza.
        Con <strong>Adegua</strong> il prezzo sale almeno al tuo costo — se vuoi, con un margine sopra.
      </p>

      {loading ? <div style={{ color: '#888' }}>Sto controllando i tuoi listini…</div> : totale === 0 ? (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 16, color: '#166534', fontWeight: 600 }}>
          ✓ Nessuna riga sotto costo: quello che vendi copre sempre quello che paghi.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: '#991b1b', fontWeight: 700, textTransform: 'uppercase' }}>Righe sotto costo</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#b91c1c' }}>{totale.toLocaleString('it-IT')}</div>
            </div>
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: '#9a3412', fontWeight: 700, textTransform: 'uppercase' }}>Listini coinvolti</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#c2410c' }}>{listiniCoinvolti}</div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: '#475569', fontWeight: 700, textTransform: 'uppercase' }}>Perdita per spedizione (somma)</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#334155' }}>{eur(persoTotale)}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cerca cliente, listino, contratto, zona…"
              style={{ flex: '1 1 260px', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }} />
            <label style={{ fontSize: 13, color: '#444' }}>
              margine sopra il costo{' '}
              <input value={margine} onChange={e => setMargine(e.target.value)} style={{ width: 64, padding: '7px 8px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }} /> %
            </label>
            <button onClick={() => adegua(filtrate.map(r => r.chiave))} disabled={salvando || !filtrate.length}
              style={{ background: '#1a1a1a', color: '#fff', border: 0, borderRadius: 8, padding: '9px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Adegua tutte ({filtrate.length})
            </button>
            {sel.length > 0 && (
              <button onClick={() => adegua(sel)} disabled={salvando}
                style={{ background: '#f97316', color: '#fff', border: 0, borderRadius: 8, padding: '9px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Adegua selezionate ({sel.length})
              </button>
            )}
          </div>

          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}></th>
                <th style={th}>Listino / clienti</th>
                <th style={th}>Contratto</th>
                <th style={th}>Zona</th>
                <th style={th}>Riga</th>
                <th style={{ ...th, textAlign: 'right' }}>Vendi a</th>
                <th style={{ ...th, textAlign: 'right' }}>Paghi</th>
                <th style={{ ...th, textAlign: 'right' }}>Perdi</th>
                <th style={th}></th>
              </tr></thead>
              <tbody>
                {filtrate.slice(0, 500).map(r => (
                  <tr key={r.chiave} style={{ background: sel.includes(r.chiave) ? '#fff7ed' : '#fff' }}>
                    <td style={td}>
                      <input type="checkbox" checked={sel.includes(r.chiave)}
                        onChange={() => setSel(s => s.includes(r.chiave) ? s.filter(x => x !== r.chiave) : [...s, r.chiave])} />
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{r.listino_nome}</div>
                      <div style={{ fontSize: 11.5, color: '#888' }}>{r.clienti.slice(0, 3).join(', ') || 'nessun cliente assegnato'}{r.clienti.length > 3 ? ` +${r.clienti.length - 3}` : ''}</div>
                    </td>
                    <td style={td}>{r.corriere}</td>
                    <td style={td}>{r.zona}</td>
                    <td style={td}>{r.descrizione}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{eur(r.prezzo_cliente)}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#b45309', fontWeight: 600 }}>{eur(r.costo_tuo)}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#b91c1c', fontWeight: 700 }}>{eur(r.differenza)}</td>
                    <td style={td}>
                      <button onClick={() => adegua([r.chiave])} disabled={salvando}
                        style={{ background: '#fff', color: '#1a1a1a', border: '1px solid #ddd', borderRadius: 7, padding: '5px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        Adegua
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtrate.length > 500 && <div style={{ color: '#888', fontSize: 12.5, marginTop: 8 }}>Mostrate le 500 peggiori di {filtrate.length}. "Adegua tutte" le sistema comunque tutte.</div>}
        </>
      )}
    </div>
  )
}
