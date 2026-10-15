import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { vedeLaRete } from '@/lib/ruoli'
import { isAgente } from '@/lib/agente'
import { siglaContratto } from '@/lib/corriere-logo'

export async function GET() {
  const _t0 = Date.now()
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  // Elenco dei contratti del master: serve alle pagine del portale master. Cliente e autista non ne
  // usano nessuna, e la risposta portava il `tipo` grezzo, cioe' il nome del fornitore tecnico.
  if (!vedeLaRete(utente)) return NextResponse.json([])
  // L'agente lo usa nelle tendine dei report e dell'elenco, dove conta solo il nome del contratto:
  // il fornitore tecnico gli arriva come sigla neutra, come al cliente. Lo staff del master lo tiene,
  // perche' la pagina Corrieri ci apre le credenziali delle sue integrazioni.
  const sigla = isAgente(utente)
  const { data } = await supabase.from('corrieri')
    .select('id,nome_contratto,tipo,multicollo,inserimento_ritiri,settings,attivo,livello,proprio')
    .eq('master_id', utente?.master_id)
    .order('nome_contratto')
  // Contratti messi in pausa da un master SOPRA: il master li VEDE comunque qui, marcati
  // `sospeso_sopra`, ma non li puo' riattivare (lo sblocco tocca a chi li ha fermati — segue la
  // gerarchia). contrattiSospesiSopra guarda solo gli ANTENATI, non il proprio livello (quello e' `attivo`).
  const { contrattiSospesiSopra, sospesoDallaCatena } = await import('@/lib/contratti-catena')
  const sospesi = await contrattiSospesiSopra(utente?.master_id)
  const _ms = Date.now() - _t0
  if (_ms > 300) console.log('[CORRIERI][TEMPI]', _ms + 'ms', 'istanza=' + Math.round(process.uptime()) + 's', 'contratti=' + (data || []).length)
  return NextResponse.json((data || []).map((c: any) => ({
    ...c,
    ...(sigla ? { tipo: siglaContratto(c.tipo) } : {}),
    sospeso_sopra: sospesoDallaCatena(c.nome_contratto, sospesi),
  })))
}
