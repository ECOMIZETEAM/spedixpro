'use client'
import { useState, useEffect, useRef } from 'react'

// IL CIRCUITO INTERNO, DAL LATO DI CHI CI LAVORA.
//
// Cinque cose in una pagina sola perche' sono cinque momenti dello stesso mestiere: si scansiona,
// si guarda cosa deve uscire, cosa sta arrivando, com'e' andata la giornata degli autisti e chi
// sono gli autisti. Tenerle in cinque pagine diverse vorrebbe dire far navigare chi ha un lettore
// in mano e trenta pacchi da passare.
//
// La scansione e' la cosa principale: il campo e' sempre a fuoco e si svuota da solo, cosi' il
// lettore laser puo' sparare una LDV dopo l'altra senza toccare il mouse.

const ACCENT = '#f97316'
const card = { background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', overflow: 'hidden' as const }
const th = { padding: '9px 12px', fontSize: '11px', fontWeight: 700 as const, textTransform: 'uppercase' as const, color: '#666', textAlign: 'left' as const, whiteSpace: 'nowrap' as const }
const td = { padding: '9px 12px', fontSize: '12.5px', color: '#1a1a1a', borderTop: '1px solid #f0f0f0' }
const inp = { padding: '9px 11px', fontSize: '13px', border: '1px solid #d5d5d5', borderRadius: '6px', outline: 'none', color: '#1a1a1a', background: '#fff' }

const TIPI: [string, string, string][] = [
  ['ritiro', 'Ritiro dal mittente', 'Il pacco lascia il cliente'],
  ['ingresso', 'Ingresso in deposito', 'Arrivato in sede'],
  ['partenza', 'Partenza dalla sede', 'Parte per un’altra filiale'],
  ['arrivo', 'Arrivo in filiale', 'Ricevuto dalla filiale di destinazione'],
  ['consegna', 'Consegna', 'Consegnato al destinatario'],
  ['tentata', 'Consegna tentata', 'Destinatario assente'],
  ['giacenza', 'Giacenza', 'Resta fermo in deposito'],
]

// Il motivo com'e' scritto in archivio -> come si dice a chi legge.
const MOTIVO_PAROLA: Record<string, string> = {
  assente: 'destinatario assente', indirizzo: 'indirizzo errato', rifiutata: 'rifiutata dal destinatario',
  sconosciuto: 'destinatario sconosciuto', non_riuscita: 'non riuscita',
}

const STATI: Record<string, { t: string; c: string }> = {
  in_lavorazione: { t: 'Da ritirare', c: '#8a8a8a' },
  spedita: { t: 'Ritirata', c: '#2563eb' },
  in_transito: { t: 'In transito', c: '#2563eb' },
  in_consegna: { t: 'In consegna', c: '#d97706' },
  in_giacenza: { t: 'In giacenza', c: '#dc2626' },
  consegnata: { t: 'Consegnata', c: '#16a34a' },
  non_consegnato: { t: 'Non consegnata', c: '#dc2626' },
  reso_mittente: { t: 'Reso al mittente', c: '#7c3aed' },
}

const TAB_VALIDE = ['scansiona', 'partenza', 'arrivo', 'consegne', 'autisti'] as const
type Tab = typeof TAB_VALIDE[number]

export default function CircuitoInternoPage() {
  // La scheda si puo' aprire dall'indirizzo (?tab=autisti): serve alla voce di menu "Autisti e
  // Consegne", che porta qui invece di avere una pagina sua con dentro le stesse cose.
  // Si legge al PRIMO disegno, non dopo: leggendola dopo si vedeva comparire la scheda Scansiona
  // e poi saltare a quella giusta, che sembra un difetto anche quando non lo e'.
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'scansiona'
    const t = new URLSearchParams(window.location.search).get('tab') as Tab
    return t && (TAB_VALIDE as readonly string[]).includes(t) ? t : 'scansiona'
  })
  return (
    <div>
      <div style={{ marginBottom: '18px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Circuito interno</h1>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>
          I pacchi che viaggiano sulla tua rete: li ritiri, li smisti e li consegni tu.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {([['scansiona', 'Scansiona'], ['partenza', 'In partenza'], ['arrivo', 'In arrivo'], ['consegne', 'Consegne'], ['autisti', 'Autisti']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k as any)}
            style={{
              padding: '8px 14px', fontSize: '13px', fontWeight: 600, borderRadius: '6px', cursor: 'pointer',
              border: tab === k ? `1px solid ${ACCENT}` : '1px solid #e8e8e8',
              background: tab === k ? ACCENT : '#fff', color: tab === k ? '#fff' : '#1a1a1a',
            }}>{l}</button>
        ))}
      </div>

      {tab === 'scansiona' && <Scansiona />}
      {(tab === 'partenza' || tab === 'arrivo') && <Elenco vista={tab} />}
      {tab === 'consegne' && <Consegne />}
      {tab === 'autisti' && <Autisti />}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────────────────────
function Scansiona() {
  const [tipo, setTipo] = useState('ingresso')
  const [autisti, setAutisti] = useState<any[]>([])
  const [autistaId, setAutistaId] = useState('')
  const [filiale, setFiliale] = useState('')
  const [ldv, setLdv] = useState('')
  const [righe, setRighe] = useState<any[]>([])
  const [inCorso, setInCorso] = useState(false)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/interno/autisti').then(r => r.json()).then(d => setAutisti((d?.autisti || []).filter((a: any) => a.attivo))).catch(() => { })
  }, [])
  useEffect(() => { campo.current?.focus() }, [tipo])

  async function spara(codice: string) {
    const c = codice.trim()
    if (!c || inCorso) return
    setInCorso(true)
    try {
      const r = await fetch('/api/interno/scansione', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ldv: c, tipo, autistaId: autistaId || null, filiale: filiale || null }),
      })
      const d = await r.json()
      setRighe(p => [{ ...d, ldv: c, ora: new Date().toLocaleTimeString('it-IT') }, ...p].slice(0, 200))
    } catch {
      setRighe(p => [{ error: 'Rete non raggiungibile', ldv: c, ora: new Date().toLocaleTimeString('it-IT') }, ...p])
    }
    setInCorso(false)
    setLdv('')
    campo.current?.focus()
  }

  const ok = righe.filter(r => r.ok).length
  const ko = righe.filter(r => r.error).length

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,340px) minmax(0,1fr)', gap: '16px', alignItems: 'start' }}>
      <div style={{ ...card, padding: '16px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>Cosa stai scansionando</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
          {TIPI.map(([k, l, d]) => (
            <label key={k} style={{
              display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '8px 10px', cursor: 'pointer',
              border: tipo === k ? `1px solid ${ACCENT}` : '1px solid #eee', borderRadius: '6px',
              background: tipo === k ? '#fff7ed' : '#fff',
            }}>
              <input type="radio" name="tipo" checked={tipo === k} onChange={() => setTipo(k)} style={{ marginTop: '2px' }} />
              <span>
                <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{l}</span>
                <span style={{ display: 'block', fontSize: '11.5px', color: '#8a8a8a' }}>{d}</span>
              </span>
            </label>
          ))}
        </div>

        {(tipo === 'consegna' || tipo === 'tentata' || tipo === 'ritiro') && (
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', fontSize: '11.5px', color: '#666', marginBottom: '4px' }}>Autista</label>
            <select value={autistaId} onChange={e => setAutistaId(e.target.value)} style={{ ...inp, width: '100%' }}>
              <option value="">— nessuno —</option>
              {autisti.map(a => <option key={a.id} value={a.id}>{a.nome}{a.zone?.nome ? ` · ${a.zone.nome}` : ''}</option>)}
            </select>
          </div>
        )}
        {(tipo === 'partenza' || tipo === 'arrivo') && (
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', fontSize: '11.5px', color: '#666', marginBottom: '4px' }}>
              {tipo === 'partenza' ? 'Filiale di destinazione' : 'Filiale che riceve'}
            </label>
            <input value={filiale} onChange={e => setFiliale(e.target.value)} placeholder="es. Napoli Est" style={{ ...inp, width: '100%' }} />
          </div>
        )}
      </div>

      <div>
        <div style={{ ...card, padding: '16px', marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#1a1a1a', marginBottom: '6px' }}>
            Lettera di vettura
          </label>
          <input
            ref={campo} value={ldv} autoFocus
            onChange={e => setLdv(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); spara(ldv) } }}
            placeholder="spara il codice a barre, oppure scrivilo e premi Invio"
            style={{ ...inp, width: '100%', fontSize: '17px', padding: '13px 14px', letterSpacing: '0.5px' }}
          />
          <div style={{ display: 'flex', gap: '14px', marginTop: '10px', fontSize: '12px', color: '#666', flexWrap: 'wrap' }}>
            <span>Lette: <strong style={{ color: '#1a1a1a' }}>{righe.length}</strong></span>
            <span>Registrate: <strong style={{ color: '#16a34a' }}>{ok}</strong></span>
            {ko > 0 && <span>Non riuscite: <strong style={{ color: '#dc2626' }}>{ko}</strong></span>}
            {righe.length > 0 && <button onClick={() => setRighe([])} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: ACCENT, fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>Svuota elenco</button>}
          </div>
        </div>

        <div style={card}>
          {righe.length === 0 ? (
            <div style={{ padding: '46px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>
              Nessuna lettura. Il campo qui sopra è già pronto: spara pure.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#fafafa' }}>
                  <th style={th}>Ora</th><th style={th}>LDV</th><th style={th}>Destinatario</th><th style={th}>Esito</th>
                </tr></thead>
                <tbody>
                  {righe.map((r, i) => (
                    <tr key={i}>
                      <td style={{ ...td, color: '#8a8a8a', whiteSpace: 'nowrap' }}>{r.ora}</td>
                      <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.numero || r.ldv}</td>
                      <td style={td}>
                        {r.destinatario || '—'}
                        {r.destinazione ? <span style={{ color: '#8a8a8a' }}> · {r.destinazione}</span> : null}
                        {r.contrassegno > 0 ? <span style={{ marginLeft: '8px', background: '#1a1a1a', color: '#fff', borderRadius: '4px', padding: '1px 6px', fontSize: '11px', fontWeight: 700 }}>COD € {Number(r.contrassegno).toFixed(2)}</span> : null}
                      </td>
                      <td style={td}>
                        {r.error
                          ? <span style={{ color: '#dc2626', fontWeight: 600 }}>✕ {r.error}</span>
                          : r.ripetuta
                            ? <span style={{ color: '#d97706', fontWeight: 600 }}>già letta poco fa</span>
                            : <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ {r.descrizione}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────────────────────
function Elenco({ vista }: { vista: 'partenza' | 'arrivo' }) {
  const [dati, setDati] = useState<any>(null)
  useEffect(() => {
    setDati(null)
    fetch(`/api/interno/spedizioni?vista=${vista}`).then(r => r.json()).then(setDati).catch(() => setDati({ righe: [] }))
  }, [vista])

  if (!dati) return <div style={{ ...card, padding: '40px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>Caricamento…</div>
  if (dati.senzaContratto) return <SenzaContratto />
  const righe = dati.righe || []
  if (!righe.length) return <div style={{ ...card, padding: '46px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>
    {vista === 'partenza' ? 'Niente da far uscire.' : 'Niente in arrivo.'}
  </div>

  return (
    <div style={card}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#fafafa' }}>
            <th style={th}>LDV</th><th style={th}>Cliente</th><th style={th}>Destinatario</th>
            <th style={th}>Colli</th><th style={th}>Contrassegno</th><th style={th}>Stato</th>
          </tr></thead>
          <tbody>
            {righe.map((s: any) => (
              <tr key={s.id}>
                <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{s.numero}</td>
                <td style={td}>{s.clienti?.ragione_sociale || '—'}</td>
                <td style={td}>{s.dest_nome}<span style={{ color: '#8a8a8a' }}> · {s.dest_cap} {s.dest_citta} {s.dest_provincia ? `(${s.dest_provincia})` : ''}</span></td>
                <td style={td}>{s.colli}</td>
                <td style={td}>{Number(s.contrassegno) > 0 ? `€ ${Number(s.contrassegno).toFixed(2)}` : '—'}</td>
                <td style={td}><span style={{ color: STATI[s.stato]?.c || '#666', fontWeight: 600 }}>{STATI[s.stato]?.t || s.stato}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────────────────────
function Consegne() {
  const [giorno, setGiorno] = useState(new Date().toISOString().slice(0, 10))
  const [dati, setDati] = useState<any>(null)
  useEffect(() => {
    setDati(null)
    fetch(`/api/interno/spedizioni?vista=consegne&giorno=${giorno}`).then(r => r.json()).then(setDati).catch(() => setDati({ righe: [] }))
  }, [giorno])

  const righe = dati?.righe || []
  // Raggruppate per autista: la domanda vera e' "com'e' andata la giornata di ciascuno".
  const perAutista = new Map<string, any[]>()
  for (const r of righe) {
    const k = r.autisti?.nome || 'Senza autista'
    if (!perAutista.has(k)) perAutista.set(k, [])
    perAutista.get(k)!.push(r)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        <label style={{ fontSize: '12.5px', color: '#666' }}>Giornata</label>
        <input type="date" value={giorno} onChange={e => setGiorno(e.target.value)} style={inp} />
      </div>
      {!dati ? <div style={{ ...card, padding: '40px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>Caricamento…</div>
        : dati.senzaContratto ? <SenzaContratto />
          : !righe.length ? <div style={{ ...card, padding: '46px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>Nessuna consegna registrata in questa giornata.</div>
            : [...perAutista.entries()].map(([nome, arr]) => {
              const fatte = arr.filter((r: any) => r.tipo === 'consegna').length
              const mancate = arr.length - fatte
              return (
                <div key={nome} style={{ ...card, marginBottom: '12px' }}>
                  <div style={{ padding: '11px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#1a1a1a' }}>{nome}</span>
                    <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: 600 }}>{fatte} consegnate</span>
                    {mancate > 0 && <span style={{ fontSize: '12px', color: '#d97706', fontWeight: 600 }}>{mancate} non riuscite</span>}
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr style={{ background: '#fafafa' }}>
                        <th style={th}>Ora</th><th style={th}>LDV</th><th style={th}>Destinatario</th><th style={th}>Esito</th>
                      </tr></thead>
                      <tbody>
                        {arr.map((r: any) => (
                          <tr key={r.id}>
                            <td style={{ ...td, color: '#8a8a8a', whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</td>
                            <td style={{ ...td, fontWeight: 600 }}>{r.spedizioni?.numero || '—'}</td>
                            <td style={td}>{r.spedizioni?.dest_nome || '—'}<span style={{ color: '#8a8a8a' }}> · {r.spedizioni?.dest_cap} {r.spedizioni?.dest_citta}</span></td>
                            <td style={td}>
                              {r.tipo === 'consegna'
                                ? <span style={{ color: '#16a34a', fontWeight: 600 }}>consegnata{r.ricevente ? <span style={{ color: '#666', fontWeight: 400 }}> a {r.ricevente}</span> : null}</span>
                                : <span style={{ color: '#d97706', fontWeight: 600 }}>{MOTIVO_PAROLA[r.motivo] || 'non riuscita'}</span>}
                              {r.pod_path ? <a href={`/api/file?s=${r.id}`} target="_blank" rel="noreferrer"
                                style={{ marginLeft: '8px', color: ACCENT, fontSize: '12px', fontWeight: 700, textDecoration: 'none' }}>
                                {r.pod_tipo === 'firma' ? 'firma' : 'foto'}
                              </a> : null}
                              {r.lat && r.lng ? <a href={`https://maps.google.com/?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer"
                                style={{ marginLeft: '8px', color: '#8a8a8a', fontSize: '12px', fontWeight: 600, textDecoration: 'none' }}>dove</a> : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────────────────────
function Autisti() {
  const [dati, setDati] = useState<any>({ autisti: [], zone: [] })
  const [caricando, setCaricando] = useState(true)
  const [form, setForm] = useState<any>(null)
  const [msg, setMsg] = useState('')

  async function carica() {
    setCaricando(true)
    const d = await fetch('/api/interno/autisti').then(r => r.json()).catch(() => null)
    if (d && !d.error) setDati(d)
    setCaricando(false)
  }
  useEffect(() => { carica() }, [])

  async function salva() {
    setMsg('')
    const r = await fetch('/api/interno/autisti', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    })
    const d = await r.json()
    if (d?.error) { setMsg(d.error); return }
    setForm(null); carica()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '12.5px', color: '#666', maxWidth: '620px' }}>
          Ogni autista lavora su una zona: è da lì che gli arrivano ritiri e consegne. Le zone sono le stesse che usi per i prezzi.
        </div>
        <button onClick={() => setForm({ nome: '', telefono: '', email: '', zona_id: '', note: '', attivo: true })}
          style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: '6px', padding: '9px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
          Nuovo autista
        </button>
      </div>

      {form && (
        <div style={{ ...card, padding: '16px', marginBottom: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '10px' }}>
            <div><label style={{ display: 'block', fontSize: '11.5px', color: '#666', marginBottom: '4px' }}>Nome e cognome *</label>
              <input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} style={{ ...inp, width: '100%' }} /></div>
            <div><label style={{ display: 'block', fontSize: '11.5px', color: '#666', marginBottom: '4px' }}>Telefono</label>
              <input value={form.telefono || ''} onChange={e => setForm({ ...form, telefono: e.target.value })} style={{ ...inp, width: '100%' }} /></div>
            <div><label style={{ display: 'block', fontSize: '11.5px', color: '#666', marginBottom: '4px' }}>Email</label>
              <input value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} style={{ ...inp, width: '100%' }} /></div>
            <div><label style={{ display: 'block', fontSize: '11.5px', color: '#666', marginBottom: '4px' }}>Zona</label>
              <select value={form.zona_id || ''} onChange={e => setForm({ ...form, zona_id: e.target.value })} style={{ ...inp, width: '100%' }}>
                <option value="">— nessuna —</option>
                {(dati.zone || []).map((z: any) => <option key={z.id} value={z.id}>{z.nome}</option>)}
              </select></div>
          </div>
          {msg && <div style={{ color: '#dc2626', fontSize: '12.5px', marginTop: '10px' }}>{msg}</div>}
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={salva} style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: '6px', padding: '9px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Salva</button>
            <button onClick={() => { setForm(null); setMsg('') }} style={{ background: '#fff', color: '#555', border: '1px solid #d5d5d5', borderRadius: '6px', padding: '9px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Annulla</button>
          </div>
        </div>
      )}

      <div style={card}>
        {caricando ? <div style={{ padding: '40px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>Caricamento…</div>
          : !(dati.autisti || []).length ? <div style={{ padding: '46px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>Nessun autista registrato.</div>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: '#fafafa' }}>
                    <th style={th}>Autista</th><th style={th}>Zona</th><th style={th}>Telefono</th><th style={th}>Stato</th><th style={th}></th>
                  </tr></thead>
                  <tbody>
                    {(dati.autisti || []).map((a: any) => (
                      <tr key={a.id} style={{ opacity: a.attivo ? 1 : 0.5 }}>
                        <td style={{ ...td, fontWeight: 600 }}>{a.nome}</td>
                        <td style={td}>{a.zone?.nome || '—'}</td>
                        <td style={td}>{a.telefono || '—'}</td>
                        <td style={td}>{a.attivo
                          ? <span style={{ color: '#16a34a', fontWeight: 600 }}>attivo</span>
                          : <span style={{ color: '#8a8a8a', fontWeight: 600 }}>non attivo</span>}</td>
                        <td style={{ ...td, textAlign: 'right' as const, whiteSpace: 'nowrap' }}>
                          <button onClick={() => setForm({ ...a, zona_id: a.zona_id || '' })}
                            style={{ background: 'none', border: 'none', color: ACCENT, fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}>Modifica</button>
                          <button onClick={async () => {
                            await fetch('/api/interno/autisti', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...a, zona_id: a.zona_id || null, attivo: !a.attivo }) })
                            carica()
                          }} style={{ background: 'none', border: 'none', color: '#8a8a8a', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', marginLeft: '10px' }}>
                            {a.attivo ? 'Disattiva' : 'Riattiva'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </div>
    </div>
  )
}

function SenzaContratto() {
  return (
    <div style={{ ...card, padding: '40px', textAlign: 'center' }}>
      <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a', marginBottom: '6px' }}>Non hai ancora un circuito interno</div>
      <div style={{ fontSize: '13px', color: '#666', marginBottom: '16px', lineHeight: 1.6 }}>
        Crealo dai Corrieri: da lì imposti le zone di consegna e i prezzi, come per ogni altro contratto.
      </div>
      <a href="/dashboard/corrieri/aggiungi?tipo=interno"
        style={{ background: ACCENT, color: '#fff', textDecoration: 'none', borderRadius: '6px', padding: '10px 18px', fontSize: '13px', fontWeight: 700 }}>
        Crea il circuito interno
      </a>
    </div>
  )
}
