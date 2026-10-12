'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

// LISTINI DA ADEGUARE — riepilogo per LISTINO delle righe vendute sotto il COSTO vero del master
// (stessa rilevazione del Check Sotto Costo: /api/listini/check-sotto-costo). Non adegua qui: per
// ogni listino/contratto porta DENTRO l'editor di quel listino, dove le righe sotto costo sono gia'
// evidenziate in rosso, e il master le sistema a mano (zone e supplementi, ciascuno a modo suo) e salva.

type Riga = {
  listino_id: string; listino_nome: string; clienti: string[]
  corriere: string; corriere_id?: string
  tipo: 'fascia' | 'supplemento'; descrizione: string; zona: string
  prezzo_cliente: number; costo_tuo: number; differenza: number
}
type CorrGruppo = { corriere: string; corriere_id: string; nFasce: number; nSupp: number }
type ListinoGruppo = { listino_id: string; listino_nome: string; clienti: string[]; corrieri: CorrGruppo[]; totale: number }

export default function ListiniDaAdeguare() {
  const [listini, setListini] = useState<ListinoGruppo[]>([])
  const [totRighe, setTotRighe] = useState(0)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch('/api/listini/check-sotto-costo').then(r => r.json()).then(j => {
      const righe: Riga[] = Array.isArray(j?.righe) ? j.righe : []
      setTotRighe(Number(j?.totale) || righe.length)
      // raggruppo per listino, e dentro per corriere
      const map = new Map<string, ListinoGruppo>()
      for (const r of righe) {
        if (!map.has(r.listino_id)) map.set(r.listino_id, { listino_id: r.listino_id, listino_nome: r.listino_nome, clienti: r.clienti || [], corrieri: [], totale: 0 })
        const g = map.get(r.listino_id)!
        g.totale++
        const cid = r.corriere_id || r.corriere
        let c = g.corrieri.find(x => x.corriere_id === cid)
        if (!c) { c = { corriere: r.corriere, corriere_id: r.corriere_id || '', nFasce: 0, nSupp: 0 }; g.corrieri.push(c) }
        if (r.tipo === 'fascia') c.nFasce++; else c.nSupp++
      }
      const arr = [...map.values()].sort((a, b) => b.totale - a.totale)
      for (const g of arr) g.corrieri.sort((a, b) => (b.nFasce + b.nSupp) - (a.nFasce + a.nSupp))
      setListini(arr); setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const filtrati = q.trim()
    ? listini.filter(g => `${g.listino_nome} ${g.clienti.join(' ')} ${g.corrieri.map(c => c.corriere).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()))
    : listini

  const card = { background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: 16, marginBottom: 14 } as const

  return (
    <div style={{ maxWidth: 1000, padding: '18px 20px', margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: '#1a1a1a', margin: '0 0 6px' }}>Listini da adeguare</h1>
      <p style={{ fontSize: 13.5, color: '#6b7280', margin: '0 0 16px', lineHeight: 1.5 }}>
        I tuoi listini cliente con righe vendute <b>sotto il tuo costo</b>. Clicca un contratto: ti porta dentro il
        listino, con le righe sotto costo <b style={{ color: '#dc2626' }}>in rosso</b> — le sistemi a mano (zone e
        supplementi) e salvi.
      </p>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Controllo i tuoi listini…</div>
      ) : totRighe === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: '#16a34a', fontWeight: 600 }}>✓ Nessun listino sotto costo: quello che vendi copre sempre quello che paghi.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: '#991b1b', fontWeight: 700, textTransform: 'uppercase' }}>Listini da sistemare</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#b91c1c' }}>{listini.length}</div>
            </div>
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: '#9a3412', fontWeight: 700, textTransform: 'uppercase' }}>Righe sotto costo</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#c2410c' }}>{totRighe.toLocaleString('it-IT')}</div>
            </div>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Cerca cliente, listino, contratto…"
              style={{ flex: '1 1 240px', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }} />
          </div>

          {filtrati.map(g => (
            <div key={g.listino_id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                <div>
                  <span style={{ fontWeight: 700, color: '#1a1a1a' }}>{g.listino_nome}</span>
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#b91c1c', fontWeight: 700 }}>{g.totale} {g.totale === 1 ? 'riga' : 'righe'} sotto costo</span>
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', maxWidth: 480, textAlign: 'right' }}>{(g.clienti || []).slice(0, 4).join(' · ') || 'nessun cliente assegnato'}{g.clienti.length > 4 ? ` +${g.clienti.length - 4}` : ''}</div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {g.corrieri.map((c, i) => (
                  <Link key={c.corriere_id || c.corriere || i}
                    href={`/dashboard/listini/clienti/${g.listino_id}${c.corriere_id ? `?corriere=${c.corriere_id}` : ''}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none',
                      border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 9, padding: '9px 13px' }}>
                    <span style={{ fontWeight: 700, color: '#1a1a1a', fontSize: 13 }}>{c.corriere}</span>
                    <span style={{ fontSize: 12, color: '#b91c1c', fontWeight: 600 }}>
                      {c.nFasce > 0 && `${c.nFasce} ${c.nFasce === 1 ? 'zona' : 'zone'}`}{c.nFasce > 0 && c.nSupp > 0 ? ' · ' : ''}{c.nSupp > 0 && `${c.nSupp} suppl.`}
                    </span>
                    <span style={{ color: '#f97316', fontWeight: 800, fontSize: 15 }}>→</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
          {filtrati.length === 0 && <div style={{ ...card, textAlign: 'center', color: '#9ca3af' }}>Nessun listino corrisponde alla ricerca.</div>}
        </>
      )}
    </div>
  )
}
