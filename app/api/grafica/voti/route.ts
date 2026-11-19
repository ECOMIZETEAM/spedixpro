import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// I risultati del voto sulla nuova versione: SOLO per il super master (Lorenzo). Media, quanti per ogni voto, e i
// commenti con chi li ha scritti (master, o cliente e il suo master).
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).maybeSingle()
  const { data: m } = utente?.master_id
    ? await supabase.from('masters').select('is_super_master').eq('id', utente.master_id).maybeSingle()
    : { data: null }
  if (!m?.is_super_master) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  const { data: voti, error } = await admin.from('grafica_voti')
    .select('id,utente_id,master_id,cliente_id,ruolo,voto,commento,pagina,creato_il,aggiornato_il')
    .order('aggiornato_il', { ascending: false }).order('id', { ascending: true }).limit(2000)
  if (error) return NextResponse.json({ error: 'Voti non letti' }, { status: 500 })
  const lista = voti || []
  const idMaster = [...new Set(lista.map(v => v.master_id).filter(Boolean))]
  const idClienti = [...new Set(lista.map(v => v.cliente_id).filter(Boolean))]
  const idUtenti = [...new Set(lista.map(v => v.utente_id).filter(Boolean))]
  const [mm, cc, uu] = await Promise.all([
    idMaster.length ? admin.from('masters').select('id,nome').in('id', idMaster) : Promise.resolve({ data: [] as any[] }),
    idClienti.length ? admin.from('clienti').select('id,ragione_sociale').in('id', idClienti) : Promise.resolve({ data: [] as any[] }),
    idUtenti.length ? admin.from('utenti').select('id,nome,cognome').in('id', idUtenti) : Promise.resolve({ data: [] as any[] }),
  ])
  const nomeM = new Map((mm.data || []).map((x: any) => [x.id, x.nome]))
  const nomeC = new Map((cc.data || []).map((x: any) => [x.id, x.ragione_sociale]))
  const nomeU = new Map((uu.data || []).map((x: any) => [x.id, [x.nome, x.cognome].filter(Boolean).join(' ')]))
  const conti = [0, 0, 0, 0, 0]
  for (const v of lista) conti[v.voto - 1]++
  const media = lista.length ? lista.reduce((s, v) => s + v.voto, 0) / lista.length : null
  return NextResponse.json({
    totale: lista.length, media, conti,
    voti: lista.map(v => ({
      voto: v.voto, commento: v.commento, pagina: v.pagina, quando: v.aggiornato_il,
      chi: nomeU.get(v.utente_id) || '—', ruolo: v.ruolo,
      master: v.master_id ? nomeM.get(v.master_id) || '—' : null,
      cliente: v.cliente_id ? nomeC.get(v.cliente_id) || '—' : null,
    })),
  })
}
