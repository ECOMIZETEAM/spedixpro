'use client'

import { useEffect, useRef, useState } from 'react'
import { useDialog } from '@/app/components/DialogProvider'

const ACCENT = '#f97316'

type Ordine = {
  id: string
  destinatario: string
  indirizzo: string
  cap: string
  localita: string
  provincia: string
  country: string
  telefono: string | null
  email_destinatario: string | null
  peso: number | null
  colli: number
  contrassegno: number
  contenuto: string | null
  sku: string | null
  note: string | null
  rif_mittente: string | null
  rif_destinatario: string | null
  order_id: string | null
  totale_ordine: number | null
  fonte: string
  stato: string
  errore: string | null
  created_at: string
}

type Corriere = { id: string; nome: string; tipo: string }

const STATO: Record<string, { t: string; c: string; bg: string }> = {
  da_spedire: { t: 'Da spedire', c: '#b45309', bg: '#fef3c7' },
  spedito:    { t: 'Spedito',    c: '#15803d', bg: '#dcfce7' },
  errore:     { t: 'Errore',     c: '#b91c1c', bg: '#fee2e2' },
  archiviato: { t: 'Archiviato', c: '#6b7280', bg: '#f3f4f6' },
}

const card: React.CSSProperties = {
  background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', padding: '20px',
}
const th: React.CSSProperties = {
  textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#888',
  textTransform: 'uppercase', letterSpacing: '.03em', padding: '10px 12px',
  borderBottom: '1px solid #eee', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = {
  fontSize: '13px', color: '#333', padding: '11px 12px', borderBottom: '1px solid #f2f2f2',
  whiteSpace: 'nowrap',
}
const lbl: React.CSSProperties = {
  display: 'block', fontSize: '11px', fontWeight: 600, color: '#888',
  textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '4px',
}
const inp: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: '13px',
  border: '1px solid #ddd', borderRadius: '6px', color: '#1a1a1a', outline: 'none',
}

export default function ImportaOrdiniPage() {
  const dialog = useDialog()
  const [ordini, setOrdini] = useState<Ordine[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Modal modifica
  const [editing, setEditing] = useState<Ordine | null>(null)
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  // Spedizione
  const [corrieri, setCorrieri] = useState<Corriere[]>([])
  const [pacchi, setPacchi] = useState<any[]>([])       // pacchi predefiniti del cliente (misure + peso)
  const [pacco, setPacco] = useState('ordine')          // 'ordine' (misure dal file) | id pacco predefinito
  const [articoli, setArticoli] = useState<any[]>([])   // catalogo SKU -> peso (+ misure opzionali)
  const [mittenteNome, setMittenteNome] = useState('')  // nome mittente (profilo cliente) mostrato in colonna
  const [filtro, setFiltro] = useState<string>('min') // 'min' | corriere_id
  const [q, setQ] = useState('')                       // ricerca libera (ordine, destinatario, località, cap, telefono)
  const [filtroStato, setFiltroStato] = useState('tutti') // tutti | da_spedire | spedito | errore | archiviato
  const [spedendo, setSpedendo] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  async function loadOrdini() {
    setLoading(true)
    try {
      const res = await fetch('/api/ordini/importati')
      const data = await res.json()
      if (res.ok) setOrdini(data.ordini || [])
      else setMsg({ type: 'err', text: data.error || 'Errore nel caricamento' })
    } catch {
      setMsg({ type: 'err', text: 'Errore di rete' })
    } finally {
      setLoading(false)
    }
  }

  // Apre la Nuova Spedizione con i dati dell'ordine gia' compilati (matita = Modifica)
  function apriInSpedizione(o: Ordine) {
    const p = new URLSearchParams()
    p.set('da_ordine', o.id)
    p.set('nome', o.destinatario || '')
    p.set('indirizzo', o.indirizzo || '')
    p.set('citta', o.localita || '')
    p.set('provincia', o.provincia || '')
    p.set('cap', o.cap || '')
    p.set('paese', o.country || 'IT')
    if (o.email_destinatario) p.set('email', o.email_destinatario)
    if (o.telefono) p.set('telefono', o.telefono)
    // Peso + MISURE risolti come in fase di spedizione: articolo(SKU) > pacco > file.
    const articolo = articoloPerOrdine(o)
    const box = paccoPerOrdine(o)
    const pesoRis = (articolo && Number(articolo.peso) > 0) ? Number(articolo.peso)
      : (box && Number(box.peso) > 0) ? Number(box.peso)
      : (o.peso || 1)
    const dimsRis = box ? { l: box.lunghezza, w: box.larghezza, h: box.altezza }
      : (articolo && (Number(articolo.lunghezza) || Number(articolo.larghezza) || Number(articolo.altezza)))
        ? { l: articolo.lunghezza, w: articolo.larghezza, h: articolo.altezza }
        : null
    p.set('peso', String(pesoRis))
    if (dimsRis) { if (dimsRis.l) p.set('l', String(dimsRis.l)); if (dimsRis.w) p.set('w', String(dimsRis.w)); if (dimsRis.h) p.set('h', String(dimsRis.h)) }
    if (o.colli) p.set('colli', String(o.colli))
    if (o.contenuto) p.set('contenuto', o.contenuto)
    if (o.order_id) p.set('rif', o.order_id)
    if (o.contrassegno) p.set('contrassegno', String(o.contrassegno))
    if (o.totale_ordine) p.set('valore', String(o.totale_ordine))
    if (o.note) p.set('note', o.note)
    window.location.href = '/cliente/spedizioni/nuova?' + p.toString()
  }

  async function loadCorrieri() {
    try {
      const res = await fetch('/api/cliente/corrieri')
      const data = await res.json()
      if (res.ok) setCorrieri(data.corrieri || [])
    } catch { /* silente */ }
  }

  async function loadPacchi() {
    try {
      const res = await fetch('/api/cliente/pacchi')
      const data = await res.json()
      if (res.ok && Array.isArray(data)) setPacchi(data)
    } catch { /* silente */ }
  }
  async function loadArticoli() {
    try {
      const res = await fetch('/api/cliente/articoli')
      const data = await res.json()
      if (res.ok && Array.isArray(data)) setArticoli(data)
    } catch { /* silente */ }
  }

  async function loadMittente() {
    try { const r = await fetch('/api/cliente/mittente'); const d = await r.json(); if (r.ok) setMittenteNome(d?.mittente?.nome || '') } catch {}
  }
  useEffect(() => { loadOrdini(); loadCorrieri(); loadPacchi(); loadArticoli(); loadMittente() }, [])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/ordini/importa', { method: 'POST', body: fd })
      const data = await res.json()
      if (res.ok) {
        const motivi = (data.errori || []).map((e: any) => e.motivo).filter(Boolean)
        const extra = data.scartati ? ` — ${data.scartati} righe scartate${motivi.length ? ' (' + Array.from(new Set(motivi)).slice(0, 3).join('; ') + ')' : ''}` : ''
        setMsg({ type: 'ok', text: `${data.importati} ordini importati${extra}` })
        loadOrdini()
      } else {
        setMsg({ type: 'err', text: data.error || 'Errore durante l\'importazione' })
      }
    } catch {
      setMsg({ type: 'err', text: 'Errore di rete durante l\'upload' })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function toggle(id: string) {
    setSel(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  function toggleAll() {
    // Seleziona/deseleziona tutti gli ordini ATTUALMENTE VISIBILI (rispetta i filtri).
    const visibili = ordiniFiltrati.map(o => o.id)
    setSel(prev => {
      const tuttiSel = visibili.length > 0 && visibili.every(id => prev.has(id))
      const next = new Set(prev)
      if (tuttiSel) visibili.forEach(id => next.delete(id))
      else visibili.forEach(id => next.add(id))
      return next
    })
  }

  async function eliminaSelezionati() {
    if (!sel.size) return
    if (!await dialog.confirm({ title: `Eliminare ${sel.size} ordini selezionati?`, danger: true, confirmText: 'Elimina' })) return
    try {
      const res = await fetch('/api/ordini/elimina', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(sel) }),
      })
      const data = await res.json()
      if (res.ok) { setSel(new Set()); loadOrdini() }
      else setMsg({ type: 'err', text: data.error || 'Errore eliminazione' })
    } catch {
      setMsg({ type: 'err', text: 'Errore di rete' })
    }
  }

  function scaricaTemplate() {
    const csv = [
      'destinatario;indirizzo;cap;localita;provincia;country;peso;colli;contrassegno;telefono;email_destinatario;contenuto;note;rif_mittente;rif_destinatario;order_id;totale_ordine',
      'Mario Rossi;"Via Roma, 20";58100;Grosseto;GR;IT;1;1;25.5;3435556667;mario@example.com;frame 20x20;Fragile;Amazon;Mario Rossi;21545-45454;25.5',
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'template_ordini_moovexpress.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Modifica ────────────────────────────────────────────────────────────
  function openEdit(o: Ordine) {
    setEditing(o)
    setForm({ ...o })
    setFormErr(null)
  }
  function closeEdit() { setEditing(null); setFormErr(null) }
  function setF(k: string, v: any) { setForm((prev: any) => ({ ...prev, [k]: v })) }

  async function saveEdit() {
    if (!editing) return
    for (const k of ['destinatario', 'indirizzo', 'cap', 'localita', 'provincia']) {
      if (!String(form[k] ?? '').trim()) { setFormErr('Compila tutti i campi obbligatori (*)'); return }
    }
    setSaving(true)
    setFormErr(null)
    try {
      const res = await fetch('/api/ordini/modifica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, ...form }),
      })
      const data = await res.json()
      if (res.ok) { closeEdit(); loadOrdini() }
      else setFormErr(data.error || 'Errore salvataggio')
    } catch {
      setFormErr('Errore di rete')
    } finally {
      setSaving(false)
    }
  }

  // ── Spedisci selezionati ──────────────────────────────────────────────────
  async function spedisciSelezionati() {
    if (!sel.size || spedendo) return

    // Ordini spedibili tra quelli selezionati
    const targets = ordini.filter(o => sel.has(o.id) && (o.stato === 'da_spedire' || o.stato === 'errore'))
    if (!targets.length) { setMsg({ type: 'err', text: 'Nessun ordine spedibile selezionato' }); return }

    // Mittente dal profilo cliente (route dedicata)
    setMsg(null)
    let mitt: any
    try {
      const res = await fetch('/api/cliente/mittente')
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Errore')
      mitt = data.mittente
    } catch {
      setMsg({ type: 'err', text: 'Impossibile leggere i dati del mittente' }); return
    }
    const shipFrom = {
      name: mitt?.nome || '', company: mitt?.nome || '',
      street1: mitt?.indirizzo || '', street2: '',
      city: mitt?.citta || '', state: mitt?.provincia || '',
      postalCode: mitt?.cap || '', country: 'IT',
      phone: mitt?.telefono || '', email: mitt?.email || '',
    }
    if (!shipFrom.street1 || !shipFrom.city || !shipFrom.state || !shipFrom.postalCode) {
      setMsg({ type: 'err', text: 'Indirizzo mittente mancante: compila l\'indirizzo del cliente in Mio Account, poi riprova' })
      return
    }

    // Pacco scelto a MANO nel selettore ('ordine' = nessun override manuale).
    const presetManuale = pacco !== 'ordine' ? pacchi.find(p => String(p.id) === String(pacco)) : null
    // Catalogo SKU → pacco (dimensioni) per il match automatico quando non c'è un pacco manuale.
    const skuMap = new Map<string, any>()
    for (const p of pacchi) {
      if (!p.sku) continue
      for (const s of String(p.sku).split(/[\s,;]+/)) { const k = s.trim().toLowerCase(); if (k) skuMap.set(k, p) }
    }
    // Catalogo articoli SKU → peso (+ misure opzionali).
    const artMap = new Map<string, any>()
    for (const a of articoli) { const k = String(a.sku || '').trim().toLowerCase(); if (k) artMap.set(k, a) }

    setSpedendo(true)
    setProgress({ done: 0, total: targets.length })
    let ok = 0, ko = 0

    for (let i = 0; i < targets.length; i++) {
      const o = targets[i]
      try {
        const skuKey = String(o.sku || '').trim().toLowerCase()
        const articolo = skuKey ? artMap.get(skuKey) : null
        const box = presetManuale || (skuKey ? skuMap.get(skuKey) : null)   // pacco = sorgente delle MISURE
        // PESO: articolo (per-SKU) > pacco > file > 1.  MISURE: pacco > articolo (se ha misure) > standard.
        const peso = (articolo && Number(articolo.peso) > 0) ? Number(articolo.peso)
          : (box && Number(box.peso) > 0) ? Number(box.peso)
          : (o.peso || 1)
        const dims = box
          ? { l: box.lunghezza, w: box.larghezza, h: box.altezza }
          : (articolo && (Number(articolo.lunghezza) || Number(articolo.larghezza) || Number(articolo.altezza)))
            ? { l: articolo.lunghezza, w: articolo.larghezza, h: articolo.altezza }
            : { l: 20, w: 15, h: 10 }
        const packages = [{ length: Number(dims.l) || 20, width: Number(dims.w) || 15, height: Number(dims.h) || 10, weight: peso }]
        const shipTo = {
          name: o.destinatario, company: '',
          street1: o.indirizzo, street2: '',
          city: o.localita, state: o.provincia,
          postalCode: o.cap, country: o.country || 'IT',
          phone: o.telefono || '', email: o.email_destinatario || '',
        }

        // 1) Tariffe
        const tRes = await fetch('/api/spedizioni/tariffe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packages, shipFrom, shipTo, codValue: o.contrassegno || 0, insuranceValue: 0, notes: o.note || '' }),
        })
        const tariffe = await tRes.json()
        if (!Array.isArray(tariffe) || !tariffe.length) {
          throw new Error(tariffe?.error || 'Nessuna tariffa disponibile')
        }

        // 2) Scelta corriere
        let scelta: any
        if (filtro === 'min') {
          scelta = tariffe.reduce((a: any, b: any) =>
            parseFloat(b.total_price) < parseFloat(a.total_price) ? b : a)
        } else {
          scelta = tariffe.find((t: any) => String(t._corriere_id) === String(filtro))
          if (!scelta) throw new Error('Corriere selezionato non disponibile per questo ordine')
        }
        const corriereId = scelta._corriere_id
        if (!corriereId) throw new Error('Corriere non identificato (listino senza corriere)')

        // 3) Crea spedizione
        const cRes = await fetch('/api/spedizioni/crea', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            _corriere_id: corriereId,
            totalPrice: scelta.total_price,
            packages,
            shipFrom, shipTo,
            notes: o.note || '', insuranceValue: 0, codValue: o.contrassegno || 0,
            contenuto: o.contenuto || '',
            rifOrdine: o.order_id || '',   // → "Rif." in etichetta (SpediamoPro externalReference)
          }),
        })
        const cData = await cRes.json()
        if (!cRes.ok || cData.error) throw new Error(cData?.error || 'Errore creazione spedizione')

        // 4) Marca come spedito
        await fetch('/api/ordini/aggiorna-stato', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: o.id, stato: 'spedito', numero: cData.numero }),
        })
        ok++
      } catch (e: any) {
        await fetch('/api/ordini/aggiorna-stato', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: o.id, stato: 'errore', errore: String(e?.message || e) }),
        })
        ko++
      }
      setProgress({ done: i + 1, total: targets.length })
    }

    setSpedendo(false)
    setProgress(null)
    setSel(new Set())
    await loadOrdini()
    setMsg({
      type: ko ? 'err' : 'ok',
      text: `Spedizioni completate: ${ok} riuscite${ko ? `, ${ko} in errore (vedi colonna Stato)` : ''}`,
    })
  }

  // Filtri: ricerca libera + stato. La selezione/spedizione lavora comunque per id.
  const ordiniFiltrati = ordini.filter(o => {
    if (filtroStato !== 'tutti' && o.stato !== filtroStato) return false
    const s = q.trim().toLowerCase()
    if (s) {
      const campi = [o.order_id, o.destinatario, o.indirizzo, o.localita, o.cap, o.provincia, o.telefono]
        .map(v => String(v ?? '').toLowerCase())
      if (!campi.some(v => v.includes(s))) return false
    }
    return true
  })
  const allChecked = ordiniFiltrati.length > 0 && ordiniFiltrati.every(o => sel.has(o.id))
  const modificabile = (o: Ordine) => o.stato === 'da_spedire' || o.stato === 'errore'

  // Catalogo SKU → pacco (per l'indicatore in tabella). Il pacco scelto a mano ha comunque la priorità.
  const skuToPacco = new Map<string, any>()
  for (const p of pacchi) {
    if (!p.sku) continue
    for (const s of String(p.sku).split(/[\s,;]+/)) { const k = s.trim().toLowerCase(); if (k) skuToPacco.set(k, p) }
  }
  const artView = new Map<string, any>()
  for (const a of articoli) { const k = String(a.sku || '').trim().toLowerCase(); if (k) artView.set(k, a) }
  const paccoManuale = pacco !== 'ordine' ? pacchi.find((p: any) => String(p.id) === String(pacco)) : null
  const paccoPerOrdine = (o: Ordine) => paccoManuale || (o.sku ? skuToPacco.get(String(o.sku).trim().toLowerCase()) : null) || null
  const articoloPerOrdine = (o: Ordine) => o.sku ? (artView.get(String(o.sku).trim().toLowerCase()) || null) : null

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Importa Ordini</h1>
        <p style={{ color: '#999', fontSize: '13px', marginTop: '4px' }}>
          Carica un file CSV con i tuoi ordini per generare le spedizioni
        </p>
      </div>

      {/* Messaggio */}
      {msg && (
        <div style={{
          marginBottom: '16px', padding: '10px 14px', borderRadius: '8px', fontSize: '13px',
          border: `1px solid ${msg.type === 'ok' ? '#bbf7d0' : '#fecaca'}`,
          background: msg.type === 'ok' ? '#f0fdf4' : '#fef2f2',
          color: msg.type === 'ok' ? '#15803d' : '#b91c1c',
        }}>
          {msg.text}
        </div>
      )}

      {/* Upload */}
      <div style={{ ...card, marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a', marginBottom: '12px' }}>
              1. Seleziona il file (CSV, TXT o Excel)
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv,.txt,.tsv,text/plain,text/tab-separated-values,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} style={{ display: 'none' }} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              style={{
                background: ACCENT, color: '#fff', border: 'none', borderRadius: '8px',
                padding: '10px 18px', fontSize: '13px', fontWeight: 600,
                cursor: uploading ? 'default' : 'pointer', opacity: uploading ? .6 : 1,
              }}
            >
              {uploading ? 'Caricamento…' : 'Carica file'}
            </button>
            <button
              onClick={scaricaTemplate}
              style={{
                marginLeft: '10px', background: '#fff', color: '#555', border: '1px solid #ddd',
                borderRadius: '8px', padding: '10px 14px', fontSize: '13px', cursor: 'pointer',
              }}
            >
              Scarica template
            </button>
          </div>

          <div style={{ flex: '1 1 320px', fontSize: '12.5px', color: '#666', lineHeight: 1.6 }}>
            Puoi caricare direttamente l&apos;<b>export ordini di Shopify</b> o il file di{' '}
            <b>Amazon</b> (il .txt originale, senza convertirlo): il sistema riconosce da solo le
            colonne e il separatore, e raggruppa gli ordini con più prodotti.<br />
            In alternativa usa il nostro <b>template</b> — colonne obbligatorie:{' '}
            <b style={{ color: '#b45309' }}>destinatario, indirizzo, cap, localita, provincia</b>.<br />
            Formati: <b>.csv</b>, <b>.txt</b> (tab) o <b>.xlsx</b>.
          </div>
        </div>
      </div>

      {/* Tabella */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ fontSize: '13px', color: '#666' }}>
            {spedendo && progress
              ? `Spedizione ${progress.done}/${progress.total} in corso…`
              : (sel.size > 0 ? `${sel.size} selezionati` : `${ordiniFiltrati.length}${ordiniFiltrati.length !== ordini.length ? ` di ${ordini.length}` : ''} ordini`)}
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={eliminaSelezionati}
              disabled={!sel.size || spedendo}
              style={{
                background: '#fff', color: sel.size && !spedendo ? '#b91c1c' : '#bbb',
                border: `1px solid ${sel.size && !spedendo ? '#fecaca' : '#eee'}`, borderRadius: '8px',
                padding: '8px 14px', fontSize: '13px', cursor: sel.size && !spedendo ? 'pointer' : 'default',
              }}
            >
              Elimina selezionati
            </button>

            {pacchi.length > 0 && (
              <>
                <span style={{ fontSize: '12.5px', color: '#666' }}>Pacco:</span>
                <select
                  value={pacco}
                  onChange={e => setPacco(e.target.value)}
                  disabled={spedendo}
                  title="Applica misure e peso di un pacco predefinito a tutti gli ordini selezionati"
                  style={{ ...inp, width: 'auto', minWidth: '170px', padding: '8px 10px' }}
                >
                  <option value="ordine">Misure dal file</option>
                  {pacchi.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.nome} — {p.peso}kg {p.lunghezza}×{p.larghezza}×{p.altezza}
                    </option>
                  ))}
                </select>
              </>
            )}

            <span style={{ fontSize: '12.5px', color: '#666' }}>Spedisci con:</span>
            <select
              value={filtro}
              onChange={e => setFiltro(e.target.value)}
              disabled={spedendo}
              style={{ ...inp, width: 'auto', minWidth: '200px', padding: '8px 10px' }}
            >
              <option value="min">Prezzo minore (automatico)</option>
              {corrieri.map(c => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>

            <button
              onClick={spedisciSelezionati}
              disabled={!sel.size || spedendo}
              style={{
                background: sel.size && !spedendo ? ACCENT : '#f3f4f6',
                color: sel.size && !spedendo ? '#fff' : '#9ca3af',
                border: 'none', borderRadius: '8px', padding: '8px 16px',
                fontSize: '13px', fontWeight: 600,
                cursor: sel.size && !spedendo ? 'pointer' : 'not-allowed',
              }}
            >
              {spedendo ? 'Spedizione in corso…' : 'Spedisci selezionati'}
            </button>
          </div>
        </div>

        {/* Filtri: ricerca + stato */}
        {ordini.length > 0 && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="🔍 Cerca per ordine, destinatario, località, CAP, telefono…"
              style={{ ...inp, flex: 1, minWidth: '240px', padding: '8px 11px' }}
            />
            <select value={filtroStato} onChange={e => setFiltroStato(e.target.value)} style={{ ...inp, width: 'auto', minWidth: '150px', padding: '8px 10px' }}>
              <option value="tutti">Tutti gli stati</option>
              <option value="da_spedire">Da spedire</option>
              <option value="spedito">Spedito</option>
              <option value="errore">Errore</option>
              <option value="archiviato">Archiviato</option>
            </select>
            {(q || filtroStato !== 'tutti') && (
              <button onClick={() => { setQ(''); setFiltroStato('tutti') }}
                style={{ background: '#fff', color: '#666', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 12px', fontSize: '12.5px', cursor: 'pointer' }}>
                Azzera filtri
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>Caricamento…</div>
        ) : ordini.length === 0 ? (
          <div style={{ padding: '50px', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>📦</div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#999' }}>Nessun ordine importato</div>
          </div>
        ) : ordiniFiltrati.length === 0 ? (
          <div style={{ padding: '50px', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔍</div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#999' }}>Nessun ordine corrisponde ai filtri</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: '36px' }}>
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                  </th>
                  <th style={th}>Destinatario</th>
                  <th style={th}>Mittente</th>
                  <th style={th}>Località</th>
                  <th style={th}>CAP</th>
                  <th style={th}>Prov</th>
                  <th style={th}>Telefono</th>
                  <th style={th}>Peso</th>
                  <th style={th}>Colli</th>
                  <th style={th}>Contrassegno</th>
                  <th style={th}>Order ID</th>
                  <th style={th}>Stato</th>
                  <th style={{ ...th, width: '60px', textAlign: 'center' }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {ordiniFiltrati.map(o => {
                  const s = STATO[o.stato] || STATO.da_spedire
                  return (
                    <tr key={o.id} style={{ background: sel.has(o.id) ? '#fff7ed' : '#fff' }}>
                      <td style={td}>
                        <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} disabled={spedendo} />
                      </td>
                      <td style={{ ...td, fontWeight: 600, color: '#1a1a1a' }}>
                        {o.destinatario}
                        <div style={{ fontSize: '11.5px', color: '#999', fontWeight: 400 }}>{o.indirizzo}</div>
                      </td>
                      <td style={td}>{o.rif_mittente || mittenteNome || '—'}</td>
                      <td style={td}>{o.localita}</td>
                      <td style={td}>{o.cap}</td>
                      <td style={td}>{o.provincia}</td>
                      <td style={td}>{o.telefono || '—'}</td>
                      <td style={td}>
                        {(() => {
                          const box = paccoPerOrdine(o)
                          const art = articoloPerOrdine(o)
                          // Peso effettivo come in spedizione: articolo > pacco > file
                          const peso = (art && Number(art.peso) > 0) ? Number(art.peso)
                            : (box && Number(box.peso) > 0) ? Number(box.peso)
                            : (o.peso ?? 1)
                          if (art || box) {
                            const fonte = [art ? 'peso da catalogo SKU' : '', box ? `misure da pacco "${box.nome}"` : ''].filter(Boolean).join(' · ')
                            return (
                              <span title={fonte} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#15803d', fontWeight: 600 }}>
                                📦 {Number(peso).toFixed(3).replace(/\.?0+$/, '')} kg
                              </span>
                            )
                          }
                          return o.peso != null ? `${o.peso} kg` : '—'
                        })()}
                      </td>
                      <td style={td}>{o.colli}</td>
                      <td style={td}>{o.contrassegno ? `€ ${Number(o.contrassegno).toFixed(2)}` : '—'}</td>
                      <td style={td}>{o.order_id || '—'}</td>
                      <td style={td}>
                        <span
                          title={o.stato === 'errore' && o.errore ? o.errore : undefined}
                          style={{
                            fontSize: '11.5px', fontWeight: 600, padding: '3px 9px', borderRadius: '999px',
                            color: s.c, background: s.bg, cursor: o.stato === 'errore' ? 'help' : 'default',
                          }}
                        >
                          {s.t}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        {modificabile(o) ? (
                          <button
                            onClick={() => apriInSpedizione(o)}
                            title="Modifica e spedisci: apre la spedizione con i dati dell'ordine"
                            disabled={spedendo}
                            style={{
                              background: '#fff', border: '1px solid #e5e5e5', borderRadius: '6px',
                              padding: '4px 8px', fontSize: '13px', cursor: spedendo ? 'default' : 'pointer', color: '#555',
                            }}
                          >
                            ✎
                          </button>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Modifica */}
      {editing && (
        <div
          onClick={closeEdit}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 50,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '10px', width: '100%', maxWidth: '640px',
              boxShadow: '0 20px 60px rgba(0,0,0,.25)',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a' }}>Modifica ordine</div>
              <button onClick={closeEdit} style={{ background: 'none', border: 'none', fontSize: '20px', color: '#999', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Destinatario *</label>
                <input style={inp} value={form.destinatario ?? ''} onChange={e => setF('destinatario', e.target.value)} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Indirizzo *</label>
                <input style={inp} value={form.indirizzo ?? ''} onChange={e => setF('indirizzo', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>CAP *</label>
                <input style={inp} value={form.cap ?? ''} onChange={e => setF('cap', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Località *</label>
                <input style={inp} value={form.localita ?? ''} onChange={e => setF('localita', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Provincia *</label>
                <input style={inp} value={form.provincia ?? ''} onChange={e => setF('provincia', e.target.value)} maxLength={4} />
              </div>
              <div>
                <label style={lbl}>Country</label>
                <input style={inp} value={form.country ?? ''} onChange={e => setF('country', e.target.value)} maxLength={2} />
              </div>
              <div>
                <label style={lbl}>Telefono</label>
                <input style={inp} value={form.telefono ?? ''} onChange={e => setF('telefono', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Email destinatario</label>
                <input style={inp} value={form.email_destinatario ?? ''} onChange={e => setF('email_destinatario', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Peso (kg)</label>
                <input style={inp} type="number" step="0.1" value={form.peso ?? ''} onChange={e => setF('peso', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Colli</label>
                <input style={inp} type="number" min="1" value={form.colli ?? ''} onChange={e => setF('colli', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Contrassegno (€)</label>
                <input style={inp} type="number" step="0.01" value={form.contrassegno ?? ''} onChange={e => setF('contrassegno', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Totale ordine (€)</label>
                <input style={inp} type="number" step="0.01" value={form.totale_ordine ?? ''} onChange={e => setF('totale_ordine', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Order ID</label>
                <input style={inp} value={form.order_id ?? ''} onChange={e => setF('order_id', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Rif. mittente</label>
                <input style={inp} value={form.rif_mittente ?? ''} onChange={e => setF('rif_mittente', e.target.value)} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Contenuto</label>
                <input style={inp} value={form.contenuto ?? ''} onChange={e => setF('contenuto', e.target.value)} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Note</label>
                <input style={inp} value={form.note ?? ''} onChange={e => setF('note', e.target.value)} />
              </div>

              {formErr && (
                <div style={{ gridColumn: '1 / -1', color: '#b91c1c', fontSize: '12.5px' }}>{formErr}</div>
              )}
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={closeEdit}
                style={{ background: '#fff', color: '#555', border: '1px solid #ddd', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', cursor: 'pointer' }}
              >
                Annulla
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: saving ? 'default' : 'pointer', opacity: saving ? .6 : 1 }}
              >
                {saving ? 'Salvataggio…' : 'Salva'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
