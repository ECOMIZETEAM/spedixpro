import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fattoreVolumeCorriere } from '@/lib/pricing'

// CHECK VOLUMETRICI — confronta il divisore peso/volume che il master METTE AI CLIENTI con quello del
// suo COSTO, contratto per contratto. Divisore più ALTO = volume più piccolo = più economico:
//  - cliente > costo  → vendi SOTTO COSTO sul volume (sui pacchi voluminosi incassi meno di quanto paghi).
//  - cliente < costo  → vendi sopra costo (ci guadagni; lo mostriamo lo stesso, per consapevolezza).
//  - uguale           → allineato (non compare).
// Il divisore di COSTO si legge dalla STESSA funzione del motore prezzi (fattoreVolumeCorriere: override
// per-corriere → default del listino proprietario → eredità dalla catena → 5000), così il check combacia
// col calcolo vero. Il divisore CLIENTE: override (listini_clienti_corrieri) → default del listino → 5000.
// SOLA LETTURA: la correzione la fa il master nell'editor del listino (link per riga).

type Riga = {
  listino_id: string; listino_nome: string; clienti: string[]
  corriere_id: string; contratto: string
  divisore_costo: number; divisore_cliente: number; scarto: number
}

const pos = (v: any): number | null => { const n = parseFloat(v); return n > 0 ? n : null }

export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ sottocosto: [], sovracosto: [] })
  const mio = utente.master_id
  const admin = createAdminSupabase()

  // I miei contratti (solo i miei: il confronto vale sui miei corrieri).
  const { data: mieiCorrieri } = await admin.from('corrieri').select('id,nome_contratto').eq('master_id', mio)
  const nomeCorr = new Map<string, string>((mieiCorrieri || []).map((c: any) => [c.id, c.nome_contratto || 'Contratto']))
  if (!nomeCorr.size) return NextResponse.json({ sottocosto: [], sovracosto: [] })

  // I miei listini CLIENTE (+ default volumetrico del listino) e i clienti agganciati.
  const { data: listini } = await admin.from('listini_clienti').select('id,nome,fattore_volume').eq('master_id', mio)
  const nomeListino = new Map<string, string>((listini || []).map((l: any) => [l.id, l.nome || 'Listino']))
  const defCli = new Map<string, number>((listini || []).map((l: any) => [l.id, pos(l.fattore_volume) ?? 5000]))
  const ids = [...nomeListino.keys()]
  if (!ids.length) return NextResponse.json({ sottocosto: [], sovracosto: [] })
  const clientiDi = new Map<string, string[]>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await admin.from('clienti').select('ragione_sociale,listino_cliente_id').in('listino_cliente_id', ids.slice(i, i + 100))
    for (const c of (data || [])) {
      const k = (c as any).listino_cliente_id
      if (!clientiDi.has(k)) clientiDi.set(k, [])
      clientiDi.get(k)!.push((c as any).ragione_sociale || '—')
    }
  }

  // DIVISORE DI COSTO dalla funzione del motore, in cache per contratto (una volta per corriere).
  const costoCache = new Map<string, number>()
  const divCosto = async (corrId: string): Promise<number> => {
    if (!costoCache.has(corrId)) costoCache.set(corrId, await fattoreVolumeCorriere(admin, mio, corrId))
    return costoCache.get(corrId)!
  }

  // DIVISORE CLIENTE per (listino,corriere): override → default listino → 5000. Paginato (oltre 1000
  // righe PostgREST tronca in silenzio → contratti non mostrati).
  const sottocosto: Riga[] = [], sovracosto: Riga[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    for (let da = 0; ; da += 1000) {
      const { data: links } = await admin.from('listini_clienti_corrieri')
        .select('listino_id,corriere_id,fattore_volume').in('listino_id', chunk)
        .order('listino_id', { ascending: true }).order('corriere_id', { ascending: true })
        .range(da, da + 999)
      if (!links?.length) break
      for (const l of links) {
        const corrId = (l as any).corriere_id
        if (!nomeCorr.has(corrId)) continue
        const dCosto = await divCosto(corrId)
        const dCli = pos((l as any).fattore_volume) ?? defCli.get((l as any).listino_id) ?? 5000
        if (Math.abs(dCli - dCosto) < 0.5) continue
        const riga: Riga = {
          listino_id: (l as any).listino_id, listino_nome: nomeListino.get((l as any).listino_id) || 'Listino',
          clienti: clientiDi.get((l as any).listino_id) || [],
          corriere_id: corrId, contratto: nomeCorr.get(corrId) || '—',
          divisore_costo: dCosto, divisore_cliente: dCli, scarto: Math.round((dCli - dCosto) * 100) / 100,
        }
        if (dCli > dCosto) sottocosto.push(riga); else sovracosto.push(riga)
      }
      if (links.length < 1000) break
    }
  }
  sottocosto.sort((a, b) => b.scarto - a.scarto)       // peggiori (più sotto costo) in cima
  sovracosto.sort((a, b) => a.scarto - b.scarto)
  return NextResponse.json({ sottocosto: sottocosto.slice(0, 1000), sovracosto: sovracosto.slice(0, 1000) })
}
