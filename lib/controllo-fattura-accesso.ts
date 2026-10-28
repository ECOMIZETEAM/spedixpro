// CHI PUÒ CONTROLLARE UNA FATTURA DEL CORRIERE: il DETENTORE del contratto, e solo sui suoi contratti BRT.
// La fattura la riceve chi ha il contratto col corriere, e il controllo mostra il suo costo e le spedizioni di
// chi gli compra il contratto: un sotto-master non deve vederlo. Le rotte leggono con la chiave di servizio,
// quindi il permesso si controlla qui, a mano, una volta per tutte le rotte del controllo fattura.
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'

export async function contrattiDelDetentore(admin: any, masterId: string) {
  const { data } = await admin.from('corrieri').select('id,nome_contratto,tipo,contratto_id,proprio,attivo')
    .eq('master_id', masterId).eq('tipo', 'brt').eq('proprio', true)
  // Il detentore è la riga che porta il codice di sé stessa: le copie hanno il codice del contratto di sopra.
  return (data || []).filter((c: any) => c.contratto_id === c.id)
}

export async function utenteDetentore() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { errore: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const blocco = bloccaAgente(utente as any); if (blocco) return { errore: blocco }
  // master_id da solo non è un permesso (ce l'hanno anche clienti e autisti): conta il ruolo.
  if (!utente?.master_id || !gestisceLaRete(utente)) return { errore: NextResponse.json({ error: 'Non autorizzato' }, { status: 403 }) }
  return { masterId: utente.master_id as string, userId: user.id }
}
