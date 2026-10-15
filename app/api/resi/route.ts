import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente, clientiAgente } from '@/lib/agente'
import { vedeLaRete } from '@/lib/ruoli'
import { spedizioniDaCodici, codiciPerRegistro } from '@/lib/resi-codice'

// Lo stesso messaggio per un codice che non esiste e per un pacco fuori dalla propria rete: dire la
// differenza direbbe a chi scansiona che quel numero e' una spedizione di qualcun altro.
const NON_TROVATA = 'Non trovata fra le spedizioni della tua rete: inquadra il codice della LDV o scrivi il numero'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  // PERIMETRO. Questa e' una rotta del portale MASTER (Resi > Scansiona) e cerca la LDV col client
  // amministrativo, che scavalca la RLS: l'unico controllo e' quello scritto sotto, "sono il master della
  // spedizione o un suo antenato". Quel controllo NON e' un permesso per un utente cliente, perche' il
  // master_id ce l'hanno anche i clienti: per loro passava sempre, e con una LDV qualsiasi del proprio
  // master (o della sua discendenza) si leggevano mittente, destinatario, citta' e costo delle spedizioni
  // di un ALTRO cliente. Dentro restano i ruoli che la rete la guardano davvero; l'agente ha la sua
  // regola subito dopo (solo i suoi clienti). Stessa ragione di lib/perimetro.
  if (!vedeLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  // `ldv` = scritto a mano o dalla pistola USB; `codice` (anche piu' di uno) = letti dalla fotocamera,
  // tutti quelli inquadrati nello stesso fotogramma.
  const codici = [...req.nextUrl.searchParams.getAll('codice'), req.nextUrl.searchParams.get('ldv') || '']
    .map(c => c.trim()).filter(Boolean)
  if (!codici.length) return NextResponse.json({ error: 'LDV obbligatoria' }, { status: 400 })
  // RLS + catena: cerco la LDV su tutta la discendenza (solo discesa)
  const adminDb = createAdminSupabase()
  // CONDIVISIONE: una spedizione condivisa è N gambe con lo STESSO tracking_number. Con `.single()` il
  // match .or(numero,tracking) moriva su "multiple rows" → 404 ("non la fa scansionare"). Prendo TUTTE le
  // gambe e scelgo quella NEL PERIMETRO di chi scansiona (il suo master o un suo antenato), preferendo
  // l'ORIGINANTE (numero=tracking pulito) quando è nella sua rete. Per una spedizione normale c'è una riga.
  // Il codice letto non sempre e' il numero (BRT, GLS, SDA multicollo): lo riconosce lib/resi-codice.
  const trovato = await spedizioniDaCodici(adminDb, codici,
    'id,numero,mitt_nome,dest_nome,dest_citta,colli,stato,tracking_number,cliente_id,master_id,giacenza_reso_addebitato,corrieri(nome_contratto),clienti(ragione_sociale)')
  if (!trovato.righe.length) {
    // Nel registro, per imparare i formati che ancora non riconosciamo (senza dati personali).
    console.warn('[RESI][CODICE NON RICONOSCIUTO]' + (trovato.ambiguo ? '[AMBIGUO]' : ''), codiciPerRegistro(codici))
    return NextResponse.json({ error: trovato.ambiguo ? 'Il codice indica più pacchi: scrivi il numero della LDV' : NON_TROVATA }, { status: 404 })
  }
  const legs = trovato.righe
  // Originante prima: così, quando chi scansiona sta sopra la catena, si prende la gamba pulita (ed è da
  // lì che la cascata reso condivisione riparte comunque, in modo idempotente).
  const legsOrd = (legs || []).slice().sort((a: any, b: any) =>
    (b.numero === b.tracking_number ? 1 : 0) - (a.numero === a.tracking_number ? 1 : 0))
  let spedizione: any = null
  let idx = -1
  for (const leg of legsOrd) {
    let cur: string | null = (leg as any).master_id
    for (let i = 0; i < 20 && cur; i++) {
      if (cur === utente?.master_id) { idx = i; spedizione = leg; break }
      const { data: mm } = await adminDb.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
      cur = (mm as any)?.parent_master_id || null
    }
    if (spedizione) break
  }
  if (!spedizione) return NextResponse.json({ error: NON_TROVATA }, { status: 404 })
  // Agente: solo spedizioni di un suo cliente.
  if (isAgente(utente)) {
    const miei = await clientiAgente(supabase, utente)
    if (!spedizione.cliente_id || !miei.includes(spedizione.cliente_id)) return NextResponse.json({ error: NON_TROVATA }, { status: 404 })
  }

  // target per la distinta: null se cliente diretto (idx 0), altrimenti il primo master sotto chi cerca
  let targetMasterId: string | null = null
  let targetMasterNome: string | null = null
  if (idx > 0) {
    // ricostruisco il percorso per prendere il livello idx-1
    const percorso: string[] = []
    let c2: string | null = spedizione.master_id
    for (let i = 0; i < 20 && c2; i++) {
      percorso.push(c2)
      const { data: mm } = await adminDb.from('masters').select('parent_master_id').eq('id', c2).maybeSingle()
      c2 = mm?.parent_master_id || null
    }
    const pos = percorso.indexOf(utente!.master_id)
    if (pos > 0) {
      targetMasterId = percorso[pos - 1]
      const { data: tm } = await adminDb.from('masters').select('nome').eq('id', targetMasterId).maybeSingle()
      targetMasterNome = tm?.nome || null
    }
  }
  // anti-duplicato PER LIVELLO: blocco solo se GIA' in una distinta reso del MIO master
  // (la stessa LDV puo' legittimamente stare in una distinta di M1 verso M2 e in una di M2 verso il suo cliente)
  const { data: giaMia } = await adminDb.from('distinte_resi')
    .select('id')
    .eq('master_id', utente!.master_id)
    .contains('voci', JSON.stringify([{ id: spedizione.id }]))
    .limit(1)
  if (giaMia && giaMia.length > 0) {
    return NextResponse.json({ error: 'Spedizione già messa in reso e addebitata' }, { status: 400 })
  }

  // Reso già gestito e addebitato in fase di SVINCOLO GIACENZA: la scansione lo segnala (popup)
  // e non deve riaddebitarlo. Torno 200 con un flag così la UI mostra l'avviso e lascia proseguire.
  const gia_addebitato_giacenza = (spedizione as any).giacenza_reso_addebitato === true

  // Per raggruppare in pagina: a chi va la distinta (il cliente o il sotto-master) e su che contratto.
  const { corrieri, clienti, ...resto } = spedizione as any
  return NextResponse.json({
    ...resto, target_master_id: targetMasterId, target_master_nome: targetMasterNome, gia_addebitato_giacenza,
    contratto: (Array.isArray(corrieri) ? corrieri[0] : corrieri)?.nome_contratto || null,
    cliente_nome: (Array.isArray(clienti) ? clienti[0] : clienti)?.ragione_sociale || null,
    codice_letto: trovato.codice,
  })
}