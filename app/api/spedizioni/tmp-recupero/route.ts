import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// RECUPERO DELLE SPEDIZIONI FERME SU UN NUMERO PROVVISORIO.
//
// Sui contratti DVA la lettera di vettura non arriva insieme all'ordine: l'ordine si paga, e il
// numero con le etichette si va a prendere dopo. Se in quel momento non c'e' ancora, la spedizione
// viene salvata con un numero provvisorio "TMP-<ordine>" — senza un numero non sarebbe agganciabile
// ai movimenti — e dovrebbe essere completata piu' tardi.
//
// Piu' tardi non arrivava mai: due spedizioni sono rimaste col TMP per otto ore, e con loro le
// ETICHETTE, che il provider aveva gia' pronte. Un pacco senza etichetta non parte.
//
// Questo lavoro fa solo quello, e solo su quelle: cerca le spedizioni il cui numero comincia per
// TMP-, richiede la waybill, e quando c'e' scrive numero ed etichette. NON tocca nient'altro —
// nessun'altra spedizione, nessun altro corriere, nessun prezzo, nessun movimento. E' scritto
// apposta come lavoro a parte invece che dentro la creazione: li' passano 1.500 pacchi al giorno
// di tutti i contratti, e un errore avrebbe conseguenze su tutti.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()

  // SOLO chi ha il numero provvisorio, e solo sul contratto che lo produce.
  const { data: ferme } = await admin.from('spedizioni')
    .select('id,numero,colli,corriere_id,stato,colli_dettaglio,created_at,corrieri(tipo,credenziali)')
    .like('numero', 'TMP-%')
    // UNA SPEDIZIONE IN CODA DI ANNULLO MANUALE E' ANCORA VIVA PRESSO IL FORNITORE, e va recuperata
    // come le altre. Escluderla creava un anello chiuso: il recupero non la guardava piu', e senza
    // il numero vero nemmeno i suoi movimenti venivano risistemati (riga piu' sotto: si salta
    // finche' il numero comincia per TMP). Restava un numero provvisorio per sempre, nessuna
    // etichetta, e l'addebito gia' fatto a tutti e tre i livelli con un riferimento che il fornitore
    // non conosce — quindi l'annullo manuale non era nemmeno eseguibile, perche' chi lo deve fare
    // non ha una lettera di vettura da citare. E' il caso di TMP-25681381, 18,52 euro fermi li'.
    .not('stato', 'in', '(annullata)')
    // Oltre una settimana la lettera di vettura non arriva piu': quella spedizione va guardata a
    // mano, non ritentata all'infinito. Il limite tiene anche la ricerca leggera su una tabella
    // che cresce di 1.500 righe al giorno.
    .gte('created_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
    .order('created_at', { ascending: true })
    .limit(50)

  let completate = 0, soloEtichette = 0, ancoraNulla = 0, saltate = 0
  const { easyparcelWaybillGrezza, unisciEtichette } = await import('@/lib/easyparcel')

  for (const s of (ferme || [])) {
    const corr: any = (s as any).corrieri
    // Il numero provvisorio nasce solo sul ramo DVA: su qualsiasi altro tipo non si tocca niente.
    if (corr?.tipo !== 'easyparcel') { saltate++; continue }
    const apikey = corr?.credenziali?.apikey
    if (!apikey) { saltate++; continue }

    const ordine = String(s.numero).replace(/^TMP-/, '')
    let w: any = null
    try {
      w = await easyparcelWaybillGrezza(apikey, ordine)
    } catch (e: any) {
      console.warn('[TMP] waybill non ancora disponibile', s.numero, e?.message)
      ancoraNulla++
      continue
    }

    const patch: any = {}

    // LE ETICHETTE SI SALVANO ANCHE SENZA LETTERA DI VETTURA.
    // Sono valide di per se': il pacco con quelle parte. Buttarle perche' manca un altro campo
    // e' il motivo per cui questi pacchi sono rimasti fermi.
    const singole: string[] = (w?.singole || []).map((x: any) => x?.pdfBase64).filter(Boolean)
    if (singole.length) {
      const unito = (await unisciEtichette(singole)) || w?.pdfBase64
      if (unito) patch.etichetta_url = `data:application/pdf;base64,${unito}`
      const dett = Array.isArray(s.colli_dettaglio) ? [...s.colli_dettaglio] : []
      if (dett.length) {
        for (let i = 0; i < dett.length; i++) {
          if (singole[i]) dett[i] = {
            ...dett[i],
            etichetta_url: `data:application/pdf;base64,${singole[i]}`,
            numero: w.singole[i]?.numero || dett[i]?.numero,
          }
        }
        patch.colli_dettaglio = dett
      }
    } else if (w?.pdfBase64) {
      patch.etichetta_url = `data:application/pdf;base64,${w.pdfBase64}`
    }

    // IL NUMERO si cambia solo se la LDV c'e' davvero ed e' diversa. Un numero e' l'identita' della
    // spedizione: sta nei movimenti, nelle distinte, sull'etichetta gia' stampata. Non si tocca
    // per un valore vuoto o dubbio.
    const ldv = String(w?.numero || '').trim()
    if (ldv && ldv !== s.numero) {
      // Se quel numero esiste gia' su un'altra spedizione, non si sovrascrive niente: si segnala.
      const { data: gia } = await admin.from('spedizioni').select('id').eq('numero', ldv).neq('id', s.id).maybeSingle()
      if (gia) {
        console.error('[TMP] LDV gia in uso da un altra spedizione, non riassegnata', ldv, s.numero)
      } else {
        patch.numero = ldv
        patch.tracking_number = ldv
      }
    }
    // Il codice di ritiro NON si scrive qui: vive sulla riga del ritiro, non sulla spedizione, e
    // ha gia' il suo recupero. Toccarlo da qui vorrebbe dire scrivere su una colonna che non esiste.

    if (!Object.keys(patch).length) { ancoraNulla++; continue }
    const { error } = await admin.from('spedizioni').update(patch).eq('id', s.id)
    if (error) { console.error('[TMP] aggiornamento fallito', s.numero, error.message); continue }

    if (patch.numero) {
      completate++
      console.log('[TMP] completata', s.numero, '->', patch.numero)
      // ANCHE L'ESTRATTO CONTO. Il movimento porta il numero scritto nella descrizione: se resta
      // quello provvisorio, il cliente si ritrova addebitata una spedizione con un numero che non
      // esiste da nessuna parte e non sa a cosa corrisponde. Cambia solo il testo — mai l'importo.
      const { data: mv } = await admin.from('movimenti').select('id,descrizione').eq('spedizione_id', s.id)
      for (const m of (mv || [])) {
        const t = String(m.descrizione || '')
        if (t.includes(s.numero)) {
          await admin.from('movimenti').update({ descrizione: t.split(s.numero).join(patch.numero) }).eq('id', m.id)
        }
      }
    }
    else { soloEtichette++; console.log('[TMP] recuperate solo le etichette', s.numero) }
  }

  // ── SECONDA PARTE: I MULTICOLLO SENZA LE ETICHETTE DEI SINGOLI COLLI ──
  //
  // Qui il numero c'e' ed e' giusto: manca l'etichetta dei colli dal secondo in poi, perche' al
  // momento della creazione il provider aveva pronta solo quella principale. Il pacco 2 e il pacco 3
  // partono senza niente sopra.
  //
  // Per richiedere di nuovo le etichette serve l'ID ORDINE del provider, ed e' gia' in casa:
  // raw_response._idOrdine, scritto alla creazione e gia' usato dalla ristampa etichetta, dai ritiri
  // e dal tracking. (Sull'etichetta e' anche stampato un "Rif.", ma quello e' il riferimento SCRITTO
  // DAL CLIENTE: leggerlo da li' vorrebbe dire chiedere al provider l'ordine di un altro, visto che
  // tutti i contratti condividono la stessa chiave.)
  const colliRecuperati = await recuperaMulticollo(admin)

  // ── TERZA PARTE: L'ESTRATTO CONTO CHE CITA UN NUMERO CHE NON ESISTE ──
  //
  // Quasi tutte le spedizioni di questo contratto nascono col numero provvisorio e lo perdono dopo
  // pochi secondi, sostituito da chi completa la creazione. Il numero della spedizione diventa
  // quello giusto, ma il MOVIMENTO no: la sua descrizione era gia' stata scritta, e nessuno ci
  // torna sopra. Risultato: il cliente apre l'estratto conto e legge addebiti intestati a
  // "TMP-25629971", che non trova da nessuna parte e non sa a cosa corrispondano.
  //
  // Il ricambio del numero avviene troppo in fretta perche' il controllo qui sopra lo intercetti:
  // quando questo lavoro passa, la spedizione ha gia' il numero buono. Quindi si parte dall'altro
  // capo — dai movimenti — e si rimette il numero vero. Solo il testo: importi, date e collegamenti
  // non si toccano.
  const estrattoContoSistemato = await sistemaMovimenti(admin)

  // ── QUARTA PARTE: SPEDIAMOPRO FERME SULLA REFERENZA ──
  // SpediamoPro (Poste Delivery Business) assegna la LDV Poste in modo ASINCRONO: se alla creazione
  // non c'e' ancora (l'attesa breve + il completamento in background mollano dopo ~20s), la
  // spedizione resta col `code` del provider come numero (es. "6A7C7CA9BC399") e un tracking che non
  // esiste. Prima la sistemava solo il giro pesante /api/tracking/aggiorna, che gira su ~8.000
  // spedizioni a rotazione e a volte non le raggiungeva per un pezzo ("30 sì, una no"). Qui, ogni
  // 15 min e solo su quelle davvero ferme, si richiede il tracking e si scrive la LDV vera.
  const spediamoproSospese = await recuperaSpediamoproSospese(admin)

  // ARCHIVIAZIONE ETICHETTE, appoggiata qui.
  // Il giro dedicato (/api/spedizioni/archivia-etichette) esiste ma Vercel non lo invocava, mentre
  // questo parte ogni quarto d'ora da mesi. Lotto piccolo per non allungare troppo un giro che ha
  // gia' il suo lavoro, e avvolto: se l'archiviazione fallisce, il recupero dei TMP non ne risente.
  let etichetteArchiviate = 0
  let etichetteLiberate: any = null
  try {
    const { archiviaLotto, liberaEtichetteArchiviate } = await import('@/lib/etichette')
    // 1) Archivia su Storage le etichette NUOVE ancora inline (scrive etichetta_path, tiene il base64).
    etichetteArchiviate = (await archiviaLotto(admin, 60)).archiviate
    // 2) LIBERA il base64 di quelle GIÀ archiviate (verifica del file su Storage prima di azzerare) +
    //    archivia le etichette per-collo dei multicollo. È il recupero grosso dello spazio del TOAST.
    etichetteLiberate = await liberaEtichetteArchiviate(admin, 150)
  } catch (e: any) { console.error('[TMP-RECUPERO] archiviazione/liberazione etichette fallita:', e?.message) }

  return NextResponse.json({
    etichetteArchiviate, etichetteLiberate,
    esaminate: (ferme || []).length,
    completate,            // numero provvisorio sostituito con la LDV vera
    soloEtichette,         // etichette recuperate, la LDV non c'e' ancora
    ancoraNulla,           // il provider non ha ancora niente
    saltate,               // non e' un contratto che produce numeri provvisori
    colliRecuperati,       // multicollo a cui sono state riprese le etichette dei singoli colli
    estrattoContoSistemato,
    spediamoproSospese,    // SpediamoPro ferme sulla referenza a cui è stata scritta la LDV vera
  })
}

// Recupera le spedizioni SpediamoPro rimaste col `code` del provider come numero (LDV Poste non
// ancora assegnata alla creazione). Cerca il tracking reale e, quando c'è, scrive numero + LDV e
// rimette il numero vero nella descrizione dei movimenti. Isolata e best-effort, come il resto.
async function recuperaSpediamoproSospese(admin: any): Promise<number> {
  const { spediamoproGetTracking, spediamoproGetLabel, normalizzaEtichetta } = await import('@/lib/spediamopro')
  const { data: cor } = await admin.from('corrieri').select('id,credenziali').eq('tipo', 'spediamopro')
  const authDi = new Map<string, string>()
  for (const c of (cor || [])) if (c?.credenziali?.authcode) authDi.set(c.id, c.credenziali.authcode)
  if (!authDi.size) return 0

  // Attive, recenti (7gg) e su un contratto SpediamoPro, FERME SUL CODICE PROVVISORIO.
  //
  // Il codice provvisorio SpediamoPro (il `code` del provider) inizia per "6A"; la LDV Poste vera e'
  // "050...". Quindi `numero LIKE '6A%'` individua esattamente le spedizioni ancora ferme, e si filtra
  // direttamente in query — non piu' "le 400 piu' recenti + confronto in memoria".
  //
  // GUASTO CHE QUESTA RIGA RIPARA: prima si prendevano le 400 SpediamoPro piu' recenti e si teneva chi
  // aveva numero === code. A 1.500 pacchi/giorno le 400 piu' recenti coprono poche ore, ma la LDV Poste
  // puo' tardare 18h+ (async): quando la LDV era finalmente pronta, la spedizione era gia' USCITA dalla
  // finestra delle 400 e non veniva mai recuperata — restava sul 6A per sempre, con un tracking che non
  // esiste. E' successo il 31/08: ~17 spedizioni ferme sul 6A con la LDV gia' pronta su SpediamoPro.
  // Il confronto in memoria `numero === sp_code` resta come conferma (belt & suspenders).
  const { data: righe } = await admin.from('spedizioni')
    .select('id,numero,etichetta_url,corriere_id,sp_id:raw_response->id,sp_id2:raw_response->raw->data->id,sp_code:raw_response->code')
    .in('corriere_id', [...authDi.keys()])
    .ilike('numero', '6A%')
    .not('stato', 'in', '(consegnata,annullata,annullamento_pending,annullamento_manuale)')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(400)

  let fatte = 0
  for (const s of (righe || [])) {
    const code = (s as any).sp_code
    if (!code || s.numero !== code) continue        // solo quelle ancora sulla referenza SpediamoPro
    const authcode = authDi.get(s.corriere_id)
    const spid = (s as any).sp_id ?? (s as any).sp_id2
    if (!authcode || !spid) continue

    let tr: any = null
    try { tr = await spediamoproGetTracking(authcode, Number(spid)) } catch { continue }

    const patch: any = {}
    const ldv = String(tr?.trackingCode || '').trim()
    if (ldv && ldv !== s.numero) {
      // Se quella LDV è già di un'altra spedizione non si sovrascrive: si segnala.
      const { data: gia } = await admin.from('spedizioni').select('id').eq('numero', ldv).neq('id', s.id).maybeSingle()
      if (gia) console.error('[SP] LDV già in uso da un altra spedizione, non riassegnata', ldv, s.numero)
      else { patch.numero = ldv; patch.tracking_number = ldv }
    }
    // Etichetta di sicurezza: di norma c'è già, ma se manca la si scarica (una volta).
    if (!s.etichetta_url) {
      try {
        const lb = await spediamoproGetLabel(authcode, Number(spid), 1, 0)
        const n = await normalizzaEtichetta(lb)
        patch.etichetta_url = `data:${n.mime};base64,${n.buffer.toString('base64')}`
      } catch { /* non ancora pronta: al giro dopo */ }
    }
    if (!Object.keys(patch).length) continue

    const { error } = await admin.from('spedizioni').update(patch).eq('id', s.id)
    if (error) { console.error('[SP] aggiornamento fallito', s.numero, error.message); continue }

    if (patch.numero) {
      fatte++
      console.log('[SP] completata', s.numero, '->', patch.numero)
      // L'estratto conto porta il numero vecchio nella descrizione: si rimette quello vero (solo testo).
      const { data: mv } = await admin.from('movimenti').select('id,descrizione').eq('spedizione_id', s.id)
      for (const m of (mv || [])) {
        const t = String(m.descrizione || '')
        if (t.includes(s.numero)) await admin.from('movimenti').update({ descrizione: t.split(s.numero).join(patch.numero) }).eq('id', m.id)
      }
    }
  }
  return fatte
}

async function sistemaMovimenti(admin: any): Promise<number> {
  // A blocchi: le righe da sistemare sono migliaia e non c'e' nessuna fretta di finirle in un giro.
  // SI CERCA SUL RIFERIMENTO, NON SULLA DESCRIZIONE.
  // La descrizione ora dice "In attesa di lettera di vettura" invece di esibire il TMP: e' quello
  // che legge il cliente, e un codice che non esiste da nessuna parte lo mandava in confusione.
  // Il riferimento resta il TMP — e' interno — ed e' l'aggancio buono per ritrovare queste righe.
  const { data: mv } = await admin.from('movimenti')
    .select('id,descrizione,riferimento,spedizione_id')
    .like('riferimento', 'TMP-%')
    .not('spedizione_id', 'is', null)
    .limit(300)
  if (!mv?.length) return 0

  const { data: sped } = await admin.from('spedizioni')
    .select('id,numero,dest_nome').in('id', [...new Set(mv.map((m: any) => m.spedizione_id))])
  const numeroDi = new Map<string, string>()
  const destDi = new Map<string, string>()
  for (const s of (sped || [])) { numeroDi.set(s.id, s.numero); destDi.set(s.id, s.dest_nome || '') }

  let fatti = 0
  for (const m of mv) {
    const vero = numeroDi.get(m.spedizione_id)
    // Se la spedizione e' ancora col numero provvisorio non c'e' niente da mettere al suo posto:
    // ci ripasseremo quando ce l'avra'.
    if (!vero || vero.startsWith('TMP-')) continue
    // La descrizione si RICOSTRUISCE dal numero vero e dal destinatario della spedizione, invece
    // di sostituire un pezzo di testo: cosi' vale sia per le righe vecchie (che il TMP ce l'hanno
    // scritto dentro) sia per quelle nuove, che dicono "In attesa di lettera di vettura".
    const { descrizioneSpedizione } = await import('@/lib/movimenti')
    const patch: any = {
      descrizione: descrizioneSpedizione(vero, destDi.get(m.spedizione_id)),
      riferimento: vero,
    }
    const { error } = await admin.from('movimenti').update(patch).eq('id', m.id)
    if (!error) fatti++
  }
  if (fatti) console.log('[ESTRATTO CONTO] rimesso il numero vero su', fatti, 'movimenti')
  return fatti
}

async function recuperaMulticollo(admin: any): Promise<number> {
  const { easyparcelWaybillGrezza } = await import('@/lib/easyparcel')
  const { data: cor } = await admin.from('corrieri').select('id,credenziali').eq('tipo', 'easyparcel')
  const chiaveDi = new Map<string, string>()
  for (const c of (cor || [])) if (c?.credenziali?.apikey) chiaveDi.set(c.id, c.credenziali.apikey)
  if (!chiaveDi.size) return 0

  // Le etichette NON si portano dietro nella ricerca: sono PDF da mezzo mega l'uno, e tirarne fuori
  // cinquanta ogni quarto d'ora per poi scartarli quasi sempre e' peso inutile addosso al database.
  const { data: multi } = await admin.from('spedizioni')
    .select('id,numero,colli,colli_dettaglio,corriere_id,lunghezza,larghezza,altezza,peso_reale,ordine:raw_response->_idOrdine')
    .in('corriere_id', [...chiaveDi.keys()])
    .gt('colli', 1)
    .not('numero', 'like', 'TMP-%')
    .gte('created_at', new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(100)

  let sistemate = 0
  for (const s of (multi || [])) {
    const gia = (Array.isArray(s.colli_dettaglio) ? s.colli_dettaglio : []).filter((x: any) => x?.etichetta_url).length
    if (gia >= s.colli) continue                       // completa: non si tocca
    const ordine = s.ordine ? String(s.ordine) : null
    if (!ordine) continue

    let w: any = null
    try { w = await easyparcelWaybillGrezza(chiaveDi.get(s.corriere_id)!, ordine) } catch { continue }

    // LA PROVA CHE E' PROPRIO QUESTA SPEDIZIONE. Il riferimento e' stato letto da un PDF: se per
    // qualsiasi motivo fosse quello di un altro ordine, scriveremmo su un pacco le etichette di un
    // altro — che e' molto peggio di un'etichetta mancante. Se il numero non combacia, si lascia.
    if (String(w?.numero || '') !== s.numero) {
      console.warn('[COLLI] riferimento non combaciante, lasciata com era', s.numero)
      continue
    }
    const sing = (w?.singole || []).filter((x: any) => x?.pdfBase64)
    if (sing.length < s.colli) continue                // ancora incomplete dall'altra parte

    // LE MISURE VANNO MESSE, NON LASCIATE VUOTE.
    // Le spedizioni che arrivano dalle API non hanno il dettaglio dei colli: il prezzo lo calcola
    // ripiegando sulle misure della spedizione ripetute per ogni collo. Ma il calcolo guarda PRIMA
    // colli_dettaglio: se lo troviamo riempito di oggetti senza misure, il volumetrico viene zero e
    // il peso fatturato crolla. Quindi ogni collo che nasce qui prende le misure della spedizione,
    // che e' esattamente cio' che il calcolo avrebbe usato da solo: il prezzo non si muove di un
    // centesimo.
    const misureBase = {
      lunghezza: Number(s.lunghezza) || undefined,
      larghezza: Number(s.larghezza) || undefined,
      altezza: Number(s.altezza) || undefined,
    }
    const dett = Array.isArray(s.colli_dettaglio) && s.colli_dettaglio.length === s.colli
      ? [...s.colli_dettaglio]
      : Array.from({ length: s.colli }, (_: any, i: number) => ({ ...(s.colli_dettaglio?.[i] || {}) }))
    for (let i = 0; i < s.colli; i++) {
      const c: any = { ...dett[i] }
      if (c.lunghezza == null && c.larghezza == null && c.altezza == null) Object.assign(c, misureBase)
      dett[i] = { ...c, numero: sing[i].numero || c?.numero, etichetta_url: `data:application/pdf;base64,${sing[i].pdfBase64}` }
    }
    // Si scrivono SOLO le etichette dei colli. Il numero della spedizione qui non si tocca mai:
    // e' gia' quello giusto.
    const { error } = await admin.from('spedizioni').update({ colli_dettaglio: dett }).eq('id', s.id)
    if (error) { console.error('[COLLI] scrittura fallita', s.numero, error.message); continue }
    sistemate++
    console.log('[COLLI] recuperate', s.colli, 'etichette per', s.numero)
  }
  return sistemate
}
