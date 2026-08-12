// ACCOUNT DEMO — un master di prova che i potenziali clienti usano per "toccare" il gestionale.
// Regola d'oro: in demo NIENTE tocca il mondo reale. Nessuna chiamata a corrieri, Stripe, SMS, email,
// negozi. Ogni operazione esterna è simulata o bloccata. Un master reale ha `demo=false`: le guardie
// qui sotto sono no-op per lui, così il percorso condiviso (1500 spedizioni vere al giorno) è identico.
//
// Come è tenuto sicuro:
//  - il master demo è un ROOT ISOLATO (parent_master_id null): i suoi dati finti vivono nel suo tenant,
//    invisibili ai master reali (RLS) e fuori dai loro report;
//  - ha SOLO corrieri `tipo='interno'`, che non chiamano alcun provider (numero + etichetta locali);
//  - le poche porte davvero esterne (email/SMS alla creazione, Stripe, connessione negozi) sono guardate
//    da qui: `masterEDemo()` nelle librerie, la denylist nel middleware, la scadenza al login/pagine.

import { createAdminSupabase } from '@/lib/supabase-admin'

export const DEMO_GIORNI = 3

// Piccola cache per-istanza: lo stato demo non cambia quasi mai, evita una query a ogni email/SMS.
const cacheDemo = new Map<string, { v: boolean; t: number }>()
const TTL = 60 * 1000

// È demo il master indicato? Usato dalle librerie (email/SMS) che hanno il master_id ma non la sessione.
export async function masterEDemo(masterId?: string | null, admin?: any): Promise<boolean> {
  if (!masterId) return false
  const c = cacheDemo.get(masterId)
  if (c && Date.now() - c.t < TTL) return c.v
  try {
    const db = admin || createAdminSupabase()
    const { data } = await db.from('masters').select('demo').eq('id', masterId).maybeSingle()
    const v = data?.demo === true
    cacheDemo.set(masterId, { v, t: Date.now() })
    return v
  } catch {
    // Nel dubbio, meglio NON bloccare un master reale per un errore di lettura: default false.
    return false
  }
}

// La demo è scaduta? (demo attiva + oltre la data). Vale sia per il login sia per le scritture.
export function demoScaduta(demo?: boolean | null, scadenza?: string | null): boolean {
  return demo === true && !!scadenza && new Date(scadenza).getTime() < Date.now()
}

// Rotte che un master demo NON può chiamare: sono quelle che spenderebbero soldi veri o collegherebbero
// account reali (Stripe, canone, acquisto/gateway SMS, saldi provider, connessione negozi). Prefissi:
// il middleware blocca solo le SCRITTURE con sessione, così le letture (vedere le pagine) restano aperte.
export const DEMO_ROTTE_VIETATE = [
  '/api/stripe/',
  '/api/abbonamento/',
  '/api/sms/acquista',
  '/api/sms/test',
  '/api/sms/test-accredito',
  '/api/sms/autoricarica',
  '/api/portali/',            // saldi/ricariche verso i provider
  '/api/integrazioni/',       // connessione/collegamento negozi (Shopify/Woo/Presta/eBay/…)
  '/api/cliente/ricarica',
  '/api/cliente/paga-carta',
]

export function rottaVietataInDemo(pathname: string): boolean {
  return DEMO_ROTTE_VIETATE.some(p => pathname.startsWith(p))
}

export const MSG_DEMO_AZIONE = 'Modalità demo: questa operazione è simulata e non disponibile nella prova. Con un account reale funziona a tutti gli effetti.'
export const MSG_DEMO_SCADUTA = 'La prova demo è terminata. Contattaci per attivare un account reale.'
