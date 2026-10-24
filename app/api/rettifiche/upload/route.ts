import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { calcolaPrezzoListino, calcolaSupplementiCliente } from '@/lib/pricing'
import { createAdminSupabase, createAdminSupabaseConMemoria } from '@/lib/supabase-admin'
import { controllaColliXL } from '@/lib/ripesature-xl'
import { colliDalPesoTotale } from '@/lib/ripesature-pesi'
import { inserisciRettifica, fattureGiaPagate } from '@/lib/ripesature-crea'


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
  // IL RUOLO, NON SOLO L'APPARTENENZA. `master_id` ce l'hanno anche i clienti (769 in produzione)
  // e gli autisti: da solo dice a quale rete uno appartiene, non che comandi qualcosa. Qui sotto si
  // scrive con la chiave di servizio, che scavalca le regole per riga — quindi il permesso va
  // controllato a mano, come fa gia' la rotta gemella /api/network/rettifiche.
  if (!gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
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
    const { sembraRipesature, sembraRipesatureSP, leggiRipesature } = await import('@/lib/ripesature')
    if (sembraRipesature(righe || [])) {
      const { calcolaRipesature, qualcunoSottoDeve } = await import('@/lib/ripesature-calcolo')
      const lette = leggiRipesature(righe || [])
      if (!lette.righe.length) return NextResponse.json({ error: 'Il file non contiene ripesature leggibili' }, { status: 400 })

      const adminRip = createAdminSupabase()

      // FILE TRANSAZIONI SpediamoPro? Il "ldv" letto è il CODICE provider (6A...): va rimappato in
      // tracking_number (raw_response.code) perché il motore e il costo fornitore agganciano per
      // tracking. La rimappatura si fa SOLO sui codici della fetta corrente (sotto), non su tutti a
      // ogni giro: risolvere 500 codici con un OR enorme su un campo JSON non indicizzato faceva
      // sforare il tempo del primo blocco → funzione uccisa → "non riesco a caricarlo".
      const isSP = sembraRipesatureSP(righe || [])

      // A FETTE, cosi' la schermata puo' dire a che punto sta.
      // Riprezzare una spedizione vuol dire ricostruire tutta la sua catena di master, e ognuno e'
      // qualche lettura: su centosei spedizioni sono centinaia di viaggi al database, e in un colpo
      // solo la richiesta ci mette troppo e la pagina resta muta. Il browser ne chiede un pezzo per
      // volta e misura quanto ci mette davvero: il tempo che manca e' calcolato sul ritmo vero.
      //
      // L'INDICE CONTA SUL FILE, NON SU "QUELLE CHE RESTANO DA FARE". E' il guasto che ha fatto
      // sparire quarantasei spedizioni su centosei, due volte di fila: la fetta veniva presa
      // dall'elenco delle NON ancora caricate, che pero' si accorcia di quindici a ogni giro perche'
      // nel frattempo le stiamo scrivendo noi. L'indice avanzava di quindici, la lista ne perdeva
      // quindici, e ogni giro ne saltava un blocco intero; dopo quattro giri la fetta cadeva oltre
      // la fine e il lavoro si dichiarava finito a sessanta su centosei. Ogni caricamento ne
      // prendeva un pezzo diverso — ecco perche' i totali dei destinatari cambiavano ogni volta.
      // Il file e' la sola cosa che non cambia sotto i piedi: si numera quello.
      const totaleFile = lette.righe.length
      const da = Math.max(0, Number(body?.da) || 0)
      const quante = Math.max(1, Math.min(200, Number(body?.quante) || totaleFile))
      const fetta = body?.da !== undefined ? lette.righe.slice(da, da + quante) : lette.righe

      // SpediamoPro: rimappa 6A → tracking_number SOLO per i codici di QUESTA fetta. Le righe il cui
      // codice non aggancia restano col 6A: il motore non le troverà (contate come "non trovate"),
      // senza toccare la lunghezza del file (l'indice a fette conta sul file, non deve cambiare sotto
      // i piedi).
      //
      // .in() → "= ANY(array)": UNA sola condizione che usa l'indice idx_spedizioni_raw_code, a
      // qualsiasi dimensione (misurato: 500 codici in 470ms). NON tornare a .or(...eq...) con molti
      // rami: oltre ~50 il planner molla l'indice e va in seq-scan sull'INTERA tabella spedizioni →
      // statement timeout (57014) → l'aggancio torna a vuoto e l'import muore con "Nessuna spedizione
      // agganciata". E' il guasto vero del "non riesco a caricarlo": il vecchio batch da 100 andava
      // SEMPRE in timeout (verificato: 5/5 batch a 500, 0 codici agganciati su 500).
      const attesaMisureLdv = new Set<string>()
      const spPerCode = new Map<string, { id: string; colli: number }>()
      if (isSP) {
        const codiciFetta = Array.from(new Set(fetta.map(r => r.codiceProvider || r.ldv)))
        const codeToTrack = new Map<string, string>()
        const { data: sp } = await adminRip.from('spedizioni')
          .select('id,colli,tracking_number,code:raw_response->>code')
          .in('raw_response->>code', codiciFetta)
        for (const s of (sp || [])) {
          const code = (s as any).code, tn = (s as any).tracking_number
          if (code && tn) codeToTrack.set(code, tn)
          if (code) spPerCode.set(code, { id: (s as any).id, colli: Number((s as any).colli || 1) })
        }
        for (const r of fetta) { const t = codeToTrack.get(r.codiceProvider || r.ldv); if (t) r.ldv = t }
      }

      // Gia' caricate: si saltano SENZA spostare l'indice, cosi' rileggere lo stesso export (che il
      // fornitore manda cumulativo) non rifa' i conti su quelle di ieri. La garanzia vera resta
      // l'indice unico sul database: questo evita solo lavoro inutile.
      const viste = new Set<string>()
      // Delle gia' caricate, quelle CONFERMATE: per loro la fattura del fornitore si ritenta qui sotto come
      // prima (rete di sicurezza: se mancasse, la ripaga l'indice unico solo una volta). Quelle ancora in
      // attesa no: il loro costo si paga alla conferma, e cancellandole non si paga (regola del 22/10).
      const visteConfermate = new Set<string>()
      for (let i = 0; i < fetta.length; i += 200) {
        // Le ANNULLATE non contano: il loro addebito e' stato stornato, quindi la spedizione torna da
        // rettificare e il file giusto deve poterla ricaricare (file LOGIXIA 12-16/10, stornato il 22/10).
        const { data: gia } = await adminRip.from('rettifiche')
          .select('rif_fornitore,confermata').eq('master_id', myMaster)
          .in('rif_fornitore', fetta.slice(i, i + 200).map(r => r.idOrdine))
          .or('propagazione.is.null,propagazione.neq.annullata')
        for (const g of (gia || [])) { viste.add((g as any).rif_fornitore); if ((g as any).confermata) visteConfermate.add((g as any).rif_fornitore) }
      }
      const nuove = fetta.filter(r => !viste.has(r.idOrdine))

      // ── MULTICOLLO: il totale del fornitore NON e' un collo solo ──
      //
      // La riga del fornitore porta il peso di TUTTA la spedizione. Metterlo in un collo unico fa
      // perdere il volume degli altri colli, e alla rete si chiede molto meno del dovuto: su 40
      // multicollo veri (conto 499,72 EUR) si recuperavano 419,81 EUR invece di 564,16.
      // Le misure vere, collo per collo, le legge il Mac dal portale filiali (Poste blocca gli IP
      // dei server) e stanno in misure_colli. Se non ci sono ancora, la riga NON si addebita: si
      // mette in coda e si aspetta il giro di stanotte — l'export del fornitore e' cumulativo,
      // domani la riga ritorna e verra' caricata giusta. Dopo tre tentativi a vuoto (spedizioni
      // che il portale filiali non copre) si rinuncia e si torna a fare come prima, col totale in
      // un collo solo: meglio recuperare meno che non recuperare niente.
      const { colliDaMisure } = await import('@/lib/misure-colli')
      const multi = nuove.filter(r => (spPerCode.get(r.codiceProvider || '')?.colli || 1) > 1)
      if (multi.length) {
        const idsMulti = multi.map(r => spPerCode.get(r.codiceProvider || '')!.id)
        const misurePerSped = new Map<string, any[]>()
        const rinunciate = new Set<string>()
        for (let i = 0; i < idsMulti.length; i += 200) {
          const fettaIds = idsMulti.slice(i, i + 200)
          const { data: mis } = await adminRip.from('misure_colli')
            .select('spedizione_id,codice,peso,lunghezza,larghezza,altezza').in('spedizione_id', fettaIds)
          for (const m of (mis || [])) {
            const k = (m as any).spedizione_id
            if (!misurePerSped.has(k)) misurePerSped.set(k, [])
            misurePerSped.get(k)!.push(m)
          }
          const { data: ric } = await adminRip.from('misure_colli_richieste')
            .select('spedizione_id,esito').in('spedizione_id', fettaIds)
          for (const x of (ric || [])) if ((x as any).esito === 'senza-misure') rinunciate.add((x as any).spedizione_id)
        }
        const daMettereInCoda: any[] = []
        for (const r of multi) {
          const sped = spPerCode.get(r.codiceProvider || '')!
          const mis = misurePerSped.get(sped.id) || []
          if (mis.length >= sped.colli) {
            r.colli = colliDaMisure(mis, r.colli.reduce((s: number, c: any) => s + (c.peso || 0), 0))
            continue
          }
          if (rinunciate.has(sped.id)) continue     // il portale filiali non ce le da': si fa come prima
          daMettereInCoda.push({ spedizione_id: sped.id, colli_attesi: sped.colli })
          attesaMisureLdv.add(r.ldv)
        }
        if (daMettereInCoda.length) {
          await adminRip.from('misure_colli_richieste')
            .upsert(daMettereInCoda, { onConflict: 'spedizione_id', ignoreDuplicates: true })
        }
      }

      // Formato XL di Poste (lo carica LOGIXIA): una riga per collo. Le spedizioni con colli non
      // ancora misurati, con piu' righe che colli, o misurate non piu' grandi di come le abbiamo
      // addebitate, si saltano qui — il perche' e' in ripesature-xl.
      const { daSaltare: xlDaSaltare, misureIncomplete, colliInPiu } = await controllaColliXL(adminRip, nuove)
      const daCalcolare = xlDaSaltare.size ? nuove.filter(r => !xlDaSaltare.has(r.ldv)) : nuove
      // File dei soli pesi: sui multicollo il peso del file si divide sui colli dichiarati.
      await colliDalPesoTotale(adminRip, daCalcolare)

      // Il flag fuori sagoma / reso vive sulla Ripesatura letta dal file; l'esito del motore porta
      // solo idOrdine → si rimappa qui per sapere, riga per riga, se aggiungere il supplemento fisso
      // o se saltarla (reso).
      const ripPerOrdine = new Map(nuove.map(r => [r.idOrdine, r]))
      // IL COSTO DEL FORNITORE E' QUELLO DI TUTTO IL FILE, non della fetta che sto elaborando ora.
      // Spezzando il lavoro a pacchetti da quindici avevo lasciato il totale sul pacchetto: a
      // schermo usciva 33,54 invece di 356,35 — cioe' la somma degli ultimi quindici.
      const costoFornitoreTotale = Math.round(lette.righe.reduce((s, r) => s + r.addebitoFornitore, 0) * 100) / 100
      // Client CON MEMORIA, nuovo a ogni richiesta: zone, listini e contratti si leggono una volta
      // per pacchetto invece che una per spedizione (lib/supabase-admin). Spedizioni e movimenti freschi.
      const esiti = await calcolaRipesature(createAdminSupabaseConMemoria(), daCalcolare)

      // ── ANTI-DOPPIO PER SPEDIZIONE ── salta le spedizioni che hanno GIÀ una rettifica viva
      // (confermata o da_rettificare), da OneTracking o da un import precedente. Il dedup su
      // rif_fornitore NON basta tra fonti diverse: OneTracking usa il tracking come rif, il file
      // SpediamoPro usa il codice 6A... → chiavi diverse, non si vedrebbero. Stessa guardia che usa
      // OneTracking in creaRettificaDaEsito. (Il costo fornitore RIPFORN- resta comunque scalato sotto,
      // una volta sola: la spesa del fornitore c'è anche se non creo una seconda rettifica.)
      const spedEsiti = Array.from(new Set(esiti.filter(e => e.spedizioneId).map(e => e.spedizioneId as string)))
      const giaRettificateSet = new Set<string>()
      for (let i = 0; i < spedEsiti.length; i += 200) {
        const { data: gr } = await adminRip.from('rettifiche').select('spedizione_id,master_id,target_master_id,propagazione')
          .in('spedizione_id', spedEsiti.slice(i, i + 200)).or('confermata.eq.true,stato.eq.da_rettificare')
        for (const x of (gr || []) as any[]) {
          // Non contano: il COSTO DEL DETENTORE (riga intestata a se' stesso: non e' un addebito a
          // nessuno sotto) e le ANNULLATE (addebito stornato, la spedizione e' di nuovo da rettificare).
          if (x.target_master_id && x.target_master_id === x.master_id) continue
          if (x.propagazione === 'annullata') continue
          // ALLO STESSO SCALINO: conta solo una rettifica fatta da chi carica o verso di lui. Se Wave ha gia'
          // rettificato MULTI con OneTracking, LOGIXIA col suo file deve poter addebitare Wave (decisione di
          // Lorenzo, 24/10/2026): e' un altro scalino. Il doppio a valle (Wave che rigira a MULTI quello che
          // MULTI ha gia' pagato) lo ferma il database, trg_rettifica_no_doppia_ripesatura (stesso pagante).
          if (x.master_id !== myMaster && x.target_master_id !== myMaster) continue
          if (x.spedizione_id) giaRettificateSet.add(x.spedizione_id)
        }
      }
      let giaRettificateCount = 0

      // PENALE BRT EXPRESS: mappa spedizione → soglia peso-reale, SOLO per i contratti 'BRT Express' con
      // soglia attiva. Serve alla regola penale piu' sotto (un collo del servizio ≤5kg che sfora). Per
      // ora limitata a BRT Express (scelta di Lorenzo 7/10); gli altri contratti a soglia restano invariati.
      const penalePerSped = new Map<string, { sogliaKg: number }>()
      for (let i = 0; i < spedEsiti.length; i += 200) {
        const { data: spc } = await adminRip.from('spedizioni')
          .select('id, corrieri(nome_contratto, settings)').in('id', spedEsiti.slice(i, i + 200))
        for (const s of (spc || [])) {
          const c: any = Array.isArray((s as any).corrieri) ? (s as any).corrieri[0] : (s as any).corrieri
          if (c?.nome_contratto === 'BRT Express') {
            const sog = (c.settings as any)?.peso_reale_soglia
            if (sog?.attivo && Number(sog.kg) > 0) penalePerSped.set((s as any).id, { sogliaKg: Number(sog.kg) })
          }
        }
      }

      // ── CARICAMENTO VERO ──
      // Si scrive SOLO se chi carica lo chiede esplicitamente. Il primo giro e' sempre
      // un'anteprima: chi paga guarda i numeri, poi conferma.
      {
        // UNA RIGA SOLA NELL'ELENCO FILE, non una per pacchetto.
        // Il lavoro si fa a fette per poter mostrare la barra; ma il FILE e' uno, e creare una riga
        // a ogni fetta riempirebbe l'elenco di sette righe uguali per un solo caricamento.
        // La prima fetta la crea, le altre si portano dietro il suo identificativo.
        let creaturaFile: string | null = body?.fileId || null
        if (!creaturaFile) {
          const { data: fileRip } = await supabase.from('rettifiche_files').insert({
            master_id: myMaster, nome_file: nomeFile, n_tot_spedizioni: (righe || []).length,
          }).select().single()
          creaturaFile = fileRip?.id || null
        }
        const daScrivere: any[] = []
        let fuoriCatena = 0, resoSaltate = 0, attesaMisure = 0, passateAZero = 0
        // Righe dove la differenza chiesta alla rete supera di molto il costo del fornitore: non e'
        // un errore (succede quando il cliente ha dichiarato scatole molto piu' piccole del vero e
        // il fornitore ci ha addebitato poco), ma chi carica deve vederle prima di confermare.
        const sopraIlTriplo: { ldv: string; costoFornitore: number; differenza: number }[] = []
        // Senza costo del fornitore (file dei soli pesi, file XL) il confronto si fa con quanto era stato
        // PAGATO: GLS ha scritto 691 kg su un pacco pagato 4,04 (NN668512857, 15/10) e ne usciva una
        // rettifica da 282 euro. Puo' essere vera o un errore del corriere: chi carica deve vederla prima.
        const sopraIlTriploPagato: { ldv: string; pagato: number; differenza: number }[] = []
        // ── PRIMA PAGA CHI CARICA (regola di Lorenzo, 22/10/2026) ──
        // Chi carica il file del suo fornitore ha gia' pagato il fornitore: alla CONFERMA di ogni riga gli
        // si registra quel costo, e solo dopo si addebita il livello sotto (come oggi). Il costo e':
        //  * nei file con l'importo del fornitore (E&A, transazioni): quell'importo, per chiunque carichi
        //    — e' la sua fattura, come prima, solo che ora si paga alla conferma e non al caricamento;
        //  * nei file senza importo (XL di Poste, file pesi): il costo dal SUO listino al peso nuovo meno
        //    quanto ha gia' pagato — ma solo se chi carica e' il DETENTORE del contratto (in cima alla
        //    fila). Chi non e' detentore non ha un costo suo da registrare: per lui nulla cambia.
        // Sta in costo_fornitore, la colonna che la pagina usa gia' per dividere buone e da controllare.
        let aTuoCarico = 0, soloATuoCarico = 0
        // Fatture gia' pagate da un caricamento precedente (export cumulativi): niente riga "solo tua" da
        // confermare, e fuori dal "tuo costo" annunciato. Sulle righe verso sotto il costo resta scritto
        // (serve a dividere buone e da controllare), ma alla conferma non si ripaga.
        const giaPagate = await fattureGiaPagate(adminRip, esiti.filter((e: any) => e.trovata && e.spedizioneId).map((e: any) => e.idOrdine))
        const costoProprio = (e: any): number => {
          if (Number(e.addebitoFornitore) > 0) return Math.round(Number(e.addebitoFornitore) * 100) / 100
          const cat = e.catenaDalBasso || []
          const detentore = cat.length > 0 && cat[cat.length - 1] === myMaster
          const cd = e.costoDetentore
          // SENZA "GIA' PAGATO" NON C'E' UNA DIFFERENZA: se sulla spedizione non risulta niente a carico del
          // detentore, prezzo - 0 sarebbe la spedizione intera, non la ripesatura. Meglio nessun costo che
          // un costo inventato.
          return detentore && cd && cd.masterId === myMaster && cd.pagato > 0.005 && cd.differenza >= 0.01 ? Math.round(cd.differenza * 100) / 100 : 0
        }
        // SOLO A TUO CARICO: sotto non c'e' niente da chiedere (gia' rettificata da un'altra fonte, reso,
        // stesso scaglione per tutti), ma il fornitore ha fatto pagare chi carica. La riga e' intestata a
        // lui stesso: confermandola paga lui, e a nessuno sotto arriva niente.
        const soloMio = (e: any, rip: any, costo: number) => {
          if (giaPagate.has(e.idOrdine)) return     // gia' pagata: come prima, nessuna riga
          soloATuoCarico++
          // Quanto aveva gia' pagato chi carica: dal suo listino (costoDetentore) o, nei file con
          // l'importo, dal suo livello nella catena.
          const pagatoMio = e.costoDetentore?.pagato ?? (e.livelli || []).find((l: any) => l.masterId === myMaster)?.pagato ?? 0
          daScrivere.push({
            master_id: myMaster, file_id: creaturaFile,
            spedizione_id: e.spedizioneId, numero_spedizione: e.ldv,
            cliente_id: null, target_master_id: myMaster,
            peso_iniziale: e.pesoRealePrima, peso_volume_iniziale: e.pesoVolumePrima,
            peso_reale: e.pesoDopo, peso_volume_reale: e.pesoVolumeDopo || 0,
            costo_iniziale: pagatoMio, costo_finale: Math.round((pagatoMio + costo) * 100) / 100,
            differenza: 0, fuori_sagoma: 0,
            supplementi_nomi: ((rip as any)?.supplementiNomi || []).join(' + ') || null,
            costo_fornitore: costo,
            stato: 'da_rettificare',
            rif_fornitore: e.idOrdine,
            colli_ripesati: e.colli_ripesati || null,
          })
        }
        for (const e of esiti) {
          if (!e.trovata || !e.spedizioneId) continue
          const rip = ripPerOrdine.get(e.idOrdine) as any
          const costo = costoProprio(e)
          // Già rettificata (OneTracking o import precedente) → non se ne crea una seconda. Il costo del
          // fornitore pero' c'e' lo stesso: resta "solo a tuo carico".
          if (giaRettificateSet.has(e.spedizioneId)) { giaRettificateCount++; if (costo > 0) soloMio(e, rip, costo); continue }
          // RESO: il "peso reale" del file è il peso del RITORNO, non una ripesatura dell'andata:
          // darlo al motore riprezzerebbe l'andata su un peso che non è suo. Il reso ha il suo flusso
          // (prezzo = nolo di fascia), quindi qui NON si crea un addebito cliente. Il costo fornitore
          // (quello che E&A ha davvero pagato per il ritorno) resta scalato sotto, come per tutte.
          if (rip?.reso) { resoSaltate++; if (costo > 0) soloMio(e, rip, costo); continue }
          // In attesa delle misure collo per collo: non si addebita adesso (sarebbe meno del
          // dovuto, e l'anti-doppione impedirebbe di correggerla dopo). Il costo del fornitore si
          // scala lo stesso, piu' sotto: quello e' uscito davvero.
          if (attesaMisureLdv.has(e.ldv)) { attesaMisure++; continue }
          // SUPPLEMENTI: importi FISSI da addebitare in aggiunta e far cascare invariati (fuori
          // sagoma, non sovrapponibile, consegna su appuntamento — la tabella sta in lib/ripesature).
          // Va creata la rettifica ANCHE quando la ripesatura non produce differenza (l'importo del
          // fornitore e' solo il supplemento), altrimenti non verrebbe mai recuperato.
          const fs = Number(rip?.supplementi || 0)
          // A CHI VA INDIRIZZATA: al FIGLIO DIRETTO di chi carica, non al fondo della catena.
          // La catena arriva dal basso verso il detentore; il figlio diretto e' quello che sta
          // subito PRIMA di me. Se non ci sono master sotto, il destinatario e' il cliente.
          const cat = e.catenaDalBasso || []
          const mio = cat.indexOf(myMaster)
          // "NON SONO NELLA CATENA" NON E' "SONO L'ULTIMO".
          // Con indexOf che torna -1 il conto `mio > 0 ? ... : null` cadeva sullo stesso ramo del
          // caso legittimo `mio === 0`, e la rettifica veniva intestata al CLIENTE FINALE di una
          // spedizione che non e' mia: saltando tutti i master in mezzo, riprezzata sul listino
          // sbagliato, e addebitata alla conferma con la chiave di servizio — che non ricontrolla
          // di chi sia quel cliente. Ci si finisce in tre modi: caricando un file con lettere di
          // vettura altrui, stando sopra il detentore del contratto (la catena si ferma li'), o
          // con una catena rotta a meta'. Il ramo del file dei pesi, in fondo a questo stesso file,
          // la guardia ce l'ha da sempre: "idx === -1 -> scartata".
          if (mio < 0 || e.catenaCompleta === false) { fuoriCatena++; continue }
          const figlio = mio > 0 ? cat[mio - 1] : null
          const liv = figlio
            ? e.livelli.find(l => l.masterId === figlio)
            : e.livelli.find(l => l.clienteId)
          if (!liv || liv.differenza == null) continue
          // SOLO RECUPERI, MAI RIMBORSI. La ripesatura del fornitore serve a incassare quello che
          // abbiamo fatturato in MENO; se riprezzata sul listino del livello esce piu' bassa (o
          // uguale) di quanto pagato — liv.differenza = dovuto - pagato <= 0 — non si crea una nota
          // di credito: non si regalano soldi su un pacco che il fornitore ci ha comunque
          // conteggiato. ECCEZIONE: se c'e' un fuori sagoma da recuperare (fs>0) la riga si crea lo
          // stesso, con differenza a zero, per far scendere il supplemento.
          // PENALE BRT EXPRESS (regola Lorenzo 7/10, SOLO BRT Express): il servizio a soglia peso-reale
          // (≤5kg) spedito con un collo OLTRE la soglia viene punito dal corriere ~1 €/kg; il riprezzo a
          // banda normale NON la recupera. Si gira l'INTERO costo fornitore come supplemento fisso, che
          // cascata invariato fino al cliente che ha sforato — differenza a 0 (non e' un cambio-peso: il
          // peso_fatturato non si tocca). Verificato su 050187292960523 (5→18,6kg, costo 18,60 = 18,6×1€).
          const pen = penalePerSped.get(e.spedizioneId)
          const isPenaleBrt = !!pen && Number(e.pesoDopo || 0) > pen.sogliaKg && Number(e.addebitoFornitore || 0) > 0
          const fsEff = isPenaleBrt ? Math.round(Number(e.addebitoFornitore) * 100) / 100 : fs
          // A ZERO MA NON FERMA: il figlio non deve niente, ma qualcuno sotto di lui si' (vedi
          // qualcunoSottoDeve). La riga nasce a zero cosi' la catena prosegue e chi sta sotto la gira ai suoi.
          const aZero = liv.differenza < 0.01 && fsEff === 0
          if (aZero && !qualcunoSottoDeve(e, figlio)) { if (costo > 0) soloMio(e, rip, costo); continue }
          if (aZero) passateAZero++
          const diffRett = (!isPenaleBrt && liv.differenza >= 0.01) ? liv.differenza : 0
          if (!isPenaleBrt && e.addebitoFornitore > 0 && diffRett > e.addebitoFornitore * 3) {
            sopraIlTriplo.push({ ldv: e.ldv, costoFornitore: e.addebitoFornitore, differenza: Math.round(diffRett * 100) / 100 })
          }
          if (!isPenaleBrt && !(e.addebitoFornitore > 0) && diffRett >= 20 && diffRett > Number(liv.pagato || 0) * 3) {
            sopraIlTriploPagato.push({ ldv: e.ldv, pagato: Number(liv.pagato || 0), differenza: Math.round(diffRett * 100) / 100 })
          }
          daScrivere.push({
            master_id: myMaster, file_id: creaturaFile,
            spedizione_id: e.spedizioneId, numero_spedizione: e.ldv,
            cliente_id: figlio ? null : liv.clienteId,
            target_master_id: figlio,
            // "iniziale" = collo DICHIARATO: reale nella colonna Peso, volumetrico in Peso/Volume
            // (prima: peso_iniziale=fatturato e peso_volume_iniziale=0, cioè peso che mostrava il
            //  volume e peso/volume vuoto). Il costo resta calcolato sul fatturato, qui è solo display.
            peso_iniziale: e.pesoRealePrima, peso_volume_iniziale: e.pesoVolumePrima,
            // Il volume vero (quello che fa salire il costo): prima era 0 anche sul primo livello,
            // così la sua Rettifica Costi mostrava "0,00" mentre il livello sotto vedeva il volume.
            peso_reale: e.pesoDopo, peso_volume_reale: e.pesoVolumeDopo || 0,
            // A zero il costo resta quello pagato: col listino del figlio potrebbe uscire anche piu' basso,
            // e mostrarlo sembrerebbe un rimborso che non c'e'.
            costo_iniziale: liv.pagato, costo_finale: (isPenaleBrt || aZero) ? liv.pagato : liv.dovuto,
            differenza: -diffRett,   // la colonna e' "quanto restituisco": un addebito e' negativo (0 se solo fuori sagoma / penale)
            fuori_sagoma: fsEff,     // supplemento FISSO (o penale BRT ≤5kg sforata): in aggiunta e cascata invariato
            // QUALE supplemento: senza il nome, il movimento del cliente diceva "fuori sagoma"
            // anche quando aveva pagato un super gdo o una consegna su appuntamento.
            supplementi_nomi: isPenaleBrt ? 'penale BRT peso reale sforato' : (((rip as any)?.supplementiNomi || []).join(' + ') || null),
            // Il costo che il CORRIERE ci ha addebitato per questa ripesatura: serve alla pagina per
            // dividere buone (da-girare >= costo) da da-controllare (sotto-recupero). I file-pesi
            // (es. Velox) non hanno costo fornitore → resta null.
            // e, dal 22/10/2026, quello che si registra a CHI CARICA alla conferma (vedi costoProprio).
            costo_fornitore: costo,
            stato: 'da_rettificare',
            rif_fornitore: e.idOrdine,     // l'anti-doppione: indice unico sul database
            // Le misure viaggiano con la riga: servono a chi la ricevera' per riprezzare col
            // PROPRIO listino quando la gira al livello sotto. La cifra in euro non scende lungo
            // la catena — quella e' il costo di chi sta sopra.
            colli_ripesati: e.colli_ripesati || null,
          })
        }
        // OTTO SCRITTURE ALLA VOLTA, una riga per volta come prima. Righe diverse, spedizioni
        // diverse: non si pestano i piedi, e il doppione lo ferma comunque l'indice unico del
        // database (che e' la garanzia vera, non l'ordine in cui si scrive). In fila indiana mille
        // righe erano mille viaggi al database uno dopo l'altro.
        let scritte = 0, doppioni = 0
        let iScrittura = 0
        const conRiga = new Set<string>()   // righe del file che ora hanno una rettifica (il costo si paga alla conferma)
        await Promise.all(Array.from({ length: Math.min(8, daScrivere.length) }, async () => {
          while (iScrittura < daScrivere.length) {
            const riga = daScrivere[iScrittura++]
            const { error } = await inserisciRettifica(adminRip, riga)
            // 23505 = l'indice unico ha respinto un doppione. E' il comportamento voluto, non un guasto.
            if (!error) { scritte++; conRiga.add(riga.rif_fornitore); if (!giaPagate.has(riga.rif_fornitore)) aTuoCarico += Number(riga.costo_fornitore || 0) }
            else if (error.code === '23505') { doppioni++; conRiga.add(riga.rif_fornitore) }
            else console.error('[RIPESATURE] riga non scritta', riga.numero_spedizione, error.message)
          }
        }))

        // ── IL CONTO DEL FORNITORE LO PAGA CHI CARICA, E LO PAGA ADESSO ──
        //
        // Quando questo file arriva, il fornitore ha GIA' mandato la fattura a chi lo sta caricando:
        // quei soldi sono usciti davvero. Poi lui li recupera girando le rettifiche ai livelli sotto
        // — ma il recupero e' una cosa diversa dalla spesa, e finora la spesa non veniva registrata
        // da nessuna parte. Risultato: nei margini chi carica sembrava guadagnare tutta la
        // differenza che addebitava ai sotto-master, mentre una parte non fa che coprire il conto
        // del fornitore. Con 356 euro su un file solo, il margine era gonfiato di altrettanto.
        //
        // SI GUARDA TUTTO IL FILE, NON SOLO LE RIGHE NUOVE.
        //
        // Prima questo giro partiva dalle sole spedizioni che generavano una rettifica nuova. Ma il
        // conto del fornitore non c'entra con le rettifiche: e' la fattura di CHI CARICA, e riguarda
        // ogni riga del file — comprese quelle gia' caricate ieri e quelle che al livello sotto non
        // fanno differenza. Con quella versione, un file gia' caricato non avrebbe mai scalato
        // niente: e' esattamente il caso delle 106 di stasera, entrate prima che questo codice
        // esistesse. Cosi' invece basta ricaricare lo stesso file e il conto si mette a posto, senza
        // che nascano rettifiche doppie (quelle le respinge il loro indice unico).
        //
        // Il doppio addebito lo impedisce l'indice unico sul riferimento: l'export del fornitore e'
        // cumulativo, lo stesso ordine ritorna nel file del giorno dopo, e ricaricarlo due volte
        // non puo' scalare due volte.
        let fornitoreScalato = 0
        const { registraMovimentoMaster } = await import('@/lib/movimenti')
        const spedPerLdv = new Map<string, string>()
        for (let i = 0; i < fetta.length; i += 200) {
          const { data: ss } = await adminRip.from('spedizioni')
            .select('id,tracking_number').in('tracking_number', fetta.slice(i, i + 200).map(r => r.ldv))
          for (const s of (ss || [])) spedPerLdv.set((s as any).tracking_number, (s as any).id)
        }
        // QUATTRO ALLA VOLTA, non di piu': qui si muove CREDITO, e tutte queste righe scalano lo
        // stesso conto. La funzione dei movimenti e' atomica e il database mette in fila chi tocca la
        // stessa riga di credito, quindi il saldo resta giusto comunque; con quattro si guadagna
        // tempo senza mettersi a spingere in venti sulla stessa porta. Il doppio addebito lo impedisce
        // come prima l'indice unico sul riferimento RIPFORN-.
        // DAL 22/10/2026 SOLO LE RIGHE CHE NON SONO DIVENTATE RETTIFICHE. Quelle che lo sono portano il
        // costo con se' e lo pagano alla CONFERMA (stesso riferimento RIPFORN-: un file vecchio, gia'
        // pagato al caricamento, non paga due volte). Le altre — in attesa delle misure, catena
        // incompleta, fuori dalla catena — si pagano subito come prima, cosi' la fattura del fornitore
        // non si perde. Delle gia' caricate si ritentano solo le confermate (vedi visteConfermate): le
        // altre aspettano la loro conferma.
        const daScalare = fetta.filter((r: any) => spedPerLdv.get(r.ldv) && r.addebitoFornitore > 0
          && !conRiga.has(r.idOrdine) && (!viste.has(r.idOrdine) || visteConfermate.has(r.idOrdine)))
        let iScalo = 0
        await Promise.all(Array.from({ length: Math.min(4, daScalare.length) }, async () => {
          while (iScalo < daScalare.length) {
          const r = daScalare[iScalo++]
          const sid = spedPerLdv.get(r.ldv)
          if (!sid || !(r.addebitoFornitore > 0)) continue
          // Descrizione del costo fornitore: per il file SpediamoPro dettaglio dimensioni + flag (fuori
          // sagoma / reso), così il movimento è motivato. Il fuori sagoma è fisso €16,39; il reso è un
          // supplemento gestito dal flusso reso a parte (qui solo indicato).
          const c0: any = (r.colli || [])[0] || {}
          const dimTxt = (c0.lunghezza && c0.larghezza && c0.altezza) ? ` dim ${c0.lunghezza}x${c0.larghezza}x${c0.altezza}cm` : ''
          const parti: string[] = []
          const sup: string[] = (r as any).supplementiNomi || []
          if (sup.length) parti.push(`${sup.join(' + ')} €${Number((r as any).supplementi || 0).toFixed(2)}`)
          // Riconosciuto ma senza tariffa: si scrive nel movimento com'e', cosi' chi legge il conto
          // sa perche' il costo del fornitore e' piu' alto della differenza girata.
          const senza: string[] = (r as any).supplementiSenzaTariffa || []
          if (senza.length) parti.push(`${senza.join(' + ')}: tariffa non nota, non girato`)
          if ((r as any).reso) parti.push('reso: gestito dal flusso reso')
          const descrizione = (r as any).codiceProvider
            ? `Ripesatura ${r.ldv}${dimTxt} - costo fornitore €${r.addebitoFornitore.toFixed(2)}${parti.length ? ` [${parti.join(' + ')}]` : ''}`
            : `Ripesatura ${r.ldv} - costo addebitato dal fornitore`
          try {
            await registraMovimentoMaster(adminRip, {
              masterOwnerId: myMaster, masterTargetId: myMaster, tipo: 'rettifica',
              descrizione,
              riferimento: `RIPFORN-${r.idOrdine}`,
              importo: -Math.abs(r.addebitoFornitore),
              spedizioneId: sid, createdBy: user.id,
            })
            fornitoreScalato += r.addebitoFornitore
          } catch (err: any) {
            // Gia' scalato da un caricamento precedente: e' il comportamento voluto, non un
            // guasto. Il messaggio arriva impacchettato dentro un Error, quindi si riconosce dal
            // testo del vincolo e non dal codice, che qui non passa.
            const m = String(err?.message || '')
            if (!/23505|duplicate key|unique constraint/i.test(m)) {
              console.error('[RIPESATURE] costo fornitore non scalato', r.ldv, m)
            }
          }
          }
        }))
        // I conteggi si SOMMANO a quelli gia' scritti dalle fette precedenti.
        if (creaturaFile) {
          const { data: pre } = await supabase.from('rettifiche_files')
            .select('n_processate,n_trovate,n_scartati,n_da_rettificare').eq('id', creaturaFile).maybeSingle()
          await supabase.from('rettifiche_files').update({
            n_processate: (pre?.n_processate || 0) + fetta.length,
            n_trovate: (pre?.n_trovate || 0) + esiti.filter(e => e.trovata).length,
            n_scartati: (pre?.n_scartati || 0) + esiti.filter(e => !e.trovata).length,
            n_da_rettificare: (pre?.n_da_rettificare || 0) + scritte,
          }).eq('id', creaturaFile)
        }

        return NextResponse.json({
          success: true, tipo: 'ripesature',
          fileId: creaturaFile,
          // Dove siamo arrivati NEL FILE: serve alla barra e a sapere se c'e' un altro pezzo da
          // chiedere. Si conta sul file, non sul lavoro rimasto, che si accorcia mentre lo si fa.
          da, quante: fetta.length, totaleDaFare: totaleFile,
          finito: da + fetta.length >= totaleFile,
          creato: scritte, doppioniRespinti: doppioni, giaCaricate: fetta.length - nuove.length,
          giaRettificate: giaRettificateCount,   // già fatte da OneTracking/import: saltate (no doppio)
          fuoriCatena, costoFornitoreScalato: Math.round(fornitoreScalato * 100) / 100,
          attesaMisure,                      // multicollo senza misure: in coda, si caricano al prossimo giro
          aTuoCarico: Math.round(aTuoCarico * 100) / 100,   // costo di chi carica, da pagare alla conferma
          soloATuoCarico,                    // righe col solo costo di chi carica (sotto non c'e' niente da chiedere)
          passateAZero,                      // create a zero: al figlio non costano, servono a chi sta sotto
          // Formato XL di Poste: spedizioni con colli non misurati (in attesa del prossimo file), con
          // piu' righe che colli (da guardare a mano), e — per tutto il file — LDV senza nessuna misura.
          misureIncomplete, colliInPiu, senzaMisure: lette.senzaMisure || 0,
          sopraIlTriplo: sopraIlTriplo.slice(0, 50),
          sopraIlTriploPagato: sopraIlTriploPagato.slice(0, 50),
          fuoriSagoma: (fetta as any[]).filter(r => Number(r.supplementi || 0) > 0).length,   // righe con un supplemento che ora cascata
          supplementiEuro: Math.round((fetta as any[]).reduce((a, r) => a + Number(r.supplementi || 0), 0) * 100) / 100,
          // Voci che il fornitore addebita ma di cui non conosciamo la tariffa: il costo lo paghiamo,
          // a valle non lo giriamo. Vanno a vista, altrimenti nessuno le chiede mai al fornitore.
          supplementiSenzaTariffa: Array.from(new Set((fetta as any[]).flatMap(r => r.supplementiSenzaTariffa || []))),
          reso: (fetta as any[]).filter(r => r.reso).length,                 // reso nel file (costo fornitore scalato)
          resoSaltate,                                                       // reso NON rettificati al cliente (flusso reso a parte)
          totali: {
            nelFile: (righe || []).length, spedizioni: totaleFile,
            nonTrovate: esiti.filter(e => !e.trovata).length,
            addebitoFornitore: costoFornitoreTotale,
          },
        })
      }
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
    // Con raw:false le celle arrivano come testo: un peso scritto "8,5" va letto 8,5 e non 8.
    // `new_weight`: formato minimale di Velox = due colonne ldv + peso ripesato, niente volume/misure
    // (verificato su Poste STANDARD I: 224/331 agganciano). Cade qui (non e' ne' SpediamoPro ne' il
    // formato a colonne con peso_riscontrato), si riprezza sul solo peso come gli altri file-pesi senza misure.
    const pesoReale = parseFloat(String(riga['peso reale'] || riga['peso_reale'] || riga['pesoreale'] || riga['peso'] || riga['peso volume'] || riga['pesovolume'] || riga['new_weight'] || riga['new weight'] || riga['newweight'] || 0).replace(',', '.'))
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
      .select('id,cliente_id,master_id,peso_reale,peso_fatturato,peso_volume,costo_totale,costo_spedizione,numero,dest_provincia,dest_cap,dest_paese,dest_citta,corriere_id,stato,contrassegno,assicurazione,valore_merce,servizi_accessori')
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
        //
        // LE DUE CIFRE VANNO FATTE CON LA STESSA RICETTA.
        // `costoIniziale` e' costo_totale, cioe' quello che il cliente ha PAGATO: nolo + fee
        // contrassegno + fee assicurazione + servizi accessori scelti. Riprezzando il solo nolo,
        // tutto il resto finiva dentro la differenza col segno POSITIVO. Finche' la conferma
        // prendeva il valore assoluto usciva un addebito sbagliato; col segno rispettato — che e'
        // giusto, un accredito non deve diventare un prelievo — quella stessa differenza diventa
        // una NOTA DI CREDITO vera: su una spedizione con contrassegno da 3 euro di fee, un collo
        // diventato piu' pesante avrebbe REGALATO al cliente la commissione gia' incassata.
        // Le fee si RICALCOLANO sul nolo nuovo, come fa la creazione, perche' certi scaglioni sono
        // in percentuale sul nolo; gli accessori invece si riportano come sono stati addebitati.
        if (ris) {
          const sup = await calcolaSupplementiCliente(supabase, {
            listinoId: cli.listino_cliente_id, corriereId: spedizione.corriere_id,
            contrassegno: Number((spedizione as any).contrassegno || 0),
            assicurazione: Number((spedizione as any).assicurazione || 0),
            valoreMerce: Number((spedizione as any).valore_merce || 0), nolo: ris.prezzo,
            pesoReale: Number((spedizione as any).peso_reale || 0),
          })
          // `disponibile: false` non vuol dire "fee zero", vuol dire "questo listino non prezza
          // contrassegno o assicurazione per questo contratto" — e le due fee tornano 0 senza
          // errore. Sommare quello zero toglierebbe dal dovuto una commissione che il cliente ha
          // gia' pagato, e la rettifica uscirebbe a suo favore. Come quando manca la tariffa: non
          // si inventa niente, si lascia il costo com'e' e non nasce nessuna rettifica.
          if (sup.disponibile) {
            const acc = Array.isArray((spedizione as any).servizi_accessori)
              ? (spedizione as any).servizi_accessori.reduce((a: number, x: any) => a + (Number(x?.importo) || 0), 0)
              : 0
            costoFinale = Math.round((ris.prezzo + sup.contrassegno + sup.assicurazione + acc) * 100) / 100
          }
        }
      }
      const differenza = costoIniziale - costoFinale
      // SOLO RECUPERI (differenza negativa = addebito), mai rimborsi: vedi il ramo ripesature sopra.
      if (differenza > -0.01) { continue }
      nDaRettificare++
      rettificheToInsert.push({
        master_id: myMaster, file_id: fileRec?.id, spedizione_id: spedizione.id,
        numero_spedizione: spedizione.numero, cliente_id: spedizione.cliente_id, target_master_id: null,
        // "iniziale" = collo dichiarato (reale + volume); il costo si calcola su pesoIniziale (fatturato), qui è display.
        peso_iniziale: Number(spedizione.peso_reale || pesoIniziale), peso_volume_iniziale: Number(spedizione.peso_volume||0),
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
      // SOLO RECUPERI (differenza negativa = addebito), mai rimborsi: vedi il ramo ripesature sopra.
      if (differenza > -0.01) { continue }
      nDaRettificare++
      rettificheToInsert.push({
        master_id: myMaster, file_id: fileRec?.id, spedizione_id: spedizione.id,
        numero_spedizione: spedizione.numero, cliente_id: null, target_master_id: targetMasterId,
        // "iniziale" = collo dichiarato (reale + volume); il costo si calcola su pesoIniziale (fatturato), qui è display.
        peso_iniziale: Number(spedizione.peso_reale || pesoIniziale), peso_volume_iniziale: Number(spedizione.peso_volume||0),
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
