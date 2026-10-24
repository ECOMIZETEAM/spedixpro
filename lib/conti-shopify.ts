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
// 2) Il cliente sta sotto il master dei negozi dell'App Store (MOOVY, variabile
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

export function pagaSoloEtichette(masterIdDelCliente: string | null | undefined): boolean {
  const m = masterDeiNegoziShopify()
  return !!m && !!masterIdDelCliente && masterIdDelCliente === m
}
