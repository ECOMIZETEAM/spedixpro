import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { calcolaPrezzoListino } from '@/lib/pricing'
import { createAdminSupabase } from '@/lib/supabase-admin'


// Risale la catena dei master: [masterId, padre, nonno, ...]
async function risaliCatena(adminDb: any, masterId: string): Promise<string[]> {
  const path: string[] = []
  let cur: string | null = masterId
  for (let i = 0; i < 20 && cur; i++) {
    path.push(cur)
    const { data: m } = await adminDb.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    cur = m?.parent_master_id || null
  }
  return path
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = no scrittura / no rete
  const myMaster = utente?.master_id
  if (!myMaster) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
  const body = await req.json()
  const { nomeFile, righe } = body

  // ── E' IL FILE DELLE RIPESATURE DEL FORNITORE? ──
  //
  // Una schermata sola, due file possibili: quello dei PESI (storico) e quello delle RIPESATURE che
  // manda il corriere. Chi carica non deve sapere in quale voce di menu va quale export — lo
  // riconosce il sistema dalle COLONNE.
  //
  // E' successo davvero: il file delle ripesature caricato qui dentro ha risposto "0 da rettificare"
  // senza spiegare perche'. Il motivo e' che questa rotta cerca una colonna "peso reale", mentre
  // quel file la chiama `peso_riscontrato` — e soprattutto qui le MISURE vengono buttate via
  // ("senza misure: nessun volumetrico"), mentre su quel file e' proprio il volume a fare il
  // supplemento: su 45 spedizioni su 106 il pacco pesa MENO del dichiarato e paga lo stesso.
  {
    const { sembraRipesature, leggiRipesature } = await import('@/lib/ripesature')
    if (sembraRipesature(righe || [])) {
      const { calcolaRipesature } = await import('@/lib/ripesature-calcolo')
      const lette = leggiRipesature(righe || [])
      if (!lette.righe.length) return NextResponse.json({ error: 'Il file non contiene ripesature leggibili' }, { status: 400 })

      const adminRip = createAdminSupabase()
      // Gia' caricate: si tolgono PRIMA di calcolare, cosi' i totali a schermo sono quelli che
      // entrerebbero davvero. L'export del fornitore e' cumulativo. (La garanzia vera resta
      // l'indice unico sul database: questo serve solo a mostrare numeri onesti.)
      const { data: gia } = await adminRip.from('rettifiche')
        .select('rif_fornitore').eq('master_id', myMaster)
        .in('rif_fornitore', lette.righe.map(r => r.idOrdine))
      const viste = new Set((gia || []).map((g: any) => g.rif_fornitore))
      const nuove = lette.righe.filter(r => !viste.has(r.idOrdine))
      const esiti = await calcolaRipesature(adminRip, nuove)

      return NextResponse.json({
        success: true, tipo: 'ripesature', anteprima: true,
        totali: {
          nelFile: (righe || []).length,
          spedizioni: lette.righe.length,
          giaCaricate: viste.size,
          nonTrovate: esiti.filter(e => !e.trovata).length,
          addebitoFornitore: Math.round(nuove.reduce((s, r) => s + r.addebitoFornitore, 0) * 100) / 100,
        },
        righe: esiti,
      })
    }
  }

  // RLS: match LDV su tutta la catena (discendenti) -> admin; l'autorizzazione e' il check catena stesso
  const adminDb = createAdminSupabase()

  // ── Dedup del file per LDV: doppioni identici → uno; pesi diversi → anomalia ──
  const perLdv = new Map<string, number[]>()
  for (const rigaRaw of (righe || [])) {
    const riga: any = {}
    for (const k in rigaRaw) { riga[String(k).trim().toLowerCase()] = (rigaRaw as any)[k] }
    const ldv = String(riga['ldv'] || riga['n. spedizione'] || riga['numero'] || '').trim()
    const pesoReale = parseFloat(String(riga['peso reale'] || riga['peso_reale'] || riga['pesoreale'] || riga['peso'] || riga['peso volume'] || riga['pesovolume'] || 0))
    if (!ldv) continue
    if (!perLdv.has(ldv)) perLdv.set(ldv, [])
    perLdv.get(ldv)!.push(pesoReale)
  }
  const anomalie: string[] = []
  const daProcessare: { ldv: string, pesoReale: number }[] = []
  for (const [ldv, pesi] of perLdv) {
    const distinti = Array.from(new Set(pesi.map(p => isFinite(p) ? p.toFixed(3) : 'x')))
    if (distinti.length > 1) { anomalie.push(ldv); continue }
    daProcessare.push({ ldv, pesoReale: pesi[0] })
  }

  let nProcessate = 0, nTrovate = 0, nScartati = 0, nDaRettificare = 0
  const { data: fileRec } = await supabase.from('rettifiche_files').insert({
    master_id: myMaster, nome_file: nomeFile, n_tot_spedizioni: (righe || []).length,
  }).select().single()

  const rettificheToInsert: any[] = []
  for (const { ldv, pesoReale } of daProcessare) {
    nProcessate++
    // Ricerca SENZA filtro master: decide la catena (solo discesa)
    const { data: spedizione } = await adminDb.from('spedizioni')
      .select('id,cliente_id,master_id,peso_reale,peso_fatturato,peso_volume,costo_totale,costo_spedizione,numero,dest_provincia,dest_cap,dest_paese,dest_citta,corriere_id,stato')
      .or(`numero.ilike.%${ldv}%,tracking_number.ilike.%${ldv}%`)
      .limit(1).single()
    if (!spedizione) { nScartati++; continue }
    // Niente rettifiche su spedizioni ANNULLATE: sono già stornate, aggiungere una rettifica
    // lascerebbe un residuo non rimborsato a ogni livello della catena.
    if ((spedizione as any).stato === 'annullata') { nScartati++; continue }

    // Chi carica deve essere il master della spedizione o un suo ANTENATO
    const catena = await risaliCatena(adminDb, spedizione.master_id)
    const idx = catena.indexOf(myMaster)
    if (idx === -1) { nScartati++; continue }

    // Anti-duplicato: salta se esiste già una rettifica CONFERMATA o IN ATTESA per la spedizione
    // (prima bloccava solo le confermate → si potevano creare doppioni "da_rettificare")
    const { data: giaEsiste } = await supabase.from('rettifiche').select('id').eq('spedizione_id', spedizione.id).or('confermata.eq.true,stato.eq.da_rettificare').limit(1)
    if (giaEsiste && giaEsiste.length > 0) { nScartati++; continue }
    nTrovate++

    const pesoIniziale = Number(spedizione.peso_fatturato || spedizione.peso_reale || 0)

    if (idx === 0) {
      // ── CLIENTE DIRETTO: flusso attuale invariato ──
      const costoIniziale = Number(spedizione.costo_totale || 0)
      let costoFinale = costoIniziale
      const { data: cli } = await supabase.from('clienti').select('listino_cliente_id').eq('id', spedizione.cliente_id).single()
      if (cli?.listino_cliente_id && pesoReale > 0 && spedizione.corriere_id) {
        // LA ZONA SI RICALCOLA COME SI CALCOLA, cioe' col CAP e col comune.
        // Qui si guardava la sola PROVINCIA: le zone agganciate al CAP — isole minori, zone
        // disagiate, Livigno — non hanno un nome che venga fuori dalla provincia, quindi non si
        // trovava nessuna fascia e si ripiegava su "Italia". Una spedizione venduta 14,95 sulla
        // fascia isola sarebbe stata riportata a 5,34, e la differenza rimborsata al cliente:
        // il file dei pesi del corriere avrebbe REGALATO il supplemento dell'isola.
        // La stessa funzione la usa gia' il ramo della catena, qui sotto: una regola sola.
        const ris = await calcolaPrezzoListino(supabase, {
          listinoId: cli.listino_cliente_id, corriereId: spedizione.corriere_id,
          provincia: spedizione.dest_provincia || '', cap: spedizione.dest_cap || '',
          paese: spedizione.dest_paese || 'IT', citta: spedizione.dest_citta || '',
          packages: [{ weight: pesoReale }],   // il peso vero del corriere, senza misure: nessun volumetrico
        })
        // Nessun prezzo = quel contratto non copre quella destinazione (zona esclusiva non
        // prezzata al cliente). Non si inventa una tariffa: si lascia il costo com'e'.
        if (ris) costoFinale = ris.prezzo
      }
      const differenza = costoIniziale - costoFinale
      if (Math.abs(differenza) <= 0.01) { continue }
      nDaRettificare++
      rettificheToInsert.push({
        master_id: myMaster, file_id: fileRec?.id, spedizione_id: spedizione.id,
        numero_spedizione: spedizione.numero, cliente_id: spedizione.cliente_id, target_master_id: null,
        peso_iniziale: pesoIniziale, peso_volume_iniziale: Number(spedizione.peso_volume||0),
        peso_reale: pesoReale || pesoIniziale, peso_volume_reale: 0,
        costo_iniziale: costoIniziale, costo_finale: costoFinale, differenza,
        stato: 'da_rettificare',
      })
    } else {
      // ── CATENA: la rettifica si ferma al primo master sotto di me ──
      const targetMasterId = catena[idx - 1]
      const { data: tm } = await adminDb.from('masters').select('parent_listino_id').eq('id', targetMasterId).maybeSingle()
      if (!tm?.parent_listino_id) { nScartati++; continue }
      const pesoRicalcolo = pesoReale || pesoIniziale
      const prezzoIni = await calcolaPrezzoListino(adminDb, {
        listinoId: tm.parent_listino_id, provincia: spedizione.dest_provincia || '',
        cap: spedizione.dest_cap || '', paese: spedizione.dest_paese || 'IT', citta: spedizione.dest_citta || '',
        packages: [{ weight: pesoIniziale || 1 }], corriereId: spedizione.corriere_id,
      })
      const prezzoFin = await calcolaPrezzoListino(adminDb, {
        listinoId: tm.parent_listino_id, provincia: spedizione.dest_provincia || '',
        cap: spedizione.dest_cap || '', paese: spedizione.dest_paese || 'IT', citta: spedizione.dest_citta || '',
        packages: [{ weight: pesoRicalcolo }], corriereId: spedizione.corriere_id,
      })
      if (!prezzoIni || !prezzoFin) { nScartati++; continue }
      const costoIniziale = prezzoIni.prezzo
      const costoFinale = prezzoFin.prezzo
      const differenza = costoIniziale - costoFinale
      if (Math.abs(differenza) <= 0.01) { continue }
      nDaRettificare++
      rettificheToInsert.push({
        master_id: myMaster, file_id: fileRec?.id, spedizione_id: spedizione.id,
        numero_spedizione: spedizione.numero, cliente_id: null, target_master_id: targetMasterId,
        peso_iniziale: pesoIniziale, peso_volume_iniziale: Number(spedizione.peso_volume||0),
        peso_reale: pesoRicalcolo, peso_volume_reale: 0,
        costo_iniziale: costoIniziale, costo_finale: costoFinale, differenza,
        stato: 'da_rettificare',
      })
    }
  }

  if (rettificheToInsert.length > 0) await supabase.from('rettifiche').insert(rettificheToInsert)
  await supabase.from('rettifiche_files').update({
    n_processate: nProcessate, n_trovate: nTrovate, n_scartati: nScartati, n_da_rettificare: nDaRettificare,
  }).eq('id', fileRec?.id)
  return NextResponse.json({ success: true, fileId: fileRec?.id, nProcessate, nTrovate, nScartati, nDaRettificare, anomalie })
}
