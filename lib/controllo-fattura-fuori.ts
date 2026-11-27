/* LE SPEDIZIONI FUORI DA TUTTO GIÀ GESTITE ALTROVE. Il borderò GLS è cumulativo e riscritto (quello del 23/11
 * contiene tutte le righe di quello del 17/11), poi arriva l'allegato del mese: lo stesso arrivo fuori da Moove
 * torna in tre documenti, ognuno con i suoi stati. Senza guardare gli altri, ogni documento lo proponeva di nuovo
 * («L'ho fatta pagare», e in «Cosa fare» «Dire chi ha pagato…») e il cliente poteva pagarlo una volta per documento
 * (rilievo della revisione del 27/11, prima del rilascio). Qui:
 *  - quello che gli altri documenti del master dicono di quella spedizione (per mostrarlo e contarlo una volta);
 *  - i movimenti «Spedizione fatta fuori dal portale» del master con quel numero, da qualunque porta (anche dalla
 *    scheda cliente): sono quelli che fanno pagare il cliente, ed è su di loro che si decide se c'è già un addebito.
 * Solo lettura. */

export type FuoriAltrove = { stato: string; il: string; importo?: number; nota?: string; cliente?: { id?: string; nome: string }
  addebito?: string; incassato?: boolean; documento: string; fatturaId: string }

// Gli stati «fuori:…» degli altri documenti del master. Si legge solo `riepilogo->stati`, non le righe.
export async function fuoriAltrove(admin: any, masterId: string, fatturaId: string): Promise<Record<string, FuoriAltrove>> {
  const { data, error } = await admin.from('fatture_corriere').select('id,numero_fattura,etichetta,stati:riepilogo->stati')
    .eq('master_id', masterId).neq('id', fatturaId).order('created_at', { ascending: false }).limit(500)
  if (error) throw new Error('lettura degli altri documenti non riuscita: ' + error.message)
  const out: Record<string, FuoriAltrove> = {}
  for (const f of data || []) {
    for (const [k, v] of Object.entries((f.stati || {}) as Record<string, any>)) {
      if (!k.startsWith('fuori:') || !v?.stato) continue
      const seg = k.slice(6), prima = out[seg]
      // Più documenti sulla stessa spedizione: vince l'addebito vero, poi il più recente.
      const peso = (x: any) => (x.addebito === 'fatto' || x.addebito === 'in_corso' ? 2 : 0) + (x.stato === 'fatturato' ? 1 : 0)
      if (prima && (peso(prima) > peso(v) || (peso(prima) === peso(v) && prima.il >= v.il))) continue
      out[seg] = { ...v, documento: f.etichetta || f.numero_fattura, fatturaId: f.id }
    }
  }
  return out
}

// I movimenti «Spedizione fatta fuori dal portale» che il master ha scritto con quel numero (la descrizione lo
// contiene sempre: lib/movimento-manuale, descrizioneMovimento). Il numero è un tracking di sole lettere e cifre:
// nessun carattere speciale finisce nel filtro. La ricerca usa l'indice per trigrammi sulla descrizione.
// Il più recente per primo; con chi l'ha pagato (cliente, o sotto-master come 'm:<id>'), per segnarlo sulla fattura
// quando è stato fatto da un'altra porta.
export type AddebitoFuori = { il: string; importo: number; descrizione: string; chi: string | null; nome: string | null }
export async function addebitiFuoriPortale(admin: any, masterId: string, numero: string): Promise<AddebitoFuori[]> {
  if (!/^[A-Z0-9]{6,40}$/i.test(numero)) return []
  const { data, error } = await admin.from('movimenti').select('created_at,importo,descrizione,cliente_id,master_target_id')
    .eq('master_id', masterId).eq('voce', 'fuori_portale').ilike('descrizione', `%${numero}%`).order('created_at', { ascending: false }).limit(10)
  if (error) throw new Error('lettura dei movimenti non riuscita: ' + error.message)
  const righe = (data || []) as any[]
  const idCli = Array.from(new Set(righe.map(m => m.cliente_id).filter(Boolean)))
  const idMas = Array.from(new Set(righe.filter(m => !m.cliente_id && m.master_target_id && m.master_target_id !== masterId).map(m => m.master_target_id)))
  const nomi = new Map<string, string>()
  if (idCli.length) { const { data: c } = await admin.from('clienti').select('id,ragione_sociale').in('id', idCli); for (const x of c || []) nomi.set(x.id, x.ragione_sociale) }
  if (idMas.length) { const { data: m } = await admin.from('masters').select('id,nome').in('id', idMas); for (const x of m || []) nomi.set('m:' + x.id, x.nome) }
  return righe.map(m => {
    const chi = m.cliente_id ? m.cliente_id : m.master_target_id && m.master_target_id !== masterId ? 'm:' + m.master_target_id : null
    return { il: m.created_at, importo: Number(m.importo) || 0, descrizione: String(m.descrizione || ''), chi, nome: chi ? nomi.get(chi) || null : null }
  })
}

// DA UNO STATO ALL'ALTRO, PER UNA SPEDIZIONE FUORI DA TUTTO FATTA PAGARE IN MOOVE. Un addebito partito ('fatto') non
// si toglie e non si cambia in altro: il movimento resta, si storna dalla scheda del cliente e qui si segna
// 'stornato'. Una prenotazione ('in_corso') non si rifà (due clic, due schede), e porta solo a 'fatto' o si toglie.
// Risponde il motivo del rifiuto, o null se il passaggio va bene.
// `trovato`: la rotta ha appena trovato fra i movimenti l'addebito di quella spedizione (fatto da un'altra porta, o
// rifatto dalla scheda dopo uno storno): si può segnare 'fatto' senza prenotazione, perché il movimento c'è.
export function rifiutoStatoFuori(prima: { addebito?: string; cliente?: { nome?: string }; nota?: string } | undefined,
  nuovo: { stato: string | null; addebito: 'in_corso' | 'fatto' | 'stornato' | null; trovato?: boolean }): string | null {
  if (nuovo.trovato && nuovo.stato === 'fatturato' && nuovo.addebito === 'fatto') return null
  if (prima?.addebito === 'fatto' && !(nuovo.stato === 'fatturato' && (nuovo.addebito === 'fatto' || nuovo.addebito === 'stornato')))
    return `Questa spedizione è già addebitata a ${prima.cliente?.nome || prima.nota || 'un cliente'}: per correggerla fai uno storno dalla sua scheda, poi segna «L'ho stornata».`
  if (nuovo.addebito === 'in_corso' && (prima?.addebito === 'in_corso' || prima?.addebito === 'fatto'))
    return 'L\'addebito di questa spedizione è già partito: aggiorna la pagina.'
  if (prima?.addebito === 'in_corso' && nuovo.stato != null && nuovo.addebito !== 'fatto')
    return 'C\'è un addebito da verificare su questa spedizione: prima premi «L\'addebito c\'è» o «Non c\'è».'
  if (nuovo.addebito === 'stornato' && prima?.addebito !== 'fatto') return 'Si segna stornato solo un addebito partito.'
  if (nuovo.addebito === 'fatto' && prima?.addebito !== 'in_corso' && prima?.addebito !== 'fatto')
    return 'Un addebito si segna fatto solo dopo averlo prenotato: aggiorna la pagina.'
  return null
}
