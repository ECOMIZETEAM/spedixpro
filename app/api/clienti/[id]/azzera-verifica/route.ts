import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { gestisceLaRete } from '@/lib/ruoli'
import { masterVedeReteCompleta, eDiscendente } from '@/lib/rete-masters'
import { registraAudit } from '@/lib/audit'

// AZZERA LA VERIFICA IN DUE PASSAGGI di un cliente che ha cambiato o perso il telefono: al prossimo
// accesso la riattiva da capo inquadrando un codice nuovo. Toglie un pezzo della protezione
// dell'account, quindi: solo chi gestisce la rete, solo sui SUOI clienti (o su quelli della
// discendenza, per chi vede la rete completa: la stessa regola di "entra come"), e resta nel
// registro accessi. Il middleware ci fa arrivare solo con una sessione che ha gia' messo il codice.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  if (!utente?.master_id || !gestisceLaRete(utente)) {
    return NextResponse.json({ error: 'Operazione non consentita' }, { status: 403 })
  }

  const { id } = await params
  const admin = createAdminSupabase()
  const { data: cliente } = await admin.from('clienti').select('id,master_id').eq('id', id).maybeSingle()
  let autorizzato = !!cliente && cliente.master_id === utente.master_id
  if (cliente && !autorizzato
      && await masterVedeReteCompleta(admin, utente.master_id)
      && await eDiscendente(admin, cliente.master_id, utente.master_id)) {
    autorizzato = true
  }
  if (!cliente || !autorizzato) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 404 })

  // Tutti gli accessi del cliente (di solito uno).
  const { data: accessi, error: eAcc } = await admin.from('utenti').select('id').eq('cliente_id', id)
  if (eAcc) return NextResponse.json({ error: 'Accessi del cliente non letti' }, { status: 500 })

  let tolti = 0
  for (const a of accessi || []) {
    const { data: fattori, error: eF } = await admin.auth.admin.mfa.listFactors({ userId: a.id })
    if (eF) return NextResponse.json({ error: 'Verifica del cliente non letta' }, { status: 500 })
    for (const f of fattori?.factors || []) {
      const { error: eD } = await admin.auth.admin.mfa.deleteFactor({ userId: a.id, id: f.id })
      if (eD) return NextResponse.json({ error: 'Azzeramento non riuscito, riprova' }, { status: 500 })
      tolti++
    }
  }

  await registraAudit({ utenteId: user.id, ruolo: utente.ruolo, azione: 'azzera_verifica_cliente', risorsa: id, dettaglio: `fattori tolti: ${tolti}` })
  return NextResponse.json({ ok: true, tolti })
}
