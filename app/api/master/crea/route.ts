import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

function generaPassword(len = 10): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#'
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { puoGestireRete } = await import('@/lib/permessi')
  if (!(await puoGestireRete())) return NextResponse.json({ error: 'Gestione rete non abilitata per questo account' }, { status: 403 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const body = await req.json()
  const email = body.email?.toLowerCase().trim()
  const nome = body.nome?.trim()

  if (!email) return NextResponse.json({ error: 'Email obbligatoria' }, { status: 400 })
  if (!nome) return NextResponse.json({ error: 'Nome obbligatorio' }, { status: 400 })

  // *** Usa il client ADMIN per bypassare RLS — il controllo autorizzazione è già fatto sopra ***
  const admin = createAdminSupabase()

  const { data: existingMaster } = await admin.from('masters').select('id').eq('email', email).single()
  if (existingMaster) return NextResponse.json({ error: 'Email già registrata come master' }, { status: 400 })

  // Listino ereditato: dev'essere un listino del PADRE (chi sta creando)
  let parentListinoId: string | null = null
  if (body.parent_listino_id) {
    const { data: listinoValido } = await admin
      .from('listini_clienti').select('id').eq('id', body.parent_listino_id).eq('master_id', utente.master_id).single()
    if (listinoValido) parentListinoId = listinoValido.id
  }
  const tipoContratto = body.tipo_contratto === 'fattura_mensile' ? 'fattura_mensile' : 'credito_scalare'

  // Slug univoco: dal nome, con suffisso -2, -3… se già esiste (evita il vincolo unique)
  const baseSlug = (nome.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) || 'master'
  const { data: slugSimili } = await admin.from('masters').select('slug').ilike('slug', baseSlug + '%')
  const slugEsistenti = new Set((slugSimili || []).map((m: any) => m.slug))
  let slug = baseSlug
  if (slugEsistenti.has(slug)) { let n = 2; while (slugEsistenti.has(`${baseSlug}-${n}`)) n++; slug = `${baseSlug}-${n}` }

  const { data: nuovoMaster, error: masterError } = await admin.from('masters').insert({
    nome,
    slug,
    email,
    telefono: body.telefono || null,
    piva: body.piva || null,
    codice_fiscale: body.cf || null,
    pec: body.pec || null,
    codice_sdi: body.cod_sdi || null,
    // Sede legale
    indirizzo: body.sl_indirizzo || null,
    citta: body.sl_citta || null,
    provincia: body.sl_provincia || null,
    cap: body.sl_cap || null,
    paese: 'IT',
    // Sede operativa (mittente per le spedizioni per conto di questo master)
    indirizzo_operativo: body.so_indirizzo || null,
    citta_operativo: body.so_citta || null,
    provincia_operativo: body.so_provincia || null,
    cap_operativo: body.so_cap || null,
    parent_master_id: utente.master_id,
    parent_listino_id: parentListinoId,
    tipo_contratto: tipoContratto,
    is_super_master: false,
    gestione_rete: true,   // ogni master può creare/gestire la propria rete (gerarchia)
    attivo: true,
  }).select().single()

  if (masterError || !nuovoMaster) {
    return NextResponse.json({ error: masterError?.message || 'Errore creazione master' }, { status:400 })
  }

  const password = generaPassword()
  try {
    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    })

    if (authError || !authUser?.user) {
      await admin.from('masters').delete().eq('id', nuovoMaster.id)
      return NextResponse.json({ error: authError?.message || 'Errore creazione utente auth' }, { status: 400 })
    }

    await admin.from('utenti').insert({
      id: authUser.user.id,
      ruolo: 'master',
      master_id: nuovoMaster.id,
      nome,
      attivo: true,
    })

    // Copia il listino assegnato nel Listino Corrieri del sotto-master (contratti + prezzi)
    if (parentListinoId) {
      try {
        const { copiaListinoAlSottoMaster } = await import('@/lib/copia-listino-submaster')
        await copiaListinoAlSottoMaster(admin, nuovoMaster.id)
      } catch (e) { console.error('Copia listino sotto-master:', e) }
    }
  } catch (e: any) {
    await admin.from('masters').delete().eq('id', nuovoMaster.id)
    return NextResponse.json({ error: e.message || 'Errore creazione utente' }, { status: 400 })
  }

  try {
    const { inviaCredenzialiCliente } = await import('@/lib/email')
    await inviaCredenzialiCliente({
      email, nomeCliente: nome, masterNome: 'MoovExpress',
      dominio: 'moovexpress.com', password,
    })
  } catch (e) {
    console.error('Errore invio email master:', e)
  }

  return NextResponse.json({ id: nuovoMaster.id, email, password })
}
