import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { eTitolareOAdmin } from '@/lib/ruoli'
import { eDiscendente } from '@/lib/rete-masters'
import { registraAudit } from '@/lib/audit'
import { togliVerifica } from '@/lib/azzera-verifica'

// AZZERA LA VERIFICA IN DUE PASSAGGI del TITOLARE di un sotto-master. Le stesse regole del reset della
// sua password (app/api/master/[id], PATCH): solo chi gli sta SOPRA nella rete, con la gestione rete
// accesa, e solo il titolare o un admin — l'operatore no (decisione di Lorenzo del 20/10/2026 sulle
// credenziali dei sotto-master). Su se stesso no: eDiscendente non vale per il proprio master. I
// collaboratori del sotto-master li azzera il suo titolare dalla pagina Staff.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || !eTitolareOAdmin(utente)) {
    return NextResponse.json({ error: 'La verifica di un sotto-master la azzerano solo il titolare o un admin' }, { status: 403 })
  }
  const { puoGestireRete } = await import('@/lib/permessi')
  if (!(await puoGestireRete())) return NextResponse.json({ error: 'Gestione rete non abilitata per questo account' }, { status: 403 })

  const { id } = await params
  const admin = createAdminSupabase()
  if (!(await eDiscendente(admin, id, utente.master_id))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { data: titolari, error: eT } = await admin.from('utenti').select('id').eq('master_id', id).eq('ruolo', 'master').is('cliente_id', null)
  if (eT) return NextResponse.json({ error: 'Accesso del master non letto' }, { status: 500 })
  if (!titolari?.length) return NextResponse.json({ error: 'Utente di login del master non trovato' }, { status: 404 })

  const esito = await togliVerifica(admin, titolari.map(t => t.id))
  if ('errore' in esito) return NextResponse.json({ error: esito.errore }, { status: 500 })

  await registraAudit({ utenteId: user.id, ruolo: utente.ruolo, azione: 'azzera_verifica_master', risorsa: id, dettaglio: `fattori tolti: ${esito.tolti}` })
  return NextResponse.json({ ok: true, tolti: esito.tolti })
}
