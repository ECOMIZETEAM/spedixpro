import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { rimborsaAnnulloSpedizione } from '@/lib/annullaSpedizione'

// Il DETENTORE del contratto conferma che l'annullo Spedisci è stato eseguito (via assistenza):
// la spedizione passa ad 'annullata' + storno credito. Solo l'owner può confermare.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = no scrittura / no rete
  if (!utente?.master_id || (utente.ruolo || '').toLowerCase() === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const spedizioneId = req.nextUrl.searchParams.get('id') || (await req.json().catch(() => ({}))).id
  if (!spedizioneId) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: sped } = await admin.from('spedizioni')
    .select('id,numero,dest_nome,stato,annullamento_owner_id,annullamento_da')
    .eq('id', spedizioneId).single()
  if (!sped) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  if (sped.stato !== 'annullamento_manuale') return NextResponse.json({ error: 'La spedizione non è in coda annullo manuale.' }, { status: 400 })
  if (sped.annullamento_owner_id !== utente.master_id) return NextResponse.json({ error: 'Solo il detentore del contratto può confermare questo annullo.' }, { status: 403 })

  // IL PACCO E' STATO CONSEGNATO? Allora l'annullo non e' mai avvenuto e confermarlo qui
  // rimborserebbe cliente E tutta la catena per merce che il corriere ha consegnato e che va
  // comunque pagata — soldi che non tornano piu' indietro.
  // Puo' succedere in due modi: la richiesta di annullo arriva quando il pacco e' gia' partito, e
  // il tracking prosegue per conto suo; oppure qualcuno cancella e fa partire lo stesso.
  // Non e' un blocco cieco: con ?forza=1 si conferma comunque, per i casi in cui il corriere ha
  // davvero accettato l'annullo e il tracking racconta un'altra storia.
  const forza = req.nextUrl.searchParams.get('forza') === '1'
  if (!forza) {
    const { data: eventi } = await admin.from('tracking_events')
      .select('stato,descrizione,data_evento').eq('spedizione_id', spedizioneId)
      .order('data_evento', { ascending: false }).limit(50)
    const consegnato = (eventi || []).find((e: any) =>
      String(e.stato || '').toLowerCase() === 'consegnata' ||
      /consegnat|delivered/i.test(String(e.descrizione || '')))
    if (consegnato) {
      const quando = consegnato.data_evento ? new Date(consegnato.data_evento).toLocaleString('it-IT') : ''
      return NextResponse.json({
        error: `Questa spedizione risulta CONSEGNATA${quando ? ' il ' + quando : ''}: l'annullo non è stato eseguito dal corriere. Confermarlo rimborserebbe il cliente e tutta la rete per un pacco già recapitato, che il corriere fa comunque pagare. Se sei certo che il corriere lo abbia annullato, conferma di nuovo forzando l'operazione.`,
        consegnata: true, quando: consegnato.data_evento || null,
      }, { status: 409 })
    }
  }

  const { error } = await admin.from('spedizioni').update({ stato: 'annullata', annullamento_errore: null }).eq('id', spedizioneId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await rimborsaAnnulloSpedizione(admin, sped as any, (sped as any).annullamento_da || null)
  return NextResponse.json({ success: true })
}
