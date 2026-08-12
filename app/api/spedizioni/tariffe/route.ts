import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { calcolaTariffeCliente, ZONE_MAP, PAESI, superaMisureMax, descriviLimiti } from '@/lib/tariffe-motore'
import { calcolaPrezzoCorriereDettaglio } from '@/lib/pricing'
import { siglaContratto } from '@/lib/corriere-logo'
import { createAdminSupabase } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await req.json()
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()

  // Spedizione PER CONTO DI UN SOTTO-MASTER (clienteId = "m:<id>"): la trattiamo come un cliente,
  // col LISTINO CHE GLI HAI ASSEGNATO (masters.parent_listino_id, di tua proprietà → sempre
  // aggiornato: peso volume, contrassegni, sponda, misure massime dai TUOI corrieri).
  const subMatch = (typeof body.clienteId === 'string' && body.clienteId.startsWith('m:')) ? body.clienteId.slice(2) : null
  let subListinoId: string | null = null
  if (subMatch && utente?.ruolo !== 'cliente' && utente?.master_id) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: sm } = await admin.from('masters').select('parent_master_id,parent_listino_id').eq('id', subMatch).maybeSingle()
    if (!sm || sm.parent_master_id !== utente.master_id) return NextResponse.json({ error: 'Sotto-master non autorizzato' }, { status: 403 })
    subListinoId = sm.parent_listino_id || null
    if (!subListinoId) return NextResponse.json({ error: 'Il sotto-master non ha un listino assegnato. Assegnaglielo dalla scheda master.' }, { status: 400 })
  }

  // ─── SPEDIZIONE PROPRIA DEL MASTER → tariffe da LISTINO CORRIERE ───
  // L'AGENTE E' FUORI: qui i prezzi arrivano dal Listino Corrieri, cioe' quanto paga il master al
  // corriere. La pagina gli nasconde la voce "spedizione propria" e la creazione lo blocca gia',
  // ma la chiamata diretta no: confrontando questi prezzi con quelli del suo cliente ricavava il
  // margine del master, corriere per corriere e destinazione per destinazione.
  const isProprio = utente?.ruolo !== 'cliente' && (utente?.ruolo || '').toLowerCase() !== 'agente' && body.clienteId === '__proprio__'
  if (isProprio) {
    const masterIdP = utente!.master_id
    const colliP = Array.isArray(body.packages) && body.packages.length ? body.packages : [body.packages?.[0] || { weight: 1 }]
    const pesoRealeP = colliP.reduce((s: number, p: any) => s + (parseFloat(p?.weight) || 0), 0) || 1
    const provinciaP = (body.shipTo?.state || '').toUpperCase().trim()
    const capP = (body.shipTo?.postalCode || '').trim()
    const paeseP = (body.shipTo?.country || 'IT').toUpperCase().trim()
    const isEsteroP = paeseP !== 'IT'

    // Corrieri da quotare = quelli che hanno delle fasce prezzo nei listini del master
    // (indipendentemente da quale listino_id: l'editor salva sotto un listino unico).
    const { data: listiniM } = await supabase.from('listini_corrieri').select('id').eq('master_id', masterIdP)
    const listinoIdsM = (listiniM || []).map((l: any) => l.id)
    let corrieriDaQuotare: any[] = []
    if (listinoIdsM.length) {
      const { data: fasceCorr } = await supabase.from('listini_corrieri_fasce').select('corriere_id').in('listino_id', listinoIdsM)
      const ids = [...new Set((fasceCorr || []).map((f: any) => f.corriere_id).filter(Boolean))]
      if (ids.length) {
        const { data: cs } = await supabase.from('corrieri').select('id,tipo,nome_contratto,attivo,settings').in('id', ids)
        corrieriDaQuotare = (cs || []).map((c: any) => ({ corriere_id: c.id, corrieri: c }))
      }
    }

    // Nessun listino corrieri (con prezzi) assegnato al master → niente tariffe.
    if (!corrieriDaQuotare.length) return NextResponse.json({ error: 'Nessun contratto attivo' }, { status: 400 })

    // Contratti messi in pausa da un master SOPRA di noi: non si possono quotare ne' vendere,
    // perche' a monte la merce non partirebbe. Un contratto sospeso in alto sparisce quindi per
    // tutta la catena sotto (sotto-master, loro clienti e chiamate via API); se viene riattivato
    // ricompare da solo, senza toccare nulla.
    const { contrattiSospesiSopra, sospesoDallaCatena } = await import('@/lib/contratti-catena')
    const sospesiSopra = await contrattiSospesiSopra(masterIdP)

    const risultati: any[] = []
    for (const lc of corrieriDaQuotare) {
      const corr: any = (lc as any).corrieri
      if (!corr || corr.attivo === false) continue
      if (sospesoDallaCatena(corr.nome_contratto, sospesiSopra)) continue   // in pausa da un livello superiore
      if (superaMisureMax(corr.settings, pesoRealeP, colliP)) continue   // fuori misura per il suo scaglione
      const dett = await calcolaPrezzoCorriereDettaglio(supabase, {
        corriereId: (lc as any).corriere_id, masterId: masterIdP,
        provincia: provinciaP, cap: capP, paese: paeseP, citta: (body.shipTo?.city || ''),
        pesoReale: pesoRealeP, packages: colliP,
        contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0),
      })
      if (!dett || dett.totale <= 0) continue   // nessun listino/fascia per questa zona o prezzo 0 -> non mostrare
      // Contrassegno/assicurazione oltre il valore massimo configurato -> corriere non disponibile
      // (vale per il master come per il cliente, per tutti i corrieri).
      if (dett.contrassegnoOltreMax || dett.assicurazioneOltreMax) continue
      const prezzoSpedP = dett.nolo + dett.fuel + dett.sponda
      risultati.push({
        carrierCode: siglaContratto(corr.tipo) || 'sda', contractCode: '',
        weight_price: dett.nolo.toFixed(2), prezzo_spedizione: prezzoSpedP.toFixed(2),
        costo_sponda: dett.sponda.toFixed(2), costo_fuel: dett.fuel.toFixed(2), fuel: dett.fuel.toFixed(2),
        costo_contrassegno: dett.contrassegno.toFixed(2), costo_assicurazione: dett.assicurazione.toFixed(2),
        total_price: dett.totale.toFixed(2),
        zona: isEsteroP ? (PAESI[paeseP] || paeseP) : (ZONE_MAP[provinciaP] || 'Italia'),
        peso_reale: pesoRealeP, peso_volume: (dett.peso_volume || 0).toFixed(2), peso_fatturato: (dett.peso_fatturato || pesoRealeP).toFixed(2),
        corriere_nome: corr.nome_contratto || 'Corriere', listino_fascia: 'Listino corriere', limiti_collo: descriviLimiti(corr.settings, pesoRealeP),
        _corriere_tipo: siglaContratto(corr.tipo), _corriere_id: corr.id,
      })
    }
    if (!risultati.length) return NextResponse.json({ error: 'Nessuna tariffa dal listino corriere per questa destinazione' }, { status: 400 })
    risultati.sort((a, b) => Number(a.total_price) - Number(b.total_price))
    return NextResponse.json(risultati)
  }

  const clienteId = utente?.ruolo === 'cliente' ? utente.cliente_id : body.clienteId

  let cliente: any
  if (subMatch) {
    // Sotto-master trattato come cliente: listino = quello assegnato (di tua proprietà → query ok)
    cliente = { master_id: utente!.master_id, listino_cliente_id: subListinoId }
  } else {
    const { data } = await supabase.from('clienti').select('master_id,listino_cliente_id').eq('id', clienteId).single()
    cliente = data
  }
  if (!cliente) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })

  // Da qui in poi il calcolo sta in lib/tariffe-motore.ts, condiviso con la rotta pubblica
  // del sito: la regola dei prezzi deve esistere in un posto solo.
  const esito = await calcolaTariffeCliente(supabase, { cliente, clienteId, subMatch }, body)
  if (esito.errore) return NextResponse.json({ error: esito.errore }, { status: esito.stato })

  // GATE "non vendere ciò che non possiedi": mostra SOLO i corrieri che il master può davvero usare
  // (suoi o di un ANTENATO nella catena) — lo stesso criterio che applica la creazione. Un listino
  // che punta a corrieri fuori catena (es. copiati da un'altra rete) non deve proporli in lista per
  // poi vederseli rifiutare con "Corriere non disponibile per questo master".
  let risultati: any[] = Array.isArray(esito.risultati) ? esito.risultati : []
  try {
    const admin = createAdminSupabase()
    const ids = [...new Set(risultati.map((r: any) => r._corriere_id).filter(Boolean))]
    if (ids.length && cliente?.master_id) {
      const { data: corr } = await admin.from('corrieri').select('id,master_id').in('id', ids)
      const masterDiCorr = new Map((corr || []).map((c: any) => [c.id, c.master_id]))
      const catena = new Set<string>()
      let cur: string | null = cliente.master_id
      for (let i = 0; i < 20 && cur; i++) {
        catena.add(cur)
        const { data: mm } = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
        cur = mm?.parent_master_id || null
      }
      risultati = risultati.filter((r: any) => {
        if (!r._corriere_id) return true            // senza id non si può verificare: si lascia (raro)
        const mid = masterDiCorr.get(r._corriere_id)
        return !!mid && catena.has(mid)
      })
    }
  } catch { /* in caso di errore non filtro: meglio mostrare che rompere la pagina */ }

  return NextResponse.json(risultati)
}
