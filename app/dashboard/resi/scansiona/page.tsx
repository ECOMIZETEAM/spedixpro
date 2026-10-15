'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useDialog } from '@/app/components/DialogProvider'
import LettoreCodici from '@/app/components/LettoreCodici'

// SCANSIONA RESI: i pacchi tornati in sede si leggono uno dopo l'altro — fotocamera del telefono
// (Android e iPhone, anche dall'app), pistola USB o numero a mano — e si raggruppano per CLIENTE e
// CONTRATTO. Ogni gruppo diventa una distinta di reso. L'addebito parte solo quando si registra.
//
// L'elenco delle letture resta salvato sul telefono finche' non si registra: chi ha letto cinquanta
// pacchi non li perde se la pagina si ricarica o il telefono va in blocco.

const ARANCIO = '#f97316'
const NERO = '#1a1a1a'
const CHIAVE_BOZZA = 'moov_scansiona_resi_v1'

type Voce = {
  id: string; numero: string; mitt_nome?: string; dest_nome?: string; dest_citta?: string; colli?: number; stato?: string | null
  cliente_id: string | null; cliente_nome: string | null
  target_master_id: string | null; target_master_nome: string | null
  contratto: string | null; gia_addebitato_giacenza?: boolean; data_scansione: string
}
type Esito = { tipo: 'ok' | 'err' | 'info' | 'avviso'; testo: string }
type Fatta = { id: string; numero: number; destinatario: string; contratto: string; ldv: number }

// Il gruppo e' a chi va la distinta (il cliente, oppure il sotto-master per le spedizioni della sua rete)
// piu' il contratto.
// Codici che non sono mai una LDV: il CAP dell'etichetta SDA/Poste (5 cifre + "0000") e le letture
// troppo corte (nessun numero di spedizione ha meno di 9 caratteri; le letture sbagliate della fotocamera
// sono spesso di 6-8 cifre). Il lettore li ignora e continua a cercare la LDV nello stesso fotogramma.
const nonELdv = (c: string) => { const s = c.trim(); return s.length < 9 || /^\d{5}0000$/.test(s) }

// PACCO NON ANCORA PARTITO O ANNULLATO: il reso si registra lo stesso (regola di Lorenzo, 15/10/2026), ma
// chi scansiona deve saperlo, perche' il reso si paga. Caso d'origine: Wave ha letto 282343J010467 di SMAV,
// creata la mattina stessa e ancora in lavorazione. "spedita" invece vuol dire gia' in distinta o presa
// in carico dal corriere: partita.
function avvisoStato(stato?: string | null): string | null {
  if (stato === 'in_lavorazione') return 'non ancora partita (in lavorazione)'
  if (stato === 'annullata' || stato === 'annullamento_pending' || stato === 'annullamento_manuale' || stato === 'storno_richiesto') return 'spedizione annullata'
  return null
}

const chiaveGruppo = (v: Voce) => (v.target_master_id ? 'm:' + v.target_master_id : 'c:' + v.cliente_id) + '|' + (v.contratto || '')
const destinatario = (v: Voce) => v.target_master_id ? (v.target_master_nome || 'Sotto-master') : (v.cliente_nome || 'Cliente')

function leggiBozza(): Voce[] {
  try { const v = JSON.parse(localStorage.getItem(CHIAVE_BOZZA) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}

export default function ScansionaResiPage() {
  const dialog = useDialog()
  const [voci, setVoci] = useState<Voce[]>([])
  const [caricata, setCaricata] = useState(false)
  const [ldv, setLdv] = useState('')
  const [fotocamera, setFotocamera] = useState(false)
  const [esito, setEsito] = useState<Esito | null>(null)
  const [cercando, setCercando] = useState(false)
  const [registrando, setRegistrando] = useState(false)
  const [fatte, setFatte] = useState<Fatta[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const occupato = useRef(false)
  // Una lettura arrivata mentre il server risponde alla precedente: si tiene e si cerca subito dopo,
  // invece di perderla (prima: una lettura del CAP in corso faceva cadere quella della LDV).
  const inAttesa = useRef<{ codici: string[]; manuale: boolean } | null>(null)
  const vociRef = useRef<Voce[]>([])
  const audio = useRef<AudioContext | null>(null)
  const touch = useRef(false)
  const [suTelefono, setSuTelefono] = useState(false)
  // L'ultimo codice che non e' stato riconosciuto: se la fotocamera resta sul codice sbagliato (il CAP
  // dell'etichetta SDA, un codice dell'imballo) l'errore non deve suonare ogni tre secondi.
  const ultimoErrore = useRef<{ chiave: string; t: number } | null>(null)

  useEffect(() => {
    setVoci(leggiBozza()); setCaricata(true)
    touch.current = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
    setSuTelefono(touch.current)
    // Al computer la pistola USB scrive nel campo: il cursore ci deve gia' stare. Sul telefono no,
    // aprirebbe la tastiera sopra la fotocamera.
    if (!touch.current) inputRef.current?.focus()
  }, [])
  useEffect(() => {
    vociRef.current = voci
    if (!caricata) return
    try { localStorage.setItem(CHIAVE_BOZZA, JSON.stringify(voci)) } catch { /* senza memoria locale si lavora lo stesso */ }
  }, [voci, caricata])

  // Un suono per lettura: con il pacco in mano non si guarda lo schermo.
  function suona(ok: boolean) {
    try {
      const ctx = audio.current; if (!ctx) return
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.frequency.value = ok ? 880 : 220; o.type = ok ? 'sine' : 'square'
      g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination)
      o.start(); o.stop(ctx.currentTime + (ok ? 0.09 : 0.25))
      if (ok) (navigator as any).vibrate?.(60)
    } catch { /* niente audio: resta il messaggio */ }
  }
  function apriFotocamera() {
    // Safari fa suonare l'audio solo se e' stato acceso con un tocco: lo si accende qui.
    try {
      const C = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!audio.current && C) audio.current = new C()
      audio.current?.resume?.()
    } catch { /* il suono e' un di piu' */ }
    setFotocamera(f => !f)
  }

  const cerca = useCallback(async (codici: string[], manuale: boolean) => {
    if (!codici.length) return
    if (occupato.current) { inAttesa.current = { codici, manuale }; return }
    occupato.current = true; setCercando(true)
    try {
      const qs = manuale ? `ldv=${encodeURIComponent(codici[0])}` : codici.map(c => `codice=${encodeURIComponent(c)}`).join('&')
      const res = await fetch(`/api/resi?${qs}`)
      const d = await res.json().catch(() => ({ error: 'Risposta non valida' }))
      if (d.error) {
        const chiave = codici.join('|')
        const ripetuto = !manuale && ultimoErrore.current?.chiave === chiave && Date.now() - ultimoErrore.current.t < 15000
        ultimoErrore.current = { chiave, t: Date.now() }
        setEsito({ tipo: 'err', testo: d.error }); if (!ripetuto) suona(false)
        return
      }
      if (vociRef.current.some(v => v.id === d.id)) { setEsito({ tipo: 'info', testo: `${d.numero} è già nell'elenco` }); return }
      if (!d.cliente_id && !d.target_master_id) {
        setEsito({ tipo: 'err', testo: `${d.numero} è una spedizione propria senza cliente: non va in una distinta di reso` }); suona(false); return
      }
      const v: Voce = {
        id: d.id, numero: d.numero, mitt_nome: d.mitt_nome, dest_nome: d.dest_nome, dest_citta: d.dest_citta, colli: d.colli, stato: d.stato || null,
        cliente_id: d.cliente_id || null, cliente_nome: d.cliente_nome || null,
        target_master_id: d.target_master_id || null, target_master_nome: d.target_master_nome || null,
        contratto: d.contratto || null, gia_addebitato_giacenza: !!d.gia_addebitato_giacenza,
        data_scansione: new Date().toISOString(),
      }
      setVoci(prev => prev.some(x => x.id === v.id) ? prev : [v, ...prev])
      const avviso = avvisoStato(v.stato)
      setEsito({
        tipo: avviso ? 'avviso' : 'ok',
        testo: `${v.numero} · ${destinatario(v)} · ${v.contratto || 'contratto ?'}`
          + (avviso ? ` — attenzione: ${avviso}. Si può registrare come reso lo stesso.` : '')
          + (v.gia_addebitato_giacenza ? ' — già addebitato allo svincolo, non verrà riaddebitato' : ''),
      })
      suona(true)
      if (manuale) setLdv('')
    } catch {
      setEsito({ tipo: 'err', testo: 'Connessione assente: riprova' }); suona(false)
    } finally {
      occupato.current = false; setCercando(false)
      if (manuale && !touch.current) inputRef.current?.focus()
      const dopo = inAttesa.current
      if (dopo) { inAttesa.current = null; setTimeout(() => cercaRef.current(dopo.codici, dopo.manuale), 0) }
    }
  }, [])
  const cercaRef = useRef(cerca)
  cercaRef.current = cerca

  const onCodici = useCallback((codici: string[]) => { cerca(codici, false) }, [cerca])

  // Gruppi: per destinatario e contratto, in ordine di nome.
  const gruppi = (() => {
    const m = new Map<string, Voce[]>()
    for (const v of voci) { const k = chiaveGruppo(v); if (!m.has(k)) m.set(k, []); m.get(k)!.push(v) }
    return [...m.entries()].map(([k, vv]) => ({ chiave: k, voci: vv, dest: destinatario(vv[0]), rete: !!vv[0].target_master_id, contratto: vv[0].contratto || '—' }))
      .sort((a, b) => a.dest.localeCompare(b.dest) || a.contratto.localeCompare(b.contratto))
  })()

  async function registraGruppo(chiave: string): Promise<boolean> {
    const vv = vociRef.current.filter(v => chiaveGruppo(v) === chiave)
    if (!vv.length) return true
    const p = vv[0]
    const res = await fetch('/api/resi/distinte', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spedizioniIds: vv.map(v => v.id),
        clienteId: p.target_master_id ? null : p.cliente_id,
        targetMasterId: p.target_master_id,
        voci: vv.map(v => ({ id: v.id, numero: v.numero, mitt_nome: v.mitt_nome, dest_nome: v.dest_nome, dest_citta: v.dest_citta, colli: v.colli, data_scansione: v.data_scansione })),
      }),
    })
    const d = await res.json().catch(() => ({ error: 'Risposta non valida' }))
    if (d.error) { setEsito({ tipo: 'err', testo: `${destinatario(p)} · ${p.contratto || '—'}: ${d.error}` }); return false }
    setFatte(f => [{ id: d.id, numero: d.numero, destinatario: destinatario(p), contratto: p.contratto || '—', ldv: vv.length }, ...f])
    setVoci(prev => prev.filter(v => chiaveGruppo(v) !== chiave))
    return true
  }

  async function registra(chiavi: string[]) {
    const scelte = vociRef.current.filter(v => chiavi.includes(chiaveGruppo(v)))
    const n = scelte.length
    if (!n) return
    const segnalate = scelte.filter(v => avvisoStato(v.stato))
    const ok = await dialog.confirm({
      title: chiavi.length > 1 ? `Registrare ${n} resi?` : `Registrare ${n} ${n === 1 ? 'reso' : 'resi'}?`,
      message: `${chiavi.length > 1 ? `Si creano ${chiavi.length} distinte, una per cliente e contratto. ` : ''}Le spedizioni passano a "reso al mittente" e il reso viene addebitato a chi riceve la distinta (quelli già addebitati non si riaddebitano).`
        + (segnalate.length ? ` Attenzione: ${segnalate.length === 1 ? '1 spedizione non è ancora partita o è annullata' : `${segnalate.length} spedizioni non sono ancora partite o sono annullate`} (${segnalate.slice(0, 5).map(v => v.numero).join(', ')}${segnalate.length > 5 ? '…' : ''}): il reso viene addebitato lo stesso.` : ''),
      confirmText: 'Registra',
    })
    if (!ok) return
    setRegistrando(true)
    let fatti = 0
    for (const k of chiavi) if (await registraGruppo(k)) fatti++
    setRegistrando(false)
    if (fatti === chiavi.length) setEsito({ tipo: 'ok', testo: fatti > 1 ? `${fatti} distinte create` : 'Distinta creata' })
  }

  async function svuota() {
    if (!voci.length) return
    const ok = await dialog.confirm({ title: 'Svuotare l\'elenco?', message: `Tolgo ${voci.length} letture non ancora registrate. Nessun reso viene registrato né addebitato.`, confirmText: 'Svuota', danger: true })
    if (ok) setVoci([])
  }

  const coloreEsito = esito?.tipo === 'ok' ? { bg: '#f0fdf4', bd: '#bbf7d0', fg: '#15803d' }
    : esito?.tipo === 'err' ? { bg: '#fef2f2', bd: '#fecaca', fg: '#dc2626' }
    : esito?.tipo === 'avviso' ? { bg: '#fffbeb', bd: '#fcd34d', fg: '#92400e' }
    : { bg: '#f8fafc', bd: '#e2e8f0', fg: '#475569' }
  const card = { background: '#fff', borderRadius: '10px', border: '1px solid #d1d5db', marginBottom: '14px' }

  return (
    <div style={{ maxWidth: '900px' }}>
      <div style={{ marginBottom: '14px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: NERO, margin: 0 }}>Scansiona resi</h1>
        <p style={{ color: '#4b5563', fontSize: '13px', margin: '4px 0 0' }}>
          Inquadra il codice della LDV con la fotocamera, usa la pistola o scrivi il numero. I resi si raggruppano per cliente e contratto: ogni gruppo diventa una distinta.
        </p>
      </div>

      {/* LETTURA */}
      <div style={{ ...card, padding: '14px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input ref={inputRef} value={ldv} onChange={e => setLdv(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && ldv.trim()) cerca([ldv.trim()], true) }}
            placeholder="Numero LDV o tracking" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            style={{ flex: '1 1 220px', minWidth: 0, padding: '11px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '16px', color: NERO, background: '#fff', WebkitTextFillColor: NERO, colorScheme: 'light' }} />
          <button onClick={() => ldv.trim() && cerca([ldv.trim()], true)} disabled={cercando}
            style={{ padding: '11px 16px', background: ARANCIO, color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
            Aggiungi
          </button>
          {/* Sul telefono la fotocamera e' l'azione principale: prima e a tutta larghezza. Al computer resta
              prima il campo, dove scrive la pistola USB. */}
          <button onClick={apriFotocamera}
            style={{ order: suTelefono ? -1 : 0, flex: suTelefono ? '1 1 100%' : '0 0 auto', padding: suTelefono ? '14px 16px' : '11px 16px', background: fotocamera ? '#fff' : NERO, color: fotocamera ? NERO : '#fff', border: `1px solid ${NERO}`, borderRadius: '8px', fontSize: suTelefono ? '15px' : '14px', fontWeight: 700, cursor: 'pointer' }}>
            {fotocamera ? 'Chiudi fotocamera' : 'Fotocamera'}
          </button>
        </div>
        {fotocamera && (
          <div style={{ marginTop: '12px', borderRadius: '10px', overflow: 'hidden', background: '#000' }}>
            <LettoreCodici continuo onCodici={onCodici} scarta={nonELdv} altezzaMax="42dvh"
              avvisoScartati="Questo è il codice del CAP: avvicina il telefono al codice della LDV (barre più fitte)" />
          </div>
        )}
        {(esito || cercando) && (
          <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, background: coloreEsito.bg, border: `1px solid ${coloreEsito.bd}`, color: coloreEsito.fg }}>
            {cercando ? 'Cerco…' : esito?.testo}
          </div>
        )}
      </div>

      {/* RIEPILOGO */}
      {voci.length > 0 && (
        <div style={{ ...card, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', position: 'sticky', top: '56px', zIndex: 5 }}>
          <div style={{ fontSize: '14px', color: NERO }}>
            <b>{voci.length}</b> {voci.length === 1 ? 'LDV' : 'LDV'} in <b>{gruppi.length}</b> {gruppi.length === 1 ? 'gruppo' : 'gruppi'} — da registrare
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={svuota} disabled={registrando}
              style={{ padding: '9px 12px', background: '#fff', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Svuota</button>
            <button onClick={() => registra(gruppi.map(g => g.chiave))} disabled={registrando}
              style={{ padding: '9px 14px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: registrando ? 0.6 : 1 }}>
              {registrando ? 'Registro…' : gruppi.length > 1 ? `Registra tutti (${gruppi.length} distinte)` : 'Registra'}
            </button>
          </div>
        </div>
      )}

      {/* GRUPPI */}
      {gruppi.map(g => (
        <div key={g.chiave} style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '11px 14px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', background: '#fafafa' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 }}>
              {g.rete && <span style={{ background: NERO, color: '#fff', padding: '2px 7px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px' }}>RETE</span>}
              <span style={{ fontSize: '14px', fontWeight: 700, color: NERO }}>{g.dest}</span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', padding: '2px 8px', borderRadius: '999px' }}>{g.contratto}</span>
              <span style={{ fontSize: '12px', color: '#6b7280' }}>{g.voci.length} LDV</span>
            </div>
            <button onClick={() => registra([g.chiave])} disabled={registrando}
              style={{ padding: '7px 12px', background: '#fff', color: '#15803d', border: '1px solid #86efac', borderRadius: '7px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}>
              Registra
            </button>
          </div>
          {g.voci.map(v => (
            <div key={v.id} style={{ padding: '10px 14px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: ARANCIO, wordBreak: 'break-all' }}>{v.numero}</div>
                <div style={{ fontSize: '12.5px', color: NERO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v.dest_nome || '—'}{v.dest_citta ? ` · ${v.dest_citta}` : ''}
                </div>
                <div style={{ fontSize: '11.5px', color: '#6b7280' }}>
                  {v.mitt_nome ? `da ${v.mitt_nome} · ` : ''}{v.colli || 1} {Number(v.colli || 1) === 1 ? 'collo' : 'colli'} · {new Date(v.data_scansione).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                  {v.gia_addebitato_giacenza && <span style={{ marginLeft: '6px', color: '#b45309', fontWeight: 600 }}>già addebitato allo svincolo</span>}
                </div>
                {avvisoStato(v.stato) && (
                  <div style={{ marginTop: '3px', display: 'inline-block', fontSize: '11.5px', fontWeight: 700, color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '5px', padding: '1px 7px' }}>
                    {avvisoStato(v.stato)}
                  </div>
                )}
              </div>
              <button onClick={() => setVoci(prev => prev.filter(x => x.id !== v.id))} disabled={registrando} aria-label={`Togli ${v.numero}`}
                style={{ padding: '6px 10px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}>✕</button>
            </div>
          ))}
        </div>
      ))}

      {!voci.length && caricata && (
        <div style={{ ...card, padding: '30px 16px', textAlign: 'center', color: '#6b7280', fontSize: '13.5px' }}>
          Nessuna LDV letta. Apri la fotocamera e inquadra il codice a barre dell&apos;etichetta.
        </div>
      )}

      {/* DISTINTE CREATE IN QUESTA SESSIONE */}
      {fatte.length > 0 && (
        <div style={{ ...card, padding: '12px 14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: NERO, marginBottom: '8px' }}>Distinte create</div>
          {fatte.map(f => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '8px 0', borderTop: '1px solid #f3f4f6', fontSize: '13px', color: NERO }}>
              <span style={{ flex: 1, minWidth: 0 }}><b>N. {f.numero}</b> · {f.destinatario} · {f.contratto} · {f.ldv} LDV</span>
              <a href={`/dashboard/resi/distinte/${f.id}`} style={{ flexShrink: 0, color: ARANCIO, fontWeight: 600, textDecoration: 'none' }}>Apri</a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
