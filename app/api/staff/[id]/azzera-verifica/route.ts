import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { eTitolareOAdmin, RUOLI_STAFF } from '@/lib/ruoli'
import { registraAudit } from '@/lib/audit'
import { togliVerifica } from '@/lib/azzera-verifica'

// AZZERA LA VERIFICA IN DUE PASSAGGI di un COLLABORATORE che ha cambiato o perso il telefono, o a cui
// l'app non da' piu' il codice giusto. Le stesse regole del reset della password dalla pagina Staff
// (app/api/staff): solo il titolare e gli admin, solo sui collaboratori del proprio master — mai sul
// titolare (quello lo azzera chi sta sopra nella rete, app/api/master/[id]/azzera-verifica) ne' sui
// login cliente, che hanno lo stesso master_id.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: me } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!me?.master_id || !eTitolareOAdmin(me)) {
    return NextResponse.json({ error: 'Lo staff lo gestiscono il titolare e gli admin' }, { status: 403 })
  }

  const { id } = await params
  const admin = createAdminSupabase()
  const { data: st } = await admin.from('utenti').select('id,ruolo,cliente_id').eq('id', id).eq('master_id', me.master_id).maybeSingle()
  if (!st || st.cliente_id || !RUOLI_STAFF.includes(String(st.ruolo || '').toLowerCase())) {
    return NextResponse.json({ error: 'Collaboratore non trovato' }, { status: 404 })
  }

  const esito = await togliVerifica(admin, [id])
  if ('errore' in esito) return NextResponse.json({ error: esito.errore }, { status: 500 })

  await registraAudit({ utenteId: user.id, ruolo: me.ruolo, azione: 'azzera_verifica_staff', risorsa: id, dettaglio: `fattori tolti: ${esito.tolti}` })
  return NextResponse.json({ ok: true, tolti: esito.tolti })
}
