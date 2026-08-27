import { NextRequest, NextResponse } from 'next/server'
import { autenticaApiKey, rispostaBlocco } from '@/lib/api-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { leggiPrezzi, calcolaCosti, noloClienteSpedizione } from '@/lib/giacenza-prezzi'
import { eseguiSvincolo } from '@/lib/giacenza-svincolo'

// API pubblica MoovExpress — richiede un'azione su una giacenza aperta.
// Auth: Authorization: Bearer <api_key>
// Body: { action: 'riconsegna' | 'reso' | 'mantieni', notes? }
// Lo svincolo è DIRETTO come dal portale: il cliente API lo fa in autonomia, senza che l'operatore
// debba confermare (stessa porta unica lib/giacenza-svincolo). Solo 'mantieni' non fa niente.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const _b = rispostaBlocco(ctx); if (_b) return _b
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
    // Destinazione e colli servono a ricalcolare il NOLO (base del reso). numero/tracking/raw_response
    // + credenziali corriere servono a eseguiSvincolo per parlare col corriere (restano lato server).
    .select('id,master_id,cliente_id,corriere_id,stato,giacenza_stato,costo_totale,assicurazione,colli,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,dest_provincia,dest_cap,dest_paese,dest_citta,numero,tracking_number,raw_response,dest_nome,dest_telefono,dest_email,giacenza_addebito_effettuato, corrieri(tipo,credenziali,nome_contratto,master_id)')
    .eq('id', id).maybeSingle()
  if (!sped || sped.cliente_id !== ctx.clienteId) return NextResponse.json({ error: 'Giacenza non trovata' }, { status: 404 })
  if (sped.stato !== 'in_giacenza') return NextResponse.json({ error: 'La spedizione non è in giacenza' }, { status: 409 })

  // "mantieni" = nessuna richiesta di svincolo: resta in giacenza.
  if (action === 'mantieni') {
    return NextResponse.json({ id, stato: sped.giacenza_stato || 'aperta' })
  }

  // riconsegna / reso -> registra la richiesta e la SVINCOLA SUBITO, in autonomia, senza che
  // l'operatore debba confermare dal portale (il cliente API decide del SUO pacco come dal portale).
  // I COSTI SI CALCOLANO, non si scrivono a zero (altrimenti il cliente non pagava ma la rete sì).
  const prezzi = await leggiPrezzi(admin, sped)
  const costi = calcolaCosti(action, prezzi, sped, await noloClienteSpedizione(admin, sped))
  const { data: rich, error } = await admin.from('giacenza_richieste').insert({
    spedizione_id: id, master_id: sped.master_id, cliente_id: sped.cliente_id,
    operazione: action, note: body.notes || null,
    ...costi,
    richiesta_da: 'cliente', creata_da: 'API', stato: 'da_confermare',
  }).select('*').single()
  if (error || !rich) { console.error('[V1][STOCKS]', error?.message); return NextResponse.json({ error: 'Richiesta non registrata' }, { status: 400 }) }

  // Svincolo DIRETTO (corriere + addebito a cascata + marca 'svincolata'), stessa porta del portale.
  try {
    const esito = await eseguiSvincolo(admin, sped, rich, 'API')
    return NextResponse.json({ id, stato: 'svincolata', azione: action, costo: esito.addebito, ...(esito.distintaReso ? { distinta_reso: esito.distintaReso } : {}) })
  } catch (e: any) {
    // Corriere ha rifiutato lo svincolo: la richiesta resta da decidere (l'operatore può ritentare
    // dal portale), non si marca 'svincolata' a vuoto. Si risponde con l'errore pulito del corriere.
    await admin.from('spedizioni').update({ giacenza_stato: 'in_gestione' }).eq('id', id)
    console.error('[V1][STOCKS][svincolo]', e?.message)
    return NextResponse.json({ error: e?.message || 'Svincolo non riuscito al corriere', id, stato: 'in_gestione' }, { status: 502 })
  }
}
