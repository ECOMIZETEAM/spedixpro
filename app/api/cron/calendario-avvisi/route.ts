import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { momentoAvviso, RITARDO_MASSIMO_MIN, ORA_TUTTO_IL_GIORNO } from '@/lib/calendario-avviso'
import { occorrenze, descriviRicorrenza } from '@/lib/calendario-ricorrenza'
import { inviaEmailPromemoria, inviaEmailInvito } from '@/lib/email'
import { masterEDemo } from '@/lib/demo'
import { mandaPush } from '@/lib/notifiche-push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// LE EMAIL DEL CALENDARIO, ogni 5 minuti (25/11/2026; fase 2 lo stesso giorno). Tre lavori:
//  1. l'avviso a chi ha scritto la voce, per le voci singole (avvisato_il) e per ogni occorrenza di quelle che si
//     ripetono (avvisato_occorrenza = l'inizio dell'ultima occorrenza avvisata);
//  2. lo stesso avviso a chi è invitato e non ha detto di no (le stesse due colonne, sulla riga dell'invito);
//  3. l'email «ti hanno invitato», una volta per invito (invito_mandato_il).
// La campanella mostra gli avvisi da sé (/api/notifiche/mie). Qui le email e (fase 3, 26/11) le notifiche sul telefono
// e sul computer (lib/notifiche-push): se la notifica arriva e solo l'email fallisce, l'avviso non si riprova (si
// manderebbe di nuovo la notifica); si riprova solo quando non è arrivato niente.
//
// UN AVVISO SOLO. Ogni riga si segna PRIMA di spedire, con una scrittura che riesce solo se nessun altro giro l'ha già
// presa: due giri sovrapposti non mandano due email. Se l'invio fallisce il segno torna com'era e ci riprova il giro
// dopo. Oltre un'ora di ritardo l'avviso non si manda più: un promemoria scritto oggi per ieri non deve arrivare come
// se fosse urgente (resta nella campanella e nel calendario).
const COL = 'id,utente_id,master_id,tipo,titolo,inizio,fine,tutto_il_giorno,luogo,note,avviso_minuti,collegamento,ricorrenza,eccezioni,fatti,avvisato_occorrenza'

export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  const ora = Date.now()
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://moovexpress.com').replace(/\/$/, '')
  const conti = { guardate: 0, inviate: 0, inviti: 0, notifiche: 0, inRitardo: 0, saltate: 0, errori: 0 }

  // ── chi riceve: email dell'account (gli utenti non l'hanno in tabella), solo se attivo; marchio del master; demo no ──
  const persone = new Map<string, { email: string | null; attivo: boolean; cliente: boolean; nome: string }>()
  const persona = async (id: string) => {
    if (persone.has(id)) return persone.get(id)!
    const [{ data: acc }, { data: p }] = await Promise.all([
      admin.auth.admin.getUserById(id),
      admin.from('utenti').select('attivo,cliente_id,nome,cognome').eq('id', id).maybeSingle(),
    ])
    const v = { email: acc?.user?.email || null, attivo: !(p && (p as any).attivo === false) && !!p, cliente: !!(p as any)?.cliente_id, nome: [(p as any)?.nome, (p as any)?.cognome].filter(Boolean).join(' ').trim() }
    persone.set(id, v)
    return v
  }
  const marchi = new Map<string, { logo: string | null; nome: string | null; demo: boolean }>()
  const marchio = async (masterId: string | null) => {
    if (!masterId) return undefined
    if (marchi.has(masterId)) return marchi.get(masterId)!
    const [{ data: m }, demo] = await Promise.all([
      admin.from('masters').select('logo_url,nome').eq('id', masterId).maybeSingle(),
      masterEDemo(masterId, admin).catch(() => false),
    ])
    const v = { logo: (m as any)?.logo_url || null, nome: (m as any)?.nome || null, demo }
    marchi.set(masterId, v)
    return v
  }
  const scriviQuando = (inizio: Date, tutto: boolean) => {
    const g = inizio.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long' })
    return tutto ? `${g}, tutto il giorno` : `${g} alle ${inizio.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })}`
  }
  const esitoInvio = async (r: { ok: boolean; error?: string }, rilascia: () => Promise<void>) => {
    if (r.ok) return 'ok'
    // indirizzo non valido o inventato da noi (conti nati da Shopify): riprovare non serve, la riga resta segnata
    if (/non valida|destinatario interno/.test(r.error || '')) { conti.saltate++; return 'saltata' }
    conti.errori++
    console.error('[CALENDARIO-AVVISI] email non mandata, riprovo al prossimo giro:', r.error)
    await rilascia()
    return 'errore'
  }

  // l'avviso di UNA occorrenza a UNA persona. `prendi` segna la riga (riesce una volta sola), `rilascia` la rimette.
  const avvisa = async (e: any, quando: Date, destinatario: string, invitato: { organizzatore: string } | null,
    prendi: () => Promise<boolean>, rilascia: () => Promise<void>) => {
    if (!(await prendi())) return
    const p = await persona(destinatario)
    if (!p.attivo) { conti.saltate++; return }
    const m = await marchio(e.master_id)
    if (m?.demo) { conti.saltate++; return }
    const href = p.cliente ? '/cliente/calendario' : '/dashboard/calendario'
    const push = await mandaPush(admin, destinatario, {
      titolo: e.titolo, testo: [scriviQuando(quando, !!e.tutto_il_giorno), e.luogo, invitato ? `invito di ${invitato.organizzatore}` : null].filter(Boolean).join(' · '),
      link: href, chiave: `cal-${e.id}-${quando.toISOString().slice(0, 10)}`,
    }).catch(() => ({ inviate: 0 }))
    if (push.inviate) conti.notifiche++
    if (!p.email) { if (!push.inviate) conti.saltate++; return }
    const r = await inviaEmailPromemoria({
      to: p.email, tipo: e.tipo, titolo: e.titolo, quando: scriviQuando(quando, !!e.tutto_il_giorno),
      ripetizione: e.ricorrenza ? descriviRicorrenza(e.ricorrenza, e.inizio) : null,
      luogo: e.luogo, note: e.note,
      // la spedizione collegata è solo di chi ha scritto la voce
      spedizione: invitato ? null : (e.collegamento?.etichetta || null),
      organizzatore: invitato?.organizzatore || null,
      link: `${base}${href}`,
      brand: m ? { logo: m.logo, nome: m.nome } : undefined,
    })
    // la notifica è arrivata: anche se l'email fallisce non si riprova (si manderebbe di nuovo la notifica)
    if ((await esitoInvio(r, push.inviate ? async () => {} : rilascia)) === 'ok') conti.inviate++
  }

  // l'occorrenza da avvisare ADESSO, se c'è: la più recente col momento dell'avviso passato da meno di un'ora
  const daAvvisare = (e: any) => {
    const occ = occorrenze(e, new Date(ora - 8 * 86400000), new Date(ora + 8 * 86400000), 2000)
    let scelta: { giorno: string; inizio: Date } | null = null
    for (const o of occ) {
      const m = momentoAvviso({ inizio: o.inizio.toISOString(), avviso_minuti: e.avviso_minuti, tutto_il_giorno: e.tutto_il_giorno })
      if (!m || m.getTime() > ora) continue
      if (ora - m.getTime() > RITARDO_MASSIMO_MIN * 60000) { conti.inRitardo++; continue }
      if (!scelta || o.inizio > scelta.inizio) scelta = o
    }
    return scelta
  }

  // ── 1. le voci singole, a chi le ha scritte ──
  const finestra = { da: new Date(ora - (24 + ORA_TUTTO_IL_GIORNO + 1) * 3600000).toISOString(), a: new Date(ora + 7 * 86400000 + 60000).toISOString() }
  const { data: singole, error: e1 } = await admin.from('calendario_eventi').select(COL + ',fatto,avvisato_il')
    .is('eliminato_il', null).is('ricorrenza', null).not('avviso_minuti', 'is', null)
    .gte('inizio', finestra.da).lte('inizio', finestra.a).order('inizio', { ascending: true }).limit(2000)
  if (e1) { console.error('[CALENDARIO-AVVISI] lettura non riuscita:', e1.message); return NextResponse.json({ error: e1.message }, { status: 500 }) }
  const dovuteSingole: { e: any; occ: { giorno: string; inizio: Date } }[] = []
  for (const v of (singole || []) as any[]) {
    conti.guardate++
    const occ = daAvvisare(v)
    if (!occ) continue
    dovuteSingole.push({ e: v, occ })
    if (v.fatto || v.avvisato_il) continue
    await avvisa(v, occ.inizio, v.utente_id, null,
      async () => { const { data } = await admin.from('calendario_eventi').update({ avvisato_il: new Date().toISOString() }).eq('id', v.id).is('avvisato_il', null).select('id').maybeSingle(); return !!data },
      async () => { await admin.from('calendario_eventi').update({ avvisato_il: null }).eq('id', v.id) })
  }

  // ── 1b. le voci che si ripetono, a chi le ha scritte: una volta per occorrenza ──
  const { data: serie, error: e2 } = await admin.from('calendario_eventi').select(COL)
    .is('eliminato_il', null).not('ricorrenza', 'is', null).not('avviso_minuti', 'is', null)
    .lte('inizio', finestra.a).order('inizio', { ascending: true }).limit(2000)
  if (e2) { console.error('[CALENDARIO-AVVISI] serie non lette:', e2.message); return NextResponse.json({ error: e2.message }, { status: 500 }) }
  const dovuteSerie: { e: any; occ: { giorno: string; inizio: Date } }[] = []
  for (const v of (serie || []) as any[]) {
    conti.guardate++
    const occ = daAvvisare(v)
    if (!occ) continue
    dovuteSerie.push({ e: v, occ })
    if ((v.fatti || []).includes(occ.giorno)) continue
    const iso = occ.inizio.toISOString()
    if (v.avvisato_occorrenza && new Date(v.avvisato_occorrenza) >= occ.inizio) continue
    const prima = v.avvisato_occorrenza
    await avvisa(v, occ.inizio, v.utente_id, null,
      async () => {
        const { data } = await admin.from('calendario_eventi').update({ avvisato_occorrenza: iso }).eq('id', v.id)
          .or(`avvisato_occorrenza.is.null,avvisato_occorrenza.lt."${iso}"`).select('id').maybeSingle()
        return !!data
      },
      async () => { await admin.from('calendario_eventi').update({ avvisato_occorrenza: prima }).eq('id', v.id).eq('avvisato_occorrenza', iso) })
  }

  // ── 2. gli stessi avvisi a chi è invitato e non ha detto di no ──
  const dovute = [...dovuteSingole, ...dovuteSerie]
  if (dovute.length) {
    const ids = dovute.map((d) => d.e.id)
    const { data: inv, error: e3 } = await admin.from('calendario_inviti').select('id,evento_id,utente_id,invitato_da,avvisato_il,avvisato_occorrenza')
      .in('evento_id', ids).is('eliminato_il', null).neq('stato', 'rifiutato')
    if (e3) console.error('[CALENDARIO-AVVISI] inviti non letti:', e3.message)
    for (const i of inv || []) {
      const d = dovute.find((x) => x.e.id === i.evento_id)!
      const org = await persona(i.invitato_da)
      const organizzatore = org.nome || 'Lo staff'
      if (!d.e.ricorrenza) {
        if (i.avvisato_il) continue
        await avvisa(d.e, d.occ.inizio, i.utente_id, { organizzatore },
          async () => { const { data } = await admin.from('calendario_inviti').update({ avvisato_il: new Date().toISOString() }).eq('id', i.id).is('avvisato_il', null).select('id').maybeSingle(); return !!data },
          async () => { await admin.from('calendario_inviti').update({ avvisato_il: null }).eq('id', i.id) })
      } else {
        const iso = d.occ.inizio.toISOString()
        if (i.avvisato_occorrenza && new Date(i.avvisato_occorrenza) >= d.occ.inizio) continue
        const prima = i.avvisato_occorrenza
        await avvisa(d.e, d.occ.inizio, i.utente_id, { organizzatore },
          async () => {
            const { data } = await admin.from('calendario_inviti').update({ avvisato_occorrenza: iso }).eq('id', i.id)
              .or(`avvisato_occorrenza.is.null,avvisato_occorrenza.lt."${iso}"`).select('id').maybeSingle()
            return !!data
          },
          async () => { await admin.from('calendario_inviti').update({ avvisato_occorrenza: prima }).eq('id', i.id).eq('avvisato_occorrenza', iso) })
      }
    }
  }

  // ── 3. l'email «ti hanno invitato», una volta per invito (gli inviti degli ultimi 2 giorni ancora senza email) ──
  const { data: nuovi, error: e4 } = await admin.from('calendario_inviti').select('id,evento_id,utente_id,invitato_da')
    .is('eliminato_il', null).is('invito_mandato_il', null).eq('stato', 'in_attesa')
    .gte('creato_il', new Date(ora - 2 * 86400000).toISOString()).order('creato_il', { ascending: true }).limit(500)
  if (e4) console.error('[CALENDARIO-AVVISI] inviti nuovi non letti:', e4.message)
  if (nuovi?.length) {
    const { data: ev } = await admin.from('calendario_eventi').select(COL).in('id', [...new Set(nuovi.map((i: any) => i.evento_id))]).is('eliminato_il', null)
    const per = new Map((ev || []).map((e: any) => [e.id, e]))
    for (const i of nuovi) {
      const e = per.get(i.evento_id)
      // voce tolta, o già tutta passata: l'invito non si manda più (e non si riprova)
      const prossima = e ? occorrenze(e, new Date(ora), new Date(ora + 400 * 86400000), 1)[0] : null
      const { data: presa } = await admin.from('calendario_inviti').update({ invito_mandato_il: new Date().toISOString() }).eq('id', i.id).is('invito_mandato_il', null).select('id').maybeSingle()
      if (!presa) continue
      if (!e || !prossima) { conti.saltate++; continue }
      const p = await persona(i.utente_id)
      if (!p.attivo) { conti.saltate++; continue }
      const m = await marchio(e.master_id)
      if (m?.demo) { conti.saltate++; continue }
      const org = await persona(i.invitato_da)
      const pushInv = await mandaPush(admin, i.utente_id, {
        titolo: `Invito: ${e.titolo}`, testo: `${org.nome || 'Lo staff'} ti ha invitato · ${scriviQuando(prossima.inizio, !!e.tutto_il_giorno)}`,
        link: p.cliente ? '/cliente/calendario' : '/dashboard/calendario', chiave: `inv-${i.id}`,
      }).catch(() => ({ inviate: 0 }))
      if (pushInv.inviate) conti.notifiche++
      if (!p.email) { if (!pushInv.inviate) conti.saltate++; continue }
      const r = await inviaEmailInvito({
        to: p.email, tipo: e.tipo === 'riunione' ? 'riunione' : 'evento', titolo: e.titolo,
        quando: scriviQuando(prossima.inizio, !!e.tutto_il_giorno),
        ripetizione: e.ricorrenza ? descriviRicorrenza(e.ricorrenza, e.inizio) : null,
        luogo: e.luogo, note: e.note, organizzatore: org.nome || 'Lo staff',
        link: `${base}${p.cliente ? '/cliente/calendario' : '/dashboard/calendario'}`,
        brand: m ? { logo: m.logo, nome: m.nome } : undefined,
      })
      if ((await esitoInvio(r, pushInv.inviate ? async () => {} : async () => { await admin.from('calendario_inviti').update({ invito_mandato_il: null }).eq('id', i.id) })) === 'ok') conti.inviti++
    }
  }

  return NextResponse.json({ ok: true, ...conti })
}
