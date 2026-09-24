import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { vedeLaRete } from '@/lib/perimetro'

// restituisce i contratti con il conteggio delle spedizioni ancora da mettere in distinta
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const clienteIdRaw = p.get('clienteId')
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  const dal = p.get('dal')
  const al = p.get('al')

  let db: any = supabase
  let masterFilter: string[] = [utente?.master_id]
  let ownedContractNames: string[] | null = null
  if (masterSel && vedeLaRete(utente)) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { sottoAlberoMasterIds, masterIdsVisibili, contrattiPossedutiNomi } = await import('@/lib/rete-masters')
    const admin = createAdminSupabase()
    const mieiDiscendenti = await masterIdsVisibili(admin, utente.master_id)
    masterFilter = mieiDiscendenti.includes(masterSel) ? await sottoAlberoMasterIds(admin, masterSel) : ['00000000-0000-0000-0000-000000000000']
    db = admin
    // Drill su un sub: solo i contratti che POSSIEDO (non i privati del sub).
    const nn = await contrattiPossedutiNomi(admin, utente.master_id)
    ownedContractNames = nn.length ? nn : null
  }
  const filtroContratti = !!ownedContractNames && ownedContractNames.length > 0

  // prendo le spedizioni senza distinta, filtrate
  let query = db.from('spedizioni')
    .select(filtroContratti ? 'corriere_id,corrieri!inner(nome_contratto)' : 'corriere_id')
    .in('master_id', masterFilter)
    .is('distinta_id', null)
  if (filtroContratti) query = query.in('corrieri.nome_contratto', ownedContractNames as string[])
  if (clienteId) query = query.eq('cliente_id', clienteId)
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')
  const { data: speds } = await query

  // conto per corriere
  const conteggio: Record<string, number> = {}
  for (const s of (speds || [])) {
    const c = (s as any).corriere_id
    if (!c) continue
    conteggio[c] = (conteggio[c] || 0) + 1
  }

  // recupero i nomi dei corrieri (+ tipo, per raggruppare i contratti per VETTORE fisico nella UI)
  // Sul drill di rete mostro SOLO i contratti che possiedo (non i privati del sub).
  let corrQ = db.from('corrieri').select('id,nome_contratto,tipo').in('master_id', masterFilter)
  if (filtroContratti) corrQ = corrQ.in('nome_contratto', ownedContractNames as string[])
  const { data: corrieri } = await corrQ

  const risultato = (corrieri || []).map((c: any) => ({
    id: c.id,
    nome_contratto: c.nome_contratto,
    tipo: c.tipo,
    da_chiudere: conteggio[c.id] || 0,
  }))
  return NextResponse.json(risultato)
}