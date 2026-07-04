import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'non autenticato' })
  const { data: utente } = await supabase.from('utenti').select('cliente_id,master_id').eq('id', user.id).single()
  const masterId = utente?.master_id || user.id

  const url = new URL(req.url)
  const soloCorriere = url.searchParams.get('corriere') // opzionale: nome parziale, es. "BRT"

  let corrieriQ = supabase.from('corrieri').select('id,nome_contratto,tipo').eq('master_id', masterId)
  const { data: corrieri } = await corrieriQ

  const filtrati = (corrieri || []).filter((c: any) =>
    !soloCorriere || (c.nome_contratto || '').toUpperCase().includes(soloCorriere.toUpperCase()))

  const out: any[] = []
  for (const c of filtrati) {
    // 1) zone dalla tabella zone (quello che usa la pagina cliente)
    const { data: zoneTab } = await supabase.from('zone').select('id,nome').eq('master_id', masterId).eq('corriere_id', c.id).order('nome')

    // 2) fasce salvate per questo corriere su QUALSIASI listino cliente, con join zone
    const { data: fasce } = await supabase.from('listini_clienti_fasce')
      .select('zona_id, peso_max, prezzo, listino_id, zone(id,nome)')
      .eq('corriere_id', c.id).limit(50)

    // zone-id distinti che compaiono nelle fasce + se il join zone ha restituito un nome
    const zoneDaFasce: Record<string, string> = {}
    for (const f of (fasce || [])) {
      const zid = (f as any).zona_id
      const nome = ((f as any).zone?.nome) ?? '(join vuoto)'
      if (zid) zoneDaFasce[zid] = nome
    }

    out.push({
      corriere: c.nome_contratto,
      tipo: c.tipo,
      corriere_id: c.id,
      zone_in_tabella: (zoneTab || []).length,
      nomi_zone_tabella: (zoneTab || []).map((z: any) => z.nome),
      zone_id_nelle_fasce: Object.keys(zoneDaFasce).length,
      dettaglio_zone_fasce: zoneDaFasce,
      esempio_fasce: (fasce || []).slice(0, 6).map((f: any) => ({ zona_id: f.zona_id, peso_max: f.peso_max, prezzo: f.prezzo })),
    })
  }

  return NextResponse.json({ masterId, sono_cliente: !!utente?.cliente_id, contratti: out }, { status: 200 })
}