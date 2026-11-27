/* LE SPEDIZIONI FUORI DA TUTTO GIÀ GESTITE ALTROVE. Il borderò GLS è cumulativo e riscritto (quello del 23/11
 * contiene tutte le righe di quello del 17/11), poi arriva l'allegato del mese: lo stesso arrivo fuori da Moove
 * torna in tre documenti, ognuno con i suoi stati. Senza guardare gli altri, ogni documento lo proponeva di nuovo
 * («L'ho fatta pagare», e in «Cosa fare» «Dire chi ha pagato…») e la stessa spedizione finiva fatta pagare, e
 * contata incassata, una volta per documento (revisione del 27/11). Qui quello che gli altri documenti del master
 * dicono di quella spedizione, per mostrarlo e contarlo una volta. Solo lettura. */

export type FuoriAltrove = { stato: string; il: string; importo?: number; nota?: string; cliente?: { id?: string; nome: string }
  incassato?: boolean; documento: string; fatturaId: string }

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
      // Più documenti sulla stessa spedizione: vince quella fatta pagare, poi la più recente.
      const peso = (x: any) => (x.stato === 'fatturato' ? 1 : 0)
      if (prima && (peso(prima) > peso(v) || (peso(prima) === peso(v) && prima.il >= v.il))) continue
      out[seg] = { ...v, documento: f.etichetta || f.numero_fattura, fatturaId: f.id }
    }
  }
  return out
}
