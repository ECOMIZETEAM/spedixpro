import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente, clientiAgente } from '@/lib/agente'
import { completaTmp } from '@/lib/tmp-completa'
import { ldvProvvisoria } from '@/lib/numero-spedizione'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// "RIPROVA ADESSO" sulla riga ferma su "LDV in elaborazione".
//
// Il completamento automatico c'e' gia' (giro veloce ogni 2 minuti + rete di sicurezza ogni 15), ma
// chi deve stampare adesso non vuole aspettare il prossimo giro: qui chiede la lettera di vettura al
// fornitore in quel momento. Quando il fornitore ce l'ha, in due secondi la riga ha numero ed
// etichetta; quando non ce l'ha ancora, lo si dice — e NON si crea niente di nuovo, perche' su questi
// contratti l'ordine e' gia' pagato e non esiste l'annullo: rifarlo significherebbe pagarlo due volte.
//
// Chiama la stessa funzione dei giri automatici (lib/tmp-completa): una regola sola per tutti.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id, master_id').eq('id', user.id).single()

  const { id } = await req.json().catch(() => ({ id: null }))
  if (!id) return NextResponse.json({ error: 'ID spedizione mancante' }, { status: 400 })

  const { data: sped } = await supabase
    .from('spedizioni').select('id, numero, cliente_id, master_id').eq('id', id).single()
  if (!sped) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })

  // Isolamento multi-tenant, come la rotta etichetta: il cliente solo le sue, il master tutta la sua
  // rete (le spedizioni dei sotto-master hanno master_id = sotto-master), l'agente solo i suoi clienti.
  if (utente?.ruolo === 'cliente') {
    if (sped.cliente_id !== utente.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  } else if (utente?.master_id && sped.master_id !== utente.master_id) {
    const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
    const rete = await sottoAlberoMasterIds(createAdminSupabase(), utente.master_id)
    if (!sped.master_id || !rete.includes(sped.master_id)) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }
  }
  if (isAgente(utente as any)) {
    const miei = await clientiAgente(supabase, utente as any)
    if (!sped.cliente_id || !miei.includes(sped.cliente_id)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  if (!ldvProvvisoria(sped.numero)) {
    return NextResponse.json({ ok: true, gia: true, numero: sped.numero })
  }

  const admin = createAdminSupabase()
  await completaTmp(admin, { spedizioneId: String(sped.id) })

  // Si rilegge la riga: il messaggio all'utente dice cosa e' successo davvero, non cosa speravamo.
  const { data: dopo } = await admin.from('spedizioni')
    .select('numero, etichetta_url, etichetta_path').eq('id', sped.id).maybeSingle()
  const numero = String((dopo as any)?.numero || sped.numero)
  const fatta = !ldvProvvisoria(numero)
  return NextResponse.json({
    ok: true,
    fatta,
    numero: fatta ? numero : null,
    etichetta: !!((dopo as any)?.etichetta_url || (dopo as any)?.etichetta_path),
    messaggio: fatta
      ? `Lettera di vettura assegnata: ${numero}`
      : 'Il corriere non ha ancora prodotto la lettera di vettura. La spedizione e\' regolarmente creata: l\'etichetta compare da sola appena lui la rilascia, non serve rifarla.',
  })
}
