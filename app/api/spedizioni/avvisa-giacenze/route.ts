import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { inviaEmailGiacenza } from '@/lib/email'
import { inviaSmsGiacenza } from '@/lib/sms'
import { spedizioniDaAmazon } from '@/lib/compratore-amazon'

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
//
// LE PIU' RECENTI PER PRIME. Una giacenza che non si puo' avvisare (niente email valida, niente SMS)
// non riceve mai il segno e resta in coda fino alla fine della finestra. Leggendo senza un ordine,
// Postgres le restituiva dalla piu' vecchia: il 26/11/2026, dei 50 posti del giro 42 erano occupati
// da giacenze senza contatti, ogni ora le stesse, mentre dietro aspettavano 274 giacenze con l'email.
// Risultato: l'avviso arrivava 16-69 ore dopo l'apertura (media per giorno, 17-26/11) e chi non
// rientrava nelle 72 ore non lo riceveva affatto. Dalla piu' recente, quelle senza contatti
// scivolano in fondo da sole e un pacco appena fermo si avvisa al primo giro.
const GIORNI_FINESTRA = 3
const MAX_PER_GIRO = 50

export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  const dal = new Date(Date.now() - GIORNI_FINESTRA * 86400000).toISOString()

  // Si legge piu' del tetto perche' gli ordini del collegamento Amazon si scartano dopo (al compratore
  // scrive solo Amazon, lib/compratore-amazon): non avvisati restano in coda, e senza margine
  // finirebbero per occupare i posti del giro.
  // UN AVVISO PER PACCO, DALLA RIGA DEL CLIENTE. Un condiviso ha una riga per ogni venditore della fila (le gambe dei
  // conti d'ingrosso), tutte in giacenza insieme: avvisando ogni riga, il destinatario riceveva un avviso per livello,
  // quelli delle gambe col numero interno della gamba («…-216b3342») e il marchio del venditore. 466 avvisi da gambe
  // su 340 pacchi in 7 giorni (21/11/2026). Dal 20/11 la giacenza arriva anche sulla riga del cliente (138 pacchi su 138
  // nelle 24 ore), quindi l'avviso parte da li', una volta sola; e le gambe non occupano piu' posti nella coda.
  const { data: ledger, error: errLedger } = await admin.from('clienti').select('id').eq('ledger', true)
  if (errLedger) {
    console.error('[GIACENZE][AVVISO] conti d\'ingrosso non letti:', errLedger.message)
    return NextResponse.json({ error: 'lettura fallita' }, { status: 500 })
  }
  const idLedger = (ledger || []).map((c: any) => c.id)
  // any: con i filtri concatenati il tipo di supabase-js supera la profondita' che TypeScript accetta (TS2589).
  let q: any = admin
    .from('spedizioni')
    .select('id,numero,master_id,cliente_id,dest_email,dest_nome,mitt_email,mitt_nome,tracking_token,giacenza_motivo,giacenza_stato,corrieri(nome_contratto)')
    .not('giacenza_data', 'is', null)
    .is('giacenza_email_dest_at', null)
    .gte('giacenza_data', dal)
  if (idLedger.length) q = q.or(`cliente_id.is.null,cliente_id.not.in.(${idLedger.join(',')})`)
  // SOLO GIACENZE ANCORA APERTE. Quando il pacco viene consegnato o torna al mittente il database chiude la giacenza
  // da solo (chiudi_giacenza_su_stato_terminale: 'chiusa'), e qui si saltava solo la svincolata: un pacco consegnato
  // nel frattempo riceveva «il tuo pacco e' in giacenza» a cose fatte. Il 21/11/2026, su 540 righe in coda, 111 avevano
  // la giacenza chiusa (96 consegnate, 5 rese) e 100 erano svincolate. Si tolgono gia' dalla lettura, come le gambe:
  // altrimenti restano in coda fino alla fine della finestra e occupano i posti del giro.
  q = q.or('giacenza_stato.is.null,giacenza_stato.not.in.(svincolata,chiusa)').not('stato', 'in', '(consegnata,reso_mittente,annullata)')
  const { data: lette, error } = await q.order('giacenza_data', { ascending: false }).limit(MAX_PER_GIRO * 4)

  if (error) {
    console.error('[GIACENZE][AVVISO] lettura fallita:', error.message)
    return NextResponse.json({ error: 'lettura fallita' }, { status: 500 })
  }
  let daAmazon: Set<string>
  try { daAmazon = await spedizioniDaAmazon(admin, (lette || []).map((s: any) => s.id)) }
  catch (e: any) {
    console.error('[GIACENZE][AVVISO] controllo ordini Amazon fallito:', e?.message)
    return NextResponse.json({ error: 'controllo ordini Amazon fallito' }, { status: 500 })
  }
  const nonAmazon = (lette || []).filter((s: any) => !daAmazon.has(s.id))

  // Preferenze del CLIENTE sulle notifiche al destinatario.
  //  - notifica_email_dest spenta: non vuole che scriviamo ai suoi clienti, ne' email ne' SMS. E' la
  //    stessa che governa l'email di "spedizione creata".
  //  - email_giacenze = 'no': niente email di giacenza (l'SMS resta governato da notifica_sms). Si
  //    sceglieva nelle impostazioni ma nessuno la leggeva. Vale solo il 'no' scelto: chi non l'ha mai
  //    toccata riceve quello che riceveva prima.
  // Si leggono PRIMA del tetto: le spedizioni di chi ha spento tutto non si avvisano mai, e prese nei
  // 50 posti li occupavano a vuoto a ogni giro, come quelle senza contatti.
  // Se la lettura fallisce ci si ferma: proseguire con l'elenco vuoto vorrebbe dire scrivere proprio
  // ai destinatari di chi ha chiesto di non farlo.
  const clienti = Array.from(new Set(nonAmazon.map((s: any) => s.cliente_id).filter(Boolean)))
  const spente = new Set<string>()
  const senzaEmailGiacenze = new Set<string>()
  if (clienti.length) {
    const { data: cls, error: errCli } = await admin.from('clienti').select('id,impostazioni').in('id', clienti)
    if (errCli) {
      console.error('[GIACENZE][AVVISO] impostazioni dei clienti non lette:', errCli.message)
      return NextResponse.json({ error: 'lettura fallita' }, { status: 500 })
    }
    for (const c of (cls || [])) {
      const imp = (c as any)?.impostazioni || {}
      if (imp.notifica_email_dest === false) spente.add((c as any).id)
      if (imp.email_giacenze === 'no') senzaEmailGiacenze.add((c as any).id)
    }
  }
  const escluseSpente = nonAmazon.filter((s: any) => s.cliente_id && spente.has(s.cliente_id)).length
  const aperte = nonAmazon.filter((s: any) => !(s.cliente_id && spente.has(s.cliente_id))).slice(0, MAX_PER_GIRO)

  let inviate = 0, saltate = 0, perEmail = 0, perSms = 0
  const problemi: any[] = []
  for (const s of (aperte || [])) {
    // Gia' svincolata fra il rilevamento e adesso: il pacco si e' rimesso in moto da solo, non si
    // avvisa di un problema che non c'e' piu'.
    if (s.giacenza_stato === 'svincolata') { saltate++; continue }

    // I due canali sono INDIPENDENTI: si provano sempre entrambi. L'SMS si gatea da solo (preferenza
    // del titolare, cellulare valido, credito) e l'email pure (indirizzo valido, preferenza).
    const sms = await inviaSmsGiacenza(s.id)
    const esito = await inviaEmailGiacenza({
      destEmail: s.dest_email, destNome: s.dest_nome,
      mittEmail: s.mitt_email, mittNome: s.mitt_nome,
      numero: s.numero, corriere: (s as any).corrieri?.nome_contratto || null,
      motivo: s.giacenza_motivo, trackingToken: s.tracking_token, spedizioneId: s.id,
      masterId: s.master_id,
      notificaDest: !(s.cliente_id && senzaEmailGiacenze.has(s.cliente_id)),
    })

    // Il segno si mette se ALMENO UNO dei due e' partito: il destinatario e' stato avvisato, e non lo
    // si avvisa due volte. Se non parte NIENTE (nessun contatto valido, gateway giu'), la spedizione
    // resta in coda e il giro dopo ci riprova — finche' resta nella finestra dei 3 giorni.
    if (sms) perSms++
    if (esito.ok) perEmail++
    if (sms || esito.ok) {
      // Un segno non scritto fa ripartire l'avviso al giro dopo: al destinatario ne arriva un secondo.
      const { error: errSegno } = await admin.from('spedizioni').update({ giacenza_email_dest_at: new Date().toISOString() }).eq('id', s.id)
      if (errSegno) console.error('[GIACENZE][AVVISO] avviso partito ma segno non scritto, al giro dopo riparte:', s.numero, errSegno.message)
      inviate++
    } else {
      saltate++
      if (esito.error && !/non valida|demo|disattivate/.test(esito.error)) problemi.push({ numero: s.numero, errore: esito.error })
    }
  }

  if (problemi.length) console.error('[GIACENZE][AVVISO] invii non riusciti:', JSON.stringify(problemi))
  return NextResponse.json({ success: true, trovate: (aperte || []).length, inviate, perEmail, perSms, saltate, escluseSpente, problemi: problemi.length })
}
