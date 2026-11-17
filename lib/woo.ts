import { COME_SI_COLLEGA_SHOPIFY } from '@/lib/shopify-scheda-app'

// Helper WooCommerce REST API v3 (auth Basic con consumer key/secret).
export function wooHeaders(ck: string, cs: string): Record<string, string> {
  return {
    'Authorization': 'Basic ' + Buffer.from(`${ck}:${cs}`).toString('base64'),
    'Content-Type': 'application/json',
  }
}

export function wooBase(url: string): string {
  return url.replace(/\/+$/, '') + '/wp-json/wc/v3'
}

// L'ERRORE DEL NEGOZIO, LEGGIBILE. Finisce sull'integrazione e sotto il tasto Sincronizza: il testo
// grezzo della risposta, quando il negozio risponde con una pagina web, era codice HTML che nessuno
// capiva.
//
// Caso tipico: la protezione anti-bot di Cloudflare davanti al negozio sfida le richieste che arrivano
// dai server (cf-mitigated: challenge, pagina «Just a moment...»). hard2Buff, 12/11/2026: ordini fermi da
// un giorno, e da un server Vercel di prova la sfida colpiva tutto il sito, con qualunque nome ci si
// presenti. Non si aggira: lo sblocca il negoziante in Cloudflare. Un IP da autorizzare non c'e', le
// funzioni Vercel non ne hanno uno fisso.
// L'errore si porta dietro stato, corpo e se e' Cloudflare: il collegamento (woocommerce/connetti) ci
// riconosce la piattaforma vera del sito (Shopify, PrestaShop, Storeden), che il messaggio leggibile non dice.
export type ErroreWoo = Error & { stato: number; corpo: string; cloudflare: boolean }
function erroreWoo(r: Response, text: string): ErroreWoo {
  const titolo = (text.match(/<title>([^<]*)<\/title>/i)?.[1] || '').trim()
  const cloudflare = r.headers.get('cf-mitigated') === 'challenge' || /^just a moment/i.test(titolo)
  const messaggio = cloudflare
    ? 'Il sito del negozio e\' protetto da Cloudflare, che blocca il nostro server con la verifica anti-bot («Just a moment...»): gli ordini non si possono leggere. Va sbloccato in Cloudflare: Security → Bots → disattiva «Bot Fight Mode», oppure in Security → WAF aggiungi una regola «Skip» per URI Path che inizia con /wp-json/wc/. L\'accesso agli ordini resta protetto dalla chiave API.'
    : /^\s*<(!doctype|html)/i.test(text)
      ? `WooCommerce ${r.status}: il sito ha risposto con una pagina web invece che con i dati${titolo ? ` («${titolo.slice(0, 80)}»)` : ''}. Controlla l'indirizzo del negozio e che le API REST di WooCommerce siano raggiungibili.`
      : `WooCommerce ${r.status}: ${text.slice(0, 200)}`
  return Object.assign(new Error(messaggio), { stato: r.status, corpo: text.slice(0, 20000), cloudflare })
}

export async function wooGet(url: string, ck: string, cs: string, path: string, attesaMs = 20000): Promise<any> {
  const r = await fetch(`${wooBase(url)}${path}`, { headers: wooHeaders(ck, cs), signal: AbortSignal.timeout(attesaMs) })
  const text = await r.text()
  if (!r.ok) throw erroreWoo(r, text)
  try { return JSON.parse(text) } catch { return null }
}

export async function wooPost(url: string, ck: string, cs: string, path: string, body: any): Promise<any> {
  const r = await fetch(`${wooBase(url)}${path}`, { method: 'POST', headers: wooHeaders(ck, cs), body: JSON.stringify(body), signal: AbortSignal.timeout(20000) })
  const text = await r.text()
  if (!r.ok) throw erroreWoo(r, text)
  try { return JSON.parse(text) } catch { return null }
}

export async function wooPut(url: string, ck: string, cs: string, path: string, body: any): Promise<any> {
  const r = await fetch(`${wooBase(url)}${path}`, { method: 'PUT', headers: wooHeaders(ck, cs), body: JSON.stringify(body), signal: AbortSignal.timeout(20000) })
  const text = await r.text()
  if (!r.ok) throw erroreWoo(r, text)
  try { return JSON.parse(text) } catch { return null }
}

// PERCHE' IL COLLEGAMENTO NON RIESCE, detto al cliente (app/api/integrazioni/woocommerce/connetti). Qui e non
// nella rotta: si prova con risposte simulate, senza mandare chiavi finte ai negozi.
export function motivoCollegamentoWoo(e: unknown): string {
  const err = e as Partial<ErroreWoo>
  const corpo = String(err?.corpo || '')
  const stato = Number(err?.stato) || 0
  if (err?.cloudflare) return String(err.message)
  // IL SITO NON È WOOCOMMERCE. L'API risponde con una PAGINA HTML (404/home) invece del JSON: succede
  // quando il negozio è su un'altra piattaforma. Il 404 grezzo ("<!DOCTYPE html>...") non dice niente
  // al cliente — qui riconosciamo la piattaforma vera e lo spieghiamo. (Caso reale: ilpapiroshop.com
  // è Storeden, non WooCommerce — l'errore mostrava l'HTML di una pagina "storeden-404.html".)
  // Si guarda la RISPOSTA intera (err.corpo), non il messaggio: dal 12/11/2026 il messaggio non porta
  // piu' l'HTML, e per cinque giorni questi riconoscimenti non sono scattati.
  if (/storeden/i.test(corpo)) return 'Questo sito è realizzato con Storeden, non con WooCommerce: non ha le API WooCommerce da collegare. Le integrazioni supportano WooCommerce, Shopify e PrestaShop.'
  // Shopify non si collega scrivendo il sito (requisito 2.3.1): la frase sta con la scheda dell'app.
  if (/cdn\.shopify|myshopify|x-shopify/i.test(corpo)) return 'Questo sito sembra Shopify, non WooCommerce: ' + COME_SI_COLLEGA_SHOPIFY
  if (/prestashop/i.test(corpo)) return 'Questo sito sembra PrestaShop, non WooCommerce: collegalo dalla sezione PrestaShop.'
  // CHIAVE RIFIUTATA. Le cause vere, in ordine: codici copiati male o di un'altra chiave; chiave
  // creata con un utente che non e' amministratore o con permesso di sola scrittura (WooCommerce
  // risponde «Non puoi creare una lista delle risorse»: tre negozi collegati cosi' da luglio-agosto,
  // senza mai un ordine); un hosting che toglie l'intestazione con la chiave prima di WordPress.
  if (stato === 401 || stato === 403) {
    const codice = (corpo.match(/"code"\s*:\s*"([^"]+)"/)?.[1] || '')
    if (codice === 'woocommerce_rest_cannot_view') return 'WooCommerce ha riconosciuto la chiave ma non le dà accesso agli ordini. Rifai la chiave scegliendo come «Utente» un amministratore del negozio e come «Permessi» «Leggi/Scrivi». Se la chiave è già così, il tuo hosting probabilmente blocca l\'intestazione «Authorization»: chiedi al tecnico del sito di lasciarla passare a WordPress.'
    return 'WooCommerce ha rifiutato la chiave. Controlla di aver copiato «Chiave Utente» (ck_…) e «Utente nascosto» (cs_…) della stessa chiave, appena creata e non revocata, con «Permessi» «Leggi/Scrivi».'
  }
  if (/<!doctype|<html[\s>]/i.test(corpo)) return 'Questo indirizzo non espone l\'API WooCommerce (risponde con una pagina web, non con i dati). Controlla l\'indirizzo del negozio; se è giusto, in WordPress vai in Impostazioni → Permalink e scegli una struttura diversa da «Semplice».'
  if (/timeout|aborted/i.test(String(err?.message || ''))) return 'Il sito del negozio non ha risposto entro 20 secondi. Controlla l\'indirizzo e riprova: se il sito è lento, riprova tra qualche minuto.'
  return 'Impossibile raggiungere WooCommerce. Verifica l\'indirizzo del negozio e che le API REST siano attive. ' + String(err?.message || '').slice(0, 120)
}
