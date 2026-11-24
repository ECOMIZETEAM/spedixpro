// CHI PUÒ CONTROLLARE UNA FATTURA DEL CORRIERE: il DETENTORE del contratto, e solo sui suoi contratti BRT o GLS.
// La fattura la riceve chi ha il contratto col corriere, e il controllo mostra il suo costo e le spedizioni di
// chi gli compra il contratto: un sotto-master non deve vederlo. Le rotte leggono con la chiave di servizio,
// quindi il permesso si controlla qui, a mano, una volta per tutte le rotte del controllo fattura.
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'

// `tipi`: di default solo BRT, perché la compensazione contrassegni (app/api/contrassegni/compensazione-brt)
// è solo BRT. Il controllo fattura chiede anche GLS.
// Delle credenziali si leggono solo sede e codice contratto (mai le password): dicono quali contratti Moove
// stanno sullo stesso conto GLS, cioè nello stesso PDF.
export async function contrattiDelDetentore(admin: any, masterId: string, tipi: string[] = ['brt']) {
  const { data } = await admin.from('corrieri')
    .select('id,nome_contratto,tipo,contratto_id,proprio,attivo,created_at,sede:credenziali->>sigla_sede,codice:credenziali->>codice_contratto')
    .eq('master_id', masterId).in('tipo', tipi).eq('proprio', true)
  // Il detentore è la riga che porta il codice di sé stessa: le copie hanno il codice del contratto di sopra.
  return (data || []).filter((c: any) => c.contratto_id === c.id)
}

// UN CONTO GLS, PIÙ CONTRATTI MOOVE. Wave ha "GLS NI W", "GLS NI W LIGHT" e "GLS NI W Europa" tutti sul
// contratto GLS 6160 della sede NI: GLS manda un PDF solo, con le spedizioni di tutti e tre. Il controllo li
// prende insieme; nella tendina compaiono come una voce sola, col primo creato a rappresentarli.
export function gruppiGls(contratti: any[]) {
  const gruppi = new Map<string, any[]>()
  for (const c of contratti.filter(c => c.tipo === 'gls').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    // "06160", " 6160" e "6160" sono lo stesso contratto (come normalizzaCodice di lib/fattura-gls-pdf).
    const codice = String(c.codice || '').trim().replace(/^0+(?=\d)/, '')
    const k = codice ? `${String(c.sede || '').trim().toUpperCase()}|${codice}` : c.id
    gruppi.set(k, [...(gruppi.get(k) || []), { ...c, codice }])
  }
  return Array.from(gruppi.values()).map(l => ({ rappresentante: l[0], ids: l.map(c => c.id), nomi: l.map(c => c.nome_contratto), sede: l[0].sede || null, codice: l[0].codice || null }))
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
