import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'
import { accessoAumenti, eUuid } from '@/lib/aumento-listini-accesso'

// I listini del master in cui c'e' un contratto, con chi li usa e i prezzi di quel contratto: servono alla
// pagina per scegliere i listini e per l'anteprima (prima → dopo) calcolata con lib/aumento-listini.
// Chi usa un listino: i clienti (listino_cliente_id), i sotto-master a cui e' assegnato
// (masters.parent_listino_id) e i master collegati che comprano all'ingrosso (cliente con ledger=true).
// Un listino puo' averne piu' d'uno: "426 EXPRESS" di Ecomize LL lo usano un cliente e un sotto-master.

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const acc = await accessoAumenti(); if (acc instanceof NextResponse) return acc
  const corriereId = req.nextUrl.searchParams.get('corriere')
  if (!eUuid(corriereId)) return NextResponse.json({ error: 'Contratto non valido' }, { status: 400 })
  const admin = createAdminSupabase()
  const { masterId } = acc

  const { data: contratto } = await admin.from('corrieri').select('id,nome_contratto,codice').eq('id', corriereId).eq('master_id', masterId).maybeSingle()
  if (!contratto) return NextResponse.json({ error: 'Contratto non trovato' }, { status: 404 })

  const [listini, fasce, clienti, zone, sub] = await Promise.all([
    fetchAll<any>(() => admin.from('listini_clienti').select('id,nome,attivo').eq('master_id', masterId).order('id')),
    // Ordinate su una chiave unica: senza, le pagine da 1000 si accavallano (righe perse o doppie).
    fetchAll<any>(() => admin.from('listini_clienti_fasce').select('id,listino_id,zona_id,tipo,peso_min,peso_max,prezzo,fuel').eq('corriere_id', corriereId).order('listino_id').order('id')),
    fetchAll<any>(() => admin.from('clienti').select('id,ragione_sociale,listino_cliente_id,attivo,ledger').eq('master_id', masterId).not('listino_cliente_id', 'is', null).order('id')),
    admin.from('zone').select('id,nome').eq('corriere_id', corriereId).then((r: any) => r.data || []),
    admin.from('masters').select('id,nome,parent_listino_id').not('parent_listino_id', 'is', null).then((r: any) => r.data || []),
  ])

  const perListino = new Map<string, any[]>()
  for (const f of fasce) {
    if (!perListino.has(f.listino_id)) perListino.set(f.listino_id, [])
    perListino.get(f.listino_id)!.push({ z: f.zona_id, t: f.tipo, pmin: Number(f.peso_min) || 0, pmax: Number(f.peso_max), p: Number(f.prezzo), fuel: Number(f.fuel) || 0 })
  }
  const nomiZona = new Map<string, string>((zone as any[]).map(z => [z.id, z.nome]))
  const mancanti = [...new Set(fasce.map((f: any) => f.zona_id).filter((z: any) => z && !nomiZona.has(z)))]
  if (mancanti.length) {
    const { data } = await admin.from('zone').select('id,nome').in('id', mancanti.slice(0, 100))
    for (const z of (data || []) as any[]) nomiZona.set(z.id, z.nome)
  }

  const out = listini
    .filter((l: any) => perListino.has(l.id))
    .map((l: any) => {
      const usano = clienti.filter((c: any) => c.listino_cliente_id === l.id)
      return {
        id: l.id,
        nome: (l.nome || '').trim() || 'Listino senza nome',
        attivo: l.attivo !== false,
        clienti: usano.filter((c: any) => !c.ledger).map((c: any) => ({ nome: (c.ragione_sociale || '').trim(), attivo: c.attivo !== false }))
          .sort((a: any, b: any) => a.nome.localeCompare(b.nome, 'it')),
        collegati: usano.filter((c: any) => c.ledger).map((c: any) => (c.ragione_sociale || '').trim()),
        sottoMaster: (sub as any[]).filter(m => m.parent_listino_id === l.id).map(m => (m.nome || '').trim()),
        fasce: perListino.get(l.id)!,
      }
    })
    .sort((a: any, b: any) => a.nome.localeCompare(b.nome, 'it'))

  return NextResponse.json({
    contratto: { id: contratto.id, nome: contratto.nome_contratto, codice: contratto.codice },
    zone: Object.fromEntries(nomiZona),
    listini: out,
  })
}
