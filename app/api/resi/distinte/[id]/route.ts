import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/ruoli'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { resoAddebitatoPerSpedizione } from '@/lib/giacenza-cascata'

export async function GET(req: NextRequest, context: any) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  // Il dettaglio di una distinta di resi e' roba del portale master: `master_id` da solo lo aprirebbe
  // anche alle 1.700 utenze cliente, che vedrebbero le LDV e i costi degli altri clienti del master.
  if (!vedeLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { id } = await context.params
  let query = supabase.from('distinte_resi')
    .select('*, clienti(ragione_sociale)')
    .eq('master_id', utente?.master_id)
    .eq('id', id)
  // L'agente solo sulle distinte dei suoi clienti, come nell'elenco: qui ci sono destinatari e costi.
  if (isAgente(utente)) query = query.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente)))
  const { data } = await query.maybeSingle()
  if (!data) return NextResponse.json(null)

  // LE RIGHE SI LEGGONO DALLA SPEDIZIONE, IL COSTO DAI MOVIMENTI. Le voci salvate non bastano: il cron
  // delle 23 ci scriveva solo l'id (righe vuote a 0,00 EUR), e la scansione ci scrive il costo
  // dell'ANDATA (costo_totale), che qui compariva come "Costo reso". Il costo di ogni riga e' quanto ha
  // pagato per quel reso chi riceve la distinta (il cliente, o il sotto-master), con la stessa funzione
  // che ne scrive il totale. La distinta e' gia' filtrata sul master di chi chiama: le voci sono
  // spedizioni passate da lui, e i movimenti letti sono solo quelli del suo destinatario.
  const voci: any[] = Array.isArray((data as any).voci) ? (data as any).voci : []
  const ids = voci.map(v => v?.id).filter(Boolean)
  const admin = createAdminSupabase()
  const spedDi = new Map<string, any>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data: ss } = await admin.from('spedizioni')
      .select('id,numero,mitt_nome,dest_nome,dest_citta,dest_cap,dest_provincia,peso_reale,colli,contrassegno')
      .in('id', ids.slice(i, i + 300))
    for (const s of (ss || [])) spedDi.set((s as any).id, s)
  }
  const pagatore = (data as any).cliente_id
    ? { clienteId: (data as any).cliente_id }
    : { masterTargetId: (data as any).target_master_id }
  const resoDi = await resoAddebitatoPerSpedizione(admin, ids, pagatore)
  const arricchite = voci.map(v => {
    const s = spedDi.get(v?.id) || {}
    return {
      id: v?.id, data_scansione: v?.data_scansione || null,
      numero: s.numero ?? v?.numero ?? null,
      mitt_nome: s.mitt_nome ?? null, dest_nome: s.dest_nome ?? null, dest_citta: s.dest_citta ?? null,
      dest_cap: s.dest_cap ?? null, dest_provincia: s.dest_provincia ?? null,
      peso_reale: s.peso_reale ?? null, colli: s.colli ?? null, contrassegno: s.contrassegno ?? null,
      reso_addebitato: resoDi.get(v?.id) ?? 0,
    }
  })
  return NextResponse.json({ ...data, voci: arricchite })
}
