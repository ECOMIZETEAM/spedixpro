import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { siglaProvincia, SIGLE_IT } from '@/lib/province-it'
import { normalizzaPaese } from '@/lib/paesi'
import comuniIT from '@/lib/data/comuni.json'
import frazioniIT from '@/lib/data/frazioni.json'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

// Normalizza gli header: "Shipping Address1" -> "shipping_address1", "Località" -> "localita"
function normHeader(s: string) {
  return (s || '').toString()
    .replace(/﻿/g, '')            // via il BOM (Amazon/Excel lo mettono davanti alla 1ª colonna)
    .trim().toLowerCase()
    .replace(/[àá]/g, 'a').replace(/[èé]/g, 'e').replace(/[ìí]/g, 'i')
    .replace(/[òó]/g, 'o').replace(/[ùú]/g, 'u')
    .replace(/\s+/g, '_')
    .replace(/[^\w]/g, '')              // i trattini (Amazon: "ship-postal-code") vengono rimossi -> "shippostalcode"
}

// Campo interno -> possibili header (normalizzati). Vince il primo presente nel file.
// Copre il nostro template + export Shopify + varianti eBay/Amazon comuni.
// NB: gli header vengono normalizzati con normHeader: gli spazi diventano "_"
// (Shopify: "Shipping Address1" -> "shipping_address1") e i trattini VENGONO RIMOSSI
// (Amazon: "ship-postal-code" -> "shippostalcode"). Perciò per Amazon servono le
// forme CONCATENATE (senza separatore), che aggiungo qui accanto a quelle Shopify.
// TEMU: l'export ordini e' tutto in italiano, con header lunghi. Normalizzati (spazi->_, accenti
// tolti, apostrofi e parentesi rimossi come ogni altro non-parola): "ID Ordine"->id_ordine,
// "città di spedizione"->citta_di_spedizione, "nome dell'articolo"->nome_dellarticolo,
// "codice postale di spedizione (…)"->codice_postale_di_spedizione_... (parentesi via). Aggiunti
// qui accanto a Shopify/Amazon/eBay: cosi' i tre marketplace + Temu passano dallo stesso import.
const ALIAS: Record<string, string[]> = {
  destinatario:       ['destinatario', 'shipping_name', 'ship_to_name', 'recipient_name', 'recipientname', 'nome_destinatario', 'buyer_name', 'buyername', 'nome_e_cognome', 'nome_completo_del_destinatario'],
  indirizzo:          ['indirizzo', 'shipping_address1', 'ship_to_address_1', 'shipaddress1', 'address1', 'shipping_street', 'shipping_address_1', 'indirizzo_spedizione', 'via', 'indirizzo_di_spedizione_1'],
  indirizzo2:         ['indirizzo2', 'shipping_address2', 'shipping_address_2', 'shipaddress2', 'address2', 'indirizzo_di_spedizione_2'],
  cap:                ['cap', 'shipping_zip', 'ship_to_zip', 'shippostalcode', 'shipping_postal_code', 'shipping_zip_code', 'zip', 'postal_code', 'postcode', 'cap_destinatario', 'codice_postale_di_spedizione_la_spedizione_deve_essere_effettuata_al_seguente_cap', 'codice_postale_di_spedizione'],
  localita:           ['localita', 'shipping_city', 'ship_to_city', 'shipcity', 'shipping_town', 'city', 'citta', 'comune', 'citta_di_spedizione'],
  provincia:          ['provincia', 'shipping_province', 'ship_to_state', 'shipstate', 'state', 'province', 'shipping_province_name', 'stato_di_spedizione'],
  country:            ['country', 'shipping_country', 'ship_to_country', 'shipcountry', 'paese', 'nazione', 'paese_di_spedizione'],
  telefono:           ['telefono', 'shipping_phone', 'phone', 'shipphonenumber', 'buyer_phone', 'buyerphonenumber', 'telefono_destinatario', 'cellulare', 'numero_di_telefono_del_destinatario'],
  email_destinatario: ['email_destinatario', 'email', 'buyer_email', 'buyeremail', 'ship_to_email', 'email_virtuale'],
  peso:               ['peso', 'weight', 'peso_kg'],
  colli:              ['colli', 'packages', 'pacchi'],
  contrassegno:       ['contrassegno', 'cod', 'cash_on_delivery'],
  contenuto:          ['contenuto', 'sku', 'lineitem_sku', 'seller_sku', 'sellersku', 'lineitem_name', 'item_name', 'product_name', 'productname', 'descrizione', 'articolo', 'nome_dellarticolo', 'codice_sku'],
  note:               ['note', 'notes', 'order_note', 'note_ordine'],
  rif_mittente:       ['rif_mittente', 'riferimento_mittente'],
  rif_destinatario:   ['rif_destinatario', 'riferimento_destinatario'],
  // Amazon usa 'amazon-order-id' (normalizzato -> 'amazonorderid'): senza questo alias i suoi report
  // NON venivano riconosciuti come ordine, quindi le righe multi-articolo non venivano raggruppate
  // (lineMode restava falso) e l'order_id restava vuoto, rendendo poi inutilizzabile il file di
  // conferma da rimandare ad Amazon (colonna 'order-id' vuota). 'merchant-order-id' e' l'altro nome.
  order_id:           ['order_id', 'orderid', 'name', 'order_number', 'order', 'numero_ordine', 'ordine', 'id_ordine', 'amazonorderid', 'amazon_order_id', 'merchantorderid'],
  totale_ordine:      ['totale_ordine', 'total', 'order_total', 'importo', 'totale', 'item_price', 'itemprice', 'totale_prezzo_al_dettaglio_dopo_lo_sconto_imposte_escluse', 'prezzo_base_della_merce'],
}
// Colonne ausiliarie (non salvate ma usate per logica: line item, contrassegno, ecc.)
const AUX: Record<string, string[]> = {
  sku:           ['sku', 'lineitem_sku', 'lineitemsku', 'seller_sku', 'sellersku', 'codice_sku'],   // SOLO lo SKU (Amazon 'sku' / Shopify 'Lineitem sku' / Temu 'Codice SKU'), per il match col catalogo pacchi
  lineitem_name: ['sku', 'lineitem_sku', 'seller_sku', 'sellersku', 'lineitem_name', 'item_name', 'product_name', 'productname', 'codice_sku', 'nome_dellarticolo'],
  lineitem_qty:  ['lineitem_quantity', 'quantity', 'qty', 'quantita', 'quantity_purchased', 'quantitypurchased', 'quantita_acquistata', 'quantita_da_spedire'],
  // ID riga ordine (Amazon "order-item-id", Temu "ID articolo dell'ordine"): serve per confermare la
  // spedizione di OGNI articolo di un ordine multi-SKU (senza, si evade solo il primo).
  lineitem_orderitemid: ['orderitemid', 'order_item_id', 'id_articolo_dellordine'],
  // Nome prodotto e variante/colore per il riepilogo ordine (separati dallo SKU)
  lineitem_prodotto: ['lineitem_name', 'item_name', 'product_name', 'productname', 'title', 'product_title', 'descrizione', 'nome_dellarticolo', 'nome_articolo_in_base_allordine_utente'],
  lineitem_variante: ['lineitem_variant', 'lineitem_variant_title', 'variant', 'variante', 'variant_title', 'colore', 'color', 'variazione'],
  payment:       ['payment_method', 'metodo_pagamento'],
  shippingm:     ['shipping_method', 'metodo_spedizione', 'ship_service_level', 'shipservicelevel'],
  financial:     ['financial_status', 'payment_status', 'stato_pagamento'],
}

// LA PROVINCIA NON LA SI CHIEDE A CHI IMPORTA: SI RICAVA DAL CAP.
// Amazon nell'ordine non la scrive proprio ("Lovere, 24065", "Bologna, 40139"), e finche' era fra
// i campi obbligatori quegli ordini venivano SCARTATI — con un messaggio che diceva "dati
// destinatario incompleti" senza dire quale dato. Due ordini veri persi cosi'.
// L'elenco dei comuni ce l'abbiamo gia' in casa (lib/data/comuni.json, 7.904 comuni, piu' 9.878
// frazioni): dal CAP alla sigla e' una lettura, non un indovinello. 24065 -> BG, 40139 -> BO.
// Se un CAP appartenesse a piu' province non si tira a indovinare: si lascia vuota e la riga entra
// lo stesso, correggibile a mano dalla lista. Meglio un ordine da completare che un ordine perso.
const CAP_PROVINCIA: Map<string, string> = (() => {
  const m = new Map<string, string>()
  const ambigui = new Set<string>()
  const aggiungi = (cap: string, sigla: string) => {
    const c = String(cap || '').trim()
    const s = String(sigla || '').toUpperCase().trim()
    if (!/^\d{5}$/.test(c) || s.length !== 2) return
    const gia = m.get(c)
    if (gia && gia !== s) { ambigui.add(c); m.delete(c); return }
    if (!ambigui.has(c)) m.set(c, s)
  }
  for (const c of (comuniIT as any[])) for (const cap of (c.cap || [])) aggiungi(cap, c.sigla)
  for (const f of (frazioniIT as any[])) aggiungi(f.cap, f.sigla)
  return m
})()

const REQUIRED = ['destinatario', 'indirizzo', 'cap', 'localita']

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
  const cap = String(v ?? '').replace(/^'/, '').replace(/\s+/g, '').trim()
  // Excel/xlsx mangiano gli zeri iniziali dei CAP ("00142" -> "142"): ripristino a 5 cifre.
  if (/^\d{1,4}$/.test(cap)) return cap.padStart(5, '0')
  return cap
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
    // NON basta dire quali colonne mancano: chi carica ha esportato QUALCOSA da Shopify, e da lì
    // si esportano due file diversi che si somigliano nel nome. Uno ha gli indirizzi, l'altro no.
    // Elencargli "cap, localita, provincia" lo lascia a cercare colonne che nel suo file non
    // possono esserci, e la volta dopo riprova con lo stesso file.
    const h = headers
    const eReportVendite = (h.has('order_name') || h.has('ordine')) && (h.has('total_sales') || h.has('vendite_totali'))
      && !h.has('shipping_zip') && !h.has('shipping_address1')
    const eSoloAnagrafica = h.has('customer_name') || h.has('nome_cliente')

    if (eReportVendite || (eSoloAnagrafica && missing.length >= 4)) {
      return NextResponse.json({
        error: 'Questo è il report delle VENDITE, non degli ordini: dentro ci sono numero, data e importo, ma nessun indirizzo di spedizione. '
          + 'Da Shopify serve l\'altro export: Ordini → seleziona gli ordini → Esporta → "CSV per Excel". '
          + 'Quel file contiene Shipping Name, Shipping Address, Shipping Zip, Shipping City e Shipping Province, e si carica così com\'è.',
      }, { status: 400 })
    }

    // Caso generico: si dice anche cosa il file CONTIENE, così si vede subito se e' il file giusto.
    const trovate = [...headers].slice(0, 12).join(', ')
    return NextResponse.json({
      error: `Nel file mancano le colonne: ${missing.join(', ')}. Nel file ho trovato invece: ${trovate}. `
        + 'Serve un export che contenga l\'indirizzo di spedizione (Shopify: Ordini → Esporta; Amazon: report degli ordini; eBay: export vendite) oppure il nostro template.',
    }, { status: 400 })
  }

  const g = (r: any, field: string) => (M[field] ? String(r[M[field]!] ?? '').trim() : '')

  // Raggruppo gli ordini multi-riga (Shopify: 1 riga per prodotto, dati spedizione solo sulla 1a).
  // Attivo il raggruppamento solo quando c'è la colonna line item + un identificativo ordine.
  const lineMode = !!A.lineitem_name && !!M.order_id
  type Gruppo = { oid: string; header: any; items: string[]; articoli: any[] }
  const gruppi: Gruppo[] = []
  if (lineMode) {
    // Raggruppo per order_id usando una MAPPA, non solo il confronto con la riga precedente: cosi'
    // le righe dello stesso ordine vengono unite anche se NON sono consecutive. Amazon, a differenza
    // di Shopify, non sempre ordina il file per order-id: con il vecchio confronto "diverso dal
    // precedente" lo stesso ordine si spezzava in piu' gruppi (e in piu' spedizioni).
    const perOid = new Map<string, Gruppo>()
    let cur: Gruppo | null = null
    for (const r of rows) {
      const oid = g(r, 'order_id')
      const haDest = !!g(r, 'destinatario')
      if (oid) {
        const esistente = perOid.get(oid)
        if (esistente) {
          // Ordine gia' visto (anche non consecutivo): stesso gruppo. Se la prima riga non aveva
          // destinatario e questa si', la promuovo a header.
          cur = esistente
          if (haDest && !g(cur.header, 'destinatario')) cur.header = r
        } else {
          cur = { oid, header: r, items: [], articoli: [] }
          perOid.set(oid, cur)
          gruppi.push(cur)
        }
      } else if (!cur) {
        // Riga senza id ordine e nessun gruppo aperto: ordine a se'.
        cur = { oid: 'r' + gruppi.length, header: r, items: [], articoli: [] }
        gruppi.push(cur)
      } else if (haDest && !g(cur.header, 'destinatario')) {
        // Riga di continuazione (id ordine vuoto) che porta il destinatario: promuovila a header.
        cur.header = r
      }
      // Accumulo il prodotto di questa riga (stringa contenuto + articolo strutturato per il riepilogo)
      const li = A.lineitem_name ? String(r[A.lineitem_name] ?? '').trim() : ''
      if (li) {
        const q = A.lineitem_qty ? (toNum(r[A.lineitem_qty]) ?? 1) : 1
        const nome = (A.lineitem_prodotto ? String(r[A.lineitem_prodotto] ?? '').trim() : '') || li
        const skuItem = A.sku ? String(r[A.sku] ?? '').trim() : ''
        const variante = A.lineitem_variante ? String(r[A.lineitem_variante] ?? '').trim() : ''
        const orderItemId = A.lineitem_orderitemid ? String(r[A.lineitem_orderitemid] ?? '').trim() : ''
        cur.items.push(`${q}× ${li}`)
        cur.articoli.push({ quantita: q, nome, sku: skuItem || null, variante: variante || null, order_item_id: orderItemId || null })
      }
    }
  } else {
    for (const r of rows) gruppi.push({ oid: g(r, 'order_id'), header: r, items: [], articoli: [] })
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

    // La provincia si ricava dal CAP quando manca o non e' una sigla valida (Amazon scrive il nome
    // esteso, o niente del tutto). Solo dopo si decide se la riga e' completa.
    let provFinale = siglaProvincia(prov)
    if (!SIGLE_IT.has(provFinale)) provFinale = CAP_PROVINCIA.get(cap) || ''

    // IL MESSAGGIO DICE QUALE CAMPO MANCA. Prima diceva solo "dati destinatario incompleti", e chi
    // lo leggeva non aveva modo di sapere cosa correggere nel proprio gestionale.
    const mancanti = [
      !dest && 'nome destinatario', !ind && 'indirizzo', !cap && 'CAP', !loc && 'citta',
    ].filter(Boolean) as string[]
    if (mancanti.length) {
      errori.push({ riga: i + 2, motivo: `Ordine ${grp.oid || i + 1}: manca ${mancanti.join(', ')}` })
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
      provincia: provFinale,   // nome esteso -> sigla, oppure ricavata dal CAP se Amazon non la scrive
      country: normalizzaPaese(g(r, 'country')),   // "Italia"/"Italy" -> "IT" (Temu esporta il paese esteso)
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
      articoli: grp.articoli.length ? grp.articoli : null,   // righe prodotto strutturate per il riepilogo ordine
      sku: (A.sku ? String(r[A.sku] ?? '').trim() : '') || null,   // SKU per il match automatico col catalogo pacchi
      fonte: 'csv',
      stato: 'da_spedire',
      raw: r,
    })
  })

  if (!records.length) {
    return NextResponse.json({ error: 'Nessun ordine valido trovato nel file', errori }, { status: 400 })
  }

  // PROVINCIA SPORCA (es. Amazon: "ITALIA", "ISCHIA"): se dopo la conversione non e' una sigla
  // valida, la ricavo dal CAP usando lo STORICO spedizioni (provincia piu' frequente per quel CAP).
  const daRisolvere = records.filter(r => (r.country || 'IT') === 'IT' && !SIGLE_IT.has(r.provincia))
  if (daRisolvere.length) {
    const adminDb = createAdminSupabase()
    for (const rec of daRisolvere.slice(0, 40)) {
      try {
        const { data: sps } = await adminDb.from('spedizioni')
          .select('dest_provincia').eq('dest_cap', rec.cap).not('dest_provincia', 'is', null).limit(50)
        const conta = new Map<string, number>()
        for (const s of (sps || [])) {
          const pv = String(s.dest_provincia || '').toUpperCase().trim()
          if (SIGLE_IT.has(pv)) conta.set(pv, (conta.get(pv) || 0) + 1)
        }
        const top = [...conta.entries()].sort((a, b) => b[1] - a[1])[0]
        if (top) rec.provincia = top[0]
      } catch { /* resta com'e': modificabile a mano dalla lista */ }
    }
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
