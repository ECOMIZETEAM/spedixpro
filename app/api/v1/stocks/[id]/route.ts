import { NextRequest, NextResponse } from 'next/server'
import { autenticaApiKey } from '@/lib/api-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { leggiPrezzi, calcolaCosti, noloClienteSpedizione } from '@/lib/giacenza-prezzi'

// API pubblica MoovExpress — richiede un'azione su una giacenza aperta.
// Auth: Authorization: Bearer <api_key>
// Body: { action: 'riconsegna' | 'reso' | 'mantieni', notes? }
// La richiesta viene registrata e confermata dall'operatore dal portale.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  if (!['riconsegna', 'reso', 'mantieni'].includes(action)) {
    return NextResponse.json({ error: "action non valida (riconsegna | reso | mantieni)" }, { status: 400 })
  }

  const admin = createAdminSupabase()
  // Servono anche corriere_id, costo_totale e assicurazione: sono gli ingredienti del prezzo dello
  // svincolo (il reso si calcola in percentuale sul nolo del cliente).
  const { data: sped } = await admin.from('spedizioni')
    // I campi di destinazione e colli servono a ricalcolare il NOLO (base del reso) dal listino.
    .select('id,master_id,cliente_id,corriere_id,stato,giacenza_stato,costo_totale,assicurazione,colli,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,dest_provincia,dest_cap,dest_paese,dest_citta')
    .eq('id', id).maybeSingle()
  if (!sped || sped.cliente_id !== ctx.clienteId) return NextResponse.json({ error: 'Giacenza non trovata' }, { status: 404 })
  if (sped.stato !== 'in_giacenza') return NextResponse.json({ error: 'La spedizione non è in giacenza' }, { status: 409 })

  // "mantieni" = nessuna richiesta di svincolo: resta in giacenza.
  if (action === 'mantieni') {
    return NextResponse.json({ id, stato: sped.giacenza_stato || 'aperta' })
  }

  // riconsegna / reso -> registra la richiesta (l'operatore conferma dal portale).
  // I COSTI SI CALCOLANO, non si scrivono a zero. Erano fissi a 0: alla conferma il cliente non
  // veniva addebitato (la cascata salta l'importo zero) ma il master e tutti i master sopra
  // pagavano comunque il servizio al loro listino. Cioe' riconsegne e resi gratis, chiesti via
  // API, a spese del master. Stesso calcolo del portale, ora in lib/giacenza-prezzi.ts.
  const prezzi = await leggiPrezzi(admin, sped)
  const costi = calcolaCosti(action, prezzi, sped, await noloClienteSpedizione(admin, sped))
  const { error } = await admin.from('giacenza_richieste').insert({
    spedizione_id: id, master_id: sped.master_id, cliente_id: sped.cliente_id,
    operazione: action, note: body.notes || null,
    ...costi,
    richiesta_da: 'cliente', creata_da: 'API', stato: 'da_confermare',
  })
  if (error) { console.error('[V1][STOCKS]', error.message); return NextResponse.json({ error: 'Richiesta non registrata' }, { status: 400 }) }
  await admin.from('spedizioni').update({ giacenza_stato: 'in_gestione' }).eq('id', id)

  return NextResponse.json({ id, stato: 'in_gestione', azione: action, costo: costi.costo_totale })
}
