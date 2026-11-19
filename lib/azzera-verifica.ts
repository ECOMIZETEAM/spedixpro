import type { createAdminSupabase } from '@/lib/supabase-admin'

// AZZERA LA VERIFICA IN DUE PASSAGGI di uno o piu' accessi: toglie i codici collegati all'app sul
// telefono, e al prossimo ingresso l'utente entra con la password e la riattiva inquadrando un codice
// nuovo. Una funzione sola per le tre schede che lo fanno (cliente, collaboratore, titolare di un
// sotto-master): chi PUO' farlo lo decide ogni rotta, qui c'e' solo il come.
//
// Serve perche' senza un pulsante l'unica via era cancellare l'accesso e crearne un altro. E' successo
// davvero: un admin di AVG EXPRESS si e' visto rifiutare ogni codice dalla sera del 13/11/2026, il suo
// master non aveva come azzerarglielo, e la mattina dopo l'accesso e' stato cancellato e ricreato con un
// altro id.
export async function togliVerifica(admin: ReturnType<typeof createAdminSupabase>, utentiIds: string[]): Promise<{ tolti: number } | { errore: string }> {
  let tolti = 0
  for (const userId of utentiIds) {
    const { data: fattori, error: eF } = await admin.auth.admin.mfa.listFactors({ userId })
    if (eF) return { errore: 'Verifica non letta' }
    for (const f of fattori?.factors || []) {
      const { error: eD } = await admin.auth.admin.mfa.deleteFactor({ userId, id: f.id })
      if (eD) return { errore: 'Azzeramento non riuscito, riprova' }
      tolti++
    }
    // Anche gli altri metodi (lib/verifica-metodi): la mail, i codici di riserva, le app riconosciute e
    // le sessioni verificate dal portale. Chi non entra piu' nella sua casella riparte da zero come chi
    // ha perso il telefono.
    const { data: viaMail, error: eM } = await admin.from('verifica_metodo').delete().eq('utente_id', userId).select('utente_id')
    if (eM) return { errore: 'Azzeramento non riuscito, riprova' }
    await Promise.all([
      admin.from('codici_riserva').delete().eq('utente_id', userId),
      admin.from('fattori_approvati').delete().eq('utente_id', userId),
      admin.from('sessioni_verificate').delete().eq('utente_id', userId),
    ])
    tolti += viaMail?.length || 0
  }
  return { tolti }
}
