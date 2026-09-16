import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { registraMovimento, registraMovimentoMaster } from '@/lib/movimenti'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { calcolaRipesature } from '@/lib/ripesature-calcolo'
import { createAdminSupabase } from '@/lib/supabase-admin'

// CORREZIONE MANUALE di peso/misure di una spedizione GIA' creata.
//
// Il master si accorge che il cliente ha dichiarato peso/dimensioni sbagliati. Corregge, e il costo
// per QUELLA spedizione si RICALCOLA: la differenza col prezzo gia' pagato diventa una rettifica sul
// cliente — ADDEBITO se il costo sale, RIMBORSO se scende (a differenza della ripesatura del fornitore
// che fa solo recuperi). L'ETICHETTA NON cambia (e' gia' stampata): cambia solo il conteggio.
//
// Riusa il motore unico delle ripesature (calcolaRipesature): stessa logica prezzo/zona/peso, niente
// duplicazione. Storico append-only: il movimento resta, la riga spedizioni si aggiorna in place.
// Chiave anti-doppio MAN-<sped>-<cliente>-<n> (indice unico DB, come RIP-): un doppio-invio dello
// stesso contatore viene respinto; una nuova correzione deliberata usa un contatore piu' alto.
//
// Perimetro (MVP): solo il MASTER CREATORE della spedizione (owner) e solo spedizioni con CLIENTE.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const bloccoAg = bloccaAgente(utente); if (bloccoAg) return bloccoAg   // agente = sola lettura
  // Il RUOLO, non la sola appartenenza: master_id ce l'hanno anche i clienti, e qui si muove credito
  // con la chiave di servizio che scavalca le regole per riga.
  if (!gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { spedizioneId, colli, dryRun } = body || {}
  if (!spedizioneId) return NextResponse.json({ error: 'spedizioneId mancante' }, { status: 400 })
  if (!Array.isArray(colli) || !colli.length) return NextResponse.json({ error: 'Indica almeno un collo' }, { status: 400 })
  const colliNorm = colli.map((c: any) => ({
    peso: Number(c.peso) || 0, lunghezza: Number(c.lunghezza) || 0,
    larghezza: Number(c.larghezza) || 0, altezza: Number(c.altezza) || 0,
  }))
  if (colliNorm.some(c => c.peso <= 0 || c.lunghezza <= 0 || c.larghezza <= 0 || c.altezza <= 0))
    return NextResponse.json({ error: 'Peso e misure di ogni collo devono essere maggiori di 0' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: sped } = await admin.from('spedizioni')
    .select('id,master_id,cliente_id,tracking_number,numero,stato')
    .eq('id', spedizioneId).maybeSingle()
  if (!sped) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  // SOLO IL CREATORE: master_id della spedizione = chi la corregge. (Il super-master che corregge la
  // spedizione di un sotto-master e' un caso diverso, non in questo MVP.)
  if ((sped as any).master_id !== utente!.master_id)
    return NextResponse.json({ error: 'Non e\' una tua spedizione' }, { status: 403 })
  if ((sped as any).stato === 'annullata')
    return NextResponse.json({ error: 'Spedizione annullata: non modificabile' }, { status: 400 })
  if (!(sped as any).cliente_id)
    return NextResponse.json({ error: 'Modifica disponibile solo per spedizioni con cliente' }, { status: 400 })
  if (!(sped as any).tracking_number)
    return NextResponse.json({ error: 'Spedizione senza numero: non ricalcolabile' }, { status: 400 })

  // Ricalcolo col motore ripesature: costruisco una Ripesatura col collo VERO corretto.
  const rip = {
    idOrdine: (sped as any).tracking_number, idVerifiche: [], ldv: (sped as any).tracking_number,
    addebitoFornitore: 0, colli: colliNorm, dataChiusura: '', mittente: '', destinatario: '',
  }
  const [esito] = await calcolaRipesature(admin, [rip as any])
  if (!esito?.trovata) return NextResponse.json({ error: 'Ricalcolo non riuscito: ' + (esito?.motivo || 'spedizione non trovata') }, { status: 400 })

  // Livello CLIENTE (il creatore corregge la spedizione del suo cliente → il figlio diretto e' il cliente).
  const liv = (esito.livelli || []).find(l => l.clienteId)
  if (!liv || liv.differenza == null || liv.dovuto == null)
    return NextResponse.json({ error: 'Costo non ricalcolabile per questa destinazione/listino (zona non coperta?)' }, { status: 400 })

  // SEGNO: differenza = dovuto - pagato. importo del movimento = -differenza: negativo = ADDEBITO
  // (costo salito), positivo = RIMBORSO (costo sceso). Coerente con /api/rettifiche (importo negativo =
  // addebito) ma SENZA il gate "solo recuperi": qui i rimborsi passano.
  const importo = Math.round(-liv.differenza * 100) / 100
  const nuovoCostoCliente = Math.round(liv.dovuto * 100) / 100
  const pesoFatturato = Math.max(esito.pesoDopo, esito.pesoVolumeDopo)

  if (dryRun) {
    return NextResponse.json({
      dryRun: true, pesoPrima: esito.pesoRealePrima, pesoDopo: esito.pesoDopo,
      pesoVolumeDopo: esito.pesoVolumeDopo, pagato: liv.pagato, dovuto: liv.dovuto,
      nuovoCostoCliente, importo,
      tipo: importo < -0.005 ? 'addebito' : importo > 0.005 ? 'rimborso' : 'nessuna variazione',
    })
  }

  // Catena INCOMPLETA = non riprezzo a meta': meglio niente che una catena rotta (soldi tra master).
  if (esito.catenaCompleta === false)
    return NextResponse.json({ error: 'Catena del contratto incompleta: correzione non applicata' }, { status: 400 })
  // Il cliente e' davvero mio (il resto della catena viene dalla struttura reale del contratto).
  const { data: cli } = await admin.from('clienti').select('id')
    .eq('master_id', utente!.master_id).eq('id', (sped as any).cliente_id).maybeSingle()
  if (!cli) return NextResponse.json({ error: 'Il cliente non e\' tuo' }, { status: 403 })

  const cat = esito.catenaDalBasso || []
  const creatore = cat[0] || (sped as any).master_id   // il cliente paga il creatore (in fondo alla catena)
  const descr = `Correzione peso/misure ${(sped as any).numero || (sped as any).tracking_number}: ${esito.pesoRealePrima}kg → ${esito.pesoDopo}kg`
  // Riferimento deterministico PER DESTINATARIO, con contatore: idempotente sui doppi invii (indice
  // unico MAN-%), ripetibile per correzioni successive (contatore piu' alto). Il contatore si conta al
  // volo per destinatario: un retry salta i livelli gia' fatti (differenza~0) e completa i falliti.
  const rifPer = async (dest: string) => {
    const base = `MAN-${spedizioneId}-${dest}`
    const { data: prec } = await admin.from('movimenti').select('id').ilike('riferimento', base + '-%')
    return `${base}-${prec?.length || 0}`
  }

  // TUTTA LA CATENA (cliente + ogni master, fino al detentore/proprietario del contratto). Per ogni
  // livello importo = -differenza (negativo=ADDEBITO, positivo=RIMBORSO). Ogni master paga il livello
  // SOPRA di se': target = quel master, owner = il master sopra (catenaDalBasso[i+1]). Il detentore paga
  // il fornitore, non un master: la sua differenza e' ~0 (addebitoFornitore=0) e si salta da solo.
  // NB: NON e' una transazione ACID unica — e' un loop di RPC atomiche; l'idempotenza naturale (il
  // 'pagato' si legge dai movimenti) rende un retry sicuro.
  const applicati: { chi: string; importo: number }[] = []
  const falliti: { chi: string; errore: string }[] = []
  for (const lv of (esito.livelli || [])) {
    if (lv.differenza == null) continue
    const imp = Math.round(-lv.differenza * 100) / 100
    if (Math.abs(imp) < 0.01) continue
    try {
      if (lv.clienteId) {
        await registraMovimento(admin, { masterId: creatore, clienteId: lv.clienteId, tipo: 'rettifica', descrizione: descr, importo: imp, riferimento: await rifPer(lv.clienteId), spedizioneId, createdBy: user.id })
        applicati.push({ chi: 'cliente', importo: imp })
      } else if (lv.masterId) {
        const idx = cat.indexOf(lv.masterId)
        const owner = idx >= 0 && idx + 1 < cat.length ? cat[idx + 1] : null
        if (!owner) continue   // detentore: nessun master sopra (differenza gia' ~0)
        await registraMovimentoMaster(admin, { masterOwnerId: owner, masterTargetId: lv.masterId, tipo: 'rettifica', descrizione: descr, importo: imp, riferimento: await rifPer(lv.masterId), spedizioneId, createdBy: user.id })
        applicati.push({ chi: 'master', importo: imp })
      }
    } catch (e: any) {
      const m = String(e?.message || '')
      if (/23505|duplicate|unique/i.test(m)) continue   // gia' applicato (doppio invio / race): non e' un errore
      falliti.push({ chi: lv.clienteId ? 'cliente' : String(lv.masterId), errore: m.slice(0, 120) })
    }
  }

  // Aggiorno la spedizione (peso/misure/costo cliente). L'etichetta NON cambia. Un eventuale livello
  // fallito si recupera ri-premendo Conferma con lo stesso peso (idempotenza naturale).
  await admin.from('spedizioni').update({
    peso_reale: esito.pesoDopo, peso_volume: esito.pesoVolumeDopo, peso_fatturato: pesoFatturato,
    lunghezza: colliNorm[0].lunghezza, larghezza: colliNorm[0].larghezza, altezza: colliNorm[0].altezza,
    colli: colliNorm.length,
    colli_dettaglio: colliNorm.map((c, i) => ({ numero: i + 1, lunghezza: c.lunghezza, larghezza: c.larghezza, altezza: c.altezza, peso: c.peso })),
    costo_totale: nuovoCostoCliente,
    updated_at: new Date().toISOString(),
  }).eq('id', spedizioneId)

  return NextResponse.json({
    ok: true, importo,
    tipo: importo < -0.005 ? 'addebito' : importo > 0.005 ? 'rimborso' : 'nessuna variazione',
    pesoPrima: esito.pesoRealePrima, pesoDopo: esito.pesoDopo, nuovoCostoCliente,
    livelliApplicati: applicati.length, catena: applicati, falliti,
  })
}
