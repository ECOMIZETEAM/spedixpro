import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import Papa from 'papaparse'

export const runtime = 'nodejs'

// Colonne obbligatorie (mappate per NOME dall'header, non per posizione)
const REQUIRED = ['destinatario', 'indirizzo', 'cap', 'localita', 'provincia']

// Normalizza gli header: "Email Destinatario" -> "email_destinatario"
function normHeader(s: string) {
  return (s || '').toString().trim().toLowerCase().replace(/\s+/g, '_')
}

function toNum(v: any): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null
  const n = parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()

  // cliente_id SEMPRE dalla sessione: mai dal client
  if (utente?.ruolo !== 'cliente') {
    return NextResponse.json({ error: 'Solo i clienti possono importare ordini' }, { status: 403 })
  }
  const clienteId = utente.cliente_id
  if (!clienteId) return NextResponse.json({ error: 'Cliente non associato all\'utente' }, { status: 400 })

  const { data: cliente } = await supabase
    .from('clienti').select('master_id').eq('id', clienteId).single()
  if (!cliente) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
  const masterId = cliente.master_id

  // File
  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Nessun file caricato' }, { status: 400 })

  const text = await file.text()

  // delimitatore auto (spedisci.online usa ";", ma accettiamo anche ",")
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normHeader,
  })

  const rows = (parsed.data || []).filter(Boolean)
  if (!rows.length) return NextResponse.json({ error: 'File vuoto o non leggibile' }, { status: 400 })

  // Verifica colonne obbligatorie
  const headers = Object.keys(rows[0] || {})
  const missing = REQUIRED.filter(c => !headers.includes(c))
  if (missing.length) {
    return NextResponse.json(
      { error: `Colonne obbligatorie mancanti nell'header: ${missing.join(', ')}` },
      { status: 400 }
    )
  }

  const records: any[] = []
  const errori: { riga: number; motivo: string }[] = []

  rows.forEach((r, i) => {
    const dest = (r.destinatario || '').trim()
    const ind = (r.indirizzo || '').trim()
    const cap = (r.cap || '').trim()
    const loc = (r.localita || '').trim()
    const prov = (r.provincia || '').trim()

    // riga +2: 1 riga header + indice 1-based
    if (!dest || !ind || !cap || !loc || !prov) {
      errori.push({ riga: i + 2, motivo: 'Campi obbligatori mancanti' })
      return
    }

    records.push({
      master_id: masterId,
      cliente_id: clienteId,
      destinatario: dest,
      indirizzo: ind,
      cap,
      localita: loc,
      provincia: prov.toUpperCase(),
      country: ((r.country || '').trim().toUpperCase()) || 'IT',
      telefono: (r.telefono || '').trim() || null,
      email_destinatario: (r.email_destinatario || '').trim() || null,
      peso: toNum(r.peso),
      colli: Math.max(1, Math.round(toNum(r.colli) ?? 1)),
      contrassegno: toNum(r.contrassegno) ?? 0,
      contenuto: (r.contenuto || '').trim() || null,
      note: (r.note || '').trim() || null,
      rif_mittente: (r.rif_mittente || '').trim() || null,
      rif_destinatario: (r.rif_destinatario || '').trim() || null,
      order_id: (r.order_id || '').trim() || null,
      totale_ordine: toNum(r.totale_ordine),
      fonte: 'csv',
      stato: 'da_spedire',
      raw: r,
    })
  })

  if (!records.length) {
    return NextResponse.json({ error: 'Nessuna riga valida trovata nel file', errori }, { status: 400 })
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
