import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { resoAddebitatoPerSpedizione } from '@/lib/giacenza-cascata'
import { FILTRO_SENZA_DOPPIONI, ripetuteNellElenco } from '@/lib/distinte-resi'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  if (!clienteId) return NextResponse.json([])
  const dal = req.nextUrl.searchParams.get('dal')
  const al = req.nextUrl.searchParams.get('al')
  let query = supabase.from('distinte_resi')
    .select('*, clienti(ragione_sociale)')
    .eq('cliente_id', clienteId)
    .or(FILTRO_SENZA_DOPPIONI)   // le distinte doppie del giro delle 23 non si mostrano (lib/distinte-resi)
    .order('created_at', { ascending: false })
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al)
  const { data } = await query
  // LE RIGHE DI OGNI DISTINTA, LETTE DALLA SPEDIZIONE E DAI MOVIMENTI. Le distinte nate dal cron delle 23
  // nelle voci hanno solo l'id della spedizione: nella lista il cliente vedeva "3 LDV" senza sapere quali, e
  // l'assistenza non riusciva a dire a quale spedizione corrispondesse un reso (21/10/2026). Numero,
  // destinatario, citta' e data si leggono dalle spedizioni di QUESTO cliente; il costo di ogni riga e'
  // quanto e' stato addebitato a lui per quel reso (lo stesso conto del totale della distinta). Le voci
  // salvate dalla scansione portano anche il prezzo dell'andata: non si rimanda, in una distinta di reso
  // confondeva.
  const lista = data || []
  const ids = [...new Set(lista.flatMap((d: any) => (Array.isArray(d.voci) ? d.voci : []).map((v: any) => v?.id)).filter(Boolean))] as string[]
  const spedDi = new Map<string, any>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data: ss } = await supabase.from('spedizioni').select('id,numero,dest_nome,dest_citta,created_at')
      .eq('cliente_id', clienteId).in('id', ids.slice(i, i + 300))
    for (const s of (ss || [])) spedDi.set((s as any).id, s)
  }
  const resoDi = ids.length ? await resoAddebitatoPerSpedizione(createAdminSupabase(), ids, { clienteId }) : new Map<string, number>()
  const ripetute = ripetuteNellElenco(lista)
  for (const d of lista as any[]) {
    if (!Array.isArray(d.voci)) { d.voci = []; continue }
    const giaIn = ripetute.get(d.id)
    d.voci = d.voci.map((v: any) => {
      const s = spedDi.get(v?.id) || {}
      return {
        id: v?.id, numero: s.numero || v?.numero || null, dest_nome: s.dest_nome || v?.dest_nome || null,
        dest_citta: s.dest_citta || v?.dest_citta || null, spedita_il: s.created_at || null,
        reso_addebitato: resoDi.get(v?.id) ?? 0,
        // Pacco gia' in una distinta precedente: lo stesso reso, addebitato una volta sola.
        gia_in_distinta: giaIn?.get(v?.id) ?? null,
      }
    })
  }
  return NextResponse.json(lista)
}