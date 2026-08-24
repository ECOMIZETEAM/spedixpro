import { NextRequest, NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/perimetro'
import { pianoById } from '@/lib/piani'
import { inviaCredenzialiCliente, inviaRichiestaPartnerRifiutata } from '@/lib/email'

// NUOVI MASTER auto-registrati dalla vetrina (stato 'da_approvare'). GET = elenco della rete di chi
// guarda; POST = approva (crea l'accesso + credenziali + attiva) o rifiuta (email cortese). Visto da
// MULTIEXPRESS (genitore diretto) e da chi gli sta sopra (MoovExpress/root): il controllo è la CATENA.

function generaPassword(len = 14): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#'
  let out = ''; for (let i = 0; i < len; i++) out += chars[randomInt(chars.length)]; return out
}

// È il master `masterId` dentro la rete di chi guarda (`mioMasterId`)? Risale la catena dei genitori.
async function nellaRete(admin: any, masterId: string, mioMasterId: string): Promise<boolean> {
  if (masterId === mioMasterId) return true
  let cur: string | null = masterId
  for (let i = 0; i < 20 && cur; i++) {
    const { data: m }: any = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    const p: string | null = m?.parent_master_id || null
    if (p === mioMasterId) return true
    cur = p
  }
  return false
}

async function staff(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  return vedeLaRete(u) ? { user, master_id: u.master_id as string } : null
}

export async function GET() {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  const { data } = await admin.from('masters')
    .select('id,nome,email,telefono,piva,parent_master_id,piano_richiesto,contratti_preferenza,corrieri_interesse,volume_stimato,autoregistrato_il')
    .eq('registrazione_stato', 'da_approvare')
    .order('autoregistrato_il', { ascending: false }).limit(200)
  const righe: any[] = []
  for (const m of (data || [])) {
    if (await nellaRete(admin, (m as any).id, s.master_id)) {
      righe.push({ ...m, piano_nome: pianoById(String((m as any).piano_richiesto || ''))?.nome || (m as any).piano_richiesto })
    }
  }
  return NextResponse.json(righe)
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const id = String(b.id || '')
  const azione = b.azione === 'rifiuta' ? 'rifiuta' : 'approva'
  if (!id) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: m }: any = await admin.from('masters').select('id,nome,email,registrazione_stato').eq('id', id).maybeSingle()
  if (!m || m.registrazione_stato !== 'da_approvare') return NextResponse.json({ error: 'Richiesta non trovata o già gestita.' }, { status: 400 })
  if (!(await nellaRete(admin, id, s.master_id))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  if (azione === 'rifiuta') {
    await admin.from('masters').update({ registrazione_stato: 'rifiutato' }).eq('id', id)
    try { await inviaRichiestaPartnerRifiutata({ to: m.email, nome: m.nome, motivo: String(b.motivo || '').slice(0, 200) }) } catch {}
    return NextResponse.json({ ok: true, rifiutata: true })
  }

  // ── APPROVA: crea l'accesso (auth + riga utenti ruolo master), attiva il master, manda le credenziali.
  const email = String(m.email || '').trim().toLowerCase()
  if (!email) return NextResponse.json({ error: 'Richiesta senza email valida.' }, { status: 400 })
  const password = generaPassword()
  const { data: au, error: aErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (aErr || !au?.user) {
    if (String(aErr?.message || '').toLowerCase().includes('already')) return NextResponse.json({ error: 'Email già presente a sistema: gestiscila a mano.' }, { status: 409 })
    return NextResponse.json({ error: 'Non riusciamo a creare l\'accesso.' }, { status: 500 })
  }
  const { error: uErr } = await admin.from('utenti').insert({ id: au.user.id, ruolo: 'master', master_id: id, cliente_id: null, nome: m.nome, attivo: true })
  if (uErr) { await admin.auth.admin.deleteUser(au.user.id).catch(() => {}); return NextResponse.json({ error: 'Non riusciamo ad attivare l\'accesso.' }, { status: 500 }) }
  await admin.from('masters').update({ attivo: true, registrazione_stato: 'approvato' }).eq('id', id)

  // areaStaff: è un MASTER, il link va al Control Center, non a /cliente.
  let credenzialiInviate = true
  try {
    const es: any = await inviaCredenzialiCliente({ email, nomeCliente: m.nome, masterNome: 'MoovExpress', dominio: 'moovexpress.com', password, areaStaff: true })
    if (es && es.ok === false) credenzialiInviate = false
  } catch { credenzialiInviate = false }
  return NextResponse.json({ ok: true, approvata: true, credenzialiInviate })
}
