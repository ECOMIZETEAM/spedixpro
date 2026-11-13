import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { confineGiornoRoma, giorniFaRoma, giornoRoma } from '@/lib/date-roma'

// ── RETTIFICHE ELIMINATE: PAGATE DA ME, NON RECUPERATE DA NESSUNO ──
//
// Chiesto da Lorenzo il 22/10/2026: un master puo' caricare le rettifiche e poi, per sbaglio o per
// scelta, eliminarle invece di girarle sotto. Il costo pero' gli e' gia' stato scalato. Qui si vede
// quanto gli e' rimasto addosso, riga per riga:
//  - ricevute da sopra e ASSORBITE (o scartate perche' sotto non c'era niente da recuperare);
//  - ricevute da sopra e CARICATE, ma poi cancellate in Rettifica Costi senza confermarle: la riga
//    madre e' "propagata" e non ha piu' nessuna figlia;
//  - il SUO costo di detentore su spedizioni dove sotto non c'era niente da rettificare (riga
//    intestata a se' stesso, confermata).
// Le ANNULLATE non ci sono: l'addebito e' stato restituito, non e' un costo.
// Solo lettura. Le righe appartengono al master di sopra -> si leggono con la chiave di servizio,
// autorizzazione = target_master_id mio (come in network/ricevuti).
// Per MULTI (2.675 righe in 90 giorni) ora si leggono anche le sue rettifiche verso sotto sugli stessi pacchi: ~9 secondi.
//
// NON TUTTO QUELLO CHE NON E' GIRATO E' PERSO (Lorenzo, 13/11/2026: «il master non la capisce... pensano che sbaglia la
// piattaforma a fare il calcolo e dicono di perdere soldi»). Le righe stavano in rosso come «Davvero non recuperate», ma
// su Ecomize Solution 135 delle 189 erano pacchi su cui ci guadagnava ancora e 24 spedizioni fatte dal suo account senza
// cliente; in perdita davvero 31 pacchi (−80,36 €). Ora ogni riga dice quanto il master ha incassato da chi sta sotto e quanto ha
// pagato in tutto (lib/conto-pacco), e i gruppi si fanno su quello: ci perdi, ci guadagni comunque, gia' fatte pagare
// sotto, spedizioni tue senza cliente.
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  // L'agente non vede i costi del master (vedi costo_fornitore nascosto in GET /api/rettifiche).
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const mio = utente.master_id
  const admin = createAdminSupabase()
  // PERIODO come nelle altre liste: giorni del calendario di Roma (dal/al = 'YYYY-MM-DD'), di serie gli
  // ultimi 90 giorni. La data e' quella della rettifica (quando e' nata la riga).
  const dalG = req.nextUrl.searchParams.get('dal') || giorniFaRoma(90)
  const alG = req.nextUrl.searchParams.get('al') || giornoRoma()
  const dal = confineGiornoRoma(dalG, 'dal')!, al = confineGiornoRoma(alG, 'al')!

  try {
    const { rettificheNonGirate } = await import('@/lib/rettifiche-non-girate')
    return NextResponse.json({ dal: dalG, al: alG, ...await rettificheNonGirate(admin, mio, dal, al) })
  } catch (e: any) {
    console.error('[RETTIFICHE] eliminate:', e?.message || e)
    return NextResponse.json({ error: 'Lettura non riuscita' }, { status: 500 })
  }
}
