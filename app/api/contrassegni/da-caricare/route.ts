import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente, bloccaAgente } from '@/lib/agente'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'

// La creazione delle distinte fa molti round-trip: col default la funzione poteva essere uccisa
// a meta' (testata creata, righe no) lasciando distinte fantasma col totale pieno.
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// AREA DI SOSTA dei contrassegni ("da caricare").
// Ci finiscono i contrassegni sia dall'UPLOAD del file corriere sia dalle RIMESSE accettate dalla
// rete. Restano qui, gia' divisi per destinatario (cliente o sotto-master), finche' il master non
// verifica e decide A CHI caricarli: solo allora nascono le distinte.
//   GET  -> gruppi per destinatario, con numero spedizioni e totale
//   POST -> { destinatari: ['c:<clienteId>' | 'm:<masterId>'] } crea le distinte per quelli scelti

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ gruppi: [], totale: 0, spedizioni: 0 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  // L'agente e' in sola lettura sui SUOI clienti: non deve vedere l'area di sosta della rete
  // (nomi dei sotto-master, totali, clienti non suoi).
  if (!utente?.master_id || utente.ruolo === 'cliente' || isAgente(utente)) {
    return NextResponse.json({ gruppi: [], totale: 0, spedizioni: 0 })
  }
  const admin = createAdminSupabase()

  // AUTO-RECUPERO (sostituisce la vecchia casella "gialla"): le rimesse ACCETTATE ma non ancora messe
  // in sosta — auto-carico fallito in accettazione (era best-effort) o vecchie di prima che
  // l'accettazione caricasse da sola — si caricano ORA nel verde. Così NON serve più un box a parte per
  // recuperarle a mano: entrano qui da sole, unite per cliente come tutte le altre. `caricaRimesseInSosta`
  // è idempotente (claim atomico su caricata_target=false): rieseguirla non crea doppioni. Best-effort:
  // se salta, il verde mostra comunque ciò che è già in sosta.
  try {
    const { data: daRecuperare } = await admin.from('distinte_contrassegni')
      .select('id').eq('target_master_id', utente.master_id).eq('accettata_target', true).eq('caricata_target', false)
    if (daRecuperare?.length) {
      const { caricaRimesseInSosta } = await import('@/lib/cod-rimesse')
      await caricaRimesseInSosta(admin, utente.master_id, daRecuperare.map((d: any) => d.id))
    }
  } catch (e: any) { console.error('[COD][DA-CARICARE][auto-recupero rimesse]', e?.message) }

  const righe = await fetchAll(() => admin.from('cod_da_caricare')
    .select('id,spedizione_id,importo,cliente_id,target_master_id,origine,created_at')
    .eq('master_id', utente.master_id).order('created_at', { ascending: true }))
  if (!righe.length) return NextResponse.json({ gruppi: [], totale: 0, spedizioni: 0 })

  const cliIds = Array.from(new Set(righe.map((r: any) => r.cliente_id).filter(Boolean)))
  const mstIds = Array.from(new Set(righe.map((r: any) => r.target_master_id).filter(Boolean)))
  const [{ data: cli }, { data: mst }] = await Promise.all([
    cliIds.length ? admin.from('clienti').select('id,ragione_sociale').in('id', cliIds) : Promise.resolve({ data: [] as any[] }),
    mstIds.length ? admin.from('masters').select('id,nome').in('id', mstIds) : Promise.resolve({ data: [] as any[] }),
  ])
  const nomeCli = new Map((cli || []).map((c: any) => [c.id, c.ragione_sociale]))
  const nomeMst = new Map((mst || []).map((m: any) => [m.id, m.nome]))

  const mappa = new Map<string, any>()
  for (const r of righe as any[]) {
    // cliente_id → distinta cliente; target_master_id → verso sotto-master; ENTRAMBI null → "proprio"
    // (spedizione del master stesso: COD già suo, si carica senza pagamento nel riquadro a parte).
    const chiave = r.cliente_id ? `c:${r.cliente_id}` : (r.target_master_id ? `m:${r.target_master_id}` : 'proprio')
    if (!mappa.has(chiave)) {
      mappa.set(chiave, {
        chiave, tipo: r.cliente_id ? 'cliente' : (r.target_master_id ? 'sotto-master' : 'proprio'),
        nome: r.cliente_id ? (nomeCli.get(r.cliente_id) || '—') : (r.target_master_id ? (nomeMst.get(r.target_master_id) || '—') : 'Contrassegni propri (già incassati)'),
        spedizioni: 0, totale: 0, aZero: 0, origini: new Set<string>(),
      })
    }
    const g = mappa.get(chiave)
    g.spedizioni++; g.totale += Number(r.importo) || 0
    if (!(Number(r.importo) > 0)) g.aZero++
    g.origini.add(r.origine)
  }
  const gruppi = Array.from(mappa.values())
    .map(g => ({ ...g, totale: Math.round(g.totale * 100) / 100, origini: Array.from(g.origini) }))
    .sort((a, b) => (a.tipo === b.tipo ? b.totale - a.totale : a.tipo === 'cliente' ? -1 : 1))

  return NextResponse.json({
    gruppi,
    totale: Math.round(gruppi.reduce((s, g) => s + g.totale, 0) * 100) / 100,
    spedizioni: righe.length,
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const mio = utente.master_id
  const body = await req.json().catch(() => ({}))
  const destinatari: string[] = Array.isArray(body.destinatari) ? body.destinatari.filter(Boolean) : []
  // Selezione PER SINGOLA SPEDIZIONE (dalla tendina del cliente): si possono caricare solo alcune
  // delle sue spedizioni, le altre restano in sosta. Il POST poi le raggruppa comunque per
  // destinatario e crea una distinta per gruppo — quindi selezioni miste (più clienti) funzionano.
  const spedizioniSel: string[] = Array.isArray(body.spedizioni) ? body.spedizioni.filter(Boolean).map(String) : []
  if (!destinatari.length && !spedizioniSel.length) return NextResponse.json({ error: 'Seleziona almeno un contrassegno da caricare' }, { status: 400 })

  const admin = createAdminSupabase()
  const cliIds = destinatari.filter(d => d.startsWith('c:')).map(d => d.slice(2))
  const mstIds = destinatari.filter(d => d.startsWith('m:')).map(d => d.slice(2))
  const vuoleProprio = destinatari.includes('proprio')   // riquadro "propri" (COD del master stesso)

  // ── CLAIM ATOMICO: le righe si PRENDONO cancellandole e riportandole indietro. Chi arriva
  //    secondo non ottiene nulla (Postgres serializza le delete sulla stessa riga) → niente
  //    distinte doppie. Se poi qualcosa va storto, le righe vengono RIMESSE in sosta.
  const claim: any[] = []
  if (cliIds.length) {
    const { data } = await admin.from('cod_da_caricare').delete()
      .eq('master_id', mio).in('cliente_id', cliIds)
      .select('id,spedizione_id,importo,cliente_id,target_master_id,origine,origine_id')
    claim.push(...(data || []))
  }
  if (mstIds.length) {
    const { data } = await admin.from('cod_da_caricare').delete()
      .eq('master_id', mio).in('target_master_id', mstIds)
      .select('id,spedizione_id,importo,cliente_id,target_master_id,origine,origine_id')
    claim.push(...(data || []))
  }
  // Gruppo "proprio": le righe con cliente_id E target_master_id entrambi null (COD del master stesso).
  if (vuoleProprio) {
    const { data } = await admin.from('cod_da_caricare').delete()
      .eq('master_id', mio).is('cliente_id', null).is('target_master_id', null)
      .select('id,spedizione_id,importo,cliente_id,target_master_id,origine,origine_id')
    claim.push(...(data || []))
  }
  // Claim per singola spedizione. Se una è già stata presa dal gruppo intero qui sopra, il delete
  // non la ritrova (già rimossa) → nessun doppio claim.
  if (spedizioniSel.length) {
    for (let i = 0; i < spedizioniSel.length; i += 300) {
      const { data } = await admin.from('cod_da_caricare').delete()
        .eq('master_id', mio).in('spedizione_id', spedizioniSel.slice(i, i + 300))
        .select('id,spedizione_id,importo,cliente_id,target_master_id,origine,origine_id')
      claim.push(...(data || []))
    }
  }
  if (!claim.length) return NextResponse.json({ error: 'Nessun contrassegno da caricare per la selezione (forse è già stato caricato).' }, { status: 400 })

  // Rimette in sosta le righe non andate a buon fine: nessun contrassegno si perde mai.
  const rimettiInSosta = async (rows: any[]) => {
    if (!rows.length) return
    for (let i = 0; i < rows.length; i += 500) {
      try {
        await admin.from('cod_da_caricare').upsert(rows.slice(i, i + 500).map((r: any) => ({
          master_id: mio, spedizione_id: r.spedizione_id, importo: r.importo,
          cliente_id: r.cliente_id, target_master_id: r.target_master_id,
          origine: r.origine, origine_id: r.origine_id,
        })), { onConflict: 'master_id,spedizione_id', ignoreDuplicates: true })
      } catch (e) { console.error('[COD][DA-CARICARE] ripristino sosta fallito:', e) }
    }
  }

  try {
    // Dati spedizione: numero LDV e contrassegno DI SISTEMA (importo_sistema deve restare il valore
    // a sistema, non quello del file: serve al confronto file-vs-sistema).
    const spedIds = Array.from(new Set(claim.map(r => r.spedizione_id)))
    const infoSped = new Map<string, { numero: string; cod: number }>()
    for (let i = 0; i < spedIds.length; i += 300) {
      const { data: sp } = await admin.from('spedizioni').select('id,numero,contrassegno').in('id', spedIds.slice(i, i + 300))
      for (const s of (sp || [])) infoSped.set((s as any).id, { numero: (s as any).numero, cod: Number((s as any).contrassegno) || 0 })
    }

    // ANTI-DUPLICATO mirato: solo le spedizioni in gioco, usando la colonna denormalizzata
    // distinta_master_id (prima si scaricava TUTTO lo storico del master a ogni carico).
    const giaMie = new Set<string>()
    for (let i = 0; i < spedIds.length; i += 300) {
      const { data: r } = await admin.from('distinte_contrassegni_righe')
        .select('spedizione_id').eq('distinta_master_id', mio).in('spedizione_id', spedIds.slice(i, i + 300))
      for (const x of (r || [])) if ((x as any).spedizione_id) giaMie.add((x as any).spedizione_id)
    }

    const perDest = new Map<string, any[]>()
    const giaInDistinta: any[] = [], senzaImporto: any[] = []
    for (const r of claim) {
      if (giaMie.has(r.spedizione_id)) { giaInDistinta.push(r); continue }        // gia' gestita: non torna in sosta
      if (!(Number(r.importo) > 0)) { senzaImporto.push(r); continue }            // importo 0: resta in sosta
      const k = r.cliente_id ? `c:${r.cliente_id}` : (r.target_master_id ? `m:${r.target_master_id}` : 'proprio')
      if (!perDest.has(k)) perDest.set(k, [])
      perDest.get(k)!.push(r)
    }
    await rimettiInSosta(senzaImporto)

    let create = 0, totaleCaricato = 0, spedizioniCaricate = 0
    const falliti: any[] = []

    for (const [k, rows] of perDest) {
      const totale = Math.round(rows.reduce((s, r) => s + (Number(r.importo) || 0), 0) * 100) / 100
      const versoCliente = k.startsWith('c:')
      const versoProprio = k === 'proprio'   // COD del master stesso: già incassato → distinta subito 'pagata'
      let dist: any = null

      // Numero univoco per master (indice unico uniq_distinte_cod_master_numero): se due carichi
      // concorrenti scelgono lo stesso numero, il secondo riprova col successivo.
      for (let tentativo = 0; tentativo < 8 && !dist; tentativo++) {
        const { data: ultima } = await admin.from('distinte_contrassegni')
          .select('numero').eq('master_id', mio).order('numero', { ascending: false }).limit(1).maybeSingle()
        const numero = Number(ultima?.numero || 1000) + 1 + tentativo
        const { data, error } = await admin.from('distinte_contrassegni').insert({
          master_id: mio, numero,
          cliente_id: versoCliente ? k.slice(2) : null,
          target_master_id: (versoCliente || versoProprio) ? null : k.slice(2),
          totale_iniziale: totale, totale_rimborsato: totale,
          stato: versoProprio ? 'pagata' : 'in_lavorazione',
          ...(versoProprio ? { data_pagamento: new Date().toISOString(), totale_pagato: totale } : {}),
        }).select('id').single()
        if (!error && data?.id) dist = data
        else if (error && !String(error.message || '').includes('uniq_distinte_cod_master_numero')) break
      }
      if (!dist?.id) { falliti.push(...rows); continue }

      // Le RIGHE devono esistere: se l'inserimento fallisce (anche solo in parte, l'indice unico
      // rifiuta l'INSERT INTERA) la testata va rimossa, altrimenti resta una distinta col totale
      // pieno e zero righe — pagabile due volte.
      const { error: errRighe } = await admin.from('distinte_contrassegni_righe').insert(rows.map(r => ({
        distinta_id: dist.id, spedizione_id: r.spedizione_id,
        numero_spedizione: infoSped.get(r.spedizione_id)?.numero || '',
        importo_cod: Number(r.importo) || 0,
        importo_sistema: infoSped.get(r.spedizione_id)?.cod ?? 0,
      })))
      if (errRighe) {
        console.error('[COD][DA-CARICARE] righe non inserite, annullo la distinta:', errRighe.message)
        await admin.from('distinte_contrassegni').delete().eq('id', dist.id)
        falliti.push(...rows)
        continue
      }

      if (versoCliente || versoProprio) {
        // proprio: già incassato dal master → 'pagato' subito. verso cliente: 'in_distinta' (pagherà alla conferma).
        await admin.from('spedizioni')
          .update({ stato_contrassegno: versoProprio ? 'pagato' : 'in_distinta', distinta_contrassegno_id: dist.id })
          .in('id', rows.map(r => r.spedizione_id)).neq('stato_contrassegno', 'pagato')
      }
      create++; totaleCaricato += totale; spedizioniCaricate += rows.length
    }

    await rimettiInSosta(falliti)   // ciò che non è diventato distinta torna disponibile

    return NextResponse.json({
      success: true, distinteCreate: create,
      totaleCaricato: Math.round(totaleCaricato * 100) / 100,
      spedizioniCaricate,
      giaCaricate: giaInDistinta.length,
      senzaImporto: senzaImporto.length,
      nonRiuscite: falliti.length,
    })
  } catch (e: any) {
    await rimettiInSosta(claim)     // errore imprevisto: tutto torna in sosta, niente va perso
    console.error('[COD][DA-CARICARE] errore:', e?.message)
    return NextResponse.json({ error: 'Errore durante il caricamento: nessun contrassegno è andato perso, riprova.' }, { status: 500 })
  }
}
