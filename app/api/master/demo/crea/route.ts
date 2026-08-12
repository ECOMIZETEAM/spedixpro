import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { seminaDemo } from '@/lib/demo-seed'
import { DEMO_GIORNI } from '@/lib/demo'

// Crea un ACCOUNT DEMO pronto all'uso: un master di prova ISOLATO (root a sé, non nella rete reale),
// pieno di dati finti, che scade da solo dopo DEMO_GIORNI. Solo il super master può generarlo.
// Ritorna le credenziali (email + password + link): NON manda email, le consegna a chi crea la demo.

function generaPassword(len = 12): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}
function rand(len = 6): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  // Solo il super master genera demo (è il proprietario della piattaforma).
  const { data: mioMaster } = await admin.from('masters').select('is_super_master,parent_master_id').eq('id', utente.master_id).single()
  if (!(mioMaster?.is_super_master || mioMaster?.parent_master_id === null)) {
    return NextResponse.json({ error: 'Solo il super master può creare account demo' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const etichetta = (body?.nome || '').toString().trim().slice(0, 40)
  const nome = etichetta ? `Demo — ${etichetta}` : 'Account Demo'
  const email = `demo-${rand()}@moovexpress.com`
  const password = generaPassword()
  const scadenza = new Date(Date.now() + DEMO_GIORNI * 86400000).toISOString()

  // Slug univoco
  const baseSlug = 'demo-' + rand()
  let slug = baseSlug
  const { data: simili } = await admin.from('masters').select('slug').ilike('slug', baseSlug + '%')
  const esistenti = new Set((simili || []).map((m: any) => m.slug))
  if (esistenti.has(slug)) { let n = 2; while (esistenti.has(`${baseSlug}-${n}`)) n++; slug = `${baseSlug}-${n}` }

  // 1) Master demo: ROOT ISOLATO (parent null), flag demo + scadenza, credito FINTO abbondante.
  const { data: nuovo, error: eM } = await admin.from('masters').insert({
    nome, slug, email,
    parent_master_id: null, is_super_master: false, gestione_rete: true, attivo: true,
    tipo_contratto: 'credito_scalare', paese: 'IT',
    indirizzo_operativo: 'Via Roma 1', citta_operativo: 'Milano', provincia_operativo: 'MI', cap_operativo: '20100', telefono_operativo: '0200000000',
    credito: 100000, credito_sms: 50,
    demo: true, demo_scadenza: scadenza, demo_creato_da: user.id,
  }).select('id').single()
  if (eM || !nuovo) return NextResponse.json({ error: eM?.message || 'Creazione master demo fallita' }, { status: 400 })

  // 2) Utente di accesso (ruolo master) sull'account demo.
  try {
    const { data: authUser, error: eA } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (eA || !authUser?.user) throw new Error(eA?.message || 'auth')
    const { error: eU } = await admin.from('utenti').insert({ id: authUser.user.id, ruolo: 'master', master_id: nuovo.id, nome: nome, attivo: true })
    if (eU) { await admin.auth.admin.deleteUser(authUser.user.id).catch(() => {}); throw new Error(eU.message) }

    // 3) Semina i dati finti (corriere interno, listini, clienti, spedizioni…).
    const esito = await seminaDemo(admin, nuovo.id)

    return NextResponse.json({
      ok: true, email, password, url: 'https://moovexpress.com',
      scadenza, giorni: DEMO_GIORNI,
      clienti: esito.clienti, spedizioni: esito.spedizioni,
    })
  } catch (e: any) {
    // Rollback best-effort: la demo mezza fatta non serve. Se il master non si cancella (figli già
    // seminati con FK), resta comunque isolato, in demo e destinato a scadere: innocuo.
    try { await admin.from('masters').delete().eq('id', nuovo.id) } catch { /* isolato, scadrà da solo */ }
    return NextResponse.json({ error: 'Creazione demo non riuscita: ' + (e?.message || e) }, { status: 400 })
  }
}
