'use client'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { inp, card, cardH, th, td, Testata, Vuoto, ACCENT } from '../comune'

// STOCK DEI CLIENTI: chi ha merce da noi, quanta, e in che posto sta.
//
// Una riga per cliente, che si apre sulle sue referenze. L'ordine e' per pezzi, non alfabetico:
// chi occupa il magazzino viene prima, ed e' la domanda che si fa chi ci lavora.
//
// LE REFERENZE SENZA POSTO SONO SEGNALATE, non nascoste: sono la merce che c'e' ma che nessuno sa
// dove trovare. Finche' quel numero e' alto, una piantina del capannone mostrerebbe scaffali vuoti.

type Art = { id: string; sku: string | null; nome: string | null; quantita: number; variante: string | null; ubicazione: string | null; tipo_posto: string | null; posto_liberato: boolean }
type Posto = { id: string; ubicazione: string }
type Riga = { cliente_id: string; cliente: string; pezzi: number; referenze: number; referenze_senza_posto: number; ubicazioni: string[]; articoli: Art[]; posti: Posto[] }

export default function StockPage() {
  const [righe, setRighe] = useState<Riga[]>([])
  const [tot, setTot] = useState<any>(null)
  const [caricando, setCaricando] = useState(true)
  const [cerca, setCerca] = useState('')
  const [aperti, setAperti] = useState<string[]>([])
  const [soloSenzaPosto, setSoloSenzaPosto] = useState(false)
  // Quale riga sta assegnando il posto, e cosa sta scrivendo se sta creandone uno nuovo.
  const [assegno, setAssegno] = useState<string | null>(null)
  const [nuovoPosto, setNuovoPosto] = useState('')
  const [salvo, setSalvo] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  const carica = () => fetch('/api/logistica/stock').then(r => r.json()).then(d => {
    setRighe(Array.isArray(d.righe) ? d.righe : []); setTot(d.totali || null)
  }).catch(() => {}).finally(() => setCaricando(false))

  useEffect(() => { carica() }, [])

  // ASSEGNARE IL POSTO IN UN GESTO SOLO. Se il posto non esiste ancora lo si crea qui e lo si usa
  // subito: costringere a passare dal Magazzino, tornare indietro e ricominciare era il motivo per
  // cui 24 referenze su 28 restavano senza.
  async function assegna(art: Art, clienteId: string, bloccoId: string | null, nuovaUbicazione?: string) {
    setSalvo(true); setErrore(null)
    try {
      let id = bloccoId
      if (nuovaUbicazione) {
        const r = await fetch('/api/logistica/blocchi', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cliente_id: clienteId, ubicazione: nuovaUbicazione.trim() }),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok || d.error) { setErrore(d.error || 'Non sono riuscito a creare il posto'); setSalvo(false); return }
        id = d.id || d?.blocco?.id || null
        if (!id) { await carica(); setAssegno(null); setNuovoPosto(''); setSalvo(false); return }
      }
      const r2 = await fetch('/api/logistica/stock', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articolo_id: art.id, blocco_id: id }),
      })
      const d2 = await r2.json().catch(() => ({}))
      if (!r2.ok || d2.error) { setErrore(d2.error || 'Non sono riuscito ad assegnare il posto'); setSalvo(false); return }
      setAssegno(null); setNuovoPosto('')
      await carica()
    } finally { setSalvo(false) }
  }

  const q = cerca.trim().toLowerCase()
  // La ricerca guarda anche DENTRO le referenze: chi cerca "GJ-ZQKZ" o "collana" non sa di quale
  // cliente sia — e' proprio la domanda che sta facendo.
  const visibili = useMemo(() => righe
    .map(r => {
      const artFiltrati = r.articoli.filter(a =>
        (!q || [r.cliente, a.sku, a.nome, a.variante, a.ubicazione].some(v => String(v || '').toLowerCase().includes(q)))
        && (!soloSenzaPosto || (!a.ubicazione && a.quantita > 0)))
      const clienteMatch = !q || r.cliente.toLowerCase().includes(q)
      return { ...r, articoli: artFiltrati, _mostra: artFiltrati.length > 0 || (clienteMatch && !soloSenzaPosto) }
    })
    .filter(r => r._mostra), [righe, q, soloSenzaPosto])

  const apri = (id: string) => setAperti(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  const chip = (testo: string, colore: string, sfondo: string) => (
    <span style={{ background: sfondo, color: colore, borderRadius: '999px', padding: '2px 9px', fontSize: '11.5px', fontWeight: 700, whiteSpace: 'nowrap' }}>{testo}</span>
  )

  return (
    <div>
      <Testata titolo="Stock clienti" sottotitolo="Chi ha merce in magazzino, quanta, e dove sta" />

      {tot && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '14px' }}>
          {[
            { k: 'Clienti con merce', v: tot.clienti },
            { k: 'Pezzi a magazzino', v: Number(tot.pezzi).toLocaleString('it-IT') },
            { k: 'Referenze', v: tot.referenze },
            { k: 'Posti occupati', v: `${tot.posti_occupati}${tot.posti_liberi ? ' · ' + tot.posti_liberi + ' liberi' : ''}` },
          ].map(c => (
            <div key={c.k} style={{ ...card, marginBottom: 0, padding: '12px 14px' }}>
              <div style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.03em' }}>{c.k}</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', marginTop: '2px' }}>{c.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* La merce senza posto non e' una statistica fra le altre: e' l'unica che si puo' RISOLVERE,
          e da lei dipende se la mappa del magazzino avra' senso. Sta in evidenza, con il filtro. */}
      {tot?.senza_posto > 0 && (
        <div style={{ ...card, padding: '12px 14px', background: '#fffbeb', border: '1px solid #fde68a', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', color: '#92400e' }}>
            <b>{tot.senza_posto}</b> {tot.senza_posto === 1 ? 'referenza è' : 'referenze sono'} a magazzino senza un posto assegnato: la merce c'è, ma non si sa dove trovarla.
          </span>
          <button onClick={() => setSoloSenzaPosto(s => !s)}
            style={{ marginLeft: 'auto', background: soloSenzaPosto ? '#92400e' : '#fff', color: soloSenzaPosto ? '#fff' : '#92400e', border: '1px solid #fbbf24', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
            {soloSenzaPosto ? '✕ Mostra tutto' : 'Vedi solo queste'}
          </button>
        </div>
      )}

      <div style={{ marginBottom: '12px' }}>
        <input value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Cerca cliente, SKU, articolo o ubicazione…" style={{ ...inp, maxWidth: '380px' }} />
      </div>

      <div style={card}>
        <div style={cardH}>Merce per cliente</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#fafafa' }}>
              <th style={{ ...th, width: '28px' }}></th>
              <th style={th}>Cliente</th>
              <th style={{ ...th, textAlign: 'right' }}>Pezzi</th>
              <th style={{ ...th, textAlign: 'right' }}>Referenze</th>
              <th style={th}>Dove</th>
            </tr></thead>
            <tbody>
              {caricando ? (
                <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#999' }}>Caricamento…</td></tr>
              ) : !visibili.length ? (
                <tr><td colSpan={5} style={{ padding: 0 }}><Vuoto testo={q || soloSenzaPosto ? 'Nessuna referenza con questi criteri.' : 'Nessun cliente ha merce in magazzino.'} /></td></tr>
              ) : visibili.map(r => {
                const aperto = aperti.includes(r.cliente_id) || !!q || soloSenzaPosto
                return (
                  <Fragment key={r.cliente_id}>
                    <tr onClick={() => apri(r.cliente_id)} style={{ cursor: 'pointer' }}>
                      <td style={{ ...td, color: '#9ca3af' }}>{aperto ? '▾' : '▸'}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{r.cliente}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{r.pezzi.toLocaleString('it-IT')}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {r.referenze}
                        {r.referenze_senza_posto > 0 && <span style={{ color: '#b45309', marginLeft: '6px', fontSize: '11.5px' }}>({r.referenze_senza_posto} senza posto)</span>}
                      </td>
                      <td style={td}>
                        {r.ubicazioni.length
                          ? <span style={{ display: 'inline-flex', gap: '4px', flexWrap: 'wrap' }}>{r.ubicazioni.map(u => chip(u, '#0369a1', '#e0f2fe'))}</span>
                          : <span style={{ color: '#cbd5e1' }}>—</span>}
                      </td>
                    </tr>
                    {aperto && r.articoli.map(a => (
                      <tr key={a.id} style={{ background: '#fcfcfd' }}>
                        <td style={td}></td>
                        <td style={{ ...td, paddingLeft: '22px' }}>
                          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '11.5px', color: '#64748b' }}>{a.sku || '—'}</span>
                          <span style={{ marginLeft: '8px' }}>{a.nome || 'Senza nome'}</span>
                          {a.variante && <span style={{ color: '#94a3b8', marginLeft: '6px', fontSize: '11.5px' }}>{a.variante}</span>}
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: a.quantita > 0 ? '#1a1a1a' : '#cbd5e1' }}>{a.quantita}</td>
                        <td style={td}></td>
                        <td style={td}>
                          {a.ubicazione
                            ? <>
                                {chip(a.ubicazione, '#0369a1', '#e0f2fe')}
                                {a.tipo_posto && <span style={{ color: '#94a3b8', marginLeft: '6px', fontSize: '11.5px' }}>{a.tipo_posto}</span>}
                                {a.posto_liberato && <span style={{ color: '#b91c1c', marginLeft: '6px', fontSize: '11.5px', fontWeight: 700 }}>posto già liberato</span>}
                                <button onClick={() => { setAssegno(a.id); setErrore(null) }}
                                  style={{ marginLeft: '8px', background: 'none', border: 'none', color: '#94a3b8', fontSize: '11.5px', cursor: 'pointer', textDecoration: 'underline' }}>sposta</button>
                              </>
                            : a.quantita > 0
                              ? <button onClick={() => { setAssegno(a.id); setErrore(null) }}
                                  style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', borderRadius: '999px', padding: '3px 10px', fontSize: '11.5px', fontWeight: 700, cursor: 'pointer' }}>
                                  + Assegna posto
                                </button>
                              : <span style={{ color: '#cbd5e1' }}>—</span>}
                          {assegno === a.id && (
                            <div style={{ marginTop: '6px', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                              <select autoFocus defaultValue="" disabled={salvo}
                                onChange={e => { const v = e.target.value; if (v && v !== '__nuovo') assegna(a, r.cliente_id, v) }}
                                style={{ ...inp, width: 'auto', minWidth: '150px', padding: '5px 8px', fontSize: '12px' }}>
                                <option value="">— scegli il posto —</option>
                                {r.posti.map(p => <option key={p.id} value={p.id}>{p.ubicazione}</option>)}
                                <option value="__nuovo">➕ nuovo posto…</option>
                              </select>
                              <input value={nuovoPosto} onChange={e => setNuovoPosto(e.target.value)} disabled={salvo}
                                onKeyDown={e => { if (e.key === 'Enter' && nuovoPosto.trim()) assegna(a, r.cliente_id, null, nuovoPosto) }}
                                placeholder="oppure scrivi: A-5"
                                style={{ ...inp, width: '130px', padding: '5px 8px', fontSize: '12px' }} />
                              {nuovoPosto.trim() && (
                                <button onClick={() => assegna(a, r.cliente_id, null, nuovoPosto)} disabled={salvo}
                                  style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                                  {salvo ? '…' : 'Crea e metti qui'}
                                </button>
                              )}
                              {a.ubicazione && (
                                <button onClick={() => assegna(a, r.cliente_id, null)} disabled={salvo}
                                  style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: '11.5px', cursor: 'pointer', textDecoration: 'underline' }}>togli il posto</button>
                              )}
                              <button onClick={() => { setAssegno(null); setNuovoPosto(''); setErrore(null) }}
                                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '11.5px', cursor: 'pointer' }}>annulla</button>
                              {errore && <span style={{ color: '#b91c1c', fontSize: '11.5px' }}>{errore}</span>}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '10px' }}>
        Il posto si assegna dal <b style={{ color: ACCENT }}>Carico merce</b>, scegliendo l&apos;ubicazione mentre si registra la merce in entrata.
      </p>
    </div>
  )
}
