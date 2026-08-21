import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { createServerSupabase } from '@/lib/supabase'
import { gestisceLaRete } from '@/lib/ruoli'
import { parseCurl } from '@/lib/onetracking'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MASTER_DETENTORE = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b'   // MULTIEXPRESS

// Solo super-master (MULTIEXPRESS o radice): la sessione OneTracking e' una credenziale.
async function superMaster(admin: any): Promise<boolean> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!gestisceLaRete(u as any) || !u?.master_id) return false
  return u.master_id === MASTER_DETENTORE   // SOLO MULTIEXPRESS (detentore PDB): gli altri no
}

export async function GET(_req: NextRequest) {
  const admin = createAdminSupabase()
  if (!(await superMaster(admin))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { data: sess } = await admin.from('onetracking_sessione').select('*').eq('id', 1).maybeSingle()

  // Statistiche del registro controllo
  const { data: righe } = await admin.from('ripesature_check').select('esito,recupero')
  const stat: Record<string, number> = {}
  let recuperoTot = 0
  for (const r of (righe || [])) {
    stat[(r as any).esito || '?'] = (stat[(r as any).esito || '?'] || 0) + 1
    if ((r as any).esito === 'rettificata') recuperoTot += Number((r as any).recupero || 0)
  }

  // Arretrato: consegnate PDB non ancora controllate
  const { data: pdb } = await admin.from('corrieri').select('id')
    .eq('nome_contratto', 'Poste Delivery Business S').eq('tipo', 'spediamopro')
  const pdbIds = (pdb || []).map((c: any) => c.id)
  let arretrato = 0
  if (pdbIds.length) {
    const { count: consegnate } = await admin.from('spedizioni').select('*', { count: 'exact', head: true })
      .in('corriere_id', pdbIds).eq('stato', 'consegnata').not('tracking_number', 'is', null)
    const { count: controllate } = await admin.from('ripesature_check').select('*', { count: 'exact', head: true })
    arretrato = Math.max(0, (consegnate || 0) - (controllate || 0))
  }

  return NextResponse.json({
    stato: sess?.stato || 'scaduta',
    ha_cookie: !!sess?.url_template,
    aggiornato_il: sess?.aggiornato_il || null,
    ultimo_ok_il: sess?.ultimo_ok_il || null,
    email_alert: sess?.email_alert || null,
    statistiche: stat,
    recuperoTot: Math.round(recuperoTot * 100) / 100,
    arretrato,
  })
}

export async function POST(req: NextRequest) {
  const admin = createAdminSupabase()
  if (!(await superMaster(admin))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const body = await req.json().catch(() => ({}))

  // Aggiorna la mail dell'avviso (opzionale, anche da sola)
  if (typeof body?.email_alert === 'string') {
    await admin.from('onetracking_sessione').update({ email_alert: body.email_alert.trim() || null }).eq('id', 1)
    if (!body?.curl) return NextResponse.json({ ok: true, email_salvata: true })
  }

  const parsed = parseCurl(String(body?.curl || ''))
  if (!parsed?.url_template || !parsed.headers || !Object.keys(parsed.headers).some(k => k.toLowerCase() === 'cookie')) {
    return NextResponse.json({ error: 'cURL non valido: assicurati di fare "Copy as cURL" sulla riga di dettaglio (deve contenere il cookie e /dettaglio-spedizione/).' }, { status: 400 })
  }
  // Sessione ATTIVA + riarma l'avviso (cosi' la prossima scadenza ri-notifica).
  await admin.from('onetracking_sessione').update({
    url_template: parsed.url_template, headers: parsed.headers,
    stato: 'attiva', aggiornato_il: new Date().toISOString(), scaduta_notificata: false,
  }).eq('id', 1)
  return NextResponse.json({ ok: true, stato: 'attiva' })
}
