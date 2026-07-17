import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export const runtime = 'nodejs'

// Import catalogo articoli (SKU -> peso + misure opzionali). Auto-mappa l'export PRODOTTI di Shopify
// ('Variant SKU' + 'Variant Grams') e un formato generico (sku;peso;lunghezza;larghezza;altezza;nome).
function normHeader(s: string) {
  return (s || '').toString()
    .replace(/﻿/g, '').trim().toLowerCase()
    .replace(/[àá]/g, 'a').replace(/[èé]/g, 'e').replace(/[ìí]/g, 'i')
    .replace(/[òó]/g, 'o').replace(/[ùú]/g, 'u')
    .replace(/\s+/g, '_').replace(/[^\w]/g, '')
}
const ALIAS: Record<string, string[]> = {
  sku:        ['variant_sku', 'sku', 'seller_sku', 'sellersku', 'lineitem_sku', 'lineitemsku', 'codice', 'codice_articolo', 'articolo'],
  nome:       ['title', 'nome', 'name', 'product_name', 'productname', 'descrizione', 'product_title'],
  grammi:     ['variant_grams', 'grams', 'grammi'],
  peso:       ['peso', 'weight', 'peso_kg', 'pesokg', 'variant_weight'],
  lunghezza:  ['lunghezza', 'length', 'lungh', 'lung'],
  larghezza:  ['larghezza', 'width', 'largh', 'larg'],
  altezza:    ['altezza', 'height', 'alt'],
}
function pick(headers: Set<string>, aliases: string[]): string | null {
  for (const a of aliases) if (headers.has(a)) return a
  return null
}
function toNum(v: any): number {
  if (v == null || String(v).trim() === '') return 0
  const n = parseFloat(String(v).replace(/[^0-9,.-]/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('ruolo,cliente_id,master_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Solo i clienti possono importare il catalogo' }, { status: 403 })
  }

  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Nessun file' }, { status: 400 })

  let rows: Record<string, string>[] = []
  const fname = (file.name || '').toLowerCase()
  try {
    if (fname.endsWith('.xlsx') || fname.endsWith('.xls')) {
      const buf = Buffer.from(await file.arrayBuffer())
      const wb = XLSX.read(buf, { type: 'buffer' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '', raw: false })
      rows = json.map(o => { const n: Record<string, string> = {}; for (const k of Object.keys(o)) n[normHeader(k)] = o[k] == null ? '' : String(o[k]); return n })
    } else {
      const text = await file.text()
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: normHeader })
      rows = (parsed.data || []).filter(Boolean)
    }
  } catch (e: any) {
    return NextResponse.json({ error: 'File non leggibile: ' + (e?.message || e) }, { status: 400 })
  }
  if (!rows.length) return NextResponse.json({ error: 'File vuoto o non leggibile' }, { status: 400 })

  const headers = new Set(Object.keys(rows[0] || {}))
  const M: Record<string, string | null> = {}
  for (const f of Object.keys(ALIAS)) M[f] = pick(headers, ALIAS[f])
  if (!M.sku) return NextResponse.json({ error: 'Nessuna colonna SKU riconosciuta nel file (attesa "Variant SKU" o "sku").' }, { status: 400 })
  if (!M.grammi && !M.peso) return NextResponse.json({ error: 'Nessuna colonna peso riconosciuta (attesa "Variant Grams" o "peso").' }, { status: 400 })

  // Costruisco i record: uno per SKU (l'ultimo vince in caso di duplicati nel file)
  const perSku = new Map<string, any>()
  let scartati = 0
  for (const r of rows) {
    const sku = String(r[M.sku!] ?? '').trim()
    if (!sku) { scartati++; continue }
    // Peso: preferisco i grammi Shopify (->kg), altrimenti il campo peso (già in kg)
    let peso = 0
    if (M.grammi && String(r[M.grammi] ?? '').trim() !== '') peso = Math.round((toNum(r[M.grammi]) / 1000) * 1000) / 1000
    else if (M.peso) peso = toNum(r[M.peso])
    perSku.set(sku.toLowerCase(), {
      cliente_id: utente.cliente_id, master_id: utente.master_id,
      sku, nome: M.nome ? (String(r[M.nome] ?? '').trim() || null) : null,
      peso,
      lunghezza: M.lunghezza ? toNum(r[M.lunghezza]) : 0,
      larghezza: M.larghezza ? toNum(r[M.larghezza]) : 0,
      altezza: M.altezza ? toNum(r[M.altezza]) : 0,
      updated_at: new Date().toISOString(),
    })
  }
  const records = Array.from(perSku.values())
  if (!records.length) return NextResponse.json({ error: 'Nessuno SKU valido nel file' }, { status: 400 })

  // Upsert a blocchi per (cliente_id, sku)
  let salvati = 0
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500)
    const { error } = await supabase.from('articoli_cliente').upsert(chunk, { onConflict: 'cliente_id,sku', ignoreDuplicates: false })
    if (error) return NextResponse.json({ error: error.message, salvati }, { status: 400 })
    salvati += chunk.length
  }

  return NextResponse.json({ ok: true, salvati, scartati, colonne: { sku: M.sku, peso: M.grammi || M.peso, misure: !!(M.lunghezza || M.larghezza || M.altezza) } })
}
