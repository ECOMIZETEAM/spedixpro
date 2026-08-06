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
// A ROTAZIONE, NON TUTTE INSIEME. Le integrazioni attive sono settantasei: sincronizzarle tutte in
// un colpo sfonderebbe il tempo massimo della funzione e il giro morirebbe a meta', sempre sulle
// stesse. Si prendono le piu' TRASCURATE (ultimo_sync piu' vecchio, e per prime quelle che non ne
// hanno mai avuto uno) e si fa un lotto: in poco piu' di mezz'ora il giro le ha viste tutte.
//
// FINESTRA CORTA. Il tasto in pagina guarda trenta giorni perche' lo si preme una volta; qui si
// passa ogni dieci minuti, e sette giorni sono gia' un margine larghissimo — coprono anche un
// fermo di qualche giorno. Guardarne trenta a ogni giro moltiplicherebbe per dieci le chiamate ai
// negozi senza trovare un ordine in piu'.
const LOTTO = 15
const GIORNI = 7

export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()

  const { data: integr } = await admin.from('integrazioni')
    .select('id,piattaforma,nome_negozio,cliente_id,credenziali,identificativo,stato,ultimo_sync')
    .eq('stato', 'attivo')
    .order('ultimo_sync', { ascending: true, nullsFirst: true })
    .limit(LOTTO)

  const dal = new Date(Date.now() - GIORNI * 86400000).toISOString().slice(0, 10)
  const al = new Date().toISOString().slice(0, 10)

  let fatte = 0, importati = 0
  const falliti: { negozio: string; errore: string }[] = []

  for (const it of (integr || [])) {
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
        default:
          // Piattaforma senza sincronizzazione automatica (o non piu' usata): si marca come vista,
          // altrimenti resterebbe sempre in cima alla lista dei trascurati e ruberebbe il posto
          // a un negozio vero a ogni giro.
          await admin.from('integrazioni').update({ ultimo_sync: new Date().toISOString() }).eq('id', it.id)
          continue
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

  return NextResponse.json({ esaminate: (integr || []).length, fatte, importati, falliti, finestra: { dal, al } })
}
