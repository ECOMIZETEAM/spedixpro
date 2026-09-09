import { NextRequest, NextResponse, after } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const ordineId = body.ordine_id
  const spedizioneId = body.spedizione_id || null
  if (!ordineId) return NextResponse.json({ error: 'ordine_id mancante' }, { status: 400 })

  // L'ordine puo' venire dalla sync API (ordini_ecommerce) o dall'import CSV (ordini_importati):
  // aggiorno per id in entrambe, aggiorna solo la tabella che contiene davvero quell'id.
  // SPEDIZIONE RIFATTA: l'esito dell'evasione VECCHIA non vale piu'.
  //
  // Se l'ordine viene rispedito (la prima spedizione annullata, o rifatta), qui cambiava solo
  // spedizione_id e restavano fulfillment_stato/errore/tentativi della volta prima. Con 'ok' vecchio
  // il tracking NUOVO non veniva mandato allo store mai piu' (l'evasione salta i gia' 'ok'), e con i
  // tentativi al massimo il recupero non lo ripescava. Si azzerano solo quando la spedizione cambia
  // davvero: un doppio clic sullo stesso ordine non deve far ripartire niente.
  if (spedizioneId) {
    await supabase.from('ordini_ecommerce')
      .update({ stato: 'spedito', spedizione_id: spedizioneId, fulfillment_stato: null, fulfillment_errore: null, fulfillment_tentativi: 0 })
      .eq('id', ordineId).eq('cliente_id', utente.cliente_id)
      .or(`spedizione_id.is.null,spedizione_id.neq.${spedizioneId}`)
  }
  await supabase.from('ordini_ecommerce')
    .update({ stato: 'spedito', spedizione_id: spedizioneId })
    .eq('id', ordineId).eq('cliente_id', utente.cliente_id)
  await supabase.from('ordini_importati')
    .update({ stato: 'spedito', spedizione_id: spedizioneId, errore: null })
    .eq('id', ordineId).eq('cliente_id', utente.cliente_id)

  // EVASIONE SUBITO SUL NEGOZIO, non al prossimo giro.
  //
  // Finora il tracking tornava allo store SOLO alla creazione della distinta o col recupero ogni 20
  // minuti. Funzionava, ma in differita: chi spedisce dall'app guarda Shopify e vede ancora
  // "unfulfilled". E' esattamente la bocciatura 2.1.4 della review Shopify ("fulfilling them there
  // fails to update their status in the Shopify admin"): il revisore ha spedito e ha guardato
  // subito. Un merchant fa la stessa cosa.
  //
  // Qui e' il punto UNICO in cui un ordine diventa spedito e viene legato alla sua spedizione — le
  // tre pagine che spediscono da un ordine passano tutte di qua — quindi la spinta si mette una
  // volta sola invece che in ogni ramo di creazione.
  //
  // Resta best-effort e non blocca la risposta: fulfillMarketplace e' IDEMPOTENTE (salta gli ordini
  // gia' 'ok') e ha le sue guardie — non evade con una LDV provvisoria, per non mandare al
  // compratore un tracking finto. Quelle le riprende il recupero ogni 20 minuti, come prima.
  if (spedizioneId) {
    // La spedizione dev'essere DI QUESTO CLIENTE: l'id arriva dal corpo della richiesta, e senza
    // questo controllo si potrebbe far evadere la spedizione di un altro (gli aggiornamenti qui
    // sopra sono gia' vincolati al cliente, questa chiamata no).
    const { data: mia } = await supabase
      .from('spedizioni').select('id').eq('id', spedizioneId).eq('cliente_id', utente.cliente_id).maybeSingle()
    if (mia) {
      after(async () => {
        try {
          const { createAdminSupabase } = await import('@/lib/supabase-admin')
          const { fulfillMarketplace } = await import('@/lib/fulfillMarketplace')
          await fulfillMarketplace(createAdminSupabase(), [spedizioneId])
        } catch (e: any) {
          // L'ordine e' gia' segnato spedito da noi: se lo store non si aggiorna adesso ci pensa il
          // recupero. Non deve mai far fallire la spedizione.
          console.error('[ORDINI][FULFILL IMMEDIATO]', spedizioneId, e?.message)
        }
      })
    }
  }
  return NextResponse.json({ ok: true })
}
