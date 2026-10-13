import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente } from '@/lib/permessi'
import { isProviderTecnico } from '@/lib/corriere-logo'
import { pianoCondivisione, riepilogoSostituzione } from '@/lib/condivisione-engine'

/* Dati della sezione "Contratti condivisi" sulla scheda di un master collegato (il cliente-ledger).
 * Torna il collegamento attivo di QUESTO master verso quel ledger e, per ogni contratto del listino
 * d'ingrosso assegnato, cosa ne fa la regola della condivisione (lib/condivisione-engine.ts,
 * valutaContrattoPerCompratore): condiviso, da attivare, da sostituire su conferma, o non condiviso e
 * perché. È la stessa regola dell'Assegna: la scheda mostra quello che succederà. Solo il VENDITORE
 * (fornitore del link). Se il cliente non è un ledger collegato a me → { link: null }.
 */
export async function GET(req: NextRequest) {
  const perm = await getPermessiUtente()
  if (!perm?.masterId || !perm.isFull) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  const clienteId = (req.nextUrl.searchParams.get('cliente_id') || '').trim()
  if (!clienteId) return NextResponse.json({ link: null })

  const admin = createAdminSupabase()
  const { data: link } = await admin.from('corrieri_condivisi')
    .select('id,master_id,fornitore_master_id,stato,credito_modo').eq('cliente_ledger_id', clienteId)
    .eq('fornitore_master_id', perm.masterId).is('corriere_id', null).eq('stato', 'attiva').maybeSingle()
  if (!link) return NextResponse.json({ link: null })

  const [{ data: buyer }, { data: ledgerRow }, { data: listini }, { data: pontiBuyer }, { data: chiavi }, { data: abilitati }] = await Promise.all([
    admin.from('masters').select('nome').eq('id', link.master_id).maybeSingle(),
    // Il listino d'ingrosso attualmente assegnato al collegato (= quello che lui paga).
    admin.from('clienti').select('listino_cliente_id').eq('id', clienteId).maybeSingle(),
    // I listini che il venditore ha già fatto (Listini Clienti): da assegnare al collegato.
    admin.from('listini_clienti').select('id,nome').eq('master_id', perm.masterId).eq('attivo', true).order('nome'),
    // I ponti del compratore: quali vengono da me, per quale mio contratto, e se sono accesi.
    admin.from('corrieri').select('id,attivo,settings,fornitore:credenziali->>fornitore_master_id,origine:credenziali->>corriere_origine_id')
      .eq('master_id', link.master_id).eq('tipo', 'moovexpress'),
    // Chiave e abilitazione del ledger: se le ho tolte io (Disabilita), il ponte spento è opera mia.
    admin.from('api_keys').select('corriere_id,attivo').eq('cliente_id', clienteId),
    admin.from('clienti_corrieri_abilitati').select('corriere_id,abilitato').eq('cliente_id', clienteId),
  ])
  const listinoCorrente = (ledgerRow as any)?.listino_cliente_id || null
  let piano: any[] = []
  let erroreLettura = false
  if (listinoCorrente) {
    try { piano = (await pianoCondivisione(admin, link, listinoCorrente)).piano }
    catch (e: any) { console.error('[condivisioni/scheda]', link.id, e?.message); erroreLettura = true }
  }

  const mieiPonti = (pontiBuyer || []).filter((p: any) => p.fornitore === perm.masterId && p.origine)
  const acceso = new Map<string, boolean>(mieiPonti.map((p: any) => [p.origine, p.attivo !== false]))
  const inAttesaCosto = new Set<string>(mieiPonti.filter((p: any) => p.settings?.in_attesa_costo).map((p: any) => p.origine))
  const chiaveAttiva = new Map<string, boolean>((chiavi || []).map((k: any) => [k.corriere_id, k.attivo !== false]))
  const abilitato = new Map<string, boolean>((abilitati || []).map((a: any) => [a.corriere_id, a.abilitato !== false]))
  const spentoDaMe = (corrId: string) => chiaveAttiva.get(corrId) === false || abilitato.get(corrId) === false
  const voce = (c: any) => ({ id: c.id, nome_contratto: c.nome_contratto, tipo: isProviderTecnico(c.tipo) ? null : c.tipo })
  // Chi l'ha spento: io (Disabilita), nessuno (nato senza costo, si accende quando il costo arriva), o il
  // collegato (una sua pausa, che l'Assegna non annulla).
  const statoPonte = (corrId: string) => spentoDaMe(corrId) ? 'disabilitato'
    : inAttesaCosto.has(corrId) ? 'in_attesa_costo'
    : (acceso.get(corrId) !== false ? 'acceso' : 'in_pausa')

  const contratti: any[] = piano.map(({ corr, esito }: any) => ({
    ...voce(corr),
    stato: esito.stato,
    motivo: esito.stato === 'saltato' ? esito.motivo : null,
    ponte: esito.stato === 'condiviso' ? statoPonte(corr.id) : null,
    sostituzione: esito.stato === 'da_sostituire' ? riepilogoSostituzione(corr.nome_contratto, esito) : null,
  }))
  // Ponti ancora in piedi su contratti che non sono più nel listino assegnato: si vedono, così si
  // possono disabilitare (il listino non li nomina più, ma il collegato li ha ancora).
  const nelListino = new Set(piano.map((x: any) => x.corr.id))
  const fuori = mieiPonti.filter((p: any) => !nelListino.has(p.origine)).map((p: any) => p.origine)
  if (fuori.length && !erroreLettura) {
    const { data: corrFuori } = await admin.from('corrieri').select('id,nome_contratto,tipo').in('id', fuori).eq('master_id', perm.masterId)
    for (const c of (corrFuori || [])) {
      contratti.push({ ...voce(c), stato: 'condiviso', motivo: 'non è più nel listino assegnato', ponte: statoPonte(c.id), fuori_listino: true })
    }
  }

  return NextResponse.json({
    link: { id: link.id, compratore: buyer?.nome || '—' },
    contratti,
    errore_lettura: erroreLettura,
    listini: listini || [],
    listino_corrente: listinoCorrente,
    credito_modo: link.credito_modo || 'prepagato',
  })
}
