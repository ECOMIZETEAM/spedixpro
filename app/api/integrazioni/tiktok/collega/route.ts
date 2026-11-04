import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { conErrore, conCollegato } from '@/lib/esiti-collegamento'
import { sessioneNelBrowser } from '@/lib/shopifyCollega'
import {
  PAGINA_COLLEGA_TIKTOK, azzeraSospesoTiktok, collegaNegozioTiktok, gettoneModuloTiktok, gettoneModuloTiktokValido,
  sospesoTiktokDelBrowser,
} from '@/lib/tiktokCollega'
import { paginaTiktokAccedi, paginaTiktokConferma, paginaTiktokNonCollegabile, paginaTiktokScaduta } from '@/lib/tiktok-pagina-collega'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// «COLLEGA IL NEGOZIO TIKTOK SHOP AL TUO CONTO»: il seguito di un'installazione dall'App Store di TikTok
// per un negozio che non ha ancora un conto (lib/tiktokCollega.ts). GET serve la pagina, POST il suo unico
// modulo. Chi riceve il negozio lo decide la sessione del browser, con le stesse regole della scelta di
// Shopify (sessioneNelBrowser: solo un conto cliente attivo, di un master che non sia una prova).
// Ogni POST risponde 303: dopo un 307 il browser ripeterebbe il POST sulla pagina d'arrivo.

export async function GET(req: NextRequest) {
  const s = sospesoTiktokDelBrowser(req)
  if (!s) return azzeraSospesoTiktok(paginaTiktokScaduta())
  const sessione = await sessioneNelBrowser(createAdminSupabase(), req)
  if (sessione.tipo === 'cliente') {
    return paginaTiktokConferma({
      negozi: s.negozi, ragioneSociale: sessione.ragioneSociale, codiceCliente: sessione.codiceCliente,
      gettone: gettoneModuloTiktok(s, sessione.clienteId),
    })
  }
  if (sessione.tipo === 'non_collegabile') return paginaTiktokNonCollegabile(sessione.motivo, s.negozi)
  return paginaTiktokAccedi({ negozi: s.negozi })
}

const verso = (req: NextRequest, percorso: string) => NextResponse.redirect(new URL(percorso, req.url), 303)

export async function POST(req: NextRequest) {
  // Il modulo deve venire dalla pagina qui sopra. Un browser che lo dice (Sec-Fetch-Site) deve dire «stesso
  // sito»; in ogni caso decidono il cookie dell'installazione (SameSite=Lax: non parte coi moduli di un altro
  // sito) e il gettone del modulo, legato a questa installazione e a questo cliente.
  const sito = req.headers.get('sec-fetch-site')
  if (sito && sito !== 'same-origin') return verso(req, PAGINA_COLLEGA_TIKTOK)

  const s = sospesoTiktokDelBrowser(req)
  if (!s) return azzeraSospesoTiktok(verso(req, conErrore('/cliente/integrazioni', 'tiktok_scaduto')))

  const form = await req.formData().catch(() => null)
  if (String(form?.get('azione') || '') !== 'conferma') return verso(req, PAGINA_COLLEGA_TIKTOK)

  const admin = createAdminSupabase()
  const sessione = await sessioneNelBrowser(admin, req)
  // Sessione cambiata dopo che la pagina e' stata servita: si torna sulla pagina, che mostra il conto di adesso.
  if (sessione.tipo !== 'cliente' || !gettoneModuloTiktokValido(String(form?.get('gettone') || ''), s, sessione.clienteId)) {
    return verso(req, PAGINA_COLLEGA_TIKTOK)
  }

  const esiti = []
  for (const negozio of s.negozi) esiti.push(await collegaNegozioTiktok(admin, { clienteId: sessione.clienteId, negozio, credenziali: s.credenziali }))
  if (esiti.some(e => e.ok)) return azzeraSospesoTiktok(verso(req, conCollegato('/cliente/integrazioni', 'tiktok')))
  const codice = esiti.some(e => !e.ok && e.codice === 'tiktok_non_salvato') ? 'tiktok_non_salvato' : 'tiktok_altro_account'
  return azzeraSospesoTiktok(verso(req, conErrore('/cliente/integrazioni', codice)))
}
