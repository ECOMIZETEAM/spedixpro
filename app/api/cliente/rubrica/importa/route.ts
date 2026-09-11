import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export const runtime = 'nodejs'

// Import RUBRICA DESTINATARI del cliente (CSV/XLSX). Auto-mappa le colonne dell'export "Indirizzi
// Spedizione" (Destinatario, Indirizzo, Telefono, Città, CAP, Provincia) e i sinonimi più comuni.
// Scrive su rubrica_destinatari SOLO via service_role (la tabella nega anon/authenticated): l'accesso
// è ristretto qui a mano al cliente loggato, come per gli altri percorsi del portale cliente.
function normHeader(s: string) {
  return (s || '').toString()
    .replace(/﻿/g, '').trim().toLowerCase()
    .replace(/[àá]/g, 'a').replace(/[èé]/g, 'e').replace(/[ìí]/g, 'i')
    .replace(/[òó]/g, 'o').replace(/[ùú]/g, 'u')
    .replace(/\s+/g, '_').replace(/[^\w]/g, '')
}
const ALIAS: Record<string, string[]> = {
  nome:      ['destinatario', 'nominativo', 'nome', 'ragione_sociale', 'ragionesociale', 'name', 'cliente', 'company', 'azienda'],
  indirizzo: ['indirizzo', 'via', 'address', 'street', 'address1', 'indirizzo_1'],
  telefono:  ['telefono', 'tel', 'phone', 'cellulare', 'cell', 'mobile', 'telefono_1'],
  citta:     ['citta', 'city', 'localita', 'comune', 'localita_citta'],
  cap:       ['cap', 'zip', 'zipcode', 'postal_code', 'postalcode', 'codice_postale'],
  provincia: ['provincia', 'prov', 'state', 'sigla', 'sigla_provincia'],
  email:     ['email', 'mail', 'e_mail', 'indirizzo_email', 'posta_elettronica'],
  paese:     ['paese', 'nazione', 'country', 'stato'],
  note:      ['note', 'notes', 'annotazioni'],
}
function pick(headers: Set<string>, aliases: string[]): string | null {
  for (const a of aliases) if (headers.has(a)) return a
  return null
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('ruolo,cliente_id,master_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Solo i clienti possono importare la rubrica' }, { status: 403 })
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
  if (!M.nome) return NextResponse.json({ error: 'Nessuna colonna "Destinatario" riconosciuta nel file (attese: Destinatario, Indirizzo, Telefono, Città, CAP, Provincia).' }, { status: 400 })

  const val = (r: Record<string, string>, k: string | null) => (k ? String(r[k] ?? '').trim() : '')
  // Un record per (nome, indirizzo, cap): l'ultimo vince fra i duplicati nel file.
  const perChiave = new Map<string, any>()
  let scartati = 0
  const now = new Date().toISOString()
  for (const r of rows) {
    const nome = val(r, M.nome)
    if (!nome) { scartati++; continue }
    const indirizzo = val(r, M.indirizzo)
    const cap = val(r, M.cap).replace(/\s+/g, '')
    const rec = {
      cliente_id: utente.cliente_id,
      master_id: utente.master_id,
      nome: nome.slice(0, 120),
      indirizzo: indirizzo.slice(0, 200),
      citta: val(r, M.citta).slice(0, 80),
      provincia: val(r, M.provincia).slice(0, 2).toUpperCase(),
      cap: cap.slice(0, 10),
      paese: (val(r, M.paese) || 'IT').slice(0, 40),
      telefono: val(r, M.telefono).slice(0, 40),
      email: val(r, M.email).slice(0, 120),
      note: val(r, M.note).slice(0, 200),
      updated_at: now,
    }
    perChiave.set(`${nome.toLowerCase()}|${indirizzo.toLowerCase()}|${cap}`, rec)
  }
  const records = Array.from(perChiave.values())
  if (!records.length) return NextResponse.json({ error: 'Nessun destinatario valido nel file' }, { status: 400 })

  // Upsert a blocchi sulla chiave (cliente_id, nome, indirizzo, cap). Riportare lo stesso file
  // aggiorna i contatti esistenti invece di duplicarli.
  const admin = createAdminSupabase()
  let salvati = 0
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500)
    const { error } = await admin.from('rubrica_destinatari').upsert(chunk, { onConflict: 'cliente_id,nome,indirizzo,cap', ignoreDuplicates: false })
    if (error) return NextResponse.json({ error: error.message, salvati }, { status: 400 })
    salvati += chunk.length
  }

  return NextResponse.json({ ok: true, salvati, scartati, colonne: { nome: M.nome, indirizzo: M.indirizzo, citta: M.citta, cap: M.cap, provincia: M.provincia, telefono: M.telefono, email: M.email } })
}
