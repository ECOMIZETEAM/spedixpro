import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export const runtime = 'nodejs'

// Normalizza gli header: "Shipping Address1" -> "shipping_address1", "Località" -> "localita"
function normHeader(s: string) {
  return (s || '').toString().trim().toLowerCase()
    .replace(/[àá]/g, 'a').replace(/[èé]/g, 'e').replace(/[ìí]/g, 'i')
    .replace(/[òó]/g, 'o').replace(/[ùú]/g, 'u')
    .replace(/\s+/g, '_')
    .replace(/[^\w]/g, '')
}

// Campo interno -> possibili header (normalizzati). Vince il primo presente nel file.
// Copre il nostro template + export Shopify + varianti eBay/Amazon comuni.
const ALIAS: Record<string, string[]> = {
  destinatario:       ['destinatario', 'shipping_name', 'ship_to_name', 'recipient_name', 'nome_destinatario', 'buyer_name', 'nome_e_cognome'],
  indirizzo:          ['indirizzo', 'shipping_address1', 'ship_to_address_1', 'address1', 'indirizzo_spedizione', 'via'],
  indirizzo2:         ['indirizzo2', 'shipping_address2', 'address2'],
  cap:                ['cap', 'shipping_zip', 'ship_to_zip', 'zip', 'postal_code', 'cap_destinatario'],
  localita:           ['localita', 'shipping_city', 'ship_to_city', 'city', 'citta', 'comune'],
  provincia:          ['provincia', 'shipping_province', 'ship_to_state', 'state', 'province', 'shipping_province_name'],
  country:            ['country', 'shipping_country', 'ship_to_country', 'paese', 'nazione'],
  telefono:           ['telefono', 'shipping_phone', 'phone', 'buyer_phone', 'telefono_destinatario', 'cellulare'],
  email_destinatario: ['email_destinatario', 'email', 'buyer_email', 'ship_to_email'],
  peso:               ['peso', 'weight', 'peso_kg'],
  colli:              ['colli', 'packages', 'pacchi'],
  contrassegno:       ['contrassegno', 'cod', 'cash_on_delivery'],
  contenuto:          ['contenuto', 'lineitem_name', 'item_name', 'product_name', 'descrizione', 'articolo'],
  note:               ['note', 'notes', 'order_note', 'note_ordine'],
  rif_mittente:       ['rif_mittente', 'riferimento_mittente'],
  rif_destinatario:   ['rif_destinatario', 'riferimento_destinatario'],
  order_id:           ['order_id', 'name', 'order_number', 'order', 'numero_ordine', 'ordine'],
  totale_ordine:      ['totale_ordine', 'total', 'order_total', 'importo', 'totale'],
}
// Colonne ausiliarie (non salvate ma usate per logica: line item, contrassegno, ecc.)
const AUX: Record<string, string[]> = {
  lineitem_name: ['lineitem_name', 'item_name', 'product_name'],
  lineitem_qty:  ['lineitem_quantity', 'quantity', 'qty', 'quantita'],
  payment:       ['payment_method', 'metodo_pagamento'],
  shippingm:     ['shipping_method', 'metodo_spedizione'],
  financial:     ['financial_status', 'payment_status', 'stato_pagamento'],
}

const REQUIRED = ['destinatario', 'indirizzo', 'cap', 'localita', 'provincia']

function pick(headers: Set<string>, aliases: string[]): string | null {
  for (const a of aliases) if (headers.has(a)) return a
  return null
}
function toNum(v: any): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null
  const n = parseFloat(String(v).replace(/[^0-9,.-]/g, '').replace(',', '.'))
  return isNaN(n) ? null : n
}
function cleanCap(v: any): string {
  // Shopify esporta il CAP come '05100 per non perdere lo zero iniziale
  return String(v ?? '').replace(/^'/, '').replace(/\s+/g, '').trim()
}
const isCod = (s: string) => /contrassegn|cash\s*on\s*delivery|\bcod\b/i.test(s || '')

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente') {
    return NextResponse.json({ error: 'Solo i clienti possono importare ordini' }, { status: 403 })
  }
  const clienteId = utente.cliente_id
  if (!clienteId) return NextResponse.json({ error: 'Cliente non associato all\'utente' }, { status: 400 })

  const { data: cliente } = await supabase
    .from('clienti').select('master_id').eq('id', clienteId).single()
  if (!cliente) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
  const masterId = cliente.master_id

  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Nessun file caricato' }, { status: 400 })

  // Leggo CSV o Excel (Amazon/eBay esportano spesso .xlsx)
  let rows: Record<string, string>[] = []
  const fname = (file.name || '').toLowerCase()
  try {
    if (fname.endsWith('.xlsx') || fname.endsWith('.xls')) {
      const buf = Buffer.from(await file.arrayBuffer())
      const wb = XLSX.read(buf, { type: 'buffer' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '', raw: false })
      rows = json.map(o => {
        const n: Record<string, string> = {}
        for (const k of Object.keys(o)) n[normHeader(k)] = o[k] == null ? '' : String(o[k])
        return n
      })
    } else {
      const text = await file.text()
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true, skipEmptyLines: true, transformHeader: normHeader,
      })
      rows = (parsed.data || []).filter(Boolean)
    }
  } catch (e: any) {
    return NextResponse.json({ error: 'File non leggibile: ' + (e?.message || e) }, { status: 400 })
  }
  if (!rows.length) return NextResponse.json({ error: 'File vuoto o non leggibile' }, { status: 400 })

  // Risolvo le colonne per NOME (auto-mapping)
  const headers = new Set(Object.keys(rows[0] || {}))
  const M: Record<string, string | null> = {}
  for (const field of Object.keys(ALIAS)) M[field] = pick(headers, ALIAS[field])
  const A: Record<string, string | null> = {}
  for (const k of Object.keys(AUX)) A[k] = pick(headers, AUX[k])

  const missing = REQUIRED.filter(f => !M[f])
  if (missing.length) {
    return NextResponse.json({
      error: `Colonne non riconosciute nel file: ${missing.join(', ')}. Usa un export Shopify/eBay/Amazon oppure il nostro template.`,
    }, { status: 400 })
  }

  const g = (r: any, field: string) => (M[field] ? String(r[M[field]!] ?? '').trim() : '')

  // Raggruppo gli ordini multi-riga (Shopify: 1 riga per prodotto, dati spedizione solo sulla 1a).
  // Attivo il raggruppamento solo quando c'è la colonna line item + un identificativo ordine.
  const lineMode = !!A.lineitem_name && !!M.order_id
  type Gruppo = { oid: string; header: any; items: string[] }
  const gruppi: Gruppo[] = []
  if (lineMode) {
    let cur: Gruppo | null = null
    for (const r of rows) {
      const oid = g(r, 'order_id')
      const haDest = !!g(r, 'destinatario')
      // Nuovo ordine: ha un id ordine diverso dal precedente (le righe di continuazione ripetono lo stesso id)
      if (oid && (!cur || oid !== cur.oid)) {
        cur = { oid, header: r, items: [] }
        gruppi.push(cur)
      } else if (!cur) {
        cur = { oid: oid || 'r' + gruppi.length, header: r, items: [] }
        gruppi.push(cur)
      } else if (haDest && !g(cur.header, 'destinatario')) {
        // la prima riga non aveva destinatario ma questa sì: promuovila a header
        cur.header = r
      }
      // Accumulo il prodotto di questa riga
      const li = A.lineitem_name ? String(r[A.lineitem_name] ?? '').trim() : ''
      if (li) {
        const q = A.lineitem_qty ? (toNum(r[A.lineitem_qty]) ?? 1) : 1
        cur.items.push(`${q}× ${li}`)
      }
    }
  } else {
    for (const r of rows) gruppi.push({ oid: g(r, 'order_id'), header: r, items: [] })
  }

  const records: any[] = []
  const errori: { riga: number; motivo: string }[] = []

  gruppi.forEach((grp, i) => {
    const r = grp.header
    const dest = g(r, 'destinatario')
    const a1 = g(r, 'indirizzo')
    const a2 = M.indirizzo2 ? String(r[M.indirizzo2!] ?? '').trim() : ''
    const ind = [a1, a2].filter(Boolean).join(' ')
    const cap = cleanCap(M.cap ? r[M.cap] : '')
    const loc = g(r, 'localita')
    const prov = g(r, 'provincia')

    if (!dest || !ind || !cap || !loc || !prov) {
      errori.push({ riga: i + 2, motivo: `Ordine ${grp.oid || i + 1}: dati destinatario incompleti` })
      return
    }

    // Contenuto = elenco prodotti dell'ordine (o colonna contenuto del nostro template)
    const contenuto = grp.items.length ? grp.items.join(', ') : (g(r, 'contenuto') || null)

    // Contrassegno: dal nostro template, oppure dedotto per gli ordini in contrassegno.
    // Regola: se il pagamento non è ancora incassato (pending/unpaid/authorized) o il metodo è
    // esplicitamente COD, l'intero TOTALE dell'ordine va in contrassegno (da incassare alla consegna).
    let contrassegno = M.contrassegno ? (toNum(r[M.contrassegno!]) ?? 0) : 0
    const totale = M.totale_ordine ? toNum(r[M.totale_ordine!]) : null
    if (!contrassegno && totale) {
      const metodo = (A.payment ? String(r[A.payment] ?? '') : '') + ' ' + (A.shippingm ? String(r[A.shippingm] ?? '') : '')
      const fin = (A.financial ? String(r[A.financial] ?? '') : '').trim().toLowerCase()
      const inAttesa = ['pending', 'unpaid', 'authorized', 'partially_paid', 'in attesa', 'non pagato'].includes(fin)
      if (isCod(metodo) || inAttesa) contrassegno = totale
    }

    records.push({
      master_id: masterId,
      cliente_id: clienteId,
      destinatario: dest,
      indirizzo: ind,
      cap,
      localita: loc,
      provincia: prov.length <= 4 ? prov.toUpperCase() : prov,
      country: (g(r, 'country').toUpperCase()) || 'IT',
      telefono: g(r, 'telefono') || null,
      email_destinatario: g(r, 'email_destinatario') || null,
      peso: M.peso ? toNum(r[M.peso!]) : null,
      colli: Math.max(1, Math.round((M.colli ? toNum(r[M.colli!]) : null) ?? 1)),
      contrassegno,
      contenuto,
      note: g(r, 'note') || null,
      rif_mittente: g(r, 'rif_mittente') || null,
      rif_destinatario: g(r, 'rif_destinatario') || null,
      order_id: grp.oid || null,
      totale_ordine: totale,
      fonte: 'csv',
      stato: 'da_spedire',
      raw: r,
    })
  })

  if (!records.length) {
    return NextResponse.json({ error: 'Nessun ordine valido trovato nel file', errori }, { status: 400 })
  }

  const { data: inserted, error } = await supabase
    .from('ordini_importati').insert(records).select('id')
  if (error) return NextResponse.json({ error: `Errore salvataggio: ${error.message}` }, { status: 500 })

  return NextResponse.json({
    importati: inserted?.length || 0,
    scartati: errori.length,
    errori,
  })
}
