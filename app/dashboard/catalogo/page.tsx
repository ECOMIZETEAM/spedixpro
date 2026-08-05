'use client'
import { useState, useEffect } from 'react'
import SelectCercabile from '@/app/components/SelectCercabile'
import GeneratoreVarianti, { type Opzione, type RigaVariante } from '@/app/components/GeneratoreVarianti'

// IL CATALOGO DEI CLIENTI, DAL LATO DEL MASTER.
//
// Il catalogo esisteva gia' ma solo nel portale cliente, e infatti lo usavano in due su tutta la
// rete. I pesi veri pero' li conosce il master, che i pacchi li vede passare: da qui puo'
// compilarlo lui, per il cliente che vuole.
//
// A cosa serve: con lo SKU in catalogo, peso e misure li mette il sistema quando si crea la
// spedizione o si importa un ordine. Chi spedisce sempre le stesse cose oggi li ridigita ogni
// volta, e quando sbaglia il volumetrico se ne accorge in fattura.

const ACCENT = '#f97316'
const card = { background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', overflow: 'hidden' as const }
const th = { padding: '9px 12px', fontSize: '11px', fontWeight: 700 as const, textTransform: 'uppercase' as const, color: '#666', textAlign: 'left' as const, whiteSpace: 'nowrap' as const }
const td = { padding: '8px 12px', fontSize: '12.5px', color: '#1a1a1a', borderTop: '1px solid #f0f0f0' }
const inp = { padding: '9px 11px', fontSize: '13px', border: '1px solid #d5d5d5', borderRadius: '6px', outline: 'none', color: '#1a1a1a', background: '#fff' }

// Intestazioni che sappiamo riconoscere da soli: l'export prodotti di Shopify, quello di Amazon e
// il foglio che si fa a mano. Chiedere a chi carica di rinominare le colonne vuol dire che non
// carica.
const ALIAS: Record<string, string[]> = {
  sku: ['sku', 'variant sku', 'variant_sku', 'seller sku', 'seller-sku', 'codice', 'codice articolo', 'articolo', 'item sku'],
  nome: ['nome', 'titolo', 'title', 'name', 'product name', 'item name', 'descrizione', 'product title'],
  ean13: ['ean', 'ean13', 'barcode', 'variant barcode', 'codice a barre', 'gtin'],
  asin: ['asin', 'asin1'],
  prezzo: ['prezzo', 'price', 'variant price', 'prezzo vendita'],
  peso: ['peso', 'weight', 'peso kg', 'variant weight', 'item weight'],
  grammi: ['grammi', 'grams', 'variant grams'],
  lunghezza: ['lunghezza', 'length', 'lungh', 'item length', 'profondita'],
  larghezza: ['larghezza', 'width', 'largh', 'item width'],
  altezza: ['altezza', 'height', 'alt', 'item height'],
  url_immagine: ['immagine', 'image', 'image src', 'url immagine', 'foto'],
  codice_hs: ['hs', 'codice hs', 'hs code', 'hscode'],
  paese_origine: ['paese origine', 'origine', 'country of origin', 'origin'],
  valore_dichiarato: ['valore dichiarato', 'declared value', 'valore doganale'],
  descrizione_doganale: ['descrizione doganale', 'customs description'],
}
const norm = (s: any) => String(s ?? '').replace(/﻿/g, '').trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ')
function mappa(intestazioni: string[]) {
  const trovate: Record<string, string> = {}
  const norms = intestazioni.map(h => norm(h))
  for (const [campo, alias] of Object.entries(ALIAS)) {
    const i = norms.findIndex(h => alias.includes(h))
    if (i >= 0) trovate[campo] = intestazioni[i]
  }
  return trovate
}
const num = (v: any) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9,.\-]/g, '').replace(',', '.'))
  return isFinite(n) ? n : null
}

export default function CatalogoPage() {
  const [clienti, setClienti] = useState<any[]>([])
  const [clienteId, setClienteId] = useState('')
  const [articoli, setArticoli] = useState<any[]>([])
  const [cerca, setCerca] = useState('')
  const [caricando, setCaricando] = useState(false)
  const [form, setForm] = useState<any>(null)
  // Prodotto con varianti: si definiscono le OPZIONI e le combinazioni escono da sole.
  const [varianti, setVarianti] = useState(false)
  const [creoVar, setCreoVar] = useState(false)
  // CARICO RAPIDO dal catalogo. La giacenza resta in sola lettura nella scheda — e' il saldo di un
  // registro, non un campo — ma il gesto "ne sono arrivati dieci" si fa da qui, che e' dove uno lo
  // cerca. Carico merce resta per il giro di magazzino, dove serve anche dire in che posto e' finita.
  const [giac, setGiac] = useState<any>(null)
  const [giacTipo, setGiacTipo] = useState<'carico' | 'inventario'>('carico')
  const [giacQta, setGiacQta] = useState(''); const [giacNota, setGiacNota] = useState('')
  const [giacSalvo, setGiacSalvo] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const [importando, setImportando] = useState(false)

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r => r.json())
      .then(d => setClienti(Array.isArray(d) ? d : (d?.clienti || [])))
      .catch(() => { })
  }, [])

  async function carica(id = clienteId, q = cerca) {
    if (!id) { setArticoli([]); return }
    setCaricando(true)
    const d = await fetch(`/api/catalogo?cliente_id=${id}&cerca=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => null)
    setArticoli(d?.articoli || [])
    setCaricando(false)
  }
  useEffect(() => { carica() }, [clienteId])

  async function salva() {
    setMsg(null)
    if (!String(form?.sku || '').trim()) { setMsg({ t: 'err', x: 'Lo SKU è obbligatorio' }); return }
    // LA VARIANTE si scrive libera ("rosso, S") perche' e' cosi' che uno la pensa. Diventa
    // `attributi` solo se e' stata TOCCATA: se resta com'era non si riscrive, altrimenti un
    // articolo creato dal portale cliente con chiavi vere (colore, taglia) le perderebbe,
    // diventando "variante 1, variante 2", a ogni salvataggio fatto da qui.
    const corpo: any = { ...form, cliente_id: clienteId }
    delete corpo._variante; delete corpo._varianteOrig
    if (form._variante !== form._varianteOrig) {
      const parti = String(form._variante || '').split(',').map((x: string) => x.trim()).filter(Boolean)
      const attributi: Record<string, string> = {}
      parti.forEach((val: string, i: number) => { attributi[`variante${parti.length > 1 ? ' ' + (i + 1) : ''}`] = val })
      corpo.attributi = parti.length ? attributi : null
    }
    const r = await fetch('/api/catalogo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    })
    const d = await r.json()
    if (d?.error) { setMsg({ t: 'err', x: d.error }); return }
    setForm(null); setMsg({ t: 'ok', x: 'Articolo salvato' }); carica()
  }

  // Crea in un colpo solo tutte le combinazioni: ognuna e' una RIGA con il suo SKU, che e' quello
  // che fa combaciare gli ordini di Shopify e Amazon e tiene le giacenze separate.
  async function salvaVarianti(prodotto: string, opzioni: Opzione[], righe: RigaVariante[]) {
    setMsg(null); setCreoVar(true)
    const articoli = righe.map(r => {
      const attributi: Record<string, string> = {}
      opzioni.forEach((o, i) => { if (r.valori[i]) attributi[o.nome] = r.valori[i] })
      return {
        sku: r.sku.trim(),
        nome: `${prodotto} ${r.valori.join(' ')}`.trim(),
        prodotto, attributi,
        ...(r.peso ? { peso: r.peso } : {}),
        ...(r.prezzo ? { prezzo: r.prezzo } : {}),
      }
    })
    const r = await fetch('/api/catalogo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_id: clienteId, articoli }),
    })
    const d = await r.json().catch(() => ({})); setCreoVar(false)
    if (!r.ok || d?.error) { setMsg({ t: 'err', x: d?.error || 'Errore' }); return }
    setVarianti(false); setMsg({ t: 'ok', x: `${articoli.length} varianti create` }); carica()
  }

  async function salvaGiacenza() {
    const n = parseInt(giacQta, 10)
    if (!isFinite(n) || n === 0) { setMsg({ t: 'err', x: 'Scrivi quanti pezzi' }); return }
    setGiacSalvo(true)
    // Inventario = "ho contato, ce ne sono N": si manda la DIFFERENZA, cosi' nel registro resta
    // scritto quanto mancava rispetto a quello che il sistema credeva.
    const delta = giacTipo === 'inventario' ? n - Number(giac.quantita || 0) : n
    if (delta === 0) { setGiacSalvo(false); setGiac(null); return }
    const r = await fetch('/api/logistica/carico', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articolo_id: giac.id, quantita: delta, nota: giacNota || (giacTipo === 'inventario' ? 'conteggio' : 'carico') }),
    })
    const d = await r.json().catch(() => ({})); setGiacSalvo(false)
    if (!r.ok || d?.error) { setMsg({ t: 'err', x: d?.error || 'Errore' }); return }
    setGiac(null); setGiacQta(''); setGiacNota('')
    setMsg({ t: 'ok', x: `Giacenza aggiornata: ${d.quantita}` }); carica()
  }

  async function elimina(a: any) {
    if (!confirm(`Togliere ${a.sku} dal catalogo?`)) return
    await fetch(`/api/catalogo?id=${a.id}&cliente_id=${clienteId}`, { method: 'DELETE' })
    carica()
  }

  async function importa(file: File) {
    setImportando(true); setMsg(null)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const righe: any[] = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
      if (!righe.length) { setMsg({ t: 'err', x: 'Il file è vuoto' }); setImportando(false); return }

      const col = mappa(Object.keys(righe[0]))
      if (!col.sku) {
        setMsg({ t: 'err', x: 'Non trovo la colonna dello SKU. Deve chiamarsi SKU (o Variant SKU, Codice, Seller SKU).' })
        setImportando(false); return
      }
      const articoli = righe.map(r => {
        const g = col.grammi ? num(r[col.grammi]) : null
        const kg = col.peso ? num(r[col.peso]) : null
        return {
          sku: String(r[col.sku] ?? '').trim(),
          nome: col.nome ? String(r[col.nome] ?? '').trim() : '',
          ean13: col.ean13 ? String(r[col.ean13] ?? '').trim() : '',
          asin: col.asin ? String(r[col.asin] ?? '').trim() : '',
          prezzo: col.prezzo ? num(r[col.prezzo]) : null,
          // Shopify esporta i grammi: qui si ragiona in chili, e la conversione la facciamo noi.
          // Il ripiego guarda la CELLA, non la colonna: nei fogli messi insieme a mano capita che
          // alcune righe abbiano i chili e altre solo i grammi, e guardando la colonna quelle a
          // grammi finivano in catalogo senza peso.
          peso: (kg && kg > 0) ? kg : (g != null && g > 0 ? g / 1000 : null),
          lunghezza: col.lunghezza ? num(r[col.lunghezza]) : null,
          larghezza: col.larghezza ? num(r[col.larghezza]) : null,
          altezza: col.altezza ? num(r[col.altezza]) : null,
          url_immagine: col.url_immagine ? String(r[col.url_immagine] ?? '').trim() : '',
          codice_hs: col.codice_hs ? String(r[col.codice_hs] ?? '').trim() : '',
          paese_origine: col.paese_origine ? String(r[col.paese_origine] ?? '').trim() : '',
          valore_dichiarato: col.valore_dichiarato ? num(r[col.valore_dichiarato]) : null,
          descrizione_doganale: col.descrizione_doganale ? String(r[col.descrizione_doganale] ?? '').trim() : '',
        }
      }).filter(a => a.sku)

      if (!articoli.length) { setMsg({ t: 'err', x: 'Nessuna riga con SKU' }); setImportando(false); return }

      // A blocchi: un foglio da migliaia di righe in una richiesta sola non arriva dall'altra parte.
      let salvati = 0
      for (let i = 0; i < articoli.length; i += 300) {
        const r = await fetch('/api/catalogo', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cliente_id: clienteId, articoli: articoli.slice(i, i + 300) }),
        })
        const d = await r.json()
        if (d?.error) { setMsg({ t: 'err', x: d.error }); setImportando(false); return }
        salvati += d?.salvati || 0
      }
      const riconosciute = Object.keys(col).filter(k => k !== 'grammi').length
      setMsg({ t: 'ok', x: `${salvati} articoli caricati (${riconosciute} colonne riconosciute). Gli SKU già presenti sono stati aggiornati.` })
      carica()
    } catch (e: any) {
      setMsg({ t: 'err', x: 'File non leggibile: ' + (e?.message || 'formato non riconosciuto') })
    }
    setImportando(false)
  }

  const nessunCliente = !clienteId

  return (
    <div>
      <div style={{ marginBottom: '18px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Catalogo prodotti</h1>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '4px', maxWidth: '760px', lineHeight: 1.6 }}>
          Peso e misure per ogni SKU. Quando l’articolo è in catalogo non c’è più da ridigitarli a ogni
          spedizione: li mette il sistema, e il peso volumetrico esce giusto.
        </p>
      </div>

      <div style={{ ...card, padding: '14px', marginBottom: '14px', display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: '240px' }}>
          <label style={{ display: 'block', fontSize: '11.5px', color: '#666', marginBottom: '4px' }}>Cliente</label>
          <SelectCercabile value={clienteId} onChange={e => { setClienteId(e.target.value); setForm(null); setMsg(null) }} style={{ ...inp, width: '100%' }}>
            <option value="">— scegli un cliente —</option>
            {clienti.map((c: any) => <option key={c.id} value={c.id}>{c.ragione_sociale || c.nome}</option>)}
          </SelectCercabile>
        </div>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <label style={{ display: 'block', fontSize: '11.5px', color: '#666', marginBottom: '4px' }}>Cerca</label>
          <input value={cerca} onChange={e => setCerca(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') carica(clienteId, cerca) }}
            placeholder="SKU, nome o codice a barre" disabled={nessunCliente} style={{ ...inp, width: '100%' }} />
        </div>
        <button onClick={() => { setForm({ sku: '', nome: '', _variante: '', _varianteOrig: '' }); setVarianti(false) }} disabled={nessunCliente}
          style={{ background: nessunCliente ? '#ccc' : ACCENT, color: '#fff', border: 'none', borderRadius: '6px', padding: '9px 16px', fontSize: '13px', fontWeight: 700, cursor: nessunCliente ? 'default' : 'pointer' }}>
          Nuovo articolo
        </button>
        <label style={{
          background: '#fff', color: nessunCliente ? '#bbb' : '#1a1a1a', border: '1px solid #d5d5d5', borderRadius: '6px',
          padding: '9px 16px', fontSize: '13px', fontWeight: 600, cursor: nessunCliente ? 'default' : 'pointer',
        }}>
          {importando ? 'Carico…' : 'Importa da file'}
          <input type="file" accept=".csv,.xlsx,.xls" disabled={nessunCliente || importando} style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) importa(f); e.currentTarget.value = '' }} />
        </label>
      </div>

      {msg && (
        <div style={{
          padding: '10px 14px', borderRadius: '6px', fontSize: '13px', marginBottom: '12px',
          background: msg.t === 'ok' ? '#f0fdf4' : '#fef2f2', color: msg.t === 'ok' ? '#166534' : '#991b1b',
          border: `1px solid ${msg.t === 'ok' ? '#bbf7d0' : '#fecaca'}`,
        }}>{msg.x}</div>
      )}

      {giac && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }} onClick={() => setGiac(null)}>
          <div style={{ background: '#fff', borderRadius: '8px', padding: '20px', width: '380px', maxWidth: '92%' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a' }}>{giacTipo === 'carico' ? 'È arrivata merce' : 'Correggi la giacenza'}</div>
            <div style={{ fontSize: '12.5px', color: '#666', margin: '4px 0 14px' }}>
              {giac.sku}{giac.nome ? ` · ${giac.nome}` : ''} — adesso ne risultano <b>{Number(giac.quantita ?? 0)}</b>
            </div>
            <label style={{ display: 'block', fontSize: '11.5px', color: '#666', marginBottom: '4px' }}>
              {giacTipo === 'carico' ? 'Quanti pezzi sono arrivati' : 'Quanti pezzi ci sono davvero'}
            </label>
            <input type="number" step="1" value={giacQta} autoFocus onChange={e => setGiacQta(e.target.value)} style={{ ...inp, width: '100%' }} />
            <label style={{ display: 'block', fontSize: '11.5px', color: '#666', margin: '10px 0 4px' }}>Nota (facoltativa)</label>
            <input value={giacNota} onChange={e => setGiacNota(e.target.value)} placeholder="es. bolla 1234" style={{ ...inp, width: '100%' }} />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button onClick={() => setGiac(null)} style={{ background: '#fff', color: '#555', border: '1px solid #d5d5d5', borderRadius: '6px', padding: '9px 16px', fontSize: '13px', cursor: 'pointer' }}>Annulla</button>
              <button onClick={salvaGiacenza} disabled={giacSalvo} style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: '6px', padding: '9px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: giacSalvo ? 0.6 : 1 }}>{giacSalvo ? 'Salvo…' : 'Salva'}</button>
            </div>
          </div>
        </div>
      )}

      {form && (
        <div style={{ ...card, padding: '16px', marginBottom: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a', marginBottom: '12px' }}>
            {form.id ? `Modifica ${form.sku}` : 'Nuovo articolo'}
          </div>
          {/* Il NOME resta sempre visibile: con le varianti diventa il nome del prodotto. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '10px' }}>
            {(((varianti && !form.id) ? [['nome', 'Nome del prodotto']] : [['sku', 'SKU *'], ['nome', 'Nome'], ['ean13', 'EAN13'], ['asin', 'ASIN'], ['prezzo', 'Prezzo €']]) as any[]).map(([k, l]: any) => (
              <div key={k}>
                <label style={{ display: 'block', fontSize: '11.5px', color: '#666', marginBottom: '4px' }}>{l}</label>
                <input value={form[k] ?? ''} onChange={e => setForm({ ...form, [k]: e.target.value })} style={{ ...inp, width: '100%' }} />
              </div>
            ))}
          </div>
          {/* UN SOLO PUNTO DI INGRESSO. Prima c'erano due tasti — "Nuovo articolo" e "Prodotto con
              varianti" — e uno doveva decidere PRIMA di cominciare quale dei due era il suo caso.
              Shopify ha un tasto solo e le varianti sono un'opzione dentro, che e' come uno ci
              pensa: "creo un prodotto... ah, e ne ho di tre colori". */}
          {!form.id && (
            <div style={{ margin: '14px 0 4px', padding: '10px 12px', background: '#fafafa', border: '1px solid #eee', borderRadius: '6px' }}>
              <label style={{ display: 'flex', gap: '8px', alignItems: 'center', cursor: 'pointer', fontSize: '13px', color: '#1a1a1a' }}>
                <input type="checkbox" checked={varianti} onChange={e => setVarianti(e.target.checked)} />
                <span>Questo prodotto ha <b>più varianti</b> (colore, taglia, gusto…)</span>
              </label>
              {varianti && <div style={{ fontSize: '11.5px', color: '#666', marginTop: '6px', marginLeft: '24px' }}>
                Definisci le opzioni qui sotto: le combinazioni escono da sole, una per riga, ognuna col suo SKU e la sua giacenza.
              </div>}
            </div>
          )}

          {varianti && !form.id ? (
            <div style={{ marginTop: '10px' }}>
              <GeneratoreVarianti prodotto={form.nome || ''} onSalva={salvaVarianti} salvataggio={creoVar} />
            </div>
          ) : (<>
          <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#666', margin: '14px 0 8px', textTransform: 'uppercase' }}>Prodotto e variante</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11.5px', color: '#666', marginBottom: '4px' }}>Prodotto <span style={{ color: '#999' }}>(raggruppa le varianti)</span></label>
              <input value={form.prodotto ?? ''} onChange={e => setForm({ ...form, prodotto: e.target.value })} placeholder="es. T-shirt logo" style={{ ...inp, width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11.5px', color: '#666', marginBottom: '4px' }}>Variante <span style={{ color: '#999' }}>(separa con la virgola)</span></label>
              <input value={form._variante ?? ''} onChange={e => setForm({ ...form, _variante: e.target.value })} placeholder="rosso, S" style={{ ...inp, width: '100%' }} />
            </div>
          </div>
          <div style={{ fontSize: '11.5px', color: '#999', marginTop: '6px' }}>
            Ogni variante è un articolo con il SUO SKU e la sua giacenza: la maglietta rossa S e la nera L sono due righe.
          </div>
          <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#666', margin: '14px 0 8px', textTransform: 'uppercase' }}>Dimensioni e peso</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '10px' }}>
            {([['peso', 'Peso (kg)'], ['lunghezza', 'Lunghezza (cm)'], ['larghezza', 'Larghezza (cm)'], ['altezza', 'Altezza (cm)']] as const).map(([k, l]) => (
              <div key={k}>
                <label style={{ display: 'block', fontSize: '11.5px', color: '#666', marginBottom: '4px' }}>{l}</label>
                <input value={form[k] ?? ''} onChange={e => setForm({ ...form, [k]: e.target.value })} inputMode="decimal" style={{ ...inp, width: '100%' }} />
              </div>
            ))}
          </div>
          <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#666', margin: '14px 0 8px', textTransform: 'uppercase' }}>Dogana (solo fuori UE)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '10px' }}>
            {([['descrizione_doganale', 'Descrizione doganale'], ['valore_dichiarato', 'Valore dichiarato €'], ['codice_hs', 'Codice HS'], ['codice_mid', 'Codice MID'], ['paese_origine', 'Paese di origine']] as const).map(([k, l]) => (
              <div key={k}>
                <label style={{ display: 'block', fontSize: '11.5px', color: '#666', marginBottom: '4px' }}>{l}</label>
                <input value={form[k] ?? ''} onChange={e => setForm({ ...form, [k]: e.target.value })} style={{ ...inp, width: '100%' }} />
              </div>
            ))}
          </div>
          </>)}
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
            {!(varianti && !form.id) && <button onClick={salva} style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: '6px', padding: '9px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Salva</button>}
            <button onClick={() => { setForm(null); setMsg(null) }} style={{ background: '#fff', color: '#555', border: '1px solid #d5d5d5', borderRadius: '6px', padding: '9px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Annulla</button>
          </div>
        </div>
      )}

      <div style={card}>
        {nessunCliente ? (
          <div style={{ padding: '46px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>Scegli un cliente per vedere il suo catalogo.</div>
        ) : caricando ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>Caricamento…</div>
        ) : !articoli.length ? (
          <div style={{ padding: '46px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>
            Nessun articolo in catalogo. Puoi caricarli da un file: basta che ci sia una colonna SKU.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#fafafa' }}>
                <th style={th}>SKU</th><th style={th}>Nome</th><th style={th}>Prodotto · variante</th>
                <th style={th}>Giacenza</th><th style={th}>Peso</th><th style={th}>Misure (cm)</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {articoli.map((a: any) => {
                  const misure = [a.lunghezza, a.larghezza, a.altezza].filter(Boolean)
                  return (
                    <tr key={a.id}>
                      <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{a.sku}</td>
                      <td style={td}>{a.nome || '—'}</td>
                      <td style={td}>
                        {a.prodotto ? <div style={{ fontWeight: 600 }}>{a.prodotto}</div> : null}
                        {a.attributi && Object.keys(a.attributi).length
                          ? <div style={{ fontSize: '12px', color: '#8a8a8a' }}>{Object.values(a.attributi).filter(Boolean).join(' · ')}</div>
                          : (!a.prodotto ? <span style={{ color: '#c8c8c8' }}>—</span> : null)}
                      </td>
                      {/* La giacenza si legge e basta: si muove dal carico o dal portale del cliente,
                          perche' e' il saldo del registro dei movimenti e non un campo della scheda. */}
                      <td style={{ ...td, fontWeight: 700, color: Number(a.quantita) < 0 ? '#b91c1c' : Number(a.quantita) > 0 ? '#15803d' : '#c8c8c8' }}>
                        {Number(a.quantita ?? 0)}
                        <button onClick={() => { setGiac(a); setGiacTipo('carico'); setGiacQta(''); setGiacNota('') }} title="E' arrivata merce"
                          style={{ marginLeft: '8px', background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 700, padding: '1px 7px' }}>+</button>
                        <button onClick={() => { setGiac(a); setGiacTipo('inventario'); setGiacQta(String(a.quantita ?? 0)); setGiacNota('') }} title="Ho contato: correggi"
                          style={{ marginLeft: '4px', background: '#fff', color: '#666', border: '1px solid #e5e5e5', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', padding: '1px 7px' }}>=</button>
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {a.peso ? `${Number(a.peso).toFixed(3).replace(/\.?0+$/, '')} kg`
                          : <span style={{ color: '#d97706' }}>manca</span>}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {misure.length === 3 ? misure.map((m: any) => Number(m)).join(' × ')
                          : <span style={{ color: '#d97706' }}>mancano</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right' as const, whiteSpace: 'nowrap' }}>
                        <button onClick={() => { const t = Object.values(a.attributi || {}).filter(Boolean).join(', '); setForm({ ...a, _variante: t, _varianteOrig: t }) }} style={{ background: 'none', border: 'none', color: ACCENT, fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}>Modifica</button>
                        <button onClick={() => elimina(a)} style={{ background: 'none', border: 'none', color: '#8a8a8a', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', marginLeft: '10px' }}>Elimina</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
