import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { chiaveZona, zoneNonModificabili } from '@/lib/zone-catena'

// Copia tutte le zone (con le relative regioni/CAP) da un corriere a un altro.
// body: { fromCorriereId, toCorriereId }
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const masterId = utente?.master_id
  const { fromCorriereId, toCorriereId } = await req.json()
  if (!fromCorriereId || !toCorriereId || fromCorriereId === toCorriereId) {
    return NextResponse.json({ error: 'Seleziona un corriere di destinazione diverso' }, { status: 400 })
  }

  // Si copia solo SU un contratto proprio: su uno comprato le zone sono quelle del fornitore (lib/zone-catena).
  const bloccato = await zoneNonModificabili(createAdminSupabase(), toCorriereId, masterId ?? null)
  if (bloccato) return NextResponse.json({ error: bloccato }, { status: 403 })

  // Zone di origine con le loro regioni
  const { data: zoneOrigine } = await supabase.from('zone')
    .select('id,nome,descrizione,con_fuel,su_mittente,multicollo')
    .eq('master_id', masterId).eq('corriere_id', fromCorriereId)
  if (!zoneOrigine?.length) return NextResponse.json({ error: 'Il corriere di origine non ha zone da copiare' }, { status: 400 })

  // Zone già presenti sul corriere di destinazione: evita i doppioni. Per chiave intera (nome, multicollo, partenza):
  // per solo nome una zona multicollo veniva saltata perché c'era quella del collo singolo con lo stesso nome.
  const { data: zoneDest } = await supabase.from('zone').select('nome,multicollo,su_mittente').eq('master_id', masterId).eq('corriere_id', toCorriereId)
  const nomiEsistenti = new Set((zoneDest || []).map((z: any) => chiaveZona(z)))

  // Una zona si crea, poi i suoi CAP a blocchi: ogni blocco porta i CAP anche a chi compra il contratto di
  // destinazione (scripts/zone-catena-trigger.sql), dentro il limite di tempo di un'istruzione. Se un blocco non
  // entra la zona appena creata si toglie (le copie con lei) e lo si dice: prima l'errore si ignorava e una zona
  // nasceva senza CAP, con la pagina che diceva "copiate".
  let create = 0, saltate = 0
  const nonCopiate: string[] = []
  for (const z of zoneOrigine) {
    if (nomiEsistenti.has(chiaveZona(z))) { saltate++; continue }
    const caps: any[] = []
    let letti = true
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('zone_cap').select('paese,provincia,cap,citta').eq('zona_id', z.id).order('id', { ascending: true }).range(from, from + 999)
      if (error) { letti = false; break }
      caps.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    if (!letti) { nonCopiate.push(z.nome); continue }
    const { data: nuova, error } = await supabase.from('zone').insert({
      master_id: masterId, corriere_id: toCorriereId, nome: z.nome, descrizione: z.descrizione, con_fuel: z.con_fuel || false,
      su_mittente: !!z.su_mittente, multicollo: !!z.multicollo,
    }).select('id').single()
    if (error || !nuova) { nonCopiate.push(z.nome); continue }
    let entrati = true
    for (let i = 0; i < caps.length; i += 1000) {
      const { error: eCap } = await supabase.from('zone_cap').insert(caps.slice(i, i + 1000).map((c: any) => ({ zona_id: nuova.id, paese: c.paese, provincia: c.provincia, cap: c.cap, citta: c.citta })))
      if (eCap) { entrati = false; break }
    }
    if (!entrati) {
      await supabase.from('zone').delete().eq('id', nuova.id)
      nonCopiate.push(z.nome)
      continue
    }
    create++
  }
  if (nonCopiate.length) {
    return NextResponse.json({ error: `Copiate ${create} zone, ma queste NON sono state copiate: ${nonCopiate.join(', ')}. Riprova.`, create, saltate }, { status: 500 })
  }
  return NextResponse.json({ ok: true, create, saltate })
}
