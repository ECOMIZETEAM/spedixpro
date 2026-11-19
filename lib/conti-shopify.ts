import { eIndirizzoContoShopify } from '@/lib/indirizzi-interni'

// I CONTI DEI NEGOZI SHOPIFY, RICONOSCIUTI IN UN POSTO SOLO.
//
// Piu' parti del portale si fanno le stesse due domande, e devono avere sempre la stessa risposta.
//
// 1) Il conto e' nato dall'installazione dell'app? Il negoziante non ha mai scelto ne' email ne' password:
//    ha un indirizzo nostro (lib/indirizzi-interni) e ci entra solo aprendo l'app da Shopify. Da qui
//    dipendono due regole decise da Lorenzo il 21/10/2026:
//    - aprendo l'app dal menu App di Shopify entrano da soli SOLO questi conti. Un conto che esisteva gia' e
//      ha collegato il negozio con "Ho gia' un account" deve mettere la password: altrimenti chiunque
//      abbia accesso all'admin Shopify di quel negozio entrerebbe nel conto vero, credito compreso;
//    - la schermata del primo accesso (indirizzo di ritiro, telefono, dati fiscali) compare solo a loro.
//      Presa alla lettera, "chi non ha sede o telefono" l'avrebbe mostrata a 136 clienti di oggi, 49 dei
//      quali spediscono tutti i giorni scrivendo il mittente a mano (conteggio del 21/10).
//
// 2) Il cliente e' un negozio dell'app sotto il master dell'App Store (MOOVY, variabile
//    SHOPIFY_ONBOARDING_MASTER_ID)? Quei negozi pagano SOLO etichette e i loro seguiti (rettifiche, resi,
//    giacenze): e' la condizione per l'esenzione dal Billing di Shopify (requisito 1.2, "shipping
//    labels"). Quindi niente SMS a pagamento e niente piani API con carta: sarebbero incassi dell'app
//    fuori da Shopify che l'esenzione non copre (decisione di Lorenzo del 21/10). Gli altri clienti, anche
//    se collegano un negozio Shopify, restano come sono: sono clienti nostri da prima.
//
// Si legge una variabile del server: nei componenti del browser la risposta arriva gia' calcolata dal layout.

// ATTENZIONE: vero per OGNI conto nato da un'installazione, ma l'ingresso automatico vale solo dal negozio da
// cui il conto e' nato (email del conto = emailContoShopify(shop)): lo decide entraNelPortaleDaShopify in
// lib/accesso-cliente.ts. Collegando un secondo negozio allo stesso conto, chi apre l'app da quel negozio NON
// deve entrare da solo (revisione del 21/10/2026). Non usare questa funzione da sola per concedere un ingresso.
export function contoNatoDaShopify(cliente: { email?: string | null } | null | undefined): boolean {
  return eIndirizzoContoShopify(cliente?.email)
}

export function masterDeiNegoziShopify(): string | null {
  const id = String(process.env.SHOPIFY_ONBOARDING_MASTER_ID || '').trim()
  return id || null
}

// Il cliente paga SOLO etichette (punto 2)? Si', se sta sotto MOOVY e USA L'APP: il conto e' nato
// dall'installazione, oppure ha un negozio Shopify collegato.
//
// Fino al 27/10/2026 bastava il master, perche' sotto MOOVY c'erano solo i negozi dell'app. Da quel giorno
// MOOVY e' anche il master di chi si registra dal sito (lib/vetrina.ts), e quei clienti non sono negozi
// dell'app: Lorenzo ha deciso che restano come tutti gli altri, SMS e piani API compresi. Guardando solo
// il master li avremmo chiusi in silenzio.
// Non basta nemmeno l'indirizzo del conto: TEST SHOPIFY, il conto con cui entra il revisore di Shopify,
// ha un'email nostra normale e un negozio collegato, e deve vedere la schermata a sole etichette — e'
// quella che il revisore controlla. Un cliente del sito che collega poi un negozio passa a sole etichette:
// da li' usa l'app sotto il master dell'app, che e' il caso che l'esenzione copre.
//
// null = lettura non riuscita: chi chiama NON apre la cassa. Meglio un acquisto rifiutato una volta che
// un incasso fuori da Shopify.
export async function pagaSoloEtichette(db: any, clienteId: string | null | undefined): Promise<boolean | null> {
  const m = masterDeiNegoziShopify()
  if (!m || !clienteId) return false
  const { data: cli, error } = await db.from('clienti').select('master_id,email').eq('id', clienteId).maybeSingle()
  if (error) return null
  if (!cli || cli.master_id !== m) return false
  if (contoNatoDaShopify(cli)) return true
  const { data: negozi, error: eNeg } = await db.from('integrazioni').select('id')
    .eq('cliente_id', clienteId).eq('piattaforma', 'shopify').limit(1)
  if (eNeg) return null
  return (negozi || []).length > 0
}
