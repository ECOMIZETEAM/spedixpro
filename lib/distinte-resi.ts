// LE DISTINTE DI RESO GIA' ESISTENTI, LETTE PER INTERO.
// Ogni porta che crea una distinta di reso deve sapere quali pacchi sono gia' in una distinta e qual e'
// l'ultimo numero del master. Le leggevano con una richiesta sola, e le risposte del database si
// fermano a 1.000 righe senza dirlo: superata la millesima distinta (21/09/2026) il giro delle 23 ne
// vedeva solo una parte, rimetteva in distinta ogni sera i resi gia' chiusi e riusava i numeri. Al 21/10
// erano 4.086 righe ripetute in 2.045 distinte di 337 clienti: lo stesso pacco in 4-6 distinte, con
// totali che sommati sembravano addebiti ripetuti (l'addebito no: lo protegge il database).
// Qui si legge a pagine, e se una pagina non arriva si ferma tutto: meglio nessuna distinta stanotte
// che una distinta doppia.

const PAGINA = 1000

// Spedizione -> numero della PRIMA distinta di reso che la contiene, tra quelle dei master indicati.
// `dal`: si leggono solo le distinte create da quel momento. Basta la data della spedizione piu' vecchia
// che interessa: una distinta contiene pacchi che esistono gia', non e' mai piu' vecchia di loro
// (verificato su tutte le 6.844 righe al 21/10/2026: la distinta arriva almeno 12 ore dopo).
export async function pacchiGiaInDistintaResi(
  admin: any, masterIds: string[], opz: { dal?: string } = {},
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ids = [...new Set(masterIds.filter(Boolean))]
  for (let i = 0; i < ids.length; i += 100) {
    for (let da = 0; ; da += PAGINA) {
      let q = admin.from('distinte_resi').select('id,numero,voci').in('master_id', ids.slice(i, i + 100))
      if (opz.dal) q = q.gte('created_at', opz.dal)
      const { data, error } = await q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(da, da + PAGINA - 1)
      if (error) throw new Error('Lettura distinte di reso non riuscita: ' + error.message)
      for (const d of (data || [])) {
        for (const v of (Array.isArray(d.voci) ? d.voci : [])) if (v?.id && !out.has(v.id)) out.set(v.id, d.numero)
      }
      if (!data || data.length < PAGINA) break
    }
  }
  return out
}

// Il numero della prossima distinta di reso del master: il piu' alto che ha, piu' uno. Il conteggio
// delle distinte non va bene: coi numeri gia' ripetuti dal guasto sopra il conteggio supera il numero
// piu' alto, e prima o poi due distinte avrebbero lo stesso numero.
export async function prossimoNumeroDistintaResi(admin: any, masterId: string): Promise<number> {
  const { data, error } = await admin.from('distinte_resi').select('numero').eq('master_id', masterId)
    .not('numero', 'is', null).order('numero', { ascending: false }).limit(1)
  if (error) throw new Error('Numero distinta di reso non disponibile: ' + error.message)
  return (Number(data?.[0]?.numero) || 0) + 1
}
