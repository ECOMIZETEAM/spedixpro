import { NextRequest, NextResponse } from 'next/server'

// I GIRI AUTOMATICI (cron) NON SONO ROTTE PUBBLICHE.
//
// I loro percorsi stanno scritti in vercel.json, quindi sono noti a chiunque, e il middleware non
// li copre. Senza guardia bastava un `curl` per far partire a comando la chiusura delle distinte,
// lo storno delle prenotazioni o il giro di tracking — e la risposta raccontava pure quanto era
// stato mosso, su TUTTI i clienti della piattaforma.
//
// Come funziona: se CRON_SECRET e' configurato, si passa SOLO con
//   Authorization: Bearer <CRON_SECRET>
// che e' l'intestazione che Vercel mette da sola sulle chiamate dei suoi cron. Se la variabile non
// c'e', la chiamata passa (altrimenti si spegnerebbero tutti i giri automatici da un momento
// all'altro) ma viene scritto un avviso nei log: e' il promemoria che manca un pezzo di
// configurazione, non un via libera.
export function bloccaCronNonAutorizzato(req: NextRequest): NextResponse | null {
  const atteso = process.env.CRON_SECRET
  if (!atteso) {
    console.warn('[CRON] CRON_SECRET non configurato: questo giro automatico e\' richiamabile da chiunque conosca il percorso.')
    return null
  }
  const auth = req.headers.get('authorization') || ''
  if (auth === 'Bearer ' + atteso) return null
  return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
}
