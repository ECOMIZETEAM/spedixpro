import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { momentoAvviso, RITARDO_MASSIMO_MIN, ORA_TUTTO_IL_GIORNO } from '@/lib/calendario-avviso'
import { inviaEmailPromemoria } from '@/lib/email'
import { masterEDemo } from '@/lib/demo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// GLI AVVISI DEL CALENDARIO PER EMAIL (25/11/2026), ogni 5 minuti. Le voci con un avviso arrivato e non ancora mandato
// (avvisato_il vuoto), non fatte, non eliminate. La campanella le mostra da sé (/api/notifiche/mie): qui solo l'email.
//
// UN AVVISO SOLO. La voce si segna PRIMA di spedire, con una scrittura che riesce solo se nessun altro giro l'ha già
// presa (avvisato_il ancora vuoto): due giri sovrapposti non mandano due email. Se l'invio fallisce il segno si
// toglie e ci riprova il giro dopo. Oltre un'ora di ritardo non si manda più: un promemoria scritto oggi per ieri non
// deve arrivare come se fosse urgente (resta nella campanella e nel calendario).
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  const ora = Date.now()

  // l'indice parziale idx_cal_eventi_da_avvisare regge la finestra; «tutto il giorno» parte dalle 9 di quel giorno,
  // quindi si guarda indietro di un giorno e qualche ora, e avanti fino al massimo anticipo (7 giorni)
  const { data: voci, error } = await admin.from('calendario_eventi')
    .select('id,utente_id,master_id,tipo,titolo,inizio,tutto_il_giorno,luogo,note,avviso_minuti,collegamento')
    .is('eliminato_il', null).is('avvisato_il', null).eq('fatto', false).not('avviso_minuti', 'is', null)
    .gte('inizio', new Date(ora - (24 + ORA_TUTTO_IL_GIORNO + 1) * 3600000).toISOString())
    .lte('inizio', new Date(ora + 7 * 86400000 + 60000).toISOString())
    .order('inizio', { ascending: true }).limit(1000)
  if (error) {
    console.error('[CALENDARIO-AVVISI] lettura non riuscita:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://moovexpress.com').replace(/\/$/, '')
  const marchi = new Map<string, { logo: string | null; nome: string | null; demo: boolean }>()
  let inviate = 0, inRitardo = 0, saltate = 0, errori = 0

  for (const v of voci || []) {
    const quando = momentoAvviso(v)
    if (!quando || quando.getTime() > ora) continue
    if (ora - quando.getTime() > RITARDO_MASSIMO_MIN * 60000) { inRitardo++; continue }

    // la prendo io: riesce solo se nessun altro giro l'ha già segnata
    const { data: presa, error: ePresa } = await admin.from('calendario_eventi')
      .update({ avvisato_il: new Date().toISOString() })
      .eq('id', v.id).is('avvisato_il', null)
      .select('id').maybeSingle()
    if (ePresa) { errori++; console.error('[CALENDARIO-AVVISI] segno non scritto', v.id, ePresa.message); continue }
    if (!presa) continue

    const rilascia = async (motivo: string) => {
      console.error('[CALENDARIO-AVVISI] email non mandata, riprovo al prossimo giro:', v.id, motivo)
      await admin.from('calendario_eventi').update({ avvisato_il: null }).eq('id', v.id)
    }

    // a chi: l'email dell'account (gli utenti non hanno l'email in tabella), solo se l'utente è attivo
    const [{ data: account, error: eAcc }, { data: profilo }] = await Promise.all([
      admin.auth.admin.getUserById(v.utente_id),
      admin.from('utenti').select('attivo,cliente_id').eq('id', v.utente_id).maybeSingle(),
    ])
    if (eAcc) { errori++; await rilascia('account non letto: ' + eAcc.message); continue }
    const email = account?.user?.email
    // utente tolto o spento, o senza email: niente email, e la voce resta segnata (non si riprova all'infinito)
    if (!email || (profilo && (profilo as any).attivo === false)) { saltate++; continue }

    let marchio = v.master_id ? marchi.get(v.master_id) : undefined
    if (v.master_id && !marchio) {
      const [{ data: m }, demo] = await Promise.all([
        admin.from('masters').select('logo_url,nome').eq('id', v.master_id).maybeSingle(),
        masterEDemo(v.master_id, admin).catch(() => false),
      ])
      marchio = { logo: (m as any)?.logo_url || null, nome: (m as any)?.nome || null, demo }
      marchi.set(v.master_id, marchio)
    }
    // master in prova: non si scrive a nessuno di vero
    if (marchio?.demo) { saltate++; continue }

    const inizio = new Date(v.inizio)
    const giorno = inizio.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long' })
    const testoQuando = v.tutto_il_giorno
      ? `${giorno}, tutto il giorno`
      : `${giorno} alle ${inizio.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })}`
    const r = await inviaEmailPromemoria({
      to: email, tipo: v.tipo, titolo: v.titolo, quando: testoQuando,
      luogo: v.luogo, note: v.note, spedizione: (v.collegamento as any)?.etichetta || null,
      link: `${base}${(profilo as any)?.cliente_id ? '/cliente/calendario' : '/dashboard/calendario'}`,
      brand: marchio ? { logo: marchio.logo, nome: marchio.nome } : undefined,
    })
    if (r.ok) inviate++
    // indirizzo non valido o inventato da noi (conti nati da Shopify): riprovare non serve, la voce resta segnata
    else if (/non valida|destinatario interno/.test(r.error || '')) saltate++
    else { errori++; await rilascia(r.error || 'invio non riuscito') }
  }

  return NextResponse.json({ ok: true, guardate: (voci || []).length, inviate, inRitardo, saltate, errori })
}
