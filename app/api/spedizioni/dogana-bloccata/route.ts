import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { inviaEmailDoganaFerma } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Rileva le spedizioni INTERNAZIONALI DVA/easyparcel ferme in dogana (nessuna lettera di vettura dopo
// ore) e, UNA VOLTA SOLA, apre un ticket + avvisa il cliente con i documenti che il corriere richiede
// (EORI, contenuto dettagliato pezzo per pezzo con valore, email destinatario). Non tocca DVA (non
// abbiamo l'API per caricare i documenti): l'assistenza li carica sul portale DVA. Motivo della soglia:
// le normali internazionali prendono la LDV in pochi minuti; una TMP- easyparcel estera senza
// tracking_number da oltre qualche ora è quasi certamente "inserita con anomalie" doganali.
// dogana_bloccata_at fa da flag (badge in lista + niente re-invio): si scrive SOLO dopo aver aperto il
// ticket, così un errore lascia la riga ripescabile al giro dopo.
const ORE_SOGLIA = 6
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  const APP = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.moovexpress.com').replace(/\/$/, '')

  // Corrieri easyparcel (pattern del repo: prima gli id, poi .in()).
  const { data: corrEP } = await admin.from('corrieri').select('id').eq('tipo', 'easyparcel')
  const idsEP = (corrEP || []).map((c: any) => c.id)
  if (!idsEP.length) return NextResponse.json({ ok: true, trovate: 0, avvisate: 0 })

  const sogliaISO = new Date(Date.now() - ORE_SOGLIA * 3600 * 1000).toISOString()
  const { data: ferme } = await admin.from('spedizioni')
    .select('id,numero,dest_paese,cliente_id,master_id,created_at')
    .in('corriere_id', idsEP)
    .is('tracking_number', null)
    .like('numero', 'TMP-%')
    .is('dogana_bloccata_at', null)
    .lt('created_at', sogliaISO)
    .not('stato', 'in', '(consegnata,annullata,annullamento_pending,annullamento_manuale,reso_mittente)')
    .order('created_at', { ascending: true })
    .limit(200)

  // Estero = dest_paese != IT (in memoria, robusto a null/maiuscole, come il resto del codice).
  const candidate = (ferme || []).filter((s: any) => String(s.dest_paese || 'IT').toUpperCase() !== 'IT')

  let ticketAperti = 0, emailInviate = 0, marcate = 0
  for (const s of candidate) {
    try {
      let clienteNome = 'Cliente'
      let clienteEmail: string | null = null
      let eoriNoto: string | null = null
      if (s.cliente_id) {
        const { data: cli } = await admin.from('clienti').select('ragione_sociale,email,eori').eq('id', s.cliente_id).maybeSingle()
        clienteNome = cli?.ragione_sociale || 'Cliente'
        clienteEmail = cli?.email || null
        eoriNoto = cli?.eori || null
      }

      const messaggio = `Spedizione ${s.numero} verso ${s.dest_paese} ferma in dogana.\n`
        + `Per sbloccarla il corriere richiede:\n`
        + `- Codice EORI del mittente${eoriNoto ? ' (in anagrafica: ' + eoriNoto + ')' : ''}\n`
        + `- Contenuto dettagliato, articolo per articolo, con il valore di ciascuno\n`
        + `- Email del destinatario\n`
        + `Allega questi dati rispondendo al ticket: verranno inoltrati al corriere per sbloccare la spedizione.`

      // 1) TICKET (durevole): stesso pattern di /api/assistenza/apri, via admin (bypassa RLS).
      const { data: t, error: errT } = await admin.from('tickets').insert({
        oggetto: s.numero,
        messaggio,
        stato: 'aperto',
        categoria: 'ticket',
        non_letto_owner: true,
        owner_master_id: s.master_id,
        cliente_id: s.cliente_id,
        spedizione_id: s.id,
        tipo_apertura: 'cliente',
        aperto_da: clienteNome,
      }).select('id').single()
      let ticketId: string | null = null
      if (errT) console.error('[DOGANA-BLOCCATA][ticket]', s.numero, errT.message)
      if (t?.id) {
        ticketId = t.id
        ticketAperti++
        await admin.from('ticket_messaggi').insert({
          ticket_id: t.id, autore: 'cliente', autore_id: null,
          autore_nome: clienteNome, testo: messaggio, allegati: null,
        })
      }

      // 2) EMAIL al cliente (best-effort; salta se manca o non valida).
      if (clienteEmail && EMAIL_RE.test(clienteEmail)) {
        const link = ticketId ? `${APP}/cliente/assistenza?ticket=${ticketId}` : null
        const esito = await inviaEmailDoganaFerma({ to: clienteEmail, destNome: clienteNome, numero: s.numero, paese: s.dest_paese, masterId: s.master_id, link })
        if (esito.ok) emailInviate++
        else console.error('[DOGANA-BLOCCATA][email]', s.numero, esito.error)
      }

      // 3) Marca SOLO se il ticket è stato creato (badge + niente re-invio). Se il ticket non parte
      //    non la "bruciamo": resta ripescabile al giro dopo.
      if (ticketId) {
        await admin.from('spedizioni').update({ dogana_bloccata_at: new Date().toISOString() }).eq('id', s.id)
        marcate++
      }
    } catch (e: any) {
      console.error('[DOGANA-BLOCCATA]', s.numero, e?.message)
    }
  }
  return NextResponse.json({ ok: true, trovate: candidate.length, ticketAperti, emailInviate, marcate })
}
