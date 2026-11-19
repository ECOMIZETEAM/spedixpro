import { fetchAllStretto } from '@/lib/fetch-all'

// "STO NELLA CATENA DI QUESTO PACCO?" — per i report di chi guarda (Rettifiche, Resi, Giacenze, Fatture).
//
// Serve per i movimenti che un sotto-master scrive su SE STESSO (master_id = master_target_id): sono un
// addebito verso chi guarda solo se chi guarda sta nella catena di quella spedizione, cioe' se su quel
// pacco ha pagato anche lui. Senza questa prova la piattaforma (sopra MULTIEXPRESS, nessun contratto) si
// trovava nei report gli addebiti che il fornitore fa a MULTIEXPRESS (18.085 rettifiche da meta' agosto,
// 718 giacenze nell'1-14/10/2026); scartandoli tutti, invece, si perdevano i pochi veri dei sotto-master.
//
// Chi guarda ha pagato il pacco se c'e':
//  - un suo costo 'spedizione' (master_target_id = lui), oppure
//  - un movimento sul SUO conto "(ingrosso)" presso chi gli vende il contratto: sui contratti condivisi
//    (SDA EXPRESS L: MULTIEXPRESS compra da Wave) il costo e' su quel conto, non a se stesso, e senza
//    questo caso su quei pacchi i movimenti veri sparivano (12 giacenze, 17 € a MULTIEXPRESS, 1-14/10).
// I suoi conti "(ingrosso)" d'acquisto sono quelli dei legami in cui il compratore e' lui.
export async function spedizioniInCatena(admin: any, viewerId: string, spedizioneIds: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  const ids = Array.from(new Set(spedizioneIds.filter(Boolean)))
  if (!ids.length || !viewerId) return out
  const { data: legami, error } = await admin.from('corrieri_condivisi').select('cliente_ledger_id')
    .eq('master_id', viewerId).eq('stato', 'attiva')
  if (error) throw new Error('legami di acquisto: ' + error.message)
  const mieiLedger = Array.from(new Set((legami || []).map((l: any) => l.cliente_ledger_id).filter(Boolean))) as string[]
  const condizione = `and(tipo.eq.spedizione,master_target_id.eq.${viewerId})` + (mieiLedger.length ? `,cliente_id.in.(${mieiLedger.join(',')})` : '')
  // A blocchi di 200 id (oltre ~25 KB di indirizzo PostgREST respinge la richiesta), ordinati prima per
  // la colonna dell'indice: col solo id il database puo' scorrere l'intera tabella dei movimenti.
  for (let i = 0; i < ids.length; i += 200) {
    const righe = await fetchAllStretto(() => admin.from('movimenti').select('id,spedizione_id')
      .in('spedizione_id', ids.slice(i, i + 200)).or(condizione)
      .order('spedizione_id', { ascending: true }).order('id', { ascending: true }))
    for (const r of righe as any[]) out.add(r.spedizione_id)
  }
  return out
}
