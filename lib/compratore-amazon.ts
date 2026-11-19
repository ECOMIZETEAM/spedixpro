import type { SupabaseClient } from '@supabase/supabase-js'

// Al compratore che arriva dal COLLEGAMENTO DIRETTO Amazon (SP-API) non scriviamo noi: niente email
// ne' SMS di "spedizione creata" o di giacenza. Amazon permette di usare i suoi dati solo per spedire
// (politica d'uso SP-API, punto 4.1) e la conferma col tracking al compratore la manda gia' Amazon.
// Telefono ed email restano al corriere, che consegna.
//
// Scelta di Lorenzo del 04/11/2026: SOLO gli ordini del collegamento. Gli ordini Amazon caricati da
// file, arrivati dall'API o scritti a mano ricevono le notifiche come prima.
//
// Il segno e' l'ordine stesso: una riga di ordini_ecommerce con piattaforma 'amazon' che punta alla
// spedizione (la capofila, se gli ordini sono stati uniti). Se la lettura fallisce si lancia: chi
// chiama non scrive, nel dubbio.
export async function spedizioniDaAmazon(admin: SupabaseClient, ids: (string | null | undefined)[]): Promise<Set<string>> {
  const trovate = new Set<string>()
  const pieni = ids.filter((x): x is string => !!x)
  // A blocchi: gli id finiscono nell'URL e oltre qualche centinaio PostgREST risponde Bad Request.
  for (let i = 0; i < pieni.length; i += 200) {
    const { data, error } = await admin.from('ordini_ecommerce').select('spedizione_id')
      .eq('piattaforma', 'amazon').in('spedizione_id', pieni.slice(i, i + 200))
    if (error) throw new Error(`ordini Amazon non letti: ${error.message}`)
    for (const r of data || []) if (r.spedizione_id) trovate.add(r.spedizione_id)
  }
  return trovate
}

export async function eSpedizioneDaAmazon(admin: SupabaseClient, spedizioneId: string): Promise<boolean> {
  return (await spedizioniDaAmazon(admin, [spedizioneId])).has(spedizioneId)
}
