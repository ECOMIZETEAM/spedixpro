import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente, clientiAgente } from '@/lib/agente'
import { vedeLaRete } from '@/lib/perimetro'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { statiCodPerLivello } from '@/lib/contrassegni-stato-livello'

export const maxDuration = 60

// LA DISTINTA DI OGNI CONTRASSEGNO, VISTA DA CHI GENERA IL REPORT.
//
// Il Report Contrassegni mostra lo stato PER LIVELLO (lib/contrassegni-stato-livello.ts): per un master
// "pagato" vuol dire che la distinta del SUO livello e' pagata — quella con cui il livello sopra paga
// lui, o, per chi incassa dal corriere, quella con cui lui paga chi sta sotto. L'elenco spedizioni da'
// il colore ma non dice QUALE distinta: qui si legge numero e date di quella distinta, con la stessa
// regola che decide il colore, cosi' le due cose non possono raccontare storie diverse.
// L'agente vede lo stato del cliente finale: per lui la distinta e' quella del cliente.
// Si accettano solo id del proprio perimetro: quelli di fuori vengono ignorati, non segnalati.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const agente = isAgente(utente)
  if (!utente?.master_id || (!agente && !vedeLaRete(utente))) return NextResponse.json({ error: 'Non consentito' }, { status: 403 })
  const mio = utente.master_id
  const body = await req.json().catch(() => null)
  const ids = Array.isArray(body?.ids) ? [...new Set((body.ids as any[]).map(String))] : []
  if (!ids.length) return NextResponse.json({})
  const admin = createAdminSupabase()

  try {
    const righe: any[] = []
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await admin.from('spedizioni')
        .select('id,master_id,cliente_id,tracking_number,stato_contrassegno,distinta_contrassegno_id,corriere_id,corrieri(nome_contratto)')
        .in('id', ids.slice(i, i + 200))
      if (error) throw new Error(error.message)
      righe.push(...(data || []))
    }

    // id spedizione -> id della distinta che fa da riferimento
    const riferimento = new Map<string, string>()
    if (agente) {
      const suoi = new Set(await clientiAgente(supabase, utente))
      for (const r of righe) if (r.master_id === mio && suoi.has(r.cliente_id) && r.distinta_contrassegno_id) riferimento.set(r.id, r.distinta_contrassegno_id)
    } else {
      const rete = new Set(await sottoAlberoMasterIds(admin, mio))
      const nelPerimetro = righe.filter((r: any) => rete.has(r.master_id))
      const stati = await statiCodPerLivello(admin, mio, nelPerimetro)
      for (const r of nelPerimetro) {
        const v = stati.get(r.id)
        const rif = v ? (v.sonoDetentore ? v.mia : v.inEntrata) : undefined
        if (rif?.id) riferimento.set(r.id, rif.id)
      }
    }

    const idsDistinte = [...new Set(riferimento.values())]
    const distinte = new Map<string, any>()
    for (let i = 0; i < idsDistinte.length; i += 200) {
      const { data, error } = await admin.from('distinte_contrassegni')
        .select('id,numero,stato,data_pagamento,created_at,master_id,target_master_id')
        .in('id', idsDistinte.slice(i, i + 200))
      if (error) throw new Error(error.message)
      // Solo distinte che riguardano il mio livello (mie o indirizzate a me): un id che non lo e' non esce.
      for (const d of (data || []) as any[]) if (d.master_id === mio || d.target_master_id === mio) distinte.set(d.id, d)
    }

    const out: Record<string, { numero: number; stato: string; creata_il: string; pagata_il: string | null }> = {}
    for (const [sid, did] of riferimento) {
      const d = distinte.get(did)
      if (d) out[sid] = { numero: d.numero, stato: d.stato, creata_il: d.created_at, pagata_il: d.stato === 'pagata' ? (d.data_pagamento || null) : null }
    }
    return NextResponse.json(out)
  } catch (e: any) {
    return NextResponse.json({ error: 'Lettura distinte contrassegni non riuscita: ' + (e?.message || e) }, { status: 500 })
  }
}
