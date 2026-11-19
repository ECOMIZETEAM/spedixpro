import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { risolviPrezzoPod } from '@/lib/pod-prezzo'
import { vedeLaRete } from '@/lib/perimetro'

// Anteprima del costo di una POD PRIMA di aprirla: chi la chiede indica la LDV e sa subito quanto paga
// (dipende dal vettore della spedizione: BRT ha il suo prezzo, SDA il suo, dal listino POD del
// master) e se la puo' chiedere: la POD e' la prova di CONSEGNA, si chiede solo a pacco consegnato.
// Accettando questa cifra apre la richiesta e la paga subito (app/api/assistenza/apri, che
// ricontrolla tutto: questa e' solo l'anteprima).
// Chi chiede: il CLIENTE al suo master, oppure — dal 04/11/2026 — il MASTER al suo master superiore,
// che puo' fargliela pagare (decisione del committente). Ognuno vede solo le spedizioni che puo'
// aprire: il cliente le sue, il master le sue e quelle della sua rete, come in apri.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const admin = createAdminSupabase()

  // Chi incassa e chi paga. Il master principale non ha nessuno sopra a cui chiederla: per lui
  // niente anteprima, e apri gli dice perche'. Agente e autista non chiedono POD per il master.
  let incassa: string | null = null
  let sottoMasterId: string | null = null
  if (u?.cliente_id) {
    incassa = u.master_id
  } else if (vedeLaRete(u)) {
    const { data: m } = await admin.from('masters').select('parent_master_id').eq('id', u.master_id).maybeSingle()
    incassa = m?.parent_master_id || null
    sottoMasterId = u.master_id
  }
  if (!incassa) return NextResponse.json({ error: 'Non disponibile' }, { status: 403 })

  const ldv = (req.nextUrl.searchParams.get('ldv') || '').trim()
  if (ldv.length < 4 || ldv.length > 40) return NextResponse.json({ trovata: false })

  // Solo una LDV univoca e apribile da chi chiede: se ambigua o non sua, niente anteprima (nessun
  // prezzo trapela). Per UGUAGLIANZA (com'e' scritta, maiuscolo, minuscolo), mai ilike: su `numero`
  // l'ilike non usa l'indice e ogni anteprima — una a ogni LDV digitata — scorreva tutta la tabella.
  const { data: sps } = await admin.from('spedizioni')
    .select('id,cliente_id,master_id,corriere_id,stato')
    .in('numero', [...new Set([ldv, ldv.toUpperCase(), ldv.toLowerCase()])]).limit(2)
  if (!sps || sps.length !== 1) return NextResponse.json({ trovata: false })
  const sp = sps[0] as any
  let sua = false
  if (u?.cliente_id) sua = sp.cliente_id === u.cliente_id
  else if (sp.master_id === u!.master_id) sua = true
  else {
    const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
    sua = (await sottoAlberoMasterIds(admin, u!.master_id)).includes(sp.master_id)
  }
  if (!sua) return NextResponse.json({ trovata: false })
  if (sp.stato !== 'consegnata') return NextResponse.json({ trovata: true, consegnata: false })
  // Il master la chiede al superiore solo su un contratto che il superiore vende (come in apri).
  if (sottoMasterId) {
    const { superioreVendeContratto } = await import('@/lib/pod-prezzo')
    if (!(await superioreVendeContratto(admin, incassa, sp.corriere_id))) {
      return NextResponse.json({ trovata: true, consegnata: true, nonVende: true })
    }
  }
  try {
    const prezzo = await risolviPrezzoPod(admin, sottoMasterId
      ? { masterId: incassa, sottoMasterId, corriereId: sp.corriere_id }
      : { masterId: incassa, clienteId: u!.cliente_id, corriereId: sp.corriere_id })
    return NextResponse.json({ trovata: true, consegnata: true, prezzo })
  } catch {
    // Mai "gratuita" per un listino che non si legge: la pagina mostra "Riprova".
    return NextResponse.json({ error: 'Costo non disponibile' }, { status: 503 })
  }
}
