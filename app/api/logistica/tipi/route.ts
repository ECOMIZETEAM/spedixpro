import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/perimetro'

// I TIPI DI POSTO DEL MAGAZZINO: bancale, mezzo bancale, ripiano — col prezzo al mese.
//
// Li definisce il MASTER perche' dipendono dal suo magazzino: non esiste un elenco universale.
// La giacenza si paga A BLOCCHI, al posto occupato: un bancale mezzo vuoto occupa un posto e si
// paga intero, come nei magazzini veri. Il peso conta sull'uscita, non qui.
//
// Il cliente non li configura e non li vede: sono il listino interno del master.

async function staff(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  return vedeLaRete(u) ? { user, master_id: u.master_id } : null
}

export async function GET() {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { data } = await createAdminSupabase()
    .from('logistica_tipi_blocco').select('*').eq('master_id', s.master_id).order('prezzo_mese')
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const nome = String(b.nome || '').trim()
  if (!nome) return NextResponse.json({ error: 'Il nome del posto e obbligatorio' }, { status: 400 })
  const prezzo = Math.round((Number(b.prezzo_mese) || 0) * 100) / 100
  if (prezzo < 0) return NextResponse.json({ error: 'Il prezzo non puo essere negativo' }, { status: 400 })

  const admin = createAdminSupabase()
  const record: any = { master_id: s.master_id, nome, prezzo_mese: prezzo, descrizione: b.descrizione ? String(b.descrizione).trim() : null }
  if (b.attivo !== undefined) record.attivo = !!b.attivo

  if (b.id) {
    // `eq(master_id)` anche qui: la riga dev'essere SUA, non basta conoscerne l'id.
    const { error } = await admin.from('logistica_tipi_blocco').update(record).eq('id', b.id).eq('master_id', s.master_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  } else {
    const { error } = await admin.from('logistica_tipi_blocco').insert(record)
    if (error) {
      if ((error as any).code === '23505') return NextResponse.json({ error: 'Hai gia un posto con questo nome' }, { status: 400 })
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
  }
  return NextResponse.json({ ok: true })
}
