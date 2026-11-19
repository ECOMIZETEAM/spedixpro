import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente, nomeAgente } from '@/lib/agente'
import { vedeLaRete } from '@/lib/perimetro'
import { fetchAllStretto } from '@/lib/fetch-all'

// LE TENDINE DEI REPORT CHE NON SI POSSONO RIEMPIRE DALLE LISTE CHE GIA' ESISTONO.
//
// Agente: la tendina elencava TUTTO lo staff (admin, operatori), mentre il filtro confronta con
// `clienti.agente`, che e' un testo libero: su MULTIEXPRESS 15 clienti hanno agente "stefania", che
// non corrisponde a nessun utente, e quindi non si poteva scegliere. Le voci giuste sono gli utenti
// col ruolo agente PIU' i valori che stanno davvero sui clienti.
// Periodo di rimborso: sta su `clienti.rimborso_freq`, che /api/clienti/lista non restituisce.
// `vista` dice alla pagina se lo stato dei contrassegni e' quello PER LIVELLO (master e staff) o
// quello del cliente finale (agente): le etichette cambiano significato.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const agente = isAgente(utente)
  if (!utente?.master_id || (!agente && !vedeLaRete(utente))) return NextResponse.json({ error: 'Non consentito' }, { status: 403 })

  let clienti: any[]
  try {
    clienti = await fetchAllStretto(() => {
      let q = supabase.from('clienti').select('id,agente,rimborso_freq').eq('master_id', utente.master_id).order('id', { ascending: true })
      if (agente) q = q.eq('agente', nomeAgente(utente))
      return q
    })
  } catch (e: any) {
    return NextResponse.json({ error: 'Lettura clienti non riuscita: ' + (e?.message || e) }, { status: 500 })
  }

  // Un rimborso senza frequenza la scheda cliente lo mostra (e lo salva) come "giornaliero": il
  // report deve dire la stessa cosa che il master vede sulla scheda.
  const rimborso: Record<string, string> = {}
  for (const c of clienti) rimborso[c.id] = String(c.rimborso_freq || 'giornaliero')

  let agenti: string[]
  if (agente) {
    agenti = [nomeAgente(utente)].filter(Boolean)
  } else {
    const { data: staff, error } = await supabase.from('utenti').select('nome,cognome,ruolo').eq('master_id', utente.master_id).eq('ruolo', 'agente')
    if (error) return NextResponse.json({ error: 'Lettura agenti non riuscita: ' + error.message }, { status: 500 })
    const nomi = new Set<string>()
    for (const u of (staff || [])) { const n = [(u as any).nome, (u as any).cognome].filter(Boolean).join(' ').trim(); if (n) nomi.add(n) }
    for (const c of clienti) { const n = String(c.agente || '').trim(); if (n) nomi.add(n) }
    agenti = [...nomi].sort((a, b) => a.localeCompare(b, 'it'))
  }

  return NextResponse.json({ vista: agente ? 'agente' : 'rete', agenti, rimborso })
}
