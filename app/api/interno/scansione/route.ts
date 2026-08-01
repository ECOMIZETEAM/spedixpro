import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { bloccaAgente } from '@/lib/agente'

// LA SCANSIONE DEL CIRCUITO INTERNO.
//
// Sui contratti dei provider il tracciamento arriva da fuori. Qui il corriere siamo noi: se un
// pacco non viene scansionato, per chi lo aspetta non si e' mosso. Ogni passaggio e' una lettura:
//   ritiro    il pacco lascia il mittente
//   ingresso  entra in deposito
//   partenza  parte per un'altra filiale
//   arrivo    arriva nella filiale di destinazione
//   consegna  e' nelle mani del destinatario
//   tentata   il destinatario non c'era
//   giacenza  resta fermo in deposito
//
// La scansione scrive l'atto, muove lo stato e genera l'evento di tracking in una transazione
// sola (fn_scansione_interna): non deve poter esistere una consegna registrata senza il suo
// evento, ne' un evento senza sapere chi l'ha prodotto.

const TIPI = ['ritiro', 'ingresso', 'partenza', 'arrivo', 'consegna', 'tentata', 'giacenza']

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const _b = bloccaAgente(utente); if (_b) return _b

  const body = await req.json()
  const tipo = String(body?.tipo || '')
  if (!TIPI.includes(tipo)) return NextResponse.json({ error: 'Tipo di scansione non valido' }, { status: 400 })
  const ldv = String(body?.ldv || '').trim()
  if (!ldv) return NextResponse.json({ error: 'Lettera di vettura mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: sped } = await admin.from('spedizioni')
    .select('id,numero,master_id,stato,dest_nome,dest_citta,dest_cap,dest_indirizzo,contrassegno,corrieri(tipo,nome_contratto)')
    .or(`numero.eq.${ldv},tracking_number.eq.${ldv}`).limit(1).maybeSingle()
  if (!sped) return NextResponse.json({ error: 'Lettera di vettura non trovata' }, { status: 404 })

  // Solo pacchi della PROPRIA rete: la ricerca gira sul client amministrativo, che scavalca
  // l'isolamento, quindi l'appartenenza va verificata a mano.
  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const rete = await sottoAlberoMasterIds(admin, utente.master_id)
  if (!rete.includes(sped.master_id)) {
    return NextResponse.json({ error: 'Lettera di vettura non trovata' }, { status: 404 })
  }
  // Solo pacchi che viaggiano sul circuito interno: su un contratto di un provider gli stati li
  // detta il corriere, e sovrascriverli da qui vorrebbe dire raccontare una cosa non vera.
  if ((sped as any).corrieri?.tipo !== 'interno') {
    return NextResponse.json({ error: 'Questa spedizione non viaggia sul circuito interno' }, { status: 400 })
  }

  // L'autista, se indicato, dev'essere dei tuoi.
  let autistaId: string | null = body?.autistaId || null
  if (autistaId) {
    const { data: a } = await admin.from('autisti').select('id').eq('id', autistaId).eq('master_id', utente.master_id).maybeSingle()
    if (!a) autistaId = null
  }

  const operatore = [utente.nome, utente.cognome].filter(Boolean).join(' ').trim() || null
  const { data, error } = await admin.rpc('fn_scansione_interna', {
    p_spedizione_id: sped.id,
    p_tipo: tipo,
    p_master_id: utente.master_id,
    p_autista_id: autistaId,
    p_operatore: operatore,
    p_filiale: String(body?.filiale || '').trim() || null,
    p_note: String(body?.note || '').trim() || null,
    p_created_by: user.id,
  })
  if (error) {
    console.error('[INTERNO][SCANSIONE]', error.message)
    return NextResponse.json({ error: 'Scansione non registrata: riprova.' }, { status: 500 })
  }

  const esito = (data as any)?.esito
  return NextResponse.json({
    ok: esito === 'ok',
    ripetuta: esito === 'ripetuta',
    numero: sped.numero,
    stato: (data as any)?.stato || sped.stato,
    descrizione: (data as any)?.descrizione || null,
    destinatario: sped.dest_nome,
    destinazione: [sped.dest_cap, sped.dest_citta].filter(Boolean).join(' '),
    indirizzo: sped.dest_indirizzo,
    contrassegno: Number(sped.contrassegno || 0),
  })
}
