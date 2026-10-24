import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// NON E' PIU' UNA PORTA PER COLLEGARE UN NEGOZIO.
//
// Fino al 21/10/2026 da qui partiva l'autorizzazione Shopify per il negozio scritto nell'indirizzo (?shop=),
// e la rotta l'apriva chiunque: senza firma, scriveva uno state per un negozio a piacere col cliente della
// PROPRIA sessione dentro, e rimandava all'indirizzo d'autorizzazione di quel negozio. Bastava farlo approvare
// allo staff di un altro negozio non ancora collegato perche' quel negozio, con ordini e dati dei compratori,
// finisse sul conto di chi aveva preparato il link. E ogni chiamata scriveva una riga: 520 avvii mai conclusi.
//
// Tolto il campo del dominio dalle Integrazioni (Shopify lo vieta, requisito 2.3.1), l'unico avvio legittimo
// e' /enter, che arriva firmato da Shopify per quel negozio e da meno di 90 secondi: l'autorizzazione parte da
// li' (lib/shopifyOAuth.ts). Un link vecchio o scritto a mano qui non scrive niente e torna alla pagina delle
// integrazioni, come amazon/install.
export async function GET(req: NextRequest) {
  return NextResponse.redirect(new URL('/cliente/integrazioni', req.url))
}
