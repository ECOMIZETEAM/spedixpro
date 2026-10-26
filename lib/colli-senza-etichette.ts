// ── IL DETTAGLIO DEI COLLI, SENZA LE ETICHETTE ──
//
// `colli_dettaglio` sulle SDA L porta dentro il PDF di ogni collo (base64, ~1,7 MB a collo; 377 KB in
// media a spedizione). Chi ha bisogno solo di peso e lati non deve scaricarlo intero: il 19/10/2026 la
// pagina Rettifica Costi di LOGIXIA, con 3.706 rettifiche in attesa, chiedeva ~1,4 GB e restava su
// "Caricamento…", e la conferma faceva lo stesso a blocchi di 150.
// Qui si leggono, collo per collo, SOLO peso e lati, e si ricompone l'array con gli stessi oggetti di
// prima meno le etichette. Verificato il 19/10 sulle 4.648 spedizioni con rettifiche in attesa: nessun
// collo senza questi campi, nessuno coi nomi inglesi (weight/length…: il portale scrive i nomi italiani),
// al massimo 7 colli, mai piu' elementi dei colli della spedizione. 128 su 128 identici (40 multicollo).
const CAMPI_COLLO = ['peso', 'lunghezza', 'larghezza', 'altezza']

// `colonne` = le colonne normali da leggere insieme (senza colli_dettaglio). Torna id → riga, con
// `colli_dettaglio` ricomposto (array, eventualmente vuoto). `colonne` vuota = servono solo i colli.
export async function spedizioniConColliLeggeri(admin: any, ids: string[], colonne: string): Promise<Map<string, any>> {
  const out = new Map<string, any>()
  const unici = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < unici.length; i += 150) {
    const blocco = unici.slice(i, i + 150)
    const { data: righe } = await admin.from('spedizioni').select(colonne ? `id,colli,${colonne}` : 'id,colli').in('id', blocco)
    for (const r of (righe || []) as any[]) out.set(r.id, { ...r, colli_dettaglio: [] })
    // QUANTI COLLI LEGGERE: ogni campo estratto costringe il database ad aprire l'intero dettaglio (etichette
    // comprese), quindi se ne chiedono il meno possibile. Il dettaglio non ha mai piu' elementi dei colli
    // della spedizione (verificato il 19/10 sulle 4.648 in attesa): le monocollo — quasi tutte — si leggono
    // al solo collo 0, le multicollo fino al loro numero di colli.
    const gruppi = new Map<number, string[]>()
    for (const r of (righe || []) as any[]) {
      const n = Math.min(50, Math.max(1, Number(r.colli) || 1))
      gruppi.set(n, [...(gruppi.get(n) || []), r.id])
    }
    for (const [n, idsGruppo] of gruppi) {
      const campi = ['id']
      for (let k = 0; k < n; k++) for (const c of CAMPI_COLLO) campi.push(`c${k}_${c}:colli_dettaglio->${k}->${c}`)
      const { data: colli } = await admin.from('spedizioni').select(campi.join(',')).in('id', idsGruppo)
      for (const r of (colli || []) as any[]) {
        const dett: any[] = []
        for (let k = 0; k < n; k++) {
          const el: any = {}
          for (const c of CAMPI_COLLO) { const v = r[`c${k}_${c}`]; if (v !== null && v !== undefined) el[c] = v }
          if (!Object.keys(el).length) break           // fine dell'array
          dett.push(el)
        }
        const riga = out.get(r.id)
        if (riga) riga.colli_dettaglio = dett
      }
    }
  }
  return out
}
