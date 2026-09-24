'use client'
import { useEffect, useMemo, useRef, useState } from 'react'

// Listino POD del master: quanto paga il cliente per ogni richiesta di prova di consegna.
// Regole a PRIORITA' (dalla piu' specifica): cliente+contratto > cliente+vettore > cliente >
// contratto > vettore > predefinito.
// Il cliente vede il prezzo all'apertura della richiesta; l'addebito parte quando il master carica la POD.
//
// 23/09: si scelgono PIU' contratti in una volta (prima uno alla volta: con 38 contratti significava
// rifare 38 volte la stessa regola) e si puo' prezzare un VETTORE intero — "tutti i GLS 2 €" — che
// copre anche i contratti che nasceranno domani. Quali contratti siano "GLS" lo dice il server
// (lib/vettore.ts): sui contratti diretti non sta scritto nel nome.
type Regola = { id: string; cliente_id: string | null; corriere_id: string | null; vettore: string | null; prezzo: number; attivo: boolean }
type Corr = { id: string; nome_contratto: string; vettore: string }
type Opz = { id: string; nome: string }

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0)

const inp: React.CSSProperties = { padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', background: '#fff', width: '100%' }
const lbl: React.CSSProperties = { display: 'block', fontSize: '11px', fontWeight: 700, color: '#6b7280', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.03em' }

// Chiude la tendina quando si clicca fuori. Sta qui perche' la usano in due: se resta dentro a un
// componente solo, la seconda tendina nasce senza e resta aperta sopra il resto della pagina.
function useChiudiFuori(aperto: boolean, chiudi: () => void) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aperto) return
    const fuori = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) chiudi() }
    document.addEventListener('mousedown', fuori)
    return () => document.removeEventListener('mousedown', fuori)
    // eslint-disable-next-line
  }, [aperto])
  return box
}

const rigaTendina: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', fontSize: '13px', cursor: 'pointer', color: '#1a1a1a' }
const pannello: React.CSSProperties = { position: 'absolute', zIndex: 30, top: 'calc(100% + 4px)', left: 0, right: 0, minWidth: '320px', maxHeight: '340px', overflowY: 'auto',
  background: '#fff', border: '1px solid #d1d5db', borderRadius: '8px', boxShadow: '0 10px 30px rgba(0,0,0,0.12)', padding: '8px' }

// Selettore a caselle dei CLIENTI: se ne spuntano quanti se ne vuole e il prezzo si scrive una volta
// per tutti — "questi dieci clienti, tutti i BRT, 3 €".
//
// Nessuna spunta NON vuol dire "nessun cliente": vuol dire la regola generica, quella che vale per
// tutti e che si applica a chi non ne ha una sua. E' la stessa logica dei corrieri qui sotto, e per
// un master con 600 clienti resta anche il modo piu' economico di dire "tutti": una regola, non 600.
function SelettoreClienti({ clienti, sel, setSel }: { clienti: Opz[]; sel: string[]; setSel: (v: string[]) => void }) {
  const [aperto, setAperto] = useState(false)
  const [cerca, setCerca] = useState('')
  const box = useChiudiFuori(aperto, () => setAperto(false))

  const q = cerca.trim().toLowerCase()
  const filtrati = useMemo(() => q ? clienti.filter(c => c.nome.toLowerCase().includes(q)) : clienti, [clienti, q])
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id])
  const tuttiFiltratiSel = !!filtrati.length && filtrati.every(c => sel.includes(c.id))

  const riassunto = sel.length === 0 ? 'Tutti i clienti (predefinito)'
    : sel.length === 1 ? (clienti.find(c => c.id === sel[0])?.nome || '1 cliente')
    : `${sel.length} clienti`

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setAperto(a => !a)}
        style={{ ...inp, textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: sel.length ? '#1a1a1a' : '#6b7280' }}>{riassunto}</span>
        <span style={{ color: '#9ca3af', fontSize: '11px' }}>▾</span>
      </button>
      {aperto && (
        <div style={pannello}>
          <input autoFocus value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Cerca cliente…"
            style={{ ...inp, padding: '7px 10px', marginBottom: '6px' }} />
          {sel.length > 0 && (
            <button type="button" onClick={() => setSel([])}
              style={{ ...rigaTendina, width: '100%', background: 'none', border: 'none', color: '#b91c1c', fontWeight: 600 }}>
              ✕ Togli la selezione (vale per tutti i clienti)
            </button>
          )}
          {filtrati.length > 1 && (
            <button type="button"
              onClick={() => setSel(tuttiFiltratiSel
                ? sel.filter(id => !filtrati.some(c => c.id === id))
                : [...new Set([...sel, ...filtrati.map(c => c.id)])])}
              style={{ ...rigaTendina, width: '100%', background: 'none', border: 'none', color: '#c2410c', fontWeight: 600 }}>
              {tuttiFiltratiSel ? '□' : '☑'} {tuttiFiltratiSel ? 'Deseleziona' : 'Seleziona'} i {filtrati.length} {q ? 'trovati' : 'clienti'}
            </button>
          )}
          {!filtrati.length && <div style={{ ...rigaTendina, color: '#9ca3af' }}>Nessun cliente trovato.</div>}
          {filtrati.map(c => (
            <label key={c.id} style={{ ...rigaTendina, borderRadius: '5px', background: sel.includes(c.id) ? '#fff7ed' : 'transparent' }}>
              <input type="checkbox" checked={sel.includes(c.id)} onChange={() => toggle(c.id)} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// Selettore a caselle: contratti raggruppati per vettore, con la riga "tutti i <vettore>".
function SelettoreCorrieri({ corrieri, selCorr, setSelCorr, selVett, setSelVett }: {
  corrieri: Corr[]
  selCorr: string[]; setSelCorr: (v: string[]) => void
  selVett: string[]; setSelVett: (v: string[]) => void
}) {
  const [aperto, setAperto] = useState(false)
  const [cerca, setCerca] = useState('')
  const box = useChiudiFuori(aperto, () => setAperto(false))

  const gruppi = useMemo(() => {
    const g = new Map<string, Corr[]>()
    for (const c of corrieri) { if (!g.has(c.vettore)) g.set(c.vettore, []); g.get(c.vettore)!.push(c) }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [corrieri])

  const q = cerca.trim().toLowerCase()
  const visibile = (c: Corr) => !q || c.nome_contratto.toLowerCase().includes(q) || c.vettore.toLowerCase().includes(q)

  const toggleCorr = (id: string) => setSelCorr(selCorr.includes(id) ? selCorr.filter(x => x !== id) : [...selCorr, id])
  const toggleVett = (v: string, ids: string[]) => {
    if (selVett.includes(v)) setSelVett(selVett.filter(x => x !== v))
    else {
      setSelVett([...selVett, v])
      // La regola sul vettore copre già i suoi contratti: le spunte singole diventerebbero doppioni.
      setSelCorr(selCorr.filter(id => !ids.includes(id)))
    }
  }

  const nSel = selCorr.length + selVett.length
  const riassunto = nSel === 0 ? 'Tutti i corrieri (predefinito)'
    : [selVett.length ? `${selVett.length} ${selVett.length > 1 ? 'vettori' : 'vettore'}` : '', selCorr.length ? `${selCorr.length} contratt${selCorr.length > 1 ? 'i' : 'o'}` : '']
      .filter(Boolean).join(' + ')

  const riga = rigaTendina

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setAperto(a => !a)}
        style={{ ...inp, textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: nSel ? '#1a1a1a' : '#6b7280' }}>{riassunto}</span>
        <span style={{ color: '#9ca3af', fontSize: '11px' }}>▾</span>
      </button>
      {aperto && (
        <div style={pannello}>
          <input autoFocus value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Cerca contratto o vettore…"
            style={{ ...inp, padding: '7px 10px', marginBottom: '6px' }} />
          {nSel > 0 && (
            <button type="button" onClick={() => { setSelCorr([]); setSelVett([]) }}
              style={{ ...riga, width: '100%', background: 'none', border: 'none', color: '#b91c1c', fontWeight: 600 }}>
              ✕ Togli la selezione (vale per tutti i corrieri)
            </button>
          )}
          {gruppi.map(([vett, lista]) => {
            const ids = lista.map(c => c.id)
            const vSel = selVett.includes(vett)
            const visibili = lista.filter(visibile)
            if (!visibili.length && !vett.toLowerCase().includes(q)) return null
            return (
              <div key={vett} style={{ borderTop: '1px solid #f3f4f6', paddingTop: '4px', marginTop: '4px' }}>
                <label style={{ ...riga, fontWeight: 700, background: vSel ? '#fff7ed' : 'transparent', borderRadius: '5px' }}>
                  <input type="checkbox" checked={vSel} onChange={() => toggleVett(vett, ids)} />
                  <span>Tutti i {vett}</span>
                  <span style={{ color: '#9ca3af', fontWeight: 500, fontSize: '11.5px' }}>({lista.length} contratt{lista.length > 1 ? 'i' : 'o'}, anche i futuri)</span>
                </label>
                {visibili.map(c => (
                  <label key={c.id} style={{ ...riga, paddingLeft: '26px', opacity: vSel ? 0.45 : 1, cursor: vSel ? 'not-allowed' : 'pointer' }}>
                    <input type="checkbox" disabled={vSel} checked={vSel || selCorr.includes(c.id)} onChange={() => toggleCorr(c.id)} />
                    <span>{c.nome_contratto}</span>
                  </label>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function PrezziPodPage() {
  const [regole, setRegole] = useState<Regola[]>([])
  const [clienti, setClienti] = useState<Opz[]>([])
  const [corrieri, setCorrieri] = useState<Corr[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [selCli, setSelCli] = useState<string[]>([])
  const [prezzo, setPrezzo] = useState('')
  const [selCorr, setSelCorr] = useState<string[]>([])
  const [selVett, setSelVett] = useState<string[]>([])
  const [selRighe, setSelRighe] = useState<string[]>([])

  const carica = async () => {
    setLoading(true)
    const r = await fetch('/api/assistenza/pod-prezzi')
    const j = await r.json().catch(() => ({}))
    if (r.ok) {
      setRegole(j.regole || [])
      setClienti((j.clienti || []).map((c: any) => ({ id: c.id, nome: c.ragione_sociale })))
      setCorrieri(j.corrieri || [])
    } else setMsg({ t: 'err', x: j.error || 'Errore di caricamento' })
    setSelRighe([])
    setLoading(false)
  }
  useEffect(() => { carica() }, [])

  const nomeCliente = (id: string | null) => id ? (clienti.find(c => c.id === id)?.nome || 'Cliente') : 'Tutti i clienti'
  const nomeCorriere = (id: string | null) => id ? (corrieri.find(c => c.id === id)?.nome_contratto || 'Corriere') : 'Tutti i corrieri'
  // Ordine di lettura = ordine di priorita': predefinito, vettore, contratto, cliente, cliente+bersaglio.
  const rank = (r: Regola) => (r.cliente_id ? 4 : 0) + (r.corriere_id ? 2 : 0) + (r.vettore ? 1 : 0)
  const regoleOrd = [...regole].sort((a, b) => rank(a) - rank(b) || nomeCliente(a.cliente_id).localeCompare(nomeCliente(b.cliente_id)))

  const salva = async () => {
    const p = Number(String(prezzo).replace(',', '.'))
    if (!isFinite(p) || p < 0) { setMsg({ t: 'err', x: 'Inserisci un prezzo valido (0 = gratuita)' }); return }
    setSalvando(true); setMsg(null)
    const r = await fetch('/api/assistenza/pod-prezzi', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_ids: selCli, corriere_ids: selCorr, vettori: selVett, prezzo: p }),
    })
    const j = await r.json().catch(() => ({}))
    setSalvando(false)
    if (r.ok) {
      const suClienti = j.clienti > 1 ? ` su ${j.clienti} clienti` : ''
      setMsg({ t: 'ok', x: `${j.totale} regol${j.totale > 1 ? 'e' : 'a'}${suClienti}: ${j.create} nuov${j.create === 1 ? 'a' : 'e'}, ${j.aggiornate} aggiornat${j.aggiornate === 1 ? 'a' : 'e'}` })
      setPrezzo(''); setSelCorr([]); setSelVett([]); setSelCli([]); carica()
    } else setMsg({ t: 'err', x: j.error || 'Errore nel salvataggio' })
  }

  const toggleAttivo = async (rg: Regola) => {
    const r = await fetch('/api/assistenza/pod-prezzi', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rg.id, attivo: !rg.attivo }),
    })
    if (r.ok) carica(); else { const j = await r.json().catch(() => ({})); setMsg({ t: 'err', x: j.error || 'Errore' }) }
  }

  const elimina = async (ids: string[]) => {
    if (!ids.length) return
    if (!confirm(ids.length > 1
      ? `Eliminare ${ids.length} regole? I clienti torneranno alla regola più generica (o gratuita).`
      : 'Eliminare questa regola? I clienti torneranno alla regola più generica (o gratuita).')) return
    const r = await fetch('/api/assistenza/pod-prezzi', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
    if (r.ok) carica(); else { const j = await r.json().catch(() => ({})); setMsg({ t: 'err', x: j.error || 'Errore' }) }
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e5e7eb' }
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f0f0f0' }

  return (
    <div>
      <div style={{ marginBottom: '18px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Prezzi POD</h1>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '4px', maxWidth: '820px' }}>
          Decidi quanto paga il cliente per ogni richiesta di prova di consegna. Vale la regola più specifica:
          <b> cliente + contratto</b> batte <b>cliente + vettore</b>, che batte <b>cliente</b>, che batte <b>contratto</b>,
          che batte <b>vettore</b>, che batte il <b>predefinito</b>.
          Senza nessuna regola la POD è gratuita. Il cliente vede il prezzo già all'apertura; l'addebito parte quando carichi la POD.
        </p>
      </div>

      {msg && (
        <div style={{ marginBottom: '14px', padding: '10px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
          background: msg.t === 'ok' ? '#ecfdf5' : '#fef2f2', color: msg.t === 'ok' ? '#065f46' : '#991b1b', border: `1px solid ${msg.t === 'ok' ? '#a7f3d0' : '#fecaca'}` }}>
          {msg.x}
        </div>
      )}

      {/* NUOVA / MODIFICA REGOLA */}
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', padding: '16px', marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a', marginBottom: '14px' }}>Aggiungi o aggiorna una regola</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 140px auto', gap: '12px', alignItems: 'end' }}>
          <div>
            <label style={lbl}>Clienti</label>
            <SelettoreClienti clienti={clienti} sel={selCli} setSel={setSelCli} />
          </div>
          <div>
            <label style={lbl}>Corrieri</label>
            <SelettoreCorrieri corrieri={corrieri} selCorr={selCorr} setSelCorr={setSelCorr} selVett={selVett} setSelVett={setSelVett} />
          </div>
          <div>
            <label style={lbl}>Prezzo (€)</label>
            <input value={prezzo} onChange={e => setPrezzo(e.target.value)} inputMode="decimal" placeholder="es. 2,00" style={inp} />
          </div>
          <button disabled={salvando} onClick={salva} style={{ padding: '10px 20px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: salvando ? 0.7 : 1, whiteSpace: 'nowrap' }}>
            {salvando ? 'Salvo…' : 'Salva regola'}
          </button>
        </div>
        <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '10px', marginBottom: 0 }}>
          Un prezzo, quanti clienti e quanti corrieri vuoi: spunta i clienti e i contratti — oppure <b>Tutti i GLS</b> / <b>Tutti i BRT</b>,
          che prendono anche i contratti aggiunti in futuro. Esempio: dieci clienti + <b>Tutti i BRT</b> + 3 € = dieci regole in un colpo.
          Non spuntare nessun cliente significa <b>tutti</b> (una regola sola, vale anche per chi arriverà domani).
          Prezzo <b>0</b> = POD gratuita esplicita (per esentare un cliente pur avendo un predefinito a pagamento).
        </p>
      </div>

      {/* REGOLE ESISTENTI */}
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', fontWeight: 700, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>Regole attive</span>
          {selRighe.length > 0 && (
            <button onClick={() => elimina(selRighe)} style={{ marginLeft: 'auto', padding: '5px 12px', background: '#fff', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
              Elimina {selRighe.length} selezionate
            </button>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f9fafb' }}>
              <th style={{ ...th, width: '34px' }}>
                <input type="checkbox" checked={!!regoleOrd.length && selRighe.length === regoleOrd.length}
                  onChange={e => setSelRighe(e.target.checked ? regoleOrd.map(r => r.id) : [])} />
              </th>
              {['Cliente', 'Corriere', 'Prezzo', 'Stato', ''].map((h, i) => <th key={i} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#999' }}>Caricamento…</td></tr>
              ) : !regoleOrd.length ? (
                <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#999' }}>Nessuna regola: al momento le POD sono gratuite per tutti.</td></tr>
              ) : regoleOrd.map(rg => (
                <tr key={rg.id} style={{ opacity: rg.attivo ? 1 : 0.5 }}>
                  <td style={td}>
                    <input type="checkbox" checked={selRighe.includes(rg.id)}
                      onChange={() => setSelRighe(s => s.includes(rg.id) ? s.filter(x => x !== rg.id) : [...s, rg.id])} />
                  </td>
                  <td style={td}>{rg.cliente_id ? nomeCliente(rg.cliente_id) : <span style={{ color: '#6b7280', fontStyle: 'italic' }}>Tutti i clienti</span>}</td>
                  <td style={td}>
                    {rg.vettore
                      ? <span style={{ background: '#fff7ed', color: '#c2410c', padding: '2px 8px', borderRadius: '999px', fontSize: '12px', fontWeight: 700 }}>Tutti i {rg.vettore}</span>
                      : rg.corriere_id ? nomeCorriere(rg.corriere_id) : <span style={{ color: '#6b7280', fontStyle: 'italic' }}>Tutti i corrieri</span>}
                  </td>
                  <td style={{ ...td, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{Number(rg.prezzo) === 0 ? <span style={{ color: '#059669' }}>Gratuita</span> : eur(rg.prezzo)}</td>
                  <td style={td}>
                    <button onClick={() => toggleAttivo(rg)} style={{ padding: '4px 10px', borderRadius: '999px', border: '1px solid', fontSize: '11.5px', fontWeight: 700, cursor: 'pointer',
                      background: rg.attivo ? '#ecfdf5' : '#f3f4f6', color: rg.attivo ? '#065f46' : '#6b7280', borderColor: rg.attivo ? '#a7f3d0' : '#d1d5db' }}>
                      {rg.attivo ? 'Attiva' : 'Sospesa'}
                    </button>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button onClick={() => elimina([rg.id])} style={{ padding: '4px 10px', background: 'none', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Elimina</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
