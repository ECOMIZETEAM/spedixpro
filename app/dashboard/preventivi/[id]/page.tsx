'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

// EDITOR PREVENTIVO (Fase 2 + prezzi completi): dettagli + sezioni customizzabili + PREZZI = listino
// completo (tutte le zone + supplementi) compilato con l'editor listini, + anteprima brandizzata dal vivo.

const inp: any = { width: '100%', padding: '9px 11px', border: '1px solid #d5d5d5', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', background: '#fff', boxSizing: 'border-box' }
const lbl: any = { fontSize: '12px', fontWeight: 700, color: '#1a1a1a', display: 'block', marginBottom: '4px' }
const card: any = { background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', padding: '16px', marginBottom: '14px' }
const miniBtn: any = { background: '#f4f4f5', color: '#3f3f46', border: '1px solid #e4e4e7', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }
const eur = (n: any) => `€ ${Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const uid = () => (globalThis.crypto?.randomUUID?.() || String(Math.random()).slice(2))

type Sezione = { id: string; titolo: string; testo: string }

export default function EditorPreventivo() {
  const { id } = useParams()
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const [stato, setStato] = useState('bozza')

  const [brand, setBrand] = useState<any>({})
  const [prezzi, setPrezzi] = useState<any>({ corrieri: [] })
  const [listinoId, setListinoId] = useState<string | null>(null)
  const [destTipo, setDestTipo] = useState('cliente_nuovo')
  const [destNome, setDestNome] = useState('')
  const [destEmail, setDestEmail] = useState('')
  const [oggetto, setOggetto] = useState('')
  const [validoFino, setValidoFino] = useState('')
  const [sezioni, setSezioni] = useState<Sezione[]>([])

  function carica() {
    fetch(`/api/preventivi/${id}`).then(r => r.json()).then(d => {
      if (d?.error) { setMsg({ t: 'err', x: d.error }); setLoading(false); return }
      const p = d.preventivo || {}
      setStato(p.stato || 'bozza'); setBrand(d.branding || {}); setPrezzi(d.prezzi || { corrieri: [] }); setListinoId(p.listino_template_id || null)
      setDestTipo(p.dest_tipo || 'cliente_nuovo'); setDestNome(p.dest_nome || ''); setDestEmail(p.dest_email || '')
      setOggetto(p.oggetto || ''); setValidoFino(p.valido_fino || '')
      const c = p.contenuto || {}
      setSezioni(Array.isArray(c.sezioni) ? c.sezioni : [])
      setLoading(false)
    }).catch(() => { setMsg({ t: 'err', x: 'Errore nel caricamento' }); setLoading(false) })
  }
  useEffect(() => { carica() }, [id])

  // ── Sezioni ──
  function aggiungiSezione(preset?: 'termini' | 'contatti') {
    const contatti = [brand.nome, brand.indirizzo && `${brand.indirizzo}, ${brand.cap || ''} ${brand.citta || ''} ${brand.provincia ? '(' + brand.provincia + ')' : ''}`, brand.telefono && `Tel: ${brand.telefono}`, brand.email && `Email: ${brand.email}`, brand.pec && `PEC: ${brand.pec}`, (brand.partita_iva || brand.piva) && `P.IVA: ${brand.partita_iva || brand.piva}`].filter(Boolean).join('\n')
    const s: Sezione = preset === 'termini' ? { id: uid(), titolo: 'Termini e Condizioni', testo: '' }
      : preset === 'contatti' ? { id: uid(), titolo: 'Contatti', testo: contatti }
        : { id: uid(), titolo: '', testo: '' }
    setSezioni(prev => [...prev, s])
  }
  const setSez = (i: number, patch: Partial<Sezione>) => setSezioni(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  const togliSez = (i: number) => setSezioni(prev => prev.filter((_, idx) => idx !== i))
  const muoviSez = (i: number, d: number) => setSezioni(prev => { const a = [...prev]; const j = i + d; if (j < 0 || j >= a.length) return prev;[a[i], a[j]] = [a[j], a[i]]; return a })

  async function salva(silenzioso = false): Promise<boolean> {
    if (!silenzioso) setSalvando(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/preventivi/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dest_tipo: destTipo, dest_nome: destNome, dest_email: destEmail, oggetto, valido_fino: validoFino || null, contenuto: { sezioni } }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d?.error) { setMsg({ t: 'err', x: d?.error || 'Salvataggio non riuscito' }); return false }
      if (!silenzioso) setMsg({ t: 'ok', x: 'Preventivo salvato.' })
      return true
    } catch { setMsg({ t: 'err', x: 'Errore di rete' }); return false }
    finally { if (!silenzioso) setSalvando(false) }
  }

  async function invia() {
    if (!destEmail.trim()) { setMsg({ t: 'err', x: 'Inserisci l\'email del destinatario' }); return }
    setSalvando(true)
    const ok = await salva(true)
    if (!ok) { setSalvando(false); return }
    try {
      const res = await fetch(`/api/preventivi/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ azione: 'invia', email: destEmail.trim() }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d?.error) { setMsg({ t: 'err', x: d?.error || 'Invio non riuscito' }); setSalvando(false); return }
      setStato('inviato'); setMsg({ t: 'ok', x: 'Preventivo inviato via email al cliente.' })
    } catch { setMsg({ t: 'err', x: 'Errore di rete' }) } finally { setSalvando(false) }
  }

  // Prezzi = listino completo: salvo prima (per non perdere le sezioni), poi vado all'editor listini.
  async function apriListino() {
    setSalvando(true)
    const ok = await salva(true)
    if (!ok) { setSalvando(false); return }
    let lid = listinoId
    if (!lid) {
      const res = await fetch(`/api/preventivi/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ azione: 'crea_listino' }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d?.error) { setMsg({ t: 'err', x: d?.error || 'Errore creazione listino' }); setSalvando(false); return }
      lid = d.listino_id
    }
    window.location.href = `/dashboard/listini/clienti/${lid}?preventivo=${id}`
  }

  const colP = brand.colore_primario || '#f97316'
  const colS = brand.colore_secondario || '#1a1a1a'
  const corrieri = prezzi?.corrieri || []

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>Caricamento…</div>

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <div>
          <a href="/dashboard/preventivi" style={{ fontSize: '12.5px', color: '#f97316', textDecoration: 'none' }}>← Preventivi</a>
          <h1 style={{ fontSize: '19px', fontWeight: 700, color: '#1a1a1a', margin: '4px 0 0' }}>Modifica preventivo</h1>
        </div>
        <div style={{ display: 'inline-flex', gap: '10px', alignItems: 'center' }}>
          {stato === 'accettato' && <span style={{ background: '#dcfce7', color: '#15803d', fontSize: '12px', fontWeight: 700, padding: '5px 12px', borderRadius: '20px' }}>✅ Accettato</span>}
          <button onClick={() => salva()} disabled={salvando || stato === 'accettato'} style={{ background: '#fff', color: '#1a1a1a', border: '1px solid #ddd', borderRadius: '8px', padding: '10px 18px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: salvando ? 0.6 : 1 }}>{salvando ? 'Salvo…' : '💾 Salva'}</button>
          <button onClick={invia} disabled={salvando || stato === 'accettato' || corrieri.length === 0} title={corrieri.length === 0 ? 'Compila prima i prezzi' : 'Invia via email al cliente'} style={{ background: '#f97316', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: (salvando || stato === 'accettato' || corrieri.length === 0) ? 0.5 : 1 }}>📤 Invia al cliente</button>
        </div>
      </div>
      {msg && <div style={{ background: msg.t === 'ok' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msg.t === 'ok' ? '#bbf7d0' : '#fecaca'}`, color: msg.t === 'ok' ? '#15803d' : '#b91c1c', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '14px' }}>{msg.x}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '20px', alignItems: 'start' }}>
        {/* ── EDITOR ── */}
        <div>
          <div style={card}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a', marginBottom: '12px' }}>Dettagli</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <div><label style={lbl}>A chi</label>
                <select value={destTipo} onChange={e => setDestTipo(e.target.value)} style={inp}>
                  <option value="cliente_nuovo">Cliente nuovo</option><option value="cliente">Cliente esistente</option><option value="master">Sotto-master</option>
                </select>
              </div>
              <div><label style={lbl}>Valido fino al</label><input type="date" value={validoFino || ''} onChange={e => setValidoFino(e.target.value)} style={inp} /></div>
              <div><label style={lbl}>Nome destinatario</label><input value={destNome} onChange={e => setDestNome(e.target.value)} style={inp} /></div>
              <div><label style={lbl}>Email</label><input type="email" value={destEmail} onChange={e => setDestEmail(e.target.value)} style={inp} /></div>
            </div>
            <label style={lbl}>Oggetto</label><input value={oggetto} onChange={e => setOggetto(e.target.value)} style={inp} />
          </div>

          {/* Prezzi = listino completo */}
          <div style={card}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a', marginBottom: '6px' }}>Prezzi — listino completo</div>
            <p style={{ fontSize: '12.5px', color: '#666', margin: '0 0 12px' }}>I prezzi si compilano come un listino vero: <b>tutte le zone</b> (Italia, SCS, Zone Disagiate, Isole…) e i <b>supplementi</b> (contrassegno, assicurazione, sponda…). All'accettazione diventano il listino del cliente.</p>
            <button onClick={apriListino} disabled={salvando} style={{ background: '#f97316', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 18px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: salvando ? 0.6 : 1 }}>
              {corrieri.length ? '✎ Modifica prezzi (listino completo)' : '＋ Compila i prezzi (listino completo)'}
            </button>
            {corrieri.length > 0 && <div style={{ marginTop: '10px', fontSize: '12px', color: '#15803d' }}>✓ {corrieri.length} corriere{corrieri.length > 1 ? 'i' : ''} impostat{corrieri.length > 1 ? 'i' : 'o'} — vedi l'anteprima a destra.</div>}
            <div style={{ marginTop: '8px', fontSize: '11.5px', color: '#999' }}>Salvo il preventivo e apro l'editor listini; poi torni qui col link in alto.</div>
          </div>

          {/* Sezioni */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '6px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Sezioni</div>
              <div style={{ display: 'inline-flex', gap: '6px' }}>
                <button onClick={() => aggiungiSezione()} style={miniBtn}>+ Testo</button>
                <button onClick={() => aggiungiSezione('termini')} style={miniBtn}>+ Termini</button>
                <button onClick={() => aggiungiSezione('contatti')} style={miniBtn}>+ Contatti</button>
              </div>
            </div>
            {sezioni.length === 0 ? <div style={{ color: '#999', fontSize: '12.5px' }}>Aggiungi sezioni: presentazione, termini e condizioni, contatti, note…</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {sezioni.map((s, i) => (
                  <div key={s.id} style={{ border: '1px solid #eee', borderRadius: '6px', padding: '10px' }}>
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                      <input value={s.titolo} onChange={e => setSez(i, { titolo: e.target.value })} placeholder="Titolo sezione" style={{ ...inp, fontWeight: 700 }} />
                      <button onClick={() => muoviSez(i, -1)} title="Su" style={miniBtn}>↑</button>
                      <button onClick={() => muoviSez(i, 1)} title="Giù" style={miniBtn}>↓</button>
                      <button onClick={() => togliSez(i)} title="Togli" style={{ ...miniBtn, color: '#b91c1c' }}>🗑</button>
                    </div>
                    <textarea value={s.testo} onChange={e => setSez(i, { testo: e.target.value })} placeholder="Testo…" rows={3} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── ANTEPRIMA BRANDIZZATA ── */}
        <div style={{ position: 'sticky', top: '16px' }}>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '6px', fontWeight: 700, textTransform: 'uppercase' }}>Anteprima (come la vede il cliente)</div>
          <div style={{ border: '1px solid #e2e2e2', borderRadius: '10px', overflow: 'hidden', background: '#fff', boxShadow: '0 6px 24px rgba(0,0,0,.06)' }}>
            <div style={{ background: colS, color: '#fff', padding: '18px 22px', display: 'flex', alignItems: 'center', gap: '14px' }}>
              {brand.logo_url ? <img src={brand.logo_url} alt="logo" style={{ maxHeight: '42px', maxWidth: '180px', objectFit: 'contain' }} /> : <div style={{ fontSize: '20px', fontWeight: 800 }}>{brand.nome || 'La tua azienda'}</div>}
              <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: '11.5px', opacity: .85 }}>Preventivo{validoFino ? <><br />valido fino al {new Date(validoFino).toLocaleDateString('it-IT')}</> : null}</div>
            </div>
            <div style={{ padding: '22px' }}>
              <div style={{ fontSize: '17px', fontWeight: 800, color: colS }}>{oggetto || 'Preventivo di spedizione'}</div>
              {destNome && <div style={{ fontSize: '13px', color: '#555', marginTop: '2px' }}>Per: <b>{destNome}</b></div>}

              {corrieri.length === 0 && <div style={{ marginTop: '16px', fontSize: '12.5px', color: '#aaa' }}>Compila i prezzi per vederli qui (tutte le zone + supplementi).</div>}

              {corrieri.map((c: any, i: number) => (
                <div key={i} style={{ marginTop: '18px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: colS, borderBottom: `2px solid ${colP}`, paddingBottom: '4px', marginBottom: '6px' }}>{c.nome}</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px', minWidth: `${120 + (c.zone?.length || 1) * 70}px` }}>
                      <thead><tr>
                        <th style={{ textAlign: 'left', padding: '4px 6px', color: '#888', fontWeight: 700, borderBottom: '1px solid #eee' }}>Peso</th>
                        {(c.zone || []).map((z: string) => <th key={z} style={{ textAlign: 'right', padding: '4px 6px', color: '#888', fontWeight: 700, borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }}>{z}</th>)}
                      </tr></thead>
                      <tbody>
                        {(c.fasce || []).map((f: any, j: number) => (
                          <tr key={j} style={{ borderBottom: '1px solid #f4f4f4' }}>
                            <td style={{ padding: '4px 6px', color: '#333', whiteSpace: 'nowrap' }}>{f.label}</td>
                            {(c.zone || []).map((z: string) => <td key={z} style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{f.prezzi?.[z] != null ? eur(f.prezzi[z]) : '—'}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {(c.supplementi || []).length > 0 && (
                    <div style={{ marginTop: '6px', fontSize: '11.5px', color: '#555' }}>
                      {c.supplementi.map((s: any, k: number) => <span key={k} style={{ marginRight: '12px' }}><b>{s.nome}:</b> {s.dettaglio || '—'}</span>)}
                    </div>
                  )}
                </div>
              ))}

              {sezioni.filter(s => s.titolo || s.testo).map(s => (
                <div key={s.id} style={{ marginTop: '18px' }}>
                  {s.titolo && <div style={{ fontSize: '14px', fontWeight: 700, color: colS, marginBottom: '4px' }}>{s.titolo}</div>}
                  <div style={{ fontSize: '12.5px', color: '#444', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{s.testo}</div>
                </div>
              ))}

              <div style={{ marginTop: '22px', textAlign: 'center' }}>
                <span style={{ background: colP, color: '#fff', borderRadius: '8px', padding: '10px 22px', fontSize: '13px', fontWeight: 700, display: 'inline-block' }}>Accetta preventivo</span>
                <div style={{ fontSize: '10.5px', color: '#aaa', marginTop: '8px' }}>(nell'email il cliente riceve il link con questo pulsante)</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
