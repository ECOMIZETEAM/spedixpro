import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { inviaEmailGiacenza } from '@/lib/email'
import { inviaSmsGiacenza } from '@/lib/sms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// AVVISA IL DESTINATARIO CHE HA UN PACCO IN GIACENZA.
//
// Il corriere, quando non consegna, manda al destinatario un link per riprogrammare: nuova data
// oppure ritiro in un punto vicino. Quel link non gli arriva MAI, perche' ai provider passiamo
// l'email di servizio (EMAIL_PER_CORRIERE) e non quella vera — scelta voluta, il provider non deve
// poter contattare il cliente finale del nostro cliente. Il risultato pero' e' che il destinatario
// non sa di avere un pacco fermo, e il pacco resta li' finche' scade e torna indietro: su 387
// giacenze in 30 giorni, 133 non sono mai state svincolate.
//
// Allora avvisiamo noi, sui DUE canali, che i contatti veri li abbiamo.
//
// EMAIL + SMS, non uno solo. L'email arriva a chi ha un indirizzo vero, ma un quarto degli indirizzi
// sono alias di marketplace (marketplace.amazon.it, members.ebay.com): li' l'email la riceve un relay,
// non il destinatario. Il CELLULARE invece c'e' sul 92% delle spedizioni. L'SMS non ci costa nulla:
// lo scala dal credito del titolare che l'ha attivato (sms_consuma), e se non c'e' credito non parte.
//
// DUE PROTEZIONI CONTRO LA RAFFICA, imparate a caro prezzo altrove:
//  - FINESTRA: si guardano solo le giacenze aperte di recente. Senza, al primo giro dopo il rilascio
//    partirebbero email su pacchi fermi da mesi e ormai gia' tornati al mittente.
//  - TETTO per giro: se qualcosa va storto nel rilevamento e le giacenze diventano mille, si manda
//    a scaglioni invece di svuotare la coda in un colpo.
// La colonna `giacenza_email_dest_at` fa da segno: una spedizione avvisata non si riavvisa piu'.
const GIORNI_FINESTRA = 3
const MAX_PER_GIRO = 50

export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  const dal = new Date(Date.now() - GIORNI_FINESTRA * 86400000).toISOString()

  const { data: aperte, error } = await admin
    .from('spedizioni')
    .select('id,numero,master_id,cliente_id,dest_email,dest_nome,mitt_email,mitt_nome,tracking_token,giacenza_motivo,giacenza_stato,corrieri(nome_contratto)')
    .not('giacenza_data', 'is', null)
    .is('giacenza_email_dest_at', null)
    .gte('giacenza_data', dal)
    .limit(MAX_PER_GIRO)

  if (error) {
    console.error('[GIACENZE][AVVISO] lettura fallita:', error.message)
    return NextResponse.json({ error: 'lettura fallita' }, { status: 500 })
  }

  // Preferenza del CLIENTE sulle notifiche al destinatario: e' la stessa che governa l'email di
  // "spedizione creata". Chi l'ha spenta non vuole che scriviamo ai suoi clienti, e vale anche qui.
  const clienti = Array.from(new Set((aperte || []).map((s: any) => s.cliente_id).filter(Boolean)))
  const spente = new Set<string>()
  if (clienti.length) {
    const { data: cls } = await admin.from('clienti').select('id,impostazioni').in('id', clienti)
    for (const c of (cls || [])) {
      if ((c as any)?.impostazioni?.notifica_email_dest === false) spente.add((c as any).id)
    }
  }

  let inviate = 0, saltate = 0, perEmail = 0, perSms = 0
  const problemi: any[] = []
  for (const s of (aperte || [])) {
    // Gia' svincolata fra il rilevamento e adesso: il pacco si e' rimesso in moto da solo, non si
    // avvisa di un problema che non c'e' piu'.
    if (s.giacenza_stato === 'svincolata') { saltate++; continue }
    if (s.cliente_id && spente.has(s.cliente_id)) { saltate++; continue }

    // I due canali sono INDIPENDENTI: si provano sempre entrambi. L'SMS si gatea da solo (preferenza
    // del titolare, cellulare valido, credito) e l'email pure (indirizzo valido, preferenza).
    const sms = await inviaSmsGiacenza(s.id)
    const esito = await inviaEmailGiacenza({
      destEmail: s.dest_email, destNome: s.dest_nome,
      mittEmail: s.mitt_email, mittNome: s.mitt_nome,
      numero: s.numero, corriere: (s as any).corrieri?.nome_contratto || null,
      motivo: s.giacenza_motivo, trackingToken: s.tracking_token,
      masterId: s.master_id,
    })

    // Il segno si mette se ALMENO UNO dei due e' partito: il destinatario e' stato avvisato, e non lo
    // si avvisa due volte. Se non parte NIENTE (nessun contatto valido, gateway giu'), la spedizione
    // resta in coda e il giro dopo ci riprova — finche' resta nella finestra dei 3 giorni.
    if (sms) perSms++
    if (esito.ok) perEmail++
    if (sms || esito.ok) {
      await admin.from('spedizioni').update({ giacenza_email_dest_at: new Date().toISOString() }).eq('id', s.id)
      inviate++
    } else {
      saltate++
      if (esito.error && !/non valida|demo|disattivate/.test(esito.error)) problemi.push({ numero: s.numero, errore: esito.error })
    }
  }

  if (problemi.length) console.error('[GIACENZE][AVVISO] invii non riusciti:', JSON.stringify(problemi))
  return NextResponse.json({ success: true, trovate: (aperte || []).length, inviate, perEmail, perSms, saltate, problemi: problemi.length })
}
