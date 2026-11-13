import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente, haPermesso, nonStaffMaster } from '@/lib/permessi'
import { isAgente, clientiAgente } from '@/lib/agente'
import { inizioGiornoRomaISO, fineGiornoRomaISO } from '@/lib/date-roma'
import { righeSpesa } from '@/lib/fatture/voci'
import { calcolaProforma, motivoPeriodo, aliquotaDi, ivaDi } from '@/lib/fatture/proforma'

// REPORT FATTURE, RIGHE DEI CLIENTI: quanto ogni cliente deve al master nel periodo, con la stessa
// regola della proforma (lib/fatture/voci.ts). Decisione di Lorenzo, 13/11/2026: prima contava solo
// spedizioni e rettifiche, e a VPERFUME (GTS EXPRESS) a ottobre mancavano 38,30 € di giacenze, resi e
// servizi; due pagine davano due totali diversi per lo stesso cliente e lo stesso mese.
//
// Le righe dei SOTTO-MASTER restano quelle di /api/reports/spedizioni (listino del master verso il
// sotto-master): la proforma vale per i clienti, e i movimenti fra master hanno regole loro.

export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const cent = (x: number) => Math.round((Number(x) || 0) * 100) / 100

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  // Staff del master, oppure l'agente sui suoi clienti. Clienti e autisti no: qui ci sono le vendite
  // del master a tutti i suoi clienti.
  const agente = isAgente(utente as any)
  if (!utente?.master_id || (!agente && nonStaffMaster(utente))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  if (!haPermesso(await getPermessiUtente(), 'admin.reports.invoices')) return NextResponse.json({ error: 'Non hai il permesso per il report fatture' }, { status: 403 })
  const masterId = utente.master_id as string

  const p = req.nextUrl.searchParams
  const dal = String(p.get('dal') || '').slice(0, 10)
  const al = String(p.get('al') || '').slice(0, 10)
  const motivo = motivoPeriodo(dal, al)
  if (motivo) return NextResponse.json({ error: motivo }, { status: 400 })
  // L'agente vede solo i clienti assegnati a lui (letti con la sua sessione, sotto RLS).
  const suoi = agente ? new Set(await clientiAgente(supabase, utente as any)) : null

  const admin = createAdminSupabase()
  const clienteId = p.get('clienteId')
  if (clienteId) {
    if (!UUID.test(clienteId) || (suoi && !suoi.has(clienteId))) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 404 })
    const { data: c } = await admin.from('clienti').select('id,ragione_sociale,aliquota_iva').eq('id', clienteId).eq('master_id', masterId).maybeSingle()
    if (!c) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 404 })
    try {
      const calc = await calcolaProforma(admin, masterId, clienteId, dal, al)
      const aliquota = aliquotaDi(c), iva = ivaDi(calc.imponibile, aliquota)
      return NextResponse.json({
        cliente: { id: c.id, nome: c.ragione_sociale }, righe: calc.righe, imponibile: calc.imponibile,
        aliquota, iva, totale: cent(calc.imponibile + iva), movimenti: calc.movimenti,
      })
    } catch (e: any) { return NextResponse.json({ error: e?.message || 'Calcolo non riuscito' }, { status: 500 }) }
  }

  const { data: importi, error } = await admin.rpc('fatture_importi_periodo_v1', {
    p_master: masterId, p_dal: inizioGiornoRomaISO(dal), p_al: fineGiornoRomaISO(al),
  })
  if (error) return NextResponse.json({ error: 'Importi del periodo non leggibili: ' + error.message }, { status: 500 })
  const perCliente = new Map<string, any[]>()
  for (const r of importi || []) {
    if (suoi && !suoi.has(r.cliente_id)) continue
    const l = perCliente.get(r.cliente_id) || []
    l.push({ tipo: r.tipo, con_spedizione: r.con_spedizione, n: Number(r.n) || 0, importo: Number(r.importo) || 0 })
    perCliente.set(r.cliente_id, l)
  }
  // A gruppi: un .in() con centinaia di id diventa un indirizzo troppo lungo e PostgREST risponde
  // Bad Request (e' gia' successo con 1.000 id, nel lavoro che cancella i dati Amazon).
  const ids = [...perCliente.keys()]
  const anagrafica = new Map<string, any>()
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error: e } = await admin.from('clienti').select('id,ragione_sociale,aliquota_iva').in('id', ids.slice(i, i + 150))
    if (e) return NextResponse.json({ error: 'Clienti non leggibili: ' + e.message }, { status: 500 })
    for (const c of data || []) anagrafica.set(c.id, c)
  }
  const clienti = []
  for (const [id, l] of perCliente) {
    const { righe, imponibile } = righeSpesa(l)
    if (!righe.length) continue
    const c = anagrafica.get(id)
    const aliquota = aliquotaDi(c), iva = ivaDi(imponibile, aliquota)
    clienti.push({ id, nome: String(c?.ragione_sociale || '—').trim(), righe, imponibile, aliquota, iva, totale: cent(imponibile + iva) })
  }
  clienti.sort((a, b) => b.imponibile - a.imponibile)
  return NextResponse.json({ clienti })
}
