'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDialog } from '@/app/components/DialogProvider'
import CodiceContratto from '@/app/components/CodiceContratto'
import { logoCorriere } from '@/lib/corriere-logo'
import { aumentaPrezzo, euro, leggiPercentuale, PERC_MASSIMA } from '@/lib/aumento-listini'

// AUMENTA PREZZI — un contratto, i listini scelti, una percentuale (richiesta di Lorenzo, 30/10/2026).
// Esempio: Ecomize LL alza SDA EXPRESS L del 5% su tutti i listini dei suoi clienti.
// Si scelgono i LISTINI, non i clienti: un listino lo usano spesso piu' clienti insieme, e la pagina dice chi.
// L'anteprima usa la stessa formula del database (lib/aumento-listini), quindi la cifra vista e' quella scritta.

type Contratto = { id: string; nome: string; codice: string | null; attivo: boolean; listini: number }
type Fascia = { z: string; t: string; pmin: number; pmax: number; p: number; fuel: number }
type Listino = { id: string; nome: string; attivo: boolean; clienti: { nome: string; attivo: boolean }[]; collegati: string[]; sottoMaster: string[]; fasce: Fascia[] }
type Aumento = {
  id: string; corriere_id: string; nome_contratto: string; codice_contratto: string | null; percentuale: number
  listini: number; fasce: number; creato_da: string | null; creato_il: string
  annullato_il: string | null; annullato_da: string | null; fasce_ripristinate: number | null; fasce_lasciate: number | null
}

const ARANCIO = '#f97316'
const nuovoId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16) })
const quando = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const percTesto = (p: number) => `${String(p).replace('.', ',')}%`
const kg = (n: number) => String(Number(n)).replace('.', ',')
const fasciaTesto = (f: Fascia) => f.t === 'oltre' ? `oltre, ogni ${kg(f.pmax)} kg` : f.t === 'fino_a' || !f.t ? `fino a ${kg(f.pmax)} kg` : f.t
const primaItalia = (a: string, b: string) => {
  const ia = /italia/i.test(a) ? 0 : 1, ib = /italia/i.test(b) ? 0 : 1
  return ia - ib || a.localeCompare(b, 'it')
}
const plurale = (n: number, uno: string, tanti: string) => `${n.toLocaleString('it-IT')} ${n === 1 ? uno : tanti}`

// ── icone a linea (niente emoji) ──────────────────────────────────────────────────────────────────────
const I = {
  cerca: <path d="m21 21-4.3-4.3M10.8 18a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4Z" />,
  spunta: <path d="M20 6 9 17l-5-5" />,
  freccia: <path d="M5 12h14M13 6l6 6-6 6" />,
  giu: <path d="m6 9 6 6 6-6" />,
  annulla: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  persone: <><path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" /><circle cx="10" cy="8" r="3.5" /><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.6a3.5 3.5 0 0 1 0 6.8" /></>,
  rete: <><circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="19" r="2.5" /><circle cx="19" cy="19" r="2.5" /><path d="M12 7.5V12M12 12l-5.3 4.8M12 12l5.3 4.8" /></>,
  storico: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  attenzione: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
}
function Icona({ d, size = 16, color = 'currentColor', stroke = 1.7 }: { d: React.ReactNode; size?: number; color?: string; stroke?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>{d}</svg>
}

function Passo({ n, titolo, sotto, attivo, children, destra }: { n: number; titolo: string; sotto?: string; attivo: boolean; children?: React.ReactNode; destra?: React.ReactNode }) {
  return (
    <section style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 14, marginBottom: 14, opacity: attivo ? 1 : .55, boxShadow: attivo ? '0 1px 2px rgba(0,0,0,.03)' : 'none' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: children ? '1px solid #f3f3f3' : 0 }}>
        <span style={{ width: 26, height: 26, borderRadius: 8, background: attivo ? ARANCIO : '#f1f1f1', color: attivo ? '#fff' : '#9a9a9a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800 }}>{n}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 750, color: '#1a1a1a' }}>{titolo}</div>
          {sotto && <div style={{ fontSize: 12.5, color: '#8a8a8a', marginTop: 1 }}>{sotto}</div>}
        </div>
        {destra}
      </header>
      {children && <div style={{ padding: '14px 18px 16px' }}>{children}</div>}
    </section>
  )
}

function Etichetta({ children, tono = 'grigio', title }: { children: React.ReactNode; tono?: 'grigio' | 'viola' | 'blu' | 'rosso'; title?: string }) {
  const t = { grigio: ['#f5f5f4', '#57534e', '#e7e5e4'], viola: ['#f5f3ff', '#6d28d9', '#ddd6fe'], blu: ['#eff6ff', '#1d4ed8', '#bfdbfe'], rosso: ['#fef2f2', '#b91c1c', '#fecaca'] }[tono]
  return <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: t[0], color: t[1], border: `1px solid ${t[2]}`, borderRadius: 20, padding: '2px 8px', fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
}

export default function AumentaPrezzi() {
  const dialog = useDialog()
  const [contratti, setContratti] = useState<Contratto[]>([])
  const [storico, setStorico] = useState<Aumento[]>([])
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState('')
  const [cercaContratto, setCercaContratto] = useState('')
  const [contratto, setContratto] = useState<Contratto | null>(null)
  const [listini, setListini] = useState<Listino[]>([])
  const [zone, setZone] = useState<Record<string, string>>({})
  const [caricoListini, setCaricoListini] = useState(false)
  const [scelti, setScelti] = useState<Set<string>>(new Set())
  const [cercaListino, setCercaListino] = useState('')
  const [aperto, setAperto] = useState<string | null>(null)
  const [percScritta, setPercScritta] = useState('')
  const [richiestaId, setRichiestaId] = useState(nuovoId)
  const [salvando, setSalvando] = useState(false)
  const [esito, setEsito] = useState<{ id: string; listini: number; fasce: number; percentuale: number; contratto: string } | null>(null)
  const [dettagli, setDettagli] = useState<Record<string, { id: string; nome: string; fasce: number }[] | 'carico'>>({})

  const perc = leggiPercentuale(percScritta)

  const caricaTutto = () => {
    setCaricamento(true)
    return fetch('/api/listini/aumenti').then(async r => {
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErrore(j?.error || 'Non riesco a leggere i tuoi contratti.'); return }
      setContratti(Array.isArray(j.contratti) ? j.contratti : []); setStorico(Array.isArray(j.storico) ? j.storico : [])
    }).catch(() => setErrore('Non riesco a leggere i tuoi contratti.')).finally(() => setCaricamento(false))
  }
  useEffect(() => { caricaTutto() }, [])

  // Il contratto di cui la pagina sta mostrando i listini. Una risposta che arriva tardi per un contratto
  // lasciato (si sceglie A, lento, poi B) si butta: altrimenti si vedrebbero i listini di A sotto il nome di
  // B, e l'aumento andrebbe su B coi listini e i numeri di A.
  const contrattoCorrente = useRef<string | null>(null)
  const caricaListini = (c: Contratto, tieniScelta = false) => {
    contrattoCorrente.current = c.id
    setCaricoListini(true)
    if (!tieniScelta) { setScelti(new Set()); setAperto(null); setListini([]) }
    return fetch(`/api/listini/aumenti/listini?corriere=${c.id}`).then(r => r.json()).then(j => {
      if (contrattoCorrente.current !== c.id) return
      setListini(Array.isArray(j?.listini) ? j.listini : []); setZone(j?.zone || {})
    }).catch(() => { if (contrattoCorrente.current === c.id) setListini([]) })
      .finally(() => { if (contrattoCorrente.current === c.id) setCaricoListini(false) })
  }
  const scegliContratto = (c: Contratto) => { setContratto(c); setEsito(null); setRichiestaId(nuovoId()); caricaListini(c) }
  // Dopo un aumento o un annullo, le bozze dell'editor di quei listini sono vecchie: via (l'editor comunque
  // non le riprende se il listino e' cambiato, vedi ListinoEditor).
  const scartaBozze = (corriereId: string, ids: string[]) => {
    try { for (const id of ids) sessionStorage.removeItem(`bozza_listino:${id}:${corriereId}`) } catch {}
  }

  const contrattiVisti = useMemo(() => {
    const q = cercaContratto.trim().toLowerCase()
    return q ? contratti.filter(c => `${c.nome} ${c.codice || ''}`.toLowerCase().includes(q)) : contratti
  }, [contratti, cercaContratto])

  const usato = (l: Listino) => l.clienti.length > 0 || l.sottoMaster.length > 0 || l.collegati.length > 0
  const listiniVisti = useMemo(() => {
    const q = cercaListino.trim().toLowerCase()
    const base = [...listini].sort((a, b) => (usato(a) ? 0 : 1) - (usato(b) ? 0 : 1) || a.nome.localeCompare(b.nome, 'it'))
    return q ? base.filter(l => `${l.nome} ${l.clienti.map(c => c.nome).join(' ')} ${l.sottoMaster.join(' ')} ${l.collegati.join(' ')}`.toLowerCase().includes(q)) : base
  }, [listini, cercaListino])

  const gruppi = useMemo(() => ({
    clienti: listini.filter(l => l.clienti.length > 0).map(l => l.id),
    rete: listini.filter(l => l.sottoMaster.length > 0 || l.collegati.length > 0).map(l => l.id),
    tutti: listini.map(l => l.id),
  }), [listini])
  const uguale = (ids: string[]) => ids.length === scelti.size && ids.every(id => scelti.has(id))

  const sceltiListini = listini.filter(l => scelti.has(l.id))
  const riepilogo = useMemo(() => {
    const clienti = new Set<string>(), sub = new Set<string>(), coll = new Set<string>()
    let prezzi = 0, conFuel = false
    for (const l of sceltiListini) {
      l.clienti.forEach(c => clienti.add(c.nome)); l.sottoMaster.forEach(s => sub.add(s)); l.collegati.forEach(s => coll.add(s))
      for (const f of l.fasce) { if (f.p > 0) prezzi++; if (f.fuel) conFuel = true }
    }
    return { clienti: clienti.size, sub: [...sub], coll: [...coll], prezzi, conFuel }
  }, [sceltiListini])

  // Una riga di esempio per listino: la prima fascia della zona Italia (o della prima zona).
  const esempio = (l: Listino): Fascia | null => {
    const vive = l.fasce.filter(f => f.p > 0)
    if (!vive.length) return null
    const zoneOrd = [...new Set(vive.map(f => f.z))].sort((a, b) => primaItalia(zone[a] || '', zone[b] || ''))
    return vive.filter(f => f.z === zoneOrd[0]).sort((a, b) => (a.t === 'oltre' ? 1 : 0) - (b.t === 'oltre' ? 1 : 0) || a.pmax - b.pmax)[0]
  }
  const esempioGenerale = sceltiListini.map(l => ({ l, f: esempio(l) })).find(x => x.f)

  const cambia = (id: string) => setScelti(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function applica() {
    if (!contratto || !perc || !scelti.size || salvando) return
    const sub = riepilogo.sub.length + riepilogo.coll.length
    const ok = await dialog.confirm({
      title: `Aumentare ${contratto.nome} del ${percTesto(perc)}?`,
      confirmText: `Aumenta del ${percTesto(perc)}`,
      message: (
        <div style={{ fontSize: 13.5, lineHeight: 1.55, color: '#333' }}>
          <div>Sale del <b>{percTesto(perc)}</b> ogni prezzo per peso e zona di <b>{contratto.nome}</b>{contratto.codice ? <> ({contratto.codice})</> : null} in <b>{plurale(sceltiListini.length, 'listino', 'listini')}</b>: {plurale(riepilogo.prezzi, 'prezzo', 'prezzi')}.</div>
          <div style={{ marginTop: 6 }}>Li usano {plurale(riepilogo.clienti, 'cliente', 'clienti')}{sub ? <> e {plurale(sub, 'master della tua rete', 'master della tua rete')}</> : null}. Vale dalle prossime spedizioni.</div>
          {esempioGenerale?.f && <div style={{ marginTop: 6 }}>Per esempio, {esempioGenerale.l.nome} · {zone[esempioGenerale.f.z] || 'zona'} {fasciaTesto(esempioGenerale.f)}: {euro(esempioGenerale.f.p)} → <b>{euro(aumentaPrezzo(esempioGenerale.f.p, perc))}</b>.</div>}
          <div style={{ marginTop: 6, color: '#777' }}>Contrassegno, assicurazione, giacenze e resi non cambiano. Puoi annullarlo dallo storico.</div>
          {perc > 20 && <div style={{ marginTop: 8, color: '#b91c1c', fontWeight: 700 }}>Attenzione: è un aumento alto ({percTesto(perc)}). Controlla di non aver scritto un numero sbagliato.</div>}
        </div>
      ),
    })
    if (!ok) return
    setSalvando(true)
    const res = await fetch('/api/listini/aumenti', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corriere_id: contratto.id, listini: [...scelti], percentuale: perc, richiesta_id: richiestaId }),
    }).then(async r => ({ ok: r.ok, j: await r.json().catch(() => ({})) })).catch(() => null)
    setSalvando(false)
    if (!res) { await dialog.alert({ title: 'Connessione interrotta', message: 'Non so se l’aumento è arrivato. Ricarica lo storico qui sotto prima di riprovare: se c’è, è già fatto.' }); caricaTutto(); return }
    if (!res.ok) { await dialog.alert({ title: 'Aumento non applicato', message: res.j?.error || 'Nessun prezzo è stato cambiato.' }); caricaTutto(); return }
    scartaBozze(contratto.id, [...scelti])
    setEsito({ id: res.j.id, listini: res.j.listini, fasce: res.j.fasce, percentuale: res.j.percentuale, contratto: contratto.nome })
    setRichiestaId(nuovoId()); setScelti(new Set()); setPercScritta('')
    caricaTutto(); caricaListini(contratto, true)
  }

  async function annulla(a: Aumento) {
    const ok = await dialog.confirm({
      title: `Annullare l’aumento del ${percTesto(a.percentuale)} su ${a.nome_contratto}?`,
      confirmText: 'Annulla aumento', danger: true,
      message: (
        <div style={{ fontSize: 13.5, lineHeight: 1.55, color: '#333' }}>
          Rimetto i prezzi esatti di prima in {plurale(a.listini, 'listino', 'listini')} ({plurale(a.fasce, 'prezzo', 'prezzi')}).
          <div style={{ marginTop: 6, color: '#777' }}>Se dopo l’aumento hai cambiato a mano qualche prezzo, quello resta come l’hai lasciato.</div>
        </div>
      ),
    })
    if (!ok) return
    const res = await fetch(`/api/listini/aumenti/${a.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ azione: 'annulla' }) })
      .then(async r => ({ ok: r.ok, j: await r.json().catch(() => ({})) })).catch(() => null)
    if (!res || !res.ok) { await dialog.alert({ title: 'Annullo non fatto', message: res?.j?.error || 'Nessun prezzo è stato cambiato.' }); return }
    scartaBozze(a.corriere_id, Array.isArray(res.j.listini) ? res.j.listini : [])
    await dialog.alert({
      title: 'Aumento annullato',
      message: `${plurale(res.j.ripristinate, 'prezzo è tornato', 'prezzi sono tornati')} com’erano.${res.j.lasciate ? ` ${plurale(res.j.lasciate, 'prezzo era', 'prezzi erano')} stati cambiati dopo l’aumento e ${res.j.lasciate === 1 ? 'è rimasto' : 'sono rimasti'} come li avevi lasciati.` : ''}`,
    })
    if (esito?.id === a.id) setEsito(null)
    caricaTutto(); if (contratto) caricaListini(contratto, true)
  }

  const apriDettaglio = (id: string) => {
    if (dettagli[id]) { setDettagli(d => { const n = { ...d }; delete n[id]; return n }); return }
    setDettagli(d => ({ ...d, [id]: 'carico' }))
    fetch(`/api/listini/aumenti/${id}`).then(r => r.json()).then(j => setDettagli(d => ({ ...d, [id]: Array.isArray(j?.listini) ? j.listini : [] })))
      .catch(() => setDettagli(d => ({ ...d, [id]: [] })))
  }

  const input: React.CSSProperties = { width: '100%', padding: '9px 12px 9px 34px', border: '1px solid #e2e2e2', borderRadius: 9, fontSize: 13.5, outline: 'none', background: '#fff' }
  const bottoneGruppo = (attivo: boolean): React.CSSProperties => ({
    padding: '7px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 650, cursor: 'pointer',
    border: `1px solid ${attivo ? ARANCIO : '#e2e2e2'}`, background: attivo ? '#fff7ed' : '#fff', color: attivo ? '#c2410c' : '#333',
  })

  if (caricamento && !contratti.length && !errore) return <div style={{ padding: 28, color: '#888' }}>Carico i tuoi contratti…</div>
  if (errore) return <div style={{ padding: 28 }}><div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 12, padding: 16 }}>{errore}</div></div>

  return (
    <div style={{ padding: '20px 20px 40px', maxWidth: 1120, margin: '0 auto' }}>
      <h1 style={{ fontSize: 23, fontWeight: 800, margin: 0, color: '#1a1a1a' }}>Aumenta prezzi</h1>
      <p style={{ color: '#666', fontSize: 13.5, margin: '5px 0 18px', lineHeight: 1.55, maxWidth: 820 }}>
        Alza in percentuale un contratto su più listini insieme. Cambiano solo i <b>prezzi per peso e zona</b>: contrassegno,
        assicurazione, giacenze e resi restano come sono. Vale dalle prossime spedizioni, e ogni aumento si può annullare dallo storico.
      </p>

      {esito && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '12px 16px', marginBottom: 14 }}>
          <span style={{ width: 30, height: 30, borderRadius: 15, background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icona d={I.spunta} color="#fff" stroke={2.4} /></span>
          <div style={{ flex: 1, fontSize: 13.5, color: '#14532d' }}>
            <b>Fatto.</b> {esito.contratto} è salito del {percTesto(esito.percentuale)}: {plurale(esito.fasce, 'prezzo', 'prezzi')} in {plurale(esito.listini, 'listino', 'listini')}.
          </div>
          <button onClick={() => { const a = storico.find(s => s.id === esito.id); if (a) annulla(a) }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #bbf7d0', color: '#166534', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            <Icona d={I.annulla} size={14} /> Annulla
          </button>
        </div>
      )}

      {/* 1 · CONTRATTO */}
      <Passo n={1} titolo="Contratto" attivo sotto={contratto ? undefined : 'Quale contratto vuoi aumentare. Il codice accanto al nome distingue due contratti che si chiamano uguale.'}
        destra={contratto ? <button onClick={() => { contrattoCorrente.current = null; setContratto(null); setListini([]); setScelti(new Set()); setEsito(null) }} style={{ background: 'none', border: 0, color: ARANCIO, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Cambia</button> : undefined}>
        {contratto ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <LogoContratto nome={contratto.nome} />
            <div style={{ fontSize: 15, fontWeight: 750 }}>{contratto.nome}</div>
            <CodiceContratto codice={contratto.codice} />
            <span style={{ fontSize: 12.5, color: '#888' }}>in {plurale(contratto.listini, 'listino', 'listini')}</span>
          </div>
        ) : contratti.length === 0 ? (
          <div style={{ color: '#888', fontSize: 13.5 }}>Nei tuoi listini cliente non c’è ancora nessun contratto con dei prezzi.</div>
        ) : (
          <>
            <div style={{ position: 'relative', maxWidth: 360, marginBottom: 12 }}>
              <span style={{ position: 'absolute', left: 11, top: 10, color: '#aaa' }}><Icona d={I.cerca} size={15} /></span>
              <input value={cercaContratto} onChange={e => setCercaContratto(e.target.value)} placeholder="Cerca per nome o codice (CT-…)" style={input} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              {contrattiVisti.map(c => (
                <button key={c.id} onClick={() => scegliContratto(c)}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: '11px 12px', cursor: 'pointer', transition: 'border-color .12s, box-shadow .12s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#fdba74'; e.currentTarget.style.boxShadow = '0 2px 10px rgba(249,115,22,.08)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#ececec'; e.currentTarget.style.boxShadow = 'none' }}>
                  <LogoContratto nome={c.nome} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                      <CodiceContratto codice={c.codice} piccolo />
                      <span style={{ fontSize: 11.5, color: '#8a8a8a' }}>{plurale(c.listini, 'listino', 'listini')}</span>
                      {!c.attivo && <Etichetta tono="rosso">in pausa</Etichetta>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {!contrattiVisti.length && <div style={{ color: '#888', fontSize: 13 }}>Nessun contratto trovato.</div>}
          </>
        )}
      </Passo>

      {/* 2 · LISTINI */}
      <Passo n={2} titolo="Listini" attivo={!!contratto}
        sotto={contratto ? 'Scegli in quali listini aumentarlo. Accanto a ogni listino vedi chi lo usa: l’aumento vale per tutti loro.' : 'Prima scegli il contratto.'}
        destra={contratto && listini.length ? <span style={{ fontSize: 12.5, color: '#666', fontWeight: 600 }}>{scelti.size} di {listini.length} scelti</span> : undefined}>
        {!contratto ? null : caricoListini && !listini.length ? <div style={{ color: '#888', fontSize: 13.5 }}>Carico i listini…</div> : (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <button style={bottoneGruppo(gruppi.clienti.length > 0 && uguale(gruppi.clienti))} onClick={() => setScelti(new Set(gruppi.clienti))} disabled={!gruppi.clienti.length}>
                Quelli dei clienti · {gruppi.clienti.length}
              </button>
              <button style={bottoneGruppo(gruppi.rete.length > 0 && uguale(gruppi.rete))} onClick={() => setScelti(new Set(gruppi.rete))} disabled={!gruppi.rete.length}>
                Quelli dei sotto-master · {gruppi.rete.length}
              </button>
              <button style={bottoneGruppo(uguale(gruppi.tutti))} onClick={() => setScelti(new Set(gruppi.tutti))}>Tutti · {gruppi.tutti.length}</button>
              <button style={{ ...bottoneGruppo(false), color: '#888' }} onClick={() => setScelti(new Set())} disabled={!scelti.size}>Nessuno</button>
              <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320, marginLeft: 'auto' }}>
                <span style={{ position: 'absolute', left: 11, top: 10, color: '#aaa' }}><Icona d={I.cerca} size={15} /></span>
                <input value={cercaListino} onChange={e => setCercaListino(e.target.value)} placeholder="Cerca listino o cliente" style={input} />
              </div>
            </div>

            <div style={{ border: '1px solid #f0f0f0', borderRadius: 12, overflow: 'hidden' }}>
              {listiniVisti.map((l, i) => {
                const sel = scelti.has(l.id)
                const es = esempio(l)
                return (
                  <div key={l.id} style={{ borderTop: i ? '1px solid #f3f3f3' : 0, background: sel ? '#fffaf5' : '#fff' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer' }} onClick={() => cambia(l.id)}>
                      <span style={{ width: 19, height: 19, borderRadius: 6, border: `1.5px solid ${sel ? ARANCIO : '#cfcfcf'}`, background: sel ? ARANCIO : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {sel && <Icona d={I.spunta} size={13} color="#fff" stroke={2.6} />}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#1a1a1a' }}>{l.nome}</span>
                          {!l.attivo && <Etichetta tono="rosso">listino non attivo</Etichetta>}
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
                          {l.clienti.length > 0 && (
                            <Etichetta title={l.clienti.map(c => c.nome).join(', ')}>
                              <Icona d={I.persone} size={12} /> {l.clienti.length === 1 ? l.clienti[0].nome : `${plurale(l.clienti.length, 'cliente', 'clienti')}: ${l.clienti.slice(0, 2).map(c => c.nome).join(', ')}${l.clienti.length > 2 ? ` e altri ${l.clienti.length - 2}` : ''}`}
                            </Etichetta>
                          )}
                          {l.sottoMaster.map(s => <Etichetta key={s} tono="viola" title="Sotto-master: per lui è il costo. I prezzi ai suoi clienti li decide lui."><Icona d={I.rete} size={12} /> Sotto-master: {s}</Etichetta>)}
                          {l.collegati.map(s => <Etichetta key={s} tono="blu" title="Master collegato che compra da te all'ingrosso: per lui è il costo."><Icona d={I.rete} size={12} /> Collegato: {s}</Etichetta>)}
                          {!usato(l) && <span style={{ fontSize: 11.5, color: '#a3a3a3' }}>Non lo usa nessuno</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 180 }}>
                        {es ? (
                          <>
                            <div style={{ fontSize: 11.5, color: '#8a8a8a' }}>{zone[es.z] || 'zona'} · {fasciaTesto(es)}</div>
                            <div style={{ fontSize: 13.5, fontWeight: 650, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                              {euro(es.p)}
                              {perc && <><Icona d={I.freccia} size={13} color="#a3a3a3" /><span style={{ color: '#c2410c', fontWeight: 800 }}>{euro(aumentaPrezzo(es.p, perc))}</span></>}
                            </div>
                          </>
                        ) : <span style={{ fontSize: 12, color: '#aaa' }}>nessun prezzo</span>}
                      </div>
                      <button onClick={e => { e.stopPropagation(); setAperto(aperto === l.id ? null : l.id) }} title="Vedi tutti i prezzi"
                        style={{ background: aperto === l.id ? '#f5f5f4' : 'none', border: 0, borderRadius: 7, padding: 5, cursor: 'pointer', color: '#777', transform: aperto === l.id ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
                        <Icona d={I.giu} size={17} />
                      </button>
                    </div>
                    {aperto === l.id && <TabellaPrezzi fasce={l.fasce} zone={zone} perc={perc} />}
                  </div>
                )
              })}
              {!listiniVisti.length && <div style={{ padding: 16, color: '#888', fontSize: 13 }}>Nessun listino trovato.</div>}
            </div>
          </>
        )}
      </Passo>

      {/* 3 · PERCENTUALE */}
      <Passo n={3} titolo="Di quanto" attivo={!!contratto && scelti.size > 0}
        sotto={!contratto || !scelti.size ? 'Prima scegli contratto e listini.' : `Arrotondato al centesimo: € 7,10 +5% fa 7,455 → € 7,46. Solo aumenti, fino al ${PERC_MASSIMA}%.`}>
        {contratto && scelti.size > 0 && (
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'stretch' }}>
            <div style={{ flex: '0 0 auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', border: `1.5px solid ${perc ? ARANCIO : '#e2e2e2'}`, borderRadius: 12, overflow: 'hidden', width: 170, background: '#fff' }}>
                <span style={{ padding: '0 0 0 14px', fontSize: 22, fontWeight: 800, color: '#a3a3a3' }}>+</span>
                <input value={percScritta} onChange={e => setPercScritta(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" placeholder="0"
                  style={{ width: '100%', border: 0, outline: 'none', fontSize: 26, fontWeight: 800, padding: '10px 6px', textAlign: 'right', color: '#1a1a1a', background: 'transparent' }} />
                <span style={{ padding: '0 14px 0 2px', fontSize: 22, fontWeight: 800, color: '#a3a3a3' }}>%</span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                {[2, 3, 5, 10].map(p => (
                  <button key={p} onClick={() => setPercScritta(String(p))} style={{ ...bottoneGruppo(perc === p), padding: '5px 10px' }}>+{p}%</button>
                ))}
              </div>
              {percScritta && !perc && <div style={{ color: '#b91c1c', fontSize: 12.5, marginTop: 8 }}>Scrivi un aumento sopra lo 0 e al massimo del {PERC_MASSIMA}%.</div>}
            </div>

            <div style={{ flex: '1 1 380px', background: '#fafaf9', border: '1px solid #f0efee', borderRadius: 12, padding: '13px 16px', fontSize: 13.5, color: '#333', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 750, color: '#1a1a1a', marginBottom: 4 }}>
                {contratto.nome} {perc ? <>sale del <span style={{ color: '#c2410c' }}>{percTesto(perc)}</span></> : 'sale di…'}
              </div>
              <div>In <b>{plurale(sceltiListini.length, 'listino', 'listini')}</b> · {plurale(riepilogo.prezzi, 'prezzo', 'prezzi')} per peso e zona</div>
              <div>Li usano <b>{plurale(riepilogo.clienti, 'cliente', 'clienti')}</b>
                {riepilogo.sub.length > 0 && <> e i sotto-master <b>{riepilogo.sub.join(', ')}</b></>}
                {riepilogo.coll.length > 0 && <>, e i collegati <b>{riepilogo.coll.join(', ')}</b></>}</div>
              {perc && esempioGenerale?.f && (
                <div style={{ marginTop: 4 }}>Esempio · {esempioGenerale.l.nome}, {zone[esempioGenerale.f.z] || 'zona'} {fasciaTesto(esempioGenerale.f)}: {euro(esempioGenerale.f.p)} → <b style={{ color: '#c2410c' }}>{euro(aumentaPrezzo(esempioGenerale.f.p, perc))}</b></div>
              )}
              {(riepilogo.sub.length > 0 || riepilogo.coll.length > 0) && (
                <div style={{ display: 'flex', gap: 7, marginTop: 8, color: '#6d28d9', fontSize: 12.5 }}>
                  <Icona d={I.info} size={15} /> <span>Per i master della tua rete è il costo: sale anche il loro, e i prezzi ai loro clienti li ritoccano loro.</span>
                </div>
              )}
              {riepilogo.conFuel && (
                <div style={{ display: 'flex', gap: 7, marginTop: 6, color: '#666', fontSize: 12.5 }}>
                  <Icona d={I.info} size={15} /> <span>Dove c’è il fuel resta la stessa percentuale: anche il totale sale del {perc ? percTesto(perc) : 'X%'}.</span>
                </div>
              )}
              <button onClick={applica} disabled={!perc || salvando}
                style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 8, background: perc ? ARANCIO : '#e5e5e5', color: perc ? '#fff' : '#999', border: 0, borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 800, cursor: perc && !salvando ? 'pointer' : 'not-allowed', boxShadow: perc ? '0 2px 8px rgba(249,115,22,.25)' : 'none' }}>
                {salvando ? (riepilogo.sub.length || riepilogo.coll.length ? 'Applico e aggiorno la tua rete…' : 'Applico…') : perc ? `Aumenta del ${percTesto(perc)}` : 'Scrivi la percentuale'}
              </button>
            </div>
          </div>
        )}
      </Passo>

      {/* STORICO */}
      <section style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 14, marginTop: 22 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid #f3f3f3' }}>
          <Icona d={I.storico} size={18} color="#555" />
          <div style={{ fontSize: 15, fontWeight: 750 }}>Aumenti fatti</div>
          <span style={{ fontSize: 12.5, color: '#999' }}>gli ultimi 50</span>
        </header>
        {storico.length === 0 ? <div style={{ padding: '16px 18px', color: '#888', fontSize: 13.5 }}>Nessun aumento fatto finora.</div> : storico.map((a, i) => {
          const det = dettagli[a.id]
          return (
            <div key={a.id} style={{ borderTop: i ? '1px solid #f5f5f5' : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 18px', flexWrap: 'wrap' }}>
                <div style={{ width: 128, fontSize: 12.5, color: '#666' }}>{quando(a.creato_il)}</div>
                <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{a.nome_contratto}</span>
                  <CodiceContratto codice={a.codice_contratto} piccolo />
                </div>
                <div style={{ width: 70, fontSize: 14, fontWeight: 800, color: a.annullato_il ? '#a3a3a3' : '#c2410c', textDecoration: a.annullato_il ? 'line-through' : 'none' }}>+{percTesto(a.percentuale)}</div>
                <div style={{ width: 170, fontSize: 12.5, color: '#555' }}>{plurale(a.listini, 'listino', 'listini')} · {plurale(a.fasce, 'prezzo', 'prezzi')}</div>
                <div style={{ width: 130, fontSize: 12.5, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.creato_da || '—'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                  {a.annullato_il
                    ? <span title={`Annullato il ${quando(a.annullato_il)}${a.annullato_da ? ' da ' + a.annullato_da : ''}`} style={{ fontSize: 12, color: '#777', background: '#f5f5f4', borderRadius: 20, padding: '3px 10px', fontWeight: 600 }}>Annullato {quando(a.annullato_il).slice(0, 10)}</span>
                    : <span style={{ fontSize: 12, color: '#166534', background: '#f0fdf4', borderRadius: 20, padding: '3px 10px', fontWeight: 700 }}>In vigore</span>}
                  <button onClick={() => apriDettaglio(a.id)} style={{ background: 'none', border: '1px solid #e5e5e5', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 650, cursor: 'pointer', color: '#444' }}>{det ? 'Chiudi' : 'Listini'}</button>
                  {!a.annullato_il && (
                    <button onClick={() => annulla(a)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fff', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      <Icona d={I.annulla} size={13} /> Annulla
                    </button>
                  )}
                </div>
              </div>
              {a.annullato_il && (a.fasce_lasciate || 0) > 0 && (
                <div style={{ display: 'flex', gap: 7, padding: '0 18px 10px 160px', fontSize: 12, color: '#92400e' }}>
                  <Icona d={I.attenzione} size={14} /> {plurale(a.fasce_lasciate || 0, 'prezzo era stato cambiato', 'prezzi erano stati cambiati')} dopo l’aumento: {a.fasce_lasciate === 1 ? 'è rimasto' : 'sono rimasti'} com’erano.
                </div>
              )}
              {det && (
                <div style={{ padding: '0 18px 12px 160px' }}>
                  {det === 'carico' ? <span style={{ fontSize: 12.5, color: '#999' }}>Carico…</span> : (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {det.map(l => <Etichetta key={l.id}>{l.nome} · {l.fasce}</Etichetta>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}

function LogoContratto({ nome }: { nome: string }) {
  const logo = logoCorriere(nome)
  return logo
    ? <img src={logo} alt="" style={{ width: 46, height: 30, objectFit: 'contain', border: '1px solid #f0f0f0', borderRadius: 7, background: '#fff', flexShrink: 0 }} />
    : <span style={{ width: 46, height: 30, borderRadius: 7, background: '#f5f5f4', color: '#78716c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{(nome || '?').slice(0, 3).toUpperCase()}</span>
}

// Tutti i prezzi del contratto in quel listino: una riga per zona, una colonna per fascia, prima → dopo.
function TabellaPrezzi({ fasce, zone, perc }: { fasce: Fascia[]; zone: Record<string, string>; perc: number | null }) {
  const zoneIds = [...new Set(fasce.map(f => f.z))].sort((a, b) => primaItalia(zone[a] || '', zone[b] || ''))
  const colonne = [...new Map(fasce.map(f => [`${f.t}|${f.pmax}`, f])).values()]
    .sort((a, b) => (a.t === 'oltre' ? 1 : 0) - (b.t === 'oltre' ? 1 : 0) || a.pmax - b.pmax)
  const cella = (z: string, c: Fascia) => fasce.find(f => f.z === z && f.t === c.t && f.pmax === c.pmax)
  const th: React.CSSProperties = { padding: '7px 10px', fontSize: 11, fontWeight: 700, color: '#8a8a8a', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid #eee', textTransform: 'uppercase', letterSpacing: .3 }
  return (
    <div style={{ padding: '2px 14px 14px 45px', overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: '100%' }}>
        <thead><tr>
          <th style={{ ...th, textAlign: 'left' }}>Zona</th>
          {colonne.map(c => <th key={`${c.t}|${c.pmax}`} style={th}>{c.t === 'oltre' ? `oltre, ogni ${kg(c.pmax)} kg` : c.t === 'fino_a' || !c.t ? `${kg(c.pmax)} kg` : c.t}</th>)}
        </tr></thead>
        <tbody>
          {zoneIds.map(z => (
            <tr key={z}>
              <td style={{ padding: '7px 10px', fontWeight: 650, whiteSpace: 'nowrap', borderBottom: '1px solid #f5f5f5' }}>{zone[z] || 'zona'}</td>
              {colonne.map(c => {
                const f = cella(z, c)
                return (
                  <td key={`${c.t}|${c.pmax}`} style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid #f5f5f5' }}>
                    {!f ? <span style={{ color: '#d4d4d4' }}>—</span> : (
                      <>
                        <span style={{ color: perc ? '#a3a3a3' : '#1a1a1a' }}>{euro(f.p).replace('€ ', '')}</span>
                        {perc && f.p > 0 && <span style={{ color: '#c2410c', fontWeight: 750 }}> → {euro(aumentaPrezzo(f.p, perc)).replace('€ ', '')}</span>}
                        {f.fuel ? <span style={{ color: '#a3a3a3', fontSize: 11 }}> +{kg(f.fuel)}% fuel</span> : null}
                      </>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
