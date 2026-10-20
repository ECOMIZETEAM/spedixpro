import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { amazonScambiaCodice, credenzialiAmazon } from '@/lib/amazon'
import { paginaAmazon } from '@/lib/amazon-pagina'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Ritorno da Seller Central dopo che il venditore ha autorizzato l'app: scambia il codice con i
// token e salva l'integrazione del cliente, coi token CIFRATI (lib/cifratura-integrazioni).
//
// Gli esiti tornano alla pagina Integrazioni come CODICI (?amazon=collegato, ?amazon=scaduto…),
// che la pagina traduce in frasi sue: un testo libero preso dall'indirizzo farebbe scrivere a
// chiunque cosa vuole nel riquadro dei messaggi del portale.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const state = url.searchParams.get('state') || ''
  const codice = url.searchParams.get('spapi_oauth_code') || ''
  const sellerId = url.searchParams.get('selling_partner_id') || ''
  const appUrl = process.env.SHOPIFY_APP_URL || url.origin
  // Referrer-Policy no-referrer: Amazon lo chiede sull'indirizzo di ritorno, perche' l'URL porta il
  // codice di autorizzazione e non deve finire nell'intestazione Referer della pagina dopo.
  const vai = (percorso: string) => {
    const r = NextResponse.redirect(`${appUrl}${percorso}`)
    r.headers.set('Referrer-Policy', 'no-referrer')
    return r
  }
  const torna = (esito: string) => vai(`/cliente/integrazioni?amazon=${esito}`)

  if (!state || !codice || !/^[A-Z0-9]{8,20}$/.test(sellerId)) return torna('non_valido')

  const supabase = createAdminSupabase()
  const { data: st } = await supabase.from('shopify_oauth_state').select('*').eq('state', state).maybeSingle()
  if (!st || st.shop !== 'amazon') return torna('non_valido')
  // Lo state vale una volta sola, qualunque cosa succeda dopo.
  await supabase.from('shopify_oauth_state').delete().eq('state', state)
  // Uno state vecchio non vale: il codice di Amazon scade in cinque minuti, e uno state rimasto in
  // tabella e' un giro abbandonato che nessuno deve poter riprendere.
  if (Date.now() - new Date(st.created_at).getTime() > 10 * 60 * 1000) return torna('scaduto')

  // CHI CHIUDE IL GIRO DEV'ESSERE CHI L'HA APERTO. Lo state da solo non basta: chi avvia un
  // collegamento dal proprio portale ottiene il suo state, e potrebbe mandare il link di consenso a
  // un altro venditore — che autorizzando collegherebbe il SUO account Amazon (con i dati dei suoi
  // compratori) al cliente di chi ha mandato il link. Quindi il ritorno vale solo dentro la sessione
  // dello stesso cliente che ha avviato il collegamento (il cookie di sessione e' SameSite=Lax:
  // arriva anche sul rimando da Amazon). Senza, il codice non si scambia nemmeno.
  const sessione = await createServerSupabase()
  const { data: { user } } = await sessione.auth.getUser()
  if (!user) return vai('/cliente?error=amazon_accedi')
  const { data: utente } = await sessione.from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id || String(utente.cliente_id) !== String(st.cliente_id)) {
    // Una sessione c'e', ma e' di un altro account: la pagina di login la rimanderebbe alla sua
    // dashboard senza spiegare niente.
    return paginaAmazon('Collegamento non completato', '<p>Il collegamento con Amazon era stato avviato da un altro account MoovExpress, diverso da quello con cui sei entrato adesso. Per sicurezza non è stato completato: accedi con l\'account del negozio e ricollega da Integrazioni → Amazon.</p><a href="/cliente/integrazioni">Vai alle integrazioni</a>', 403)
  }

  let tokens: { access_token: string; refresh_token: string; expires_in: number }
  try {
    tokens = await amazonScambiaCodice(codice)
  } catch (e: any) {
    console.error('[AMAZON CALLBACK] scambio del codice non riuscito:', e?.message || e)
    return torna('scambio')
  }

  // Un cliente puo' collegare piu' account venditore: ognuno e' una riga, riconosciuta dal suo
  // selling_partner_id (come eBay con lo username). Il nome del negozio Amazon non lo chiediamo:
  // l'operazione che lo darebbe richiede ruoli che questa app non ha.
  const identificativo = `amazon:${sellerId}`
  const { data: esistente } = await supabase.from('integrazioni').select('id, stato, credenziali')
    .eq('cliente_id', st.cliente_id).eq('piattaforma', 'amazon').eq('identificativo', identificativo).maybeSingle()
  // Rinnovo di un collegamento ATTIVO: si tiene il punto della sincronizzazione, cosi' il giro dopo
  // vede gli annulli e le spedizioni del frattempo. Dopo una revoca invece no: chiudendo si sono
  // cancellati gli ordini aperti (cancellaDatiAmazon), e ripartire dal vecchio cursore non li
  // riporterebbe piu' (Amazon ridà solo quelli cambiati). Si riparte da capo: il primo giro
  // reimporta gli ordini da spedire degli ultimi 7 giorni.
  const syncPrecedente = esistente?.stato === 'attivo' ? (esistente?.credenziali as any)?.sync : undefined
  const payload: any = {
    master_id: st.master_id, cliente_id: st.cliente_id, piattaforma: 'amazon',
    nome_negozio: `Amazon · ${sellerId}`,
    identificativo,
    credenziali: credenzialiAmazon({ sellerId, refreshToken: tokens.refresh_token, accessToken: tokens.access_token, expiresIn: tokens.expires_in, syncPrecedente }),
    stato: 'attivo', errore: null,
  }
  const { error } = esistente?.id
    ? await supabase.from('integrazioni').update(payload).eq('id', esistente.id)
    : await supabase.from('integrazioni').insert(payload)
  if (error) return torna('salvataggio')

  return torna(esistente?.id ? 'rinnovato' : 'collegato')
}
