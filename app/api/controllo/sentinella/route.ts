import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { createServerSupabase } from '@/lib/supabase'
import { gestisceLaRete } from '@/lib/ruoli'
import { inviaControlloGiornaliero } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// LA SENTINELLA — una mail al giorno che dice se tutto ha lavorato.
//
// Perche' esiste: il 21/08/2026 la sessione OneTracking del server e' morta e il recupero delle
// ripesature si e' fermato il 31/08. Nessuno se n'e' accorto fino all'11/09, perche' non andava in
// errore NIENTE: semplicemente non succedeva piu' nulla, e il silenzio non suona.
//
// Quindi i controlli guardano la FRESCHEZZA ("in queste ore si e' mosso qualcosa?") oltre ai buchi
// gia' visti una volta. Le domande stanno nel database (`controllo_giornaliero`), qui si formatta e
// si manda. La mail parte ANCHE quando e' tutto verde, di proposito: una sentinella che scrive solo
// quando c'e' un problema non si distingue da una morta.
const DESTINATARIO_DI_RIPIEGO = 'info@moovexpress.com'

async function autorizzato(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization') || ''
  if (process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET) return true
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!gestisceLaRete(u as any)) return false
  const { data: m } = await supabase.from('masters').select('is_super_master').eq('id', u!.master_id).maybeSingle()
  return !!(m as any)?.is_super_master
}

export async function GET(req: NextRequest) {
  const inizio = Date.now()
  if (!(await autorizzato(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const admin = createAdminSupabase()

  // Le parti vanno una dopo l'altra: il database ferma ogni chiamata dopo 8 secondi, e tutta insieme la
  // Sentinella li ha sforati (dal 14/10, poi il 10 e 11/11). Se una parte salta, l'email parte lo
  // stesso con le altre e con una riga che dice quale manca: un'email che non arriva non si nota.
  const righe: any[] = []
  // La terza parte e' la sicurezza: il giro degli allarmi (/api/controllo/allarmi) e' vivo, la verifica
  // in due passaggi e' accesa nel database.
  // La quarta e' pesi e resi (22/11/2026). Pesi: le multicollo Spedisci dal portale salvavano come peso
  // reale quello del PRIMO collo (4.418 spedizioni, riallineate il 22/11): ora si guarda ogni giorno che
  // peso reale = somma dei colli, e che nessuna sia fatturata sotto il peso reale. Resi: un reso che il
  // fornitore ci fa pagare e che il cliente non paga e' una perdita che non lascia errori, quindi si
  // guarda la coda degli addebiti, i resi senza addebito, i resi fatturati su pacchi non a reso e il
  // titolare pagato due volte.
  // La parte 5 del database sono i contratti staccati (26/11/2026, scripts/sentinella-contratti-staccati.sql):
  // nessuna spedizione nuova su un contratto staccato, nessuno riacceso, nessun doppio attivo per nome, e quanti
  // pacchi e addebiti dopo la partenza girano ancora su di loro.
  // La parte 6 del database sono le zone lungo la catena d'acquisto (26/11/2026, scripts/zone-catena-trigger.sql): nessun contratto
  // comprato con zone diverse dal suo fornitore, e gli 8 trigger che le tengono uguali tutti accesi.
  for (const [n, funzione] of [[1, 'controllo_giornaliero_1'], [2, 'controllo_giornaliero_2'], [3, 'controllo_giornaliero_3'], [4, 'controllo_giornaliero_4'], [5, 'controllo_giornaliero_5'], [6, 'controllo_giornaliero_6']] as const) {
    const { data, error } = await admin.rpc(funzione)
    if (error || !data) {
      console.error('[SENTINELLA] controllo non eseguito:', funzione, error?.message)
      righe.push({ area: 'sentinella', controllo: `parte ${n} dei controlli NON eseguita (${error?.message || 'nessuna risposta'})`, valore: 0, atteso: 'eseguita', allarme: true })
    } else {
      righe.push(...(data as any[]))
    }
  }
  // La quinta e' l'annullo delle SDA EXPRESS L (25/11/2026): annullate subito alla richiesta, riaddebitate
  // se partono lo stesso. Sta nel codice (lib/annullo-poste) perche' la decisione "e' partito" legge il
  // testo degli eventi Poste, e la regola dev'essere la stessa della sorveglianza che riaddebita.
  try {
    const { controlloAnnulliPoste } = await import('@/lib/annullo-poste')
    righe.push(...await controlloAnnulliPoste(admin))
  } catch (e: any) {
    console.error('[SENTINELLA] controllo annulli SDA EXPRESS L non eseguito:', e?.message)
    righe.push({ area: 'sentinella', controllo: `controllo annulli SDA EXPRESS L NON eseguito (${e?.message || 'errore'})`, valore: 0, atteso: 'eseguito', allarme: true })
  }
  // Gli annulli dei pacchi venduti fra reti (26/11/2026): righe rimaste addebitate sotto un detentore annullato,
  // code manuali senza detentore, ripristini rifiutati. Sta in lib/annullo-pacco, vicino alla regola che controlla.
  try {
    const { controlloAnnulliPacco } = await import('@/lib/annullo-pacco')
    righe.push(...await controlloAnnulliPacco(admin))
  } catch (e: any) {
    console.error('[SENTINELLA] controllo annulli dei pacchi fra reti non eseguito:', e?.message)
    righe.push({ area: 'sentinella', controllo: `controllo annulli dei pacchi fra reti NON eseguito (${e?.message || 'errore'})`, valore: 0, atteso: 'eseguito', allarme: true })
  }
  // La sesta e' il margine di MULTIEXPRESS pacco per pacco del giorno prima (26/11/2026): le guardie fermano le
  // destinazioni speciali, ma un rincaro del corriere sulle zone normali (BRT Express isole, 19/11) lo si vedeva
  // solo misurando a mano. Sta nel codice perche' il motivo lo deve dire la stessa catena che fa gli addebiti.
  // Ha una scadenza sua, calcolata su tutta la rotta (maxDuration 120 s, ~15 s per comporre e mandare la mail): se
  // Vercel chiudesse la funzione per tempo non partirebbe nessuna mail, nemmeno con le altre parti.
  try {
    const { controlloPerditeMulti } = await import('@/lib/controllo-perdite-multi')
    const restano = 105_000 - (Date.now() - inizio)
    const misura = controlloPerditeMulti(admin, { tempoMaxMs: Math.max(5_000, restano - 25_000) })
    misura.catch(() => {})   // se scade prima, un errore arrivato dopo non deve restare senza gestore
    const esito = await Promise.race([misura, new Promise<null>(r => setTimeout(() => r(null), Math.max(1_000, restano)))])
    if (esito) righe.push(...esito)
    else righe.push({ area: 'sentinella', controllo: 'controllo margine MULTIEXPRESS NON completato in tempo (la Sentinella ha due minuti)', valore: 0, atteso: 'eseguito', allarme: true })
  } catch (e: any) {
    console.error('[SENTINELLA] controllo margine MULTIEXPRESS non eseguito:', e?.message)
    righe.push({ area: 'sentinella', controllo: `controllo margine MULTIEXPRESS NON eseguito (${e?.message || 'errore'})`, valore: 0, atteso: 'eseguito', allarme: true })
  }
  if (righe.every(r => r.area === 'sentinella')) {
    // Se non riesco nemmeno a fare le domande, quello E' l'allarme: si dice, non si tace.
    return NextResponse.json({ error: 'Controllo non eseguito' }, { status: 500 })
  }

  const esiti = (righe as any[]).map(r => ({
    area: String(r.area), controllo: String(r.controllo),
    valore: Number(r.valore) || 0, atteso: String(r.atteso), allarme: !!r.allarme,
  }))
  const allarmi = esiti.filter(e => e.allarme)

  // Il destinatario e' quello configurato per gli avvisi (Statistiche › Rettifiche automatiche).
  const { data: sess } = await admin.from('onetracking_sessione').select('email_alert').eq('id', 1).maybeSingle()
  const to = (sess as any)?.email_alert || DESTINATARIO_DI_RIPIEGO
  // Solo dal lavoro pianificato: aprendo la pagina a mano si guarda, non si spamma.
  const mandaMail = req.nextUrl.searchParams.get('mail') !== 'no'
  const inviata = mandaMail ? await inviaControlloGiornaliero(to, esiti) : { ok: false }

  return NextResponse.json({
    ok: true,
    quando: new Date().toISOString(),
    allarmi: allarmi.length,
    mailInviata: inviata.ok, destinatario: mandaMail ? to : null,
    esiti,
  })
}
