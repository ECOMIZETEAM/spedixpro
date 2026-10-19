import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// GLI ORDINI DEI NEGOZI ARRIVANO DA SOLI.
//
// Prima non arrivavano: entravano SOLO quando un cliente apriva la pagina e premeva Sincronizza.
// Nessun lavoro pianificato andava a guardare, per nessuna delle piattaforme. Chi non premeva si
// ritrovava gli ordini fermi sul negozio — e il cliente non ha motivo di sospettare che debba
// premere qualcosa perche' arrivi la roba che ha gia' venduto.
//
// A ROTAZIONE, NON TUTTE INSIEME. Sincronizzarle tutte in un colpo sfonderebbe il tempo massimo
// della funzione e il giro morirebbe a meta', sempre sulle stesse. Si prendono le piu' TRASCURATE
// (ultimo_sync piu' vecchio, e per prime quelle che non ne hanno mai avuto uno) e si fa un lotto.
//
// QUATTRO ALLA VOLTA, CON UN TEMPO PER PARTIRE. Erano quindici per giro, una dopo l'altra: con le
// integrazioni attive salite a 189 un negozio ripassava ogni due ore (19/10/2026), e un giro finiva
// comunque in un minuto o poco piu' su cinque disponibili. Ora il lotto e' piu' largo, ne girano quattro
// insieme (sempre negozi diversi: ognuno riceve le chiamate di una sync, solo piu' spesso, come era
// pensato quando bastava mezz'ora per vederli tutti) e dopo TEMPO_PER_PARTIRE non se ne
// avviano altre — quelle rimaste restano le piu' trascurate e aprono il giro dopo. Il margine fino ai
// trecento secondi e' per la sync piu' lenta partita per ultima.
//
// FINESTRA CORTA. Il tasto in pagina guarda trenta giorni perche' lo si preme una volta; qui si
// passa ogni dieci minuti, e sette giorni sono gia' un margine larghissimo — coprono anche un
// fermo di qualche giorno. Guardarne trenta a ogni giro moltiplicherebbe per dieci le chiamate ai
// negozi senza trovare un ordine in piu'.
const LOTTO = 60
const INSIEME = 4
const TEMPO_PER_PARTIRE_MS = 170000
const GIORNI = 7

export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()

  const { data: integr } = await admin.from('integrazioni')
    // master_id ci vuole: le librerie lo scrivono sulle righe degli ordini. Senza, ogni ordine importato
    // dal cron nasceva con master_id vuoto (19/10/2026: 21 mila righe su 58 mila, tutte le piattaforme),
    // e la scrittura a blocchi lo azzererebbe anche sulle righe che lo hanno.
    .select('id,piattaforma,nome_negozio,cliente_id,master_id,credenziali,identificativo,stato,ultimo_sync')
    .eq('stato', 'attivo')
    .order('ultimo_sync', { ascending: true, nullsFirst: true })
    .limit(LOTTO)

  // Giorni ITALIANI, non UTC: tra mezzanotte e le due il giorno UTC e' ancora ieri, e i negozi che
  // contano le date nell'ora del negozio (PrestaShop) non davano gli ordini della notte. Per chi passa
  // da rangeGiorniISO (eBay, Woo) non cambia niente: la fine della finestra e' comunque "adesso".
  const giornoRoma = (ms: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date(ms))
  const dal = giornoRoma(Date.now() - GIORNI * 86400000)
  const al = giornoRoma(Date.now())

  let fatte = 0, importati = 0
  const falliti: { negozio: string; errore: string }[] = []
  const avvio = Date.now()

  const sincronizza = async (it: any) => {
    try {
      let res: { letti: number; importati: number } | null = null
      switch (it.piattaforma) {
        case 'ebay': {
          const { sincronizzaOrdiniEbay } = await import('@/lib/ebaySync')
          res = await sincronizzaOrdiniEbay(admin, it, { dal, al }); break
        }
        case 'woocommerce': {
          const { sincronizzaOrdiniWoo } = await import('@/lib/wooSync')
          res = await sincronizzaOrdiniWoo(admin, it, { dal, al }); break
        }
        case 'prestashop': {
          const { sincronizzaOrdiniPrestashop } = await import('@/lib/prestashopSync')
          res = await sincronizzaOrdiniPrestashop(admin, it, { dal, al }); break
        }
        case 'shopify': {
          // Shopify non prende una finestra: si porta la sua, decisa dentro la libreria.
          const { sincronizzaOrdiniShopify } = await import('@/lib/shopifySync')
          res = await sincronizzaOrdiniShopify(admin, it); break
        }
        case 'tiktok': {
          // Mancava: gli ordini TikTok non venivano importati da soli (solo sync manuale).
          const { sincronizzaOrdiniTiktok } = await import('@/lib/tiktokSync')
          res = await sincronizzaOrdiniTiktok(admin, it); break
        }
        case 'temu': {
          const { sincronizzaOrdiniTemu } = await import('@/lib/temuSync')
          res = await sincronizzaOrdiniTemu(admin, it); break
        }
        default:
          // Piattaforma senza sincronizzazione automatica (o non piu' usata): si marca come vista,
          // altrimenti resterebbe sempre in cima alla lista dei trascurati e ruberebbe il posto
          // a un negozio vero a ogni giro.
          await admin.from('integrazioni').update({ ultimo_sync: new Date().toISOString() }).eq('id', it.id)
          return
      }
      fatte++
      importati += Number(res?.importati || 0)
    } catch (e: any) {
      // UN NEGOZIO ROTTO NON DEVE FERMARE GLI ALTRI, e nemmeno bloccare la rotazione: si scrive
      // l'errore E si timbra comunque il passaggio. Senza il timbro, un negozio con le credenziali
      // scadute tornerebbe primo a ogni giro e gli altri non arriverebbero mai.
      falliti.push({ negozio: it.nome_negozio || it.id, errore: String(e?.message || e).slice(0, 200) })
      await admin.from('integrazioni')
        .update({ ultimo_sync: new Date().toISOString(), errore: String(e?.message || e).slice(0, 500) })
        .eq('id', it.id)
    }
  }

  const coda = [...(integr || [])]
  let avviate = 0
  await Promise.all(Array.from({ length: INSIEME }, async () => {
    while (coda.length && Date.now() - avvio < TEMPO_PER_PARTIRE_MS) { avviate++; await sincronizza(coda.shift()) }
  }))

  return NextResponse.json({ esaminate: avviate, nel_lotto: (integr || []).length, fatte, importati, falliti, secondi: Math.round((Date.now() - avvio) / 1000), finestra: { dal, al } })
}
