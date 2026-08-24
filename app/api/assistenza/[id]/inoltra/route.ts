import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// INOLTRA il ticket al MASTER SUPERIORE di chi lo gestisce: il ticket resta UNICO, il master
// superiore entra nella catena (rete_master_ids) e vede tutta la conversazione; i suoi messaggi
// sono SEMPRE interni (visibilita 'rete') e il cliente non saprà mai dell'inoltro.
// Possono inoltrare: l'owner (assistenza diretta) e i master già in catena (escalation a salire).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const mio = utente?.master_id
  const ruolo = (utente?.ruolo || '').toLowerCase()
  // Inoltrare espone la conversazione del cliente al master superiore ed e' IRREVERSIBILE:
  // fuori il portale cliente e l'agente (sola lettura, niente rete - lib/agente.ts).
  if (!mio || ruolo === 'cliente' || utente?.cliente_id || ruolo === 'agente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: t } = await admin.from('tickets')
    .select('id,stato,owner_master_id,aperto_master_id,rete_master_ids,rete_non_letti,spedizione_id')
    .eq('id', id).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Ticket non trovato' }, { status: 404 })
  if (t.stato === 'chiuso') return NextResponse.json({ error: 'Ticket chiuso: non inoltrabile.' }, { status: 400 })

  const rete: string[] = Array.isArray(t.rete_master_ids) ? t.rete_master_ids : []
  const inCatena = mio === t.owner_master_id || rete.includes(mio)
  if (!inCatena) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  // ── CONTRATTO PROPRIO: non si inoltra sopra. Se questo ticket riguarda una spedizione fatta su un
  //    contratto di PROPRIETÀ di chi sta inoltrando (corriere `proprio=true` col suo stesso nome), il
  //    master superiore NON detiene quel contratto e non può farci nulla: l'assistenza si ferma al
  //    proprietario, che se la vede col suo fornitore diretto. (Es.: Quick vende GLS suo a un cliente →
  //    il cliente apre il ticket a Quick, ma Quick non lo inoltra a MULTIEXPRESS.) ──
  if (t.spedizione_id) {
    const { data: sped } = await admin.from('spedizioni').select('corriere_id').eq('id', t.spedizione_id).maybeSingle()
    const corrId = (sped as any)?.corriere_id
    if (corrId) {
      const { data: corr } = await admin.from('corrieri').select('nome_contratto').eq('id', corrId).maybeSingle()
      const nome = (corr as any)?.nome_contratto
      if (nome) {
        const { data: mioProprio } = await admin.from('corrieri').select('id')
          .eq('master_id', mio).eq('nome_contratto', nome).eq('proprio', true).limit(1).maybeSingle()
        if (mioProprio) {
          return NextResponse.json({ error: 'Questa spedizione è su un tuo contratto: il master superiore non lo gestisce, quindi non si inoltra sopra. L\'assistenza la chiudi tu, col tuo fornitore diretto.' }, { status: 400 })
        }
      }
    }
  }

  // Il master superiore di CHI inoltra (escalation a salire, un gradino alla volta).
  const { data: me } = await admin.from('masters').select('id,nome,parent_master_id').eq('id', mio).maybeSingle()
  const padreId = me?.parent_master_id
  if (!padreId) return NextResponse.json({ error: 'Sei al vertice della rete: non c\'è un master superiore a cui inoltrare.' }, { status: 400 })
  if (padreId === t.owner_master_id || rete.includes(padreId) || padreId === t.aperto_master_id) {
    return NextResponse.json({ error: 'Il ticket è già stato inoltrato a quel master.' }, { status: 400 })
  }
  const { data: padre } = await admin.from('masters').select('nome').eq('id', padreId).maybeSingle()

  await admin.from('tickets').update({
    inoltrato_a_master_id: padreId,
    rete_master_ids: [...rete, padreId],
    rete_non_letti: Array.from(new Set([...(t.rete_non_letti || []).filter((x: string) => x !== mio), padreId])),
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  // Traccia dell'inoltro nella chat: INTERNA, il cliente non la vede. L'autore e' il NUOVO PADRE
  // (padreId), non chi inoltra: la traccia rivela il livello superiore, quindi deve stare "in alto"
  // nella catena. Cosi' chi sta SOTTO il forwarder non la vede (regola messaggioVisibileCatena:
  // autore alla posizione p+2 non e' visibile a chi sta a p). Chi inoltra la vede lo stesso (p+1).
  await admin.from('ticket_messaggi').insert({
    ticket_id: id, autore: 'rete', autore_nome: 'Sistema', visibilita: 'rete', autore_master_id: padreId,
    testo: `📤 Ticket inoltrato da ${me?.nome || 'master'} a ${padre?.nome || 'master superiore'}.`,
  })

  return NextResponse.json({ success: true, inoltrato_a: padre?.nome || null })
}
