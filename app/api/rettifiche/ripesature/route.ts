import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { leggiRipesature } from '@/lib/ripesature'
import { calcolaRipesature } from '@/lib/ripesature-calcolo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// LE RIPESATURE DEL FORNITORE, CARICATE DAL DETENTORE DEL CONTRATTO.
//
// Il corriere rimisura i colli e ci manda il conto. Quel conto e' il costo di CHI TIENE IL
// CONTRATTO: non e' la cifra che paghera' il cliente finale, che dipende dal suo listino. Quindi
// qui non si passa un importo a scendere, si riprezza il collo vero a ogni livello.
//
// PER ORA SOLO ANTEPRIMA. Si legge il file, si ricostruisce cosa verrebbe a ognuno, e si risponde.
// NON viene scritto niente: nessuna rettifica, nessun movimento, nessun credito toccato. Il
// caricamento vero arriva dopo, quando i numeri saranno stati guardati da chi paga.

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).maybeSingle()
  if (!utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  if (!['master', 'admin'].includes(String(utente.ruolo || '').toLowerCase())) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Nessun file' }, { status: 400 })

  let lette
  try {
    lette = leggiRipesature(await file.text())
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'File non leggibile' }, { status: 400 })
  }
  if (!lette.righe.length) return NextResponse.json({ error: 'Il file non contiene ripesature' }, { status: 400 })

  const admin = createAdminSupabase()

  // GIA' CARICATE: si tolgono PRIMA di calcolare, cosi' l'anteprima mostra solo quello che
  // entrerebbe davvero. L'export del fornitore e' cumulativo — oggi 127 righe, fra tre giorni 300
  // di cui 60 gia' viste — e il conto in fondo alla schermata deve essere quello nuovo, non quello
  // di tutto il file. (La garanzia vera resta l'indice unico sul database: questo e' solo per
  // mostrare numeri onesti.)
  const { data: gia } = await admin.from('rettifiche')
    .select('rif_fornitore').eq('master_id', utente.master_id)
    .in('rif_fornitore', lette.righe.map(r => r.idOrdine))
  const viste = new Set((gia || []).map((g: any) => g.rif_fornitore))
  const nuove = lette.righe.filter(r => !viste.has(r.idOrdine))

  const esiti = await calcolaRipesature(admin, nuove)

  const trovate = esiti.filter(e => e.trovata)
  const totali = {
    nelFile: lette.righe.length,
    giaCaricate: viste.size,
    daCaricare: nuove.length,
    nonTrovate: esiti.length - trovate.length,
    addebitoFornitore: Math.round(nuove.reduce((s, r) => s + r.addebitoFornitore, 0) * 100) / 100,
  }

  return NextResponse.json({ anteprima: true, totali, righe: esiti })
}
