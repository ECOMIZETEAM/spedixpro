import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { calcolaPrezzoListino, zonaDaProvincia } from '@/lib/pricing'
import { verificaCreditoCatena } from '@/lib/cascata'

// DEBUG: /api/debug-catena?provincia=RM&peso=1&corriere=<id>
// Riproduce la verifica catena della creazione: masterDiretto=MASSIMO, owner=master del corriere.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const p = req.nextUrl.searchParams
  const provincia = p.get('provincia') || 'RM'
  const cap = p.get('cap') || ''
  const paese = p.get('paese') || 'IT'
  const peso = parseFloat(p.get('peso') || '1')
  const corriereId = p.get('corriere') || ''
  const masterDiretto = p.get('master') || '0ac48b7e-f6b6-49fa-9929-bb9e31750c81' // MASSIMO
  const packages = [{ weight: peso, length: 20, width: 15, height: 10 }]

  const out: any = { provincia, peso, corriereId, masterDiretto, zonaNome: zonaDaProvincia(provincia) }

  let corriereOwnerId = ''
  if (corriereId) {
    const { data: cor } = await supabase.from('corrieri').select('id,nome_contratto,tipo,master_id').eq('id', corriereId).maybeSingle()
    out.corriere = cor || 'NON TROVATO'
    corriereOwnerId = cor?.master_id || ''
  }
  out.corriereOwnerId = corriereOwnerId || 'MANCANTE'

  const { data: mm } = await supabase.from('masters').select('id,nome,parent_master_id,parent_listino_id,credito,tipo_contratto').eq('id', masterDiretto).maybeSingle()
  out.masterDirettoRec = mm || null

  if (mm?.parent_listino_id) {
    out.prezzoListinoParent = await calcolaPrezzoListino(supabase, { listinoId: mm.parent_listino_id, provincia, cap, paese, packages })
  }

  if (corriereOwnerId) {
    out.verificaCatena = await verificaCreditoCatena(supabase, {
      masterDirettoId: masterDiretto, corriereOwnerId, provincia, cap, paese, packages, costoSpedizione: 0,
    })
  } else {
    out.verificaCatena = 'saltata: passa ?corriere=<id> per eseguirla'
  }
  return NextResponse.json(out)
}
