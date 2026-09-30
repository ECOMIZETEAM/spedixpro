'use client'
import { useEffect, useMemo, useState } from 'react'
import { inp, card, cardH, th, td, Testata, Vuoto, ACCENT } from '../comune'

// STOCK DEI CLIENTI: chi ha merce da noi, quanta, e in che posto sta.
//
// Una riga per cliente, che si apre sulle sue referenze. L'ordine e' per pezzi, non alfabetico:
// chi occupa il magazzino viene prima, ed e' la domanda che si fa chi ci lavora.
//
// LE REFERENZE SENZA POSTO SONO SEGNALATE, non nascoste: sono la merce che c'e' ma che nessuno sa
// dove trovare. Finche' quel numero e' alto, una piantina del capannone mostrerebbe scaffali vuoti.

type Art = { id: string; sku: string | null; nome: string | null; quantita: number; variante: string | null; ubicazione: string | null; tipo_posto: string | null; posto_liberato: boolean }
type Riga = { cliente_id: string; cliente: string; pezzi: number; referenze: number; referenze_senza_posto: number; ubicazioni: string[]; articoli: Art[] }

export default function StockPage() {
  const [righe, setRighe] = useState<Riga[]>([])
  const [tot, setTot] = useState<any>(null)
  const [caricando, setCaricando] = useState(true)
  const [cerca, setCerca] = useState('')
  const [aperti, setAperti] = useState<string[]>([])
  const [soloSenzaPosto, setSoloSenzaPosto] = useState(false)

  useEffect(() => {
    fetch('/api/logistica/stock').then(r => r.json()).then(d => {
      setRighe(Array.isArray(d.righe) ? d.righe : []); setTot(d.totali || null)
    }).catch(() => {}).finally(() => setCaricando(false))
  }, [])

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
                  <>
                    <tr key={r.cliente_id} onClick={() => apri(r.cliente_id)} style={{ cursor: 'pointer' }}>
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
                              </>
                            : a.quantita > 0
                              ? <span style={{ color: '#b45309', fontSize: '11.5px', fontWeight: 600 }}>senza posto</span>
                              : <span style={{ color: '#cbd5e1' }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </>
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
