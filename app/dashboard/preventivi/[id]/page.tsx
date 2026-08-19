'use client'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import EditorMarkupFasce, { type MarkupOut } from '@/app/components/EditorMarkupFasce'
import { normalizzaMarkup, creaApplicaMarkup } from '@/lib/markup-fasce'

// EDITOR PREVENTIVO (Fase 2): dettagli + sezioni customizzabili (testo/T&C/contatti) + prezzi per uno+
// corrieri (riuso EditorMarkupFasce sul COSTO del master) + anteprima brandizzata dal vivo.
// I prezzi restano mappabili al listino: si salva {corriere_id, markup} (+ righe snapshot per l'anteprima);
// all'accettazione (Fase 4) si materializza il listino da costo+markup.

const inp: any = { width: '100%', padding: '9px 11px', border: '1px solid #d5d5d5', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', background: '#fff', boxSizing: 'border-box' }
const lbl: any = { fontSize: '12px', fontWeight: 700, color: '#1a1a1a', display: 'block', marginBottom: '4px' }
const card: any = { background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', padding: '16px', marginBottom: '14px' }
const eur = (n: any) => `€ ${Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const uid = () => (globalThis.crypto?.randomUUID?.() || String(Math.random()).slice(2))

type Sezione = { id: string; titolo: string; testo: string }
type CorrPrev = { corriere_id: string; nome: string; markup: MarkupOut; righe: { label: string; prezzo: number }[] }

export default function EditorPreventivo() {
  const { id } = useParams()
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const [stato, setStato] = useState('bozza')

  const [brand, setBrand] = useState<any>({})
  const [destTipo, setDestTipo] = useState('cliente_nuovo')
  const [destNome, setDestNome] = useState('')
  const [destEmail, setDestEmail] = useState('')
  const [oggetto, setOggetto] = useState('')
  const [validoFino, setValidoFino] = useState('')
  const [sezioni, setSezioni] = useState<Sezione[]>([])
  const [corrieri, setCorrieri] = useState<CorrPrev[]>([])

  // corrieri del master (per il picker) + modale aggiungi/modifica prezzi
  const [corrieriMaster, setCorrieriMaster] = useState<any[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [addCorrId, setAddCorrId] = useState('')
  const [addFasce, setAddFasce] = useState<any[]>([])
  const [addMarkup, setAddMarkup] = useState<MarkupOut>({ default: null, perFascia: {} })
  const [addLoad, setAddLoad] = useState(false)
  const [editIdx, setEditIdx] = useState<number | null>(null)

  useEffect(() => {
    fetch(`/api/preventivi/${id}`).then(r => r.json()).then(d => {
      if (d?.error) { setMsg({ t: 'err', x: d.error }); setLoading(false); return }
      const p = d.preventivo || {}
      setStato(p.stato || 'bozza'); setBrand(d.branding || {})
      setDestTipo(p.dest_tipo || 'cliente_nuovo'); setDestNome(p.dest_nome || ''); setDestEmail(p.dest_email || '')
      setOggetto(p.oggetto || ''); setValidoFino(p.valido_fino || '')
      const c = p.contenuto || {}
      setSezioni(Array.isArray(c.sezioni) ? c.sezioni : [])
      setCorrieri(Array.isArray(c.corrieri) ? c.corrieri : [])
      setLoading(false)
    }).catch(() => { setMsg({ t: 'err', x: 'Errore nel caricamento' }); setLoading(false) })
    fetch('/api/listini/corrieri').then(r => r.json()).then(d => setCorrieriMaster(Array.isArray(d?.corrieri) ? d.corrieri : [])).catch(() => {})
  }, [id])

  // ── Sezioni ──
  function aggiungiSezione(preset?: 'termini' | 'contatti') {
    const contatti = [brand.nome, brand.indirizzo && `${brand.indirizzo}, ${brand.cap || ''} ${brand.citta || ''} ${brand.provincia ? '(' + brand.provincia + ')' : ''}`, brand.telefono && `Tel: ${brand.telefono}`, brand.email && `Email: ${brand.email}`, brand.pec && `PEC: ${brand.pec}`, (brand.partita_iva || brand.piva) && `P.IVA: ${brand.partita_iva || brand.piva}`].filter(Boolean).join('\n')
    const s: Sezione = preset === 'termini'
      ? { id: uid(), titolo: 'Termini e Condizioni', testo: '' }
      : preset === 'contatti'
        ? { id: uid(), titolo: 'Contatti', testo: contatti }
        : { id: uid(), titolo: '', testo: '' }
    setSezioni(prev => [...prev, s])
  }
  const setSez = (i: number, patch: Partial<Sezione>) => setSezioni(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  const togliSez = (i: number) => setSezioni(prev => prev.filter((_, idx) => idx !== i))
  const muoviSez = (i: number, d: number) => setSezioni(prev => { const a = [...prev]; const j = i + d; if (j < 0 || j >= a.length) return prev;[a[i], a[j]] = [a[j], a[i]]; return a })

  // ── Corrieri / prezzi ──
  async function apriAggiungiCorr(idx?: number) {
    setEditIdx(idx ?? null); setAddOpen(true); setAddLoad(true); setAddFasce([]); setAddMarkup({ default: null, perFascia: {} })
    const corrId = idx != null ? corrieri[idx].corriere_id : ''
    setAddCorrId(corrId)
    if (corrId) await caricaFasceCorr(corrId, idx != null ? corrieri[idx].markup : undefined)
    setAddLoad(false)
  }
  async function caricaFasceCorr(corrId: string, markupIniz?: MarkupOut) {
    setAddLoad(true)
    try {
      const d = await fetch(`/api/listini/corrieri?corriere=${corrId}`).then(r => r.json())
      const raw = Array.isArray(d?.fasce) ? d.fasce : []
      // Raggruppo per tipo+peso_max, costo = il piu' basso fra le zone.
      const map = new Map<string, { tipo: string; peso: number; costi: number[] }>()
      for (const f of raw) {
        const tipo = f.tipo === 'oltre' ? 'oltre' : 'fino_a'; const peso = Number(f.peso_max)
        const k = `${tipo}_${peso}`; const pr = parseFloat(f.prezzo)
        if (!map.has(k)) map.set(k, { tipo, peso, costi: [] })
        if (isFinite(pr) && pr > 0) map.get(k)!.costi.push(pr)
      }
      const fasce = Array.from(map.values()).sort((a, b) => a.tipo === 'oltre' ? 1 : b.tipo === 'oltre' ? -1 : a.peso - b.peso)
        .map(g => ({ key: `${g.tipo}_${g.peso}`, label: g.tipo === 'oltre' ? `oltre ${g.peso} kg` : `fino a ${g.peso} kg`, tipo: g.tipo, peso: g.peso, costo: g.costi.length ? Math.min(...g.costi) : 0 }))
      setAddFasce(fasce)
      if (markupIniz) setAddMarkup(markupIniz)
    } catch { setAddFasce([]) }
    setAddLoad(false)
  }
  function confermaCorr() {
    if (!addCorrId) { setMsg({ t: 'err', x: 'Scegli un corriere' }); return }
    const nome = corrieriMaster.find((c: any) => c.id === addCorrId)?.nome_contratto || 'Corriere'
    const applica = creaApplicaMarkup(normalizzaMarkup(addMarkup))
    const righe = addFasce.map(f => ({ label: f.label, prezzo: applica(f.costo, f.tipo, f.peso) }))
    const nuovo: CorrPrev = { corriere_id: addCorrId, nome, markup: addMarkup, righe }
    setCorrieri(prev => editIdx != null ? prev.map((c, i) => i === editIdx ? nuovo : c) : (prev.some(c => c.corriere_id === addCorrId) ? prev : [...prev, nuovo]))
    setAddOpen(false)
  }
  const togliCorr = (i: number) => setCorrieri(prev => prev.filter((_, idx) => idx !== i))

  async function salva() {
    setSalvando(true); setMsg(null)
    try {
      const res = await fetch(`/api/preventivi/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dest_tipo: destTipo, dest_nome: destNome, dest_email: destEmail, oggetto, valido_fino: validoFino || null, contenuto: { sezioni, corrieri } }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d?.error) { setMsg({ t: 'err', x: d?.error || 'Salvataggio non riuscito' }); setSalvando(false); return }
      setMsg({ t: 'ok', x: 'Preventivo salvato.' })
    } catch { setMsg({ t: 'err', x: 'Errore di rete' }) } finally { setSalvando(false) }
  }

  const colP = brand.colore_primario || '#f97316'
  const colS = brand.colore_secondario || '#1a1a1a'
  const addFasceMarkupPreview = useMemo(() => addFasce, [addFasce])

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>Caricamento…</div>

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <div>
          <a href="/dashboard/preventivi" style={{ fontSize: '12.5px', color: '#f97316', textDecoration: 'none' }}>← Preventivi</a>
          <h1 style={{ fontSize: '19px', fontWeight: 700, color: '#1a1a1a', margin: '4px 0 0' }}>Modifica preventivo</h1>
        </div>
        <button onClick={salva} disabled={salvando} style={{ background: '#f97316', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 22px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: salvando ? 0.6 : 1 }}>{salvando ? 'Salvo…' : '💾 Salva'}</button>
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

          {/* Prezzi */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Prezzi — corrieri</div>
              <button onClick={() => apriAggiungiCorr()} style={{ background: '#fff7ed', color: '#ea580c', border: '1px solid #fed7aa', borderRadius: '6px', padding: '7px 12px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}>+ Aggiungi corriere</button>
            </div>
            {corrieri.length === 0 ? <div style={{ color: '#999', fontSize: '12.5px' }}>Nessun corriere. Aggiungine uno: parti dal tuo costo e applichi la maggiorazione (con anteprima).</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {corrieri.map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #eee', borderRadius: '6px', padding: '8px 10px' }}>
                    <div><b style={{ fontSize: '13px' }}>{c.nome}</b> <span style={{ fontSize: '11.5px', color: '#999' }}>· {c.righe.length} fasce</span></div>
                    <div style={{ display: 'inline-flex', gap: '8px' }}>
                      <button onClick={() => apriAggiungiCorr(i)} style={{ background: 'transparent', border: '1px solid #ddd', borderRadius: '5px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer', color: '#555' }}>Modifica</button>
                      <button onClick={() => togliCorr(i)} style={{ background: 'transparent', border: 'none', color: '#b91c1c', fontSize: '14px', cursor: 'pointer' }}>🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sezioni */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '6px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Sezioni</div>
              <div style={{ display: 'inline-flex', gap: '6px' }}>
                <button onClick={() => aggiungiSezione()} style={{ ...miniBtn }}>+ Testo</button>
                <button onClick={() => aggiungiSezione('termini')} style={{ ...miniBtn }}>+ Termini</button>
                <button onClick={() => aggiungiSezione('contatti')} style={{ ...miniBtn }}>+ Contatti</button>
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

              {corrieri.map((c, i) => (
                <div key={i} style={{ marginTop: '18px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: colS, borderBottom: `2px solid ${colP}`, paddingBottom: '4px', marginBottom: '6px' }}>{c.nome}</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                    <tbody>
                      {c.righe.map((r, j) => (
                        <tr key={j} style={{ borderBottom: '1px solid #f2f2f2' }}>
                          <td style={{ padding: '5px 0', color: '#333' }}>{r.label}</td>
                          <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 700, color: colS }}>{eur(r.prezzo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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

      {/* Modale aggiungi/modifica corriere */}
      {addOpen && (
        <div onClick={() => setAddOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '600px', maxHeight: '86vh', overflowY: 'auto', padding: '20px' }}>
            <div style={{ fontSize: '16px', fontWeight: 800, color: '#1a1a1a', marginBottom: '12px' }}>{editIdx != null ? 'Modifica prezzi corriere' : 'Aggiungi corriere'}</div>
            <label style={lbl}>Corriere (dal tuo costo)</label>
            <select value={addCorrId} onChange={e => { setAddCorrId(e.target.value); if (e.target.value) caricaFasceCorr(e.target.value) }} disabled={editIdx != null} style={{ ...inp, marginBottom: '14px' }}>
              <option value="">Scegli…</option>
              {corrieriMaster.map((c: any) => <option key={c.id} value={c.id}>{c.nome_contratto}</option>)}
            </select>
            {addLoad ? <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '13px' }}>Carico il costo…</div>
              : addFasce.length === 0 ? (addCorrId ? <div style={{ color: '#999', fontSize: '12.5px' }}>Nessuna fascia di costo per questo corriere.</div> : null)
                : <EditorMarkupFasce key={addCorrId + '_' + (editIdx ?? 'new')} fasce={addFasceMarkupPreview} valoreIniziale={editIdx != null ? corrieri[editIdx]?.markup : undefined} onChange={setAddMarkup} />}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
              <button onClick={() => setAddOpen(false)} style={{ background: '#fff', color: '#1a1a1a', border: '1px solid #ddd', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Annulla</button>
              <button onClick={confermaCorr} disabled={!addCorrId || addLoad} style={{ background: '#f97316', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 20px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: (!addCorrId || addLoad) ? 0.6 : 1 }}>{editIdx != null ? 'Aggiorna' : 'Aggiungi'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const miniBtn: any = { background: '#f4f4f5', color: '#3f3f46', border: '1px solid #e4e4e7', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }
