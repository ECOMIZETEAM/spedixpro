import { vedeLaRete } from '@/lib/perimetro'
import { isAgente, nomeAgente } from '@/lib/agente'

// CHI PUÒ USARE I PREVENTIVI. Due attori, stesse regole ma procedura diversa:
//  - MASTER/ADMIN (vedeLaRete): fa preventivi per clienti e sotto-master, vede TUTTI i preventivi del
//    proprio master (compresi quelli fatti dai suoi agenti).
//  - AGENTE: rivenditore. Può fare preventivi SOLO per clienti, costruiti sul SUO listino (mai i prezzi
//    del master); vede solo i PROPRI preventivi (tag agente = nome+cognome). Il preventivo resta del
//    MASTER (master_id) così il master lo vede col tag; il cliente all'attivazione nasce sotto il master.
export type AttorePreventivi = {
  user: any
  master_id: string
  isAgente: boolean
  agenteNome: string | null      // valorizzato solo per l'agente (chiave clienti.agente)
  listinoAgenteId: string | null // il listino COSTO dell'agente (listini_clienti), base del "da costo"
}

export async function attorePreventivi(supabase: any): Promise<AttorePreventivi | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id,nome,cognome,listino_agente_id').eq('id', user.id).single()
  if (!u?.master_id) return null
  if (vedeLaRete(u)) return { user, master_id: u.master_id, isAgente: false, agenteNome: null, listinoAgenteId: null }
  if (isAgente(u)) {
    const nome = nomeAgente(u)
    if (!nome) return null   // agente senza nome: non può taggare i clienti → fuori
    return { user, master_id: u.master_id, isAgente: true, agenteNome: nome, listinoAgenteId: (u as any).listino_agente_id || null }
  }
  return null
}
