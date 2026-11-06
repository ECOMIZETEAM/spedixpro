// DOPO CHE I PREZZI DI UN LISTINO CLIENTE CAMBIANO: chi lo usa per comprare deve vederlo.
//
// Un listino cliente non lo usano solo i clienti. Se e' assegnato a un sotto-master (masters.parent_listino_id)
// e' il suo costo, materializzato nel suo Listino Corrieri; se e' il prezzo d'ingrosso di un master collegato
// (il listino del suo conto "(ingrosso)", clienti.ledger) e' il costo mostrato sui contratti che gli sono
// condivisi. L'addebito legge gia' il listino vero; queste copie servono a quello che il sotto-master e il
// collegato VEDONO, e restano indietro se nessuno le riallinea.
// Prima stava scritto solo nel salvataggio dell'editor (app/api/listini/cliente/[id]); ora lo chiamano anche
// gli aumenti in percentuale. Una strada nuova che cambia i prezzi passa da qui.

export async function propagaListinoModificato(admin: any, listinoId: string): Promise<{ sottoMaster: number; collegamenti: number }> {
  let sottoMaster = 0, collegamenti = 0

  // Sotto-master a cui il listino e' assegnato, e tutta la loro rete sotto.
  try {
    const { propagaListinoACascata } = await import('@/lib/copia-listino-submaster')
    const t0 = Date.now()
    sottoMaster = await propagaListinoACascata(admin, listinoId)
    console.log(`[LISTINO][PROPAGA] listino ${listinoId} -> ${sottoMaster} sotto-master in ${Date.now() - t0}ms`)
  } catch (e) { console.error('Propagazione listino ai sotto-master:', e) }

  // AUTO RE-SYNC CONDIVISIONE: se questo listino è il prezzo d'ingrosso di un master collegato (è il
  // listino_cliente_id di un cliente-ledger), riporta i costi sui contratti che gli sono già condivisi
  // E CREA quelli che il venditore ci ha appena messo: il salvataggio fa quello che faceva il bottone
  // Aggiorna della scheda del collegato.
  // Prima il salvataggio riallineava solo i costi, e i contratti nuovi restavano «da attivare» finché un
  // master del venditore non premeva Aggiorna. Il 6/11/2026 Wave ha messo GLS NI W, GLS NI W Europa e
  // GLS NI W LIGHT nel listino di MULTIEXPRESS, l'ha salvato tre volte, e MULTIEXPRESS non li vedeva.
  // Regola di Lorenzo: «una volta che salva Wave, in automatico MULTI li deve vedere» — è il listino del
  // venditore a dire cosa il collegato compra.
  // Restano fuori, come per Aggiorna: le copie del collegato da sostituire (tolgono righe di un altro
  // master, solo dall'Assegna con conferma), i ponti spenti (non si riaccendono da qui) e i collegamenti
  // del vecchio tipo (un contratto solo: solo costo). L'addebito era già live. Best-effort.
  try {
    const { risincronizzaCondivisione } = await import('@/lib/condivisione-engine')
    const { data: ledgers } = await admin.from('clienti').select('id').eq('ledger', true).eq('listino_cliente_id', listinoId)
    // Tutti i collegamenti attivi del ledger, anche quello del vecchio tipo (un contratto solo, con
    // corriere_id valorizzato: LOGIXIA → Wave). Il filtro `corriere_id is null` lo escludeva, e dal 3/10
    // al 29/10 nessun salvataggio di LOGIXIA è arrivato a Wave: il secondo scaglione del contrassegno
    // restava a 2.000 € mentre l'ingrosso diceva 5.000. risincronizzaCondivisione a quel tipo riallinea
    // solo il costo, senza creargli contratti nuovi.
    for (const l of (ledgers || [])) {
      const { data: links } = await admin.from('corrieri_condivisi').select('id').eq('cliente_ledger_id', (l as any).id).eq('stato', 'attiva')
      for (const link of (links || [])) {
        const r = await risincronizzaCondivisione(admin, (link as any).id, { creaMancanti: true })
        collegamenti++
        // Nei log, per sapere quando e da quale salvataggio è nato un contratto sul portale del collegato.
        if (r.creati?.length || r.daConfermare?.length) {
          console.info(`[CONDIVISIONE][SALVATAGGIO] listino ${listinoId} collegamento ${(link as any).id}: creati ${JSON.stringify(r.creati || [])}, da sostituire con Assegna ${JSON.stringify(r.daConfermare || [])}`)
        }
      }
    }
  } catch (e) { console.error('Re-sync condivisione dopo salvataggio listino:', e) }

  return { sottoMaster, collegamenti }
}
