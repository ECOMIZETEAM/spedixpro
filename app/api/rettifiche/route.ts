import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { registraMovimento } from '@/lib/movimenti'
import { scendiCodDaSpedizione } from '@/lib/condivisione-catena'
import { isAgente, clientiAgente, idClientiPerFiltro, bloccaAgente } from '@/lib/agente'
import { gestisceLaRete, vedeLaRete } from '@/lib/ruoli'
import { fetchAll } from '@/lib/fetch-all'

// Confermare cento rettifiche vuol dire cento chiamate di credito in fila. Col limite di durata
// breve la funzione veniva uccisa a meta' — ed e' proprio meta' lavoro fatto il caso peggiore.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  // L'elenco delle rettifiche e' roba di chi le deve girare, non di chi le deve pagare: l'agente le
  // vede filtrate sui suoi clienti (piu' sotto), il cliente non le vede affatto. Serviva anche a
  // procurarsi gli id da passare alla cancellazione.
  if (!vedeLaRete(utente)) return NextResponse.json([])
  const fileId = req.nextUrl.searchParams.get('fileId')
  const filtroAgente = isAgente(utente) ? idClientiPerFiltro(await clientiAgente(supabase, utente)) : null
  // fetchAll: senza, oltre 1000 rettifiche da confermare non comparivano (e non erano confermabili).
  const build = () => {
    let q = supabase.from('rettifiche')
      .select('*, clienti(ragione_sociale), masters:target_master_id(nome)')
      .eq('master_id', utente?.master_id)
      .eq('confermata', false)
      .order('created_at', { ascending: false })
    if (filtroAgente) q = q.in('cliente_id', filtroAgente)
    if (fileId) q = q.eq('file_id', fileId)
    return q
  }
  const data = await fetchAll(build)

  // IL NOME DEL DESTINATARIO NON SI PUO' LEGGERE CON LA SESSIONE DI CHI GUARDA.
  //
  // Le regole per-inquilino su `masters` mostrano a un master SOLO SE STESSO: provato con la
  // sessione vera di MULTIEXPRESS, vede le sue 106 rettifiche ma zero dei quattro sotto-master a
  // cui sono indirizzate, e un solo master in tutto. Quindi la relazione incorporata tornava
  // `null` e la schermata scriveva "(senza destinatario)" su tutti i gruppi.
  //
  // Non e' un buco da aprire allargando le regole: il nome dei propri destinatari e' roba che
  // questo master ha il diritto di vedere, ma solo per le righe CHE SONO SUE. Quindi si risolve
  // qui, con la chiave di servizio, e SOLO sui destinatari che compaiono nelle sue rettifiche —
  // che sono gia' filtrate per master_id poche righe sopra. Nessun altro nome esce da qui.
  const righeGrezze = data || []

  // PERCHE' UNA RIGA NON SI PUO' CONFERMARE, scritto sulla riga stessa.
  // La conferma rifiuta le rettifiche su spedizioni in annullo — giusto, perche' quel pacco sta per
  // essere stornato e addebitargli una ripesatura lascerebbe un residuo su una spedizione che non
  // ha mai viaggiato. Ma finora quelle righe restavano in elenco identiche alle altre: si premeva
  // Conferma, sparivano tutte tranne una, e non c'era modo di sapere se fosse una scelta o un
  // guasto. Ora lo stato della spedizione arriva insieme alla riga.
  const idSped = [...new Set(righeGrezze.map((r: any) => r.spedizione_id).filter(Boolean))]
  const statoSped = new Map<string, string>()
  const spedDati = new Map<string, any>()
  if (idSped.length) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const adm = createAdminSupabase()
    for (let i = 0; i < idSped.length; i += 300) {
      const { data: ss } = await adm.from('spedizioni')
        .select('id,stato,peso_reale,lunghezza,larghezza,altezza,colli,colli_dettaglio,corriere_id').in('id', idSped.slice(i, i + 300))
      for (const s of (ss || [])) { statoSped.set((s as any).id, (s as any).stato); spedDati.set((s as any).id, s) }
    }
  }

  // ── SU COSA SI PAGAVA PRIMA, E SU COSA SI PAGA ORA ──
  //
  // La tabella mostrava in grassetto "il maggiore fra peso reale e volume", dicendo che e' quello su
  // cui si paga. NON E' VERO quando vale l'agevolazione: se il collo sta nella scatola del contratto
  // si paga sul REALE anche se il volume e' piu' alto. Cosi' una rettifica legittima sembrava un
  // errore: 1UW07WF292297 mostrava "prima 6,89 → ora 6,30" con un addebito, quando in realta' prima
  // si pagava su 5,00 kg reali (collo 41x32x21, dentro la scatola 50x32x28) e ora si paga sul volume
  // 6,30 perche' il corriere l'ha misurato 40x32,5x19,4 — mezzo centimetro fuori dalla scatola.
  // La regola di "su cosa si tassa" vive in un posto solo (pesoSuReale): si chiede a lei.
  const { pesoSuReale, descriviAgevolazione } = await import('@/lib/agevolazione-misure')
  const settsCorr = new Map<string, any>()
  {
    const idCorr = [...new Set(Array.from(spedDati.values()).map((s: any) => s.corriere_id).filter(Boolean))]
    if (idCorr.length) {
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      const adm2 = createAdminSupabase()
      for (let i = 0; i < idCorr.length; i += 300) {
        const { data: cc } = await adm2.from('corrieri').select('id,settings').in('id', idCorr.slice(i, i + 300))
        for (const c of (cc || [])) settsCorr.set((c as any).id, (c as any).settings || {})
      }
    }
  }
  const baseDi = (r: any) => {
    const s: any = r.spedizione_id ? spedDati.get(r.spedizione_id) : null
    if (!s) return { prima: null, dopo: null, nota: null }
    const sett = settsCorr.get(s.corriere_id) || {}
    const dett = Array.isArray(s.colli_dettaglio) ? s.colli_dettaglio : []
    const colliPrima = dett.length
      ? dett.map((c: any) => ({ length: Number(c?.lunghezza ?? c?.length) || 0, width: Number(c?.larghezza ?? c?.width) || 0, height: Number(c?.altezza ?? c?.height) || 0 }))
      : [{ length: Number(s.lunghezza) || 0, width: Number(s.larghezza) || 0, height: Number(s.altezza) || 0 }]
    const colliDopo = Array.isArray(r.colli_ripesati) ? r.colli_ripesati : []
    const pesoPrima = Number(s.peso_reale) || 0
    const pesoDopo = colliDopo.reduce((a: number, c: any) => a + (Number(c?.weight) || 0), 0)
    const prima = pesoSuReale(sett, colliPrima, pesoPrima) ? 'reale' : 'volume'
    const dopo = colliDopo.length ? (pesoSuReale(sett, colliDopo, pesoDopo) ? 'reale' : 'volume') : prima
    let nota: string | null = null
    if (prima === 'reale' && dopo === 'volume') {
      const m = colliDopo[0]
      const mis = m ? `${Number(m.length) || 0}×${Number(m.width) || 0}×${Number(m.height) || 0}` : 'misurato'
      nota = `Il collo misurato ${mis} cm esce dalla scatola agevolata ${descriviAgevolazione(sett)}: prima si pagava sul peso reale, ora sul volume.`
    } else if (prima === 'volume' && dopo === 'reale') {
      nota = `Il collo misurato rientra nella scatola agevolata ${descriviAgevolazione(sett)}: ora si paga sul peso reale.`
    }
    return { prima, dopo, nota }
  }
  const bloccoDi = (r: any) => {
    const st = r.spedizione_id ? statoSped.get(r.spedizione_id) : null
    if (st === 'annullata') return 'Spedizione annullata: non si addebita'
    if (st === 'annullamento_pending' || st === 'annullamento_manuale') return 'Spedizione in annullo: si conferma solo se l\'annullo non va a buon fine'
    return null
  }

  const idMaster = [...new Set(righeGrezze.map((r: any) => r.target_master_id).filter(Boolean))]
  const idClienti = [...new Set(righeGrezze.map((r: any) => r.cliente_id).filter(Boolean))]
  const nomi = new Map<string, string>()
  if (idMaster.length || idClienti.length) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    if (idMaster.length) {
      const { data: mm } = await admin.from('masters').select('id,nome').in('id', idMaster)
      for (const m of (mm || [])) nomi.set(m.id, m.nome)
    }
    if (idClienti.length) {
      const { data: cc } = await admin.from('clienti').select('id,ragione_sociale').in('id', idClienti)
      for (const c of (cc || [])) nomi.set(c.id, c.ragione_sociale)
    }
  }
  // BUONE vs DA CONTROLLARE. Una riga "copre" quando il DA-GIRARE (|differenza| + supplemento fisso)
  // e' almeno il COSTO FORNITORE che il corriere ci ha addebitato. Sotto = sotto-recupero, col MOTIVO
  // scritto accanto cosi' il master sa se aggiornare il listino, chiedere le misure, o e' una penale.
  // costo_fornitore NULL/0 (file-pesi senza costo, es. Velox, o righe caricate prima della colonna) =
  // sempre buona: non c'e' un costo fornitore da coprire, e' solo un riprezzo.
  const classeDi = (r: any) => {
    const daGirare = (-Number(r.differenza || 0)) + Number(r.fuori_sagoma || 0)
    const costoForn = Number(r.costo_fornitore || 0)
    if (costoForn <= 0.01 || daGirare >= costoForn - 0.01) return { classe: 'buona', motivo: null, manca: 0 }
    const manca = Math.round((costoForn - daGirare) * 100) / 100
    const nomi = String(r.supplementi_nomi || '').toLowerCase()
    let motivo: string
    if (nomi.includes('penale')) {
      motivo = `Penale corriere ${costoForn.toFixed(2)}€ (servizio a peso reale sforato): il riprezzo normale non la recupera. Il Ricalcola NON la sistema — decidi se girare l'intera penale al cliente o assorbirla.`
    } else {
      const dims = Array.isArray(r.colli_ripesati) ? r.colli_ripesati : []
      const senzaMisure = dims.length > 0 && dims.every((c: any) => !((Number(c?.length) || 0) || (Number(c?.width) || 0) || (Number(c?.height) || 0)))
      motivo = senzaMisure
        ? `Ripesata sul solo peso (collo senza misure): recuperi ${daGirare.toFixed(2)}€ su ${costoForn.toFixed(2)}€ di costo fornitore (mancano ${manca.toFixed(2)}€). Se il corriere ha contato il volume servono le misure del collo.`
        : `Listino cliente sotto il costo fornitore: recuperi ${daGirare.toFixed(2)}€ ma il corriere ha addebitato ${costoForn.toFixed(2)}€ (mancano ${manca.toFixed(2)}€). Aggiorna il listino del cliente e premi Ricalcola.`
    }
    return { classe: 'da_controllare', motivo, manca }
  }
  const righe = righeGrezze.map((r: any) => {
    const b = baseDi(r)
    return {
      ...r,
      destinatario_nome: nomi.get(r.target_master_id) || nomi.get(r.cliente_id) || null,
      destinatario_tipo: r.target_master_id ? 'master' : (r.cliente_id ? 'cliente' : null),
      blocco: bloccoDi(r),
      base_prima: b.prima,     // 'reale' | 'volume': su cosa si pagava DAVVERO
      base_dopo: b.dopo,       // e su cosa si paga ora
      nota_peso: b.nota,       // perche' e' cambiato, quando cambia la base
      ...classeDi(r),          // classe: 'buona'|'da_controllare', motivo, manca (sotto-recupero)
    }
  })
  return NextResponse.json(righe)
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
  // Il ruolo, non la sola appartenenza: `master_id` ce l'hanno anche i clienti, e qui sotto si
  // muove credito con la chiave di servizio, che scavalca le regole per riga.
  if (!gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const body = await req.json()
  const { rettificaIds } = body
  if (!rettificaIds?.length) return NextResponse.json({ error: 'Nessuna rettifica selezionata' }, { status: 400 })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const adminDb = createAdminSupabase()

  // A LOTTI, non in un colpo solo. Con centinaia di rettifiche selezionate — l'harvester delle
  // ripesature ne accumula a migliaia — un unico `.in('id', [...])` costruisce verso PostgREST una
  // URL enorme (694 id ≈ 25 KB) che viene respinta: `data` torna vuoto e la schermata diceva
  // "Nessuna rettifica trovata" pur avendone centinaia in attesa. Si legge a fette da 200.
  const rettifiche: any[] = []
  for (let i = 0; i < rettificaIds.length; i += 200) {
    const { data } = await supabase.from('rettifiche')
      .select('*')
      .in('id', rettificaIds.slice(i, i + 200))
      .eq('master_id', utente?.master_id)
      .eq('confermata', false)
    if (data?.length) rettifiche.push(...data)
  }
  if (!rettifiche.length) return NextResponse.json({ error: 'Nessuna rettifica trovata (o gia\' confermata da un altro invio).' }, { status: 404 })

  // Se qualcosa va storto su una riga, quella riga TORNA APERTA: non deve restare archiviata come
  // fatta senza che i soldi si siano mossi. Prima i due `catch` si limitavano a scrivere nel log e
  // la chiusura passava lo stesso su tutti gli id — un addebito fallito spariva dall'elenco e da
  // ogni traccia, e nessuno poteva accorgersene se non riconciliando i movimenti a mano.
  const saltate: { id: string; perche: string }[] = []
  const riapriRiga = async (r: any, perche: string) => {
    saltate.push({ id: r.id, perche })
    await supabase.from('rettifiche').update({ confermata: false, stato: 'da_rettificare' }).eq('id', r.id)
  }

  // A CHI STO PER SCALARE IL CREDITO E' DAVVERO ROBA MIA?
  // La riga porta con se' destinatario e importo, e fin qui nessuno li aveva mai ricontrollati: si
  // passavano tali e quali alla funzione di credito, invocata con la chiave di servizio, che sotto
  // quel ruolo salta i propri controlli di appartenenza. Chi riesce a scrivere una riga in
  // `rettifiche` (la tabella e' esposta) sceglie destinatario e cifra. Quindi qui si verifica che il
  // master destinatario stia DAVVERO sotto di me — e siccome la mappa non contiene me stesso, una
  // riga intestata a se' stessi non passa — e che il cliente sia DAVVERO un mio cliente.
  const { mappaPrimaLinea } = await import('@/lib/prima-linea')
  const discendenti = await mappaPrimaLinea(adminDb, utente!.master_id)
  const idClienti = [...new Set(rettifiche.map((r: any) => r.cliente_id).filter(Boolean))]
  const mieiClienti = new Set<string>()
  if (idClienti.length) {
    const { data: cc } = await adminDb.from('clienti').select('id').eq('master_id', utente!.master_id).in('id', idClienti)
    for (const c of (cc || [])) mieiClienti.add((c as any).id)
  }

  // Fra il caricamento e la conferma passano giorni, e la finestra di annullo e' di 48 ore: una
  // spedizione annullata nel frattempo e' gia' stata stornata, e lo storno non ripassa. Una
  // rettifica confermata dopo resterebbe addosso a un pacco che non ha mai viaggiato.
  const idSped = [...new Set(rettifiche.map((r: any) => r.spedizione_id).filter(Boolean))]
  const statoSped = new Map<string, string>()
  for (let i = 0; i < idSped.length; i += 300) {
    const { data: ss } = await adminDb.from('spedizioni').select('id,stato').in('id', idSped.slice(i, i + 300))
    for (const s of (ss || [])) statoSped.set((s as any).id, (s as any).stato)
  }
  const annullata = (r: any) => {
    const st = r.spedizione_id ? statoSped.get(r.spedizione_id) : null
    return st === 'annullata' || st === 'annullamento_pending' || st === 'annullamento_manuale'
  }

  // Il peso su cui si rettifica è il MAGGIORE fra reale e volumetrico ripesato. Sulla lista movimenti
  // va scritto QUELLO (spesso il volume: un pacco di 2 kg reali ma 30 kg volumetrici si rettifica sui
  // 30) — altrimenti "peso scansione 2 Kg" con un addebito sembra un errore, mentre la rettifica è sul
  // volume. È lo stesso peso che si usa per aggiornare spedizioni.peso_fatturato qui sotto.
  const pesoFatt = (r: any) => Math.max(Number(r.peso_reale) || 0, Number(r.peso_volume_reale) || 0)
  const dimDi = (r: any) => {
    const c = Array.isArray(r.colli_ripesati) ? r.colli_ripesati[0] : null
    return c && Number(c.length) && Number(c.width) && Number(c.height) ? ` dim ${c.length}x${c.width}x${c.height}cm` : ''
  }
  // La descrizione MOTIVA il movimento: la parte ripesatura (peso inserito → ripesato) e, se c'e', il
  // supplemento COL SUO NOME e le sue dimensioni — così un addebito da 7,37 di super gdo o da 25,82
  // di fuori dimensione si spiega da solo, invece di chiamarsi "fuori sagoma" come tutti gli altri.
  // Se la riga è SOLO supplemento (nessuna ripesatura) si scrive solo quella, senza il fuorviante
  // "peso inserito X - peso ripesato X". Sulle righe vecchie il nome non c'è: si scrive "Supplemento".
  // Il peso fatturato di un gruppo di colli: per ognuno il maggiore fra peso e volume, poi si somma.
  const fattDi = (colli: any[], fattore: number) => (colli || []).reduce((tot: number, c: any) => {
    const p = Number(c?.weight ?? c?.peso) || 0
    const L = Number(c?.length ?? c?.lunghezza) || 0, W = Number(c?.width ?? c?.larghezza) || 0, H = Number(c?.height ?? c?.altezza) || 0
    const v = (L && W && H && fattore > 0) ? (L * W * H) / fattore : 0
    return tot + Math.max(p, v)
  }, 0)

  // I PESI FATTURATI, riga per riga: quello dichiarato alla partenza e quello dopo la ripesatura,
  // calcolati come li calcola il motore (per collo, col fattore volumetrico DEL CONTRATTO).
  const pesiDi = new Map<string, { prima: number; dopo: number; colli: number[]; nota: string }>()
  {
    const { fattoreVolumeCorriere } = await import('@/lib/pricing')
    const { pesoSuReale, descriviAgevolazione } = await import('@/lib/agevolazione-misure')
    const idS = [...new Set(rettifiche.map((r: any) => r.spedizione_id).filter(Boolean))]
    const spedInfo = new Map<string, any>()
    for (let i = 0; i < idS.length; i += 300) {
      const { data } = await adminDb.from('spedizioni')
        .select('id,peso_reale,colli,colli_dettaglio,lunghezza,larghezza,altezza,corriere_id,master_id,corrieri(settings)')
        .in('id', idS.slice(i, i + 300))
      for (const x of (data || [])) spedInfo.set((x as any).id, x)
    }
    const fattori = new Map<string, number>()
    const fattoreDi = async (sp: any) => {
      const k = `${sp.master_id}|${sp.corriere_id}`
      if (fattori.has(k)) return fattori.get(k)!
      let f = 4000
      try { f = Number(await fattoreVolumeCorriere(adminDb, sp.master_id, sp.corriere_id)) || 4000 } catch { /* resta il predefinito */ }
      fattori.set(k, f); return f
    }
    for (const r of rettifiche as any[]) {
      const sp = r.spedizione_id ? spedInfo.get(r.spedizione_id) : null
      const dopoColli = Array.isArray(r.colli_ripesati) ? r.colli_ripesati : []
      if (!sp || !dopoColli.length) continue
      const f = await fattoreDi(sp)
      const dett = Array.isArray(sp.colli_dettaglio) ? sp.colli_dettaglio : []
      const n = Math.max(1, Number(sp.colli) || 1)
      const primaColli = dett.length ? dett : Array.from({ length: n }, () => ({
        peso: (Number(sp.peso_reale) || 0) / n, lunghezza: sp.lunghezza, larghezza: sp.larghezza, altezza: sp.altezza,
      }))
      // QUANDO VALE L'AGEVOLAZIONE SI PAGA SUL PESO REALE, non sul maggiore fra peso e volume:
      // scrivere il fatturato senza tenerne conto fa sembrare che il peso scenda mentre il prezzo
      // sale (1UW07WF292297: «da 6,89 a 6,30» con 2,50 EUR di addebito). La verita' e' che il collo
      // misurato esce dalla scatola del contratto e da li' in poi si paga a volume.
      const sett = ((sp as any).corrieri || {}).settings || {}
      const perAgev = (colli: any[]) => colli.map((c: any) => ({
        length: Number(c?.length ?? c?.lunghezza) || 0, width: Number(c?.width ?? c?.larghezza) || 0, height: Number(c?.height ?? c?.altezza) || 0,
      }))
      const pesoReale = (colli: any[]) => colli.reduce((t: number, c: any) => t + (Number(c?.weight ?? c?.peso) || 0), 0)
      const agevPrima = pesoSuReale(sett, perAgev(primaColli), pesoReale(primaColli))
      const agevDopo = pesoSuReale(sett, perAgev(dopoColli), pesoReale(dopoColli))
      const nota = (agevPrima && !agevDopo)
        ? ` — il collo misurato esce dalla scatola agevolata ${descriviAgevolazione(sett)}, quindi ora si paga sul volume`
        : (!agevPrima && agevDopo) ? ` — il collo misurato rientra nella scatola agevolata ${descriviAgevolazione(sett)}, quindi ora si paga sul peso reale` : ''
      pesiDi.set(r.id, {
        prima: agevPrima ? pesoReale(primaColli) : fattDi(primaColli, f),
        dopo: agevDopo ? pesoReale(dopoColli) : fattDi(dopoColli, f),
        nota,
        colli: agevDopo ? dopoColli.map((c: any) => Number(c?.weight) || 0) : dopoColli.map((c: any) => {
          const p = Number(c?.weight) || 0
          const L = Number(c?.length) || 0, W = Number(c?.width) || 0, H = Number(c?.height) || 0
          return Math.max(p, (L && W && H) ? (L * W * H) / f : 0)
        }),
      })
    }
  }

  // IL PESO CHE SI PAGA NON E' LA SOMMA DEI CHILI.
  //
  // Si fattura COLLO PER COLLO il maggiore fra peso e volume, e poi si somma. Scrivendo i chili
  // reali la rettifica diventava indifendibile: 3UW1WLJ036611 diceva «Peso inserito: 50 Kg - peso
  // ripesato: 49,25 Kg» e addebitava 4,80 EUR — il cliente legge che pesa MENO e paga di piu'.
  // La verita' e' che i tre colli rimisurati fatturano 18,50 + 20,25 + 11,88 (il terzo sul suo
  // volume, 32x58x32) = 50,63 contro i 50,00 dichiarati, e quei 63 grammi cambiano fascia.
  // Qui si scrive quello: il peso FATTURATO, e i colli che lo compongono.
  const kg = (n: number) => `${(Math.round(n * 100) / 100).toString().replace('.', ',')} kg`
  const descrizione = (r: any) => {
    const extraFS = Number(r.fuori_sagoma) || 0
    const haReweigh = Number(r.differenza || 0) < -0.005
    const parti: string[] = []
    if (haReweigh) {
      const info = pesiDi.get(r.id)
      if (info && info.dopo > 0) {
        const dettaglio = info.colli.length > 1
          ? ` — ${info.colli.length} colli: ${info.colli.map((x: number) => kg(x)).join(' + ')}`
          : ''
        parti.push(`Rettifica ${r.numero_spedizione} (si paga sul peso fatturato: da ${kg(info.prima)} a ${kg(info.dopo)}${dettaglio}${info.nota})`)
      } else {
        // Senza le misure non si puo' ricostruire il fatturato: si resta ai chili, com'era.
        const f = pesoFatt(r)
        const vol = (Number(r.peso_volume_reale) || 0) > (Number(r.peso_reale) || 0)
        parti.push(`Rettifica ${r.numero_spedizione} ( Peso inserito: ${r.peso_iniziale} Kg - peso ripesato: ${f} Kg${vol ? ' volumetrico' : ''} )`)
      }
    }
    if (extraFS > 0) {
      const nomi = String(r.supplementi_nomi || '').trim()
      parti.push(`Supplemento${nomi ? ' ' + nomi : ''} ${r.numero_spedizione} €${extraFS.toFixed(2)}${dimDi(r)}`)
    }
    return parti.length ? parti.join(' + ') : `Rettifica ${r.numero_spedizione}`
  }

  const { registraMovimentoMaster } = await import('@/lib/movimenti')
  let mosse = 0
  const spedizioniDaAggiornare: any[] = []

  for (const r of rettifiche as any[]) {
    // PRESA ATOMICA, UNA RIGA ALLA VOLTA.
    // Serve contro il doppio addebito: due schede, o un secondo invio dopo che il primo e' andato
    // in timeout mentre ancora girava, rileggevano le stesse righe ancora aperte e addebitavano una
    // seconda volta. La condizione sta nel WHERE, quindi chi arriva secondo non si prende la riga.
    // MA LA PRESA E' PER RIGA, NON PER TUTTE. Chiudendole tutte in blocco prima di muovere un euro,
    // una funzione uccisa a meta' lasciava le rimanenti marcate "confermate" senza nessun movimento:
    // sparivano dall'elenco (che filtra confermata = false) e i soldi non si incassavano piu', senza
    // un errore da nessuna parte. Un doppio addebito e' sbagliato ma SI VEDE nei movimenti; un
    // incasso perso in silenzio non lo trova nessuno. Cosi' la finestra vale una riga sola.
    const { data: presa } = await supabase.from('rettifiche')
      .update({ confermata: true, stato: 'confermata' })
      .eq('id', r.id).eq('master_id', utente!.master_id).eq('confermata', false)
      .select('id')
    if (!presa?.length) { saltate.push({ id: r.id, perche: 'gia\' confermata da un altro invio' }); continue }

    // SEGNO: differenza = costo_iniziale - costo_finale, quindi negativa = addebito e positiva =
    // accredito. Il ramo dei master lo rispettava, quello dei clienti prendeva il valore assoluto e
    // scriveva sempre un addebito: una nota di credito da 2,15 diventava un prelievo di 2,15, cioe'
    // 4,30 di scarto nella direzione opposta a quella mostrata a chi preme Conferma — e proprio nei
    // casi frequenti, visto che quasi meta' dei colli ripesati misura MENO del dichiarato.
    const diff = Number(r.differenza || 0)
    // FUORI SAGOMA: supplemento FISSO da addebitare IN AGGIUNTA alla differenza. differenza negativa
    // = addebito, quindi si SOTTRAE (più negativo): importo = diff - fuori_sagoma. Un SOLO movimento
    // (stessa chiave RIP-): l'anti-doppio è l'indice unico su quel riferimento, un secondo movimento
    // lo violerebbe e i 16,39 andrebbero persi. Cascata invariata: ogni livello risconta lo stesso 16,39.
    const extraFS = Number(r.fuori_sagoma) || 0
    const importoAddebito = Math.round((diff - extraFS) * 100) / 100
    // SOLO RECUPERI, MAI RIMBORSI, e questa e' la PORTA UNICA dove il credito si muove: qualunque
    // flusso l'abbia creata (file ripesature, file pesi, propagazione di rete), un accredito qui non
    // passa. Il gate guarda l'importo TOTALE (differenza + fuori sagoma): una riga di solo fuori
    // sagoma ha differenza 0 ma importo -16,39, e NON deve essere scartata. Importo zero O positivo:
    // niente da muovere, ma la riga resta CHIUSA (riaprirla la rimetterebbe in elenco per sempre).
    if (importoAddebito >= -0.005) continue
    if (annullata(r)) { await riapriRiga(r, 'spedizione annullata dopo il caricamento'); continue }

    // UN PACCO NON SI RETTIFICA DUE VOLTE ALLO STESSO DESTINATARIO. Questa e' la PORTA UNICA dove il
    // credito si muove: qui converge OGNI pipeline (file ripesature, file pesi, cascata di rete,
    // OneTracking). Chiave deterministica RIP-<spedizione>-<destinatario>: se esiste gia' un movimento
    // rettifica con quel riferimento, la seconda NON si addebita. E' il doppio addebito reale a ILARIA
    // PITTALIS (3UW1WLJ008099): il file MISURE di MULTIEXPRESS in cascata (volumetrico 16 kg) + il file
    // PESI di Velox (reale 5,65) -> due addebiti. La riga resta CHIUSA (gia' presa atomicamente), come
    // per il caso diff>=0: NON si riapre, altrimenti tornerebbe in elenco per sempre. La garanzia vera
    // e' l'indice unico su movimenti(riferimento) per 'RIP-%'; questo pre-controllo evita solo il throw.
    const rifRett = r.spedizione_id ? `RIP-${r.spedizione_id}-${r.target_master_id || r.cliente_id}` : null
    if (rifRett) {
      const { data: giaRett } = await adminDb.from('movimenti').select('id').eq('riferimento', rifRett).limit(1).maybeSingle()
      if (giaRett) { saltate.push({ id: r.id, perche: 'gia\' rettificata per questa spedizione (evitato doppio addebito)' }); continue }
    }

    try {
      if (r.target_master_id) {
        if (!discendenti.has(r.target_master_id)) { await riapriRiga(r, 'destinatario non e\' un master della tua rete'); continue }
        // CONDIVISIONE: se il salto master→target è un salto-CODICE (corrieri_condivisi), la rettifica
        // scende sul LEDGER "(ingrosso)" del target (clienti.credito), non su masters.credito — a specchio
        // della creazione/COD. Risolto al volo dalla gamba (r.spedizione_id = gamba originante, dal calcolo).
        let ledgerClienteId: string | null = null
        if (r.spedizione_id) {
          try {
            const { data: sp } = await adminDb.from('spedizioni').select('master_id,cliente_id,corrieri(tipo,nome_contratto)').eq('id', r.spedizione_id).maybeSingle()
            const c: any = Array.isArray((sp as any)?.corrieri) ? (sp as any).corrieri[0] : (sp as any)?.corrieri
            const dCon = sp ? await scendiCodDaSpedizione(adminDb, { master_id: (sp as any).master_id, cliente_id: (sp as any).cliente_id, corriereTipo: c?.tipo, nomeContratto: c?.nome_contratto }, utente!.master_id!) : null
            if (dCon && !dCon.fuori && dCon.ledger && dCon.target_master_id === r.target_master_id && dCon.cliente_id) ledgerClienteId = dCon.cliente_id
          } catch (e) { console.error('[RETTIFICHE] ledger condivisione:', e) }
        }
        if (ledgerClienteId) {
          await registraMovimento(adminDb, {
            masterId: utente!.master_id, clienteId: ledgerClienteId,
            tipo: 'rettifica', descrizione: descrizione(r), importo: importoAddebito,
            riferimento: rifRett, spedizioneId: r.spedizione_id || null, createdBy: user.id,
          })
        } else {
          await registraMovimentoMaster(adminDb, {
            masterOwnerId: utente!.master_id, masterTargetId: r.target_master_id,
            tipo: 'rettifica', descrizione: descrizione(r), importo: importoAddebito,
            riferimento: rifRett, spedizioneId: r.spedizione_id || null, createdBy: user.id,
          })
        }
      } else if (r.cliente_id) {
        if (!mieiClienti.has(r.cliente_id)) { await riapriRiga(r, 'il cliente non e\' tuo'); continue }
        await registraMovimento(adminDb, {
          masterId: utente!.master_id, clienteId: r.cliente_id,
          tipo: 'rettifica', descrizione: descrizione(r), importo: importoAddebito,
          riferimento: rifRett, spedizioneId: r.spedizione_id || null, createdBy: user.id,
        })
        // Il costo_totale/peso_fatturato della spedizione si aggiorna SOLO se c'è stata una vera
        // ripesatura (diff<0): un fuori sagoma puro (diff=0) non cambia il nolo, e riscrivere
        // peso_fatturato col peso ripesato lo abbasserebbe sotto il fatturato reale.
        if (r.spedizione_id && diff < -0.005) spedizioniDaAggiornare.push(r)
      } else { await riapriRiga(r, 'nessun destinatario'); continue }
      mosse++
    } catch (e: any) {
      const m = String(e?.message || '')
      // Doppione intercettato dall'indice unico su movimenti(riferimento) 'RIP-%' (race fra due
      // conferme simultanee): il doppio addebito e' gia' stato evitato, e' il comportamento voluto —
      // NON si riapre la riga (e' consumata correttamente).
      if (/23505|duplicate key|unique/i.test(m)) {
        saltate.push({ id: r.id, perche: 'gia\' rettificata per questa spedizione (evitato doppio addebito)' })
      } else {
        console.error('[RETTIFICHE] addebito non riuscito', r.numero_spedizione, e?.message)
        await riapriRiga(r, 'addebito non riuscito')
      }
    }
  }

  // Il costo della spedizione si aggiorna SOLO se l'addebito e' andato a buon fine: prima si
  // riscriveva comunque, e restava a sistema una spedizione riprezzata che nessuno aveva pagato.
  for (const r of spedizioniDaAggiornare) {
    // peso_fatturato = il MAGGIORE fra reale e volumetrico ripesato (non il solo peso reale): è quello
    // che è stato davvero fatturato col ricalcolo. Prima ci scriveva peso_reale e, quando vinceva il
    // volume, la spedizione restava con un peso fatturato più basso del costo che le era stato messo.
    await supabase.from('spedizioni').update({
      costo_totale: r.costo_finale, peso_fatturato: pesoFatt(r),
    }).eq('id', r.spedizione_id)
  }

  return NextResponse.json({ success: true, rettificate: mosse, nonEseguite: saltate.length, dettaglio: saltate })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
  // CHI DEVE PAGARE NON PUO' CANCELLARE IL PROPRIO ADDEBITO.
  // Il filtro era solo `master_id`, che un utente cliente ce l'ha uguale a quello del suo master, e
  // `bloccaAgente` ferma l'agente ma non il cliente: bastavano due chiamate col suo cookie — una per
  // leggersi l'id della rettifica, una per cancellarla — e la ripesatura non veniva mai addebitata.
  if (!gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const body = await req.json()
  const { rettificaIds } = body
  if (!rettificaIds?.length) return NextResponse.json({ error: 'Nessuna rettifica selezionata' }, { status: 400 })
  // A LOTTI come la conferma: con centinaia di id un solo `.in()` sfora la URL verso PostgREST.
  let eliminate = 0
  for (let i = 0; i < rettificaIds.length; i += 200) {
    const fetta = rettificaIds.slice(i, i + 200)
    const { error } = await supabase.from('rettifiche')
      .delete()
      .in('id', fetta)
      .eq('master_id', utente?.master_id)
      .eq('confermata', false)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    eliminate += fetta.length
  }
  return NextResponse.json({ success: true, eliminate })
}
