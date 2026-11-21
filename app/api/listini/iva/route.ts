import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { nonStaffMaster } from '@/lib/permessi'
import { bloccaAgente } from '@/lib/agente'
import { statoIvaListino } from '@/lib/iva-vendita'

// SCEGLIERE SE UN LISTINO E' VENDUTO IVA INCLUSA, ESCLUSA O ESENTE (Lorenzo, 20/11 e 21/11/2026): per tutto il listino o
// per un solo contratto, da inizio mese o da oggi. Non tocca prezzi, movimenti ne' credito: la leggono i
// report e la proforma per dividere imponibile e IVA. Ogni scelta e' una riga nuova (il database non
// lascia modificare le vecchie), cosi' i mesi gia' chiusi escono sempre uguali.
//
// Chi puo': lo staff del master che possiede il listino, come per modificarne i prezzi. L'agente no
// (sola lettura), il cliente no. Il listino si controlla col client di servizio CONTRO il master della
// sessione: l'id arriva dal browser.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const blocco = bloccaAgente(utente as any); if (blocco) return blocco
  if (!utente || nonStaffMaster(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const listinoId = String(body?.listino_id || '')
  const corriereId = body?.corriere_id ? String(body.corriere_id) : null
  // `regime`: 'inclusa' / 'esclusa' / 'esente', o null sul contratto = "come il listino". Un editor aperto
  // prima del 21/11 manda ancora `iva_inclusa` si'/no: vale lo stesso.
  const r = body?.regime
  const valore: 'inclusa' | 'esclusa' | 'esente' | null = r === 'inclusa' || r === 'esclusa' || r === 'esente' ? r
    : body?.iva_inclusa === true ? 'inclusa' : body?.iva_inclusa === false ? 'esclusa' : null
  if (r != null && valore !== r) return NextResponse.json({ error: 'Scelta non valida' }, { status: 400 })
  const da = body?.da === 'oggi' ? 'oggi' : body?.da === 'mese' ? 'mese' : null
  if (!UUID.test(listinoId) || (corriereId && !UUID.test(corriereId))) return NextResponse.json({ error: 'Richiesta non valida' }, { status: 400 })
  if (!da) return NextResponse.json({ error: 'Scegli da quando vale' }, { status: 400 })
  // Sul listino serve una scelta; sul contratto anche "come il listino" (null).
  if (!corriereId && valore === null) return NextResponse.json({ error: 'Scelta non valida' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: listino } = await admin.from('listini_clienti').select('id,master_id').eq('id', listinoId).maybeSingle()
  if (!listino || listino.master_id !== utente.master_id) return NextResponse.json({ error: 'Listino non trovato' }, { status: 404 })

  const argomenti = { p_master: utente.master_id, p_listino: listinoId, p_corriere: corriereId, p_da: da, p_utente: user.id }
  let { data: dal, error } = await admin.rpc('listini_iva_imposta_regime', { ...argomenti, p_regime: valore })
  // Finche' scripts/iva-esente.sql non e' lanciato c'e' solo quella di ieri: inclusa ed esclusa si salvano
  // lo stesso, esente no.
  if (error && String(error.code || '') === 'PGRST202') {
    if (valore === 'esente') return NextResponse.json({ error: 'Esente IVA non è ancora attivo: riprova più tardi' }, { status: 503 })
    ;({ data: dal, error } = await admin.rpc('listini_iva_imposta', { ...argomenti, p_iva_inclusa: valore === 'inclusa' ? true : valore === 'esclusa' ? false : null }))
  }
  if (error) {
    console.error('[LISTINI IVA]', listinoId, corriereId, error.message)
    return NextResponse.json({ error: 'Scelta non salvata: ' + error.message }, { status: 500 })
  }
  console.log('[LISTINI IVA] scelta', JSON.stringify({ listino: listinoId, corriere: corriereId, regime: valore, da, dal, utente: user.id }))
  // La scelta e' salvata: se poi non si rilegge lo stato, la pagina si ricarica invece di dire "non salvata"
  // (il master riproverebbe, aggiungendo una riga uguale).
  let stato = null
  try { stato = await statoIvaListino(admin, listinoId) } catch (e: any) { console.error('[LISTINI IVA] stato non riletto', listinoId, e?.message || e) }
  // Un editor aperto prima del 21/11 (manda `iva_inclusa`, non `regime`) legge lo stato col si'/no: se ricevesse
  // le parole, 'esclusa' gli sembrerebbe "si'" e mostrerebbe «IVA inclusa». Si toglie al prossimo giro.
  if (stato && !('regime' in (body || {}))) {
    const vecchio = (v: string | null) => (v === 'inclusa' ? true : v === 'esclusa' || v === 'esente' ? false : null)
    return NextResponse.json({ ok: true, dal, stato: { listino: vecchio(stato.listino), corrieri: Object.fromEntries(Object.entries(stato.corrieri).map(([k, v]) => [k, vecchio(v)])) } })
  }
  return NextResponse.json({ ok: true, dal, stato })
}
