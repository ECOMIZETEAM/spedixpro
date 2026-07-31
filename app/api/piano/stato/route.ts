import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { statoPiano, messaggioBlocco } from '@/lib/limite-piano'
import { isAgente } from '@/lib/agente'

// Quanto del piano e' stato consumato questo mese, per l'avviso in cima alle pagine.
//
// Chi vede cosa: un master vede i suoi numeri (spedizioni sue e di tutta la sua rete: e' il
// traffico che rivende, ed e' quello che consuma il suo pacchetto). Un cliente o un agente NO —
// il volume del proprio fornitore non e' un dato loro. A loro arriva solo il fatto che al momento
// non si puo' spedire, senza dire chi ha superato il limite e quanto.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).maybeSingle()
  if (!utente?.master_id) return NextResponse.json({ bloccato: false })

  const stato = await statoPiano(createAdminSupabase(), utente.master_id)
  const staff = utente.ruolo !== 'cliente' && !isAgente(utente)

  if (!staff) {
    return NextResponse.json({
      bloccato: stato.bloccato,
      messaggio: stato.bloccato ? messaggioBlocco(stato, false) : null,
    })
  }
  return NextResponse.json({
    usato: stato.usato, limite: stato.limite, perc: stato.perc,
    avviso: stato.avviso, bloccato: stato.bloccato, bloccatoDaMe: stato.bloccatoDaMe,
    motivo: stato.motivo, giorniPerPagare: stato.giorniPerPagare,
    messaggio: stato.bloccato ? messaggioBlocco(stato, true) : null,
  })
}
