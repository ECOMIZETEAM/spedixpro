import { createServerSupabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import ClienteShell from './ClienteShell'
import BannerPiano from '../components/BannerPiano'
import AvvisoApi from './AvvisoApi'
import EsitoCollegamento from './EsitoCollegamento'
import { DialogProvider } from '../components/DialogProvider'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { pagaSoloEtichette, masterDeiNegoziShopify } from '@/lib/conti-shopify'
import { recapitoEmail } from '@/lib/indirizzi-interni'
import { COLONNE_DATI_NEGOZIO, datiPerLaSchermata, servonoDatiNegozio, versioneDatiNegozio } from '@/lib/dati-negozio'

// Mai in cache: dipende dalla sessione (senza questo, Vercel può servire una
// versione statica "senza utente" → sidebar assente).
export const dynamic = 'force-dynamic'

export default async function ClienteLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  // Se non loggato, mostra solo il contenuto (es. la pagina di login /cliente) SENZA
  // reindirizzare: il layout avvolge anche il login, e un redirect qui creerebbe un loop.
  // Le pagine interne restano protette dal middleware.
  if (!user) return <>{children}</>
  const { data: utente } = await supabase.from('utenti').select('cliente_id,master_id,ruolo,attivo').eq('id', user.id).maybeSingle()
  if (!utente?.cliente_id) return <>{children}</>
  // Oltre a nome, credito e stato, i campi che decidono la schermata dei dati del negozio: una lettura
  // sola, niente richiesta in piu' dal browser e niente schermata che compare a pagina gia' disegnata.
  const letto = await supabase.from('clienti').select('credito,attivo,master_id,' + COLONNE_DATI_NEGOZIO).eq('id', utente.cliente_id).maybeSingle()
  let cliente: any = letto.data
  if (letto.error) {
    // Da questa lettura dipende anche il blocco dei clienti disattivati qui sotto: se quella estesa
    // fallisce si rilegge come prima, e la schermata semplicemente non compare.
    console.error('[CLIENTE LAYOUT] lettura cliente non riuscita', utente.cliente_id, letto.error.code, letto.error.message)
    cliente = (await supabase.from('clienti').select('ragione_sociale,credito,attivo,master_id').eq('id', utente.cliente_id).maybeSingle()).data
  }
  // Disattivare un cliente non aveva effetto su chi era GIA' dentro: qui non si controllava mai
  // `attivo`, quindi restava operativo finche' non chiudeva la sessione (e col recupero password
  // rientrava pure). Ora la disattivazione ha effetto alla prima pagina che apre.
  if (utente.attivo === false || cliente?.attivo === false) redirect('/api/auth/logout')

  // WHITE-LABEL: il cliente vede il marchio del SUO master (logo + nome), non "MoovExpress" fisso.
  // Stessa fonte del portale master (masters.logo_url/nome del master diretto); fallback a MoovExpress
  // se il master non ha caricato un logo/nome.
  let brandLogo: string | null = null, brandNome: string | null = null
  if (utente.master_id) {
    const { data: m } = await supabase.from('masters').select('logo_url,nome').eq('id', utente.master_id).maybeSingle()
    brandLogo = m?.logo_url || null
    brandNome = m?.nome || null
  }

  // Calcolati qui, sul server, e passati gia' pronti: la regola resta in un posto solo e il browser non
  // vede la variabile del master dei negozi.
  // - completaDati: i valori di partenza della schermata del primo accesso, SOLO per il conto nato
  //   dall'installazione Shopify a cui mancano dati (lib/dati-negozio); null per tutti gli altri. Solo
  //   all'utente con ruolo cliente: e' l'unico a cui la rotta che salva risponde.
  // - versioneDati: l'impronta dei dati che la schermata mostra. Torna indietro col salvataggio, e la
  //   rotta non scrive se nel frattempo qualcuno (il master dalla scheda) li ha cambiati.
  // - soloEtichette: il cliente e' un negozio dell'app sotto il master dell'App Store (lib/conti-shopify).
  //   Se non si riesce a leggerlo vale "si'": la voce SMS non si mostra, la cassa resta chiusa.
  const completaDati = (utente.ruolo || '').toLowerCase() === 'cliente' && servonoDatiNegozio(cliente)
    ? datiPerLaSchermata(cliente) : null
  const versioneDati = completaDati ? versioneDatiNegozio(cliente) : null
  // La lettura in piu' si fa solo per i clienti del master dell'App Store: questo layout gira a ogni pagina
  // del portale cliente, e per tutti gli altri la risposta e' gia' "no" dal master letto qui sopra.
  const soloEtichette = !!cliente?.master_id && cliente.master_id === masterDeiNegoziShopify()
    && (await pagaSoloEtichette(createAdminSupabase(), utente.cliente_id)) !== false

  // A CHI CHIEDERE AIUTO DALLA SCHERMATA. La schermata non si chiude, e il pulsante Supporto della
  // testata le sta sotto: chi ha un dato che i controlli non accettano (un CAP nuovo che l'archivio non
  // conosce, una sede legale all'estero) restava fermo senza poter scrivere a nessuno, che e' il vicolo
  // cieco della prima bocciatura Shopify ("negozio nuovo non entra"). Si indica il master del cliente,
  // con lo stesso contatto della ricarica con bonifico (email_supporto, altrimenti email): e' lui che
  // gestisce il conto. Un indirizzo da scrivere e non il modulo di supporto, perche' il modulo risponde
  // all'email del conto, che per questi conti e' nostra e non riceve posta. Letto col client di
  // servizio come in /api/cliente/ricarica-bonifico, solo quando la schermata c'e', e ne esce solo
  // l'indirizzo. Se il master non ne ha uno vero si ripiega sul supporto della piattaforma (lo stesso
  // di /api/supporto): la schermata la vedono solo i conti nati dall'app Shopify, che e' nostra.
  let contattoAiuto: string | null = null
  if (completaDati) {
    const mid = cliente?.master_id || utente.master_id
    const { data: m } = mid
      ? await createAdminSupabase().from('masters').select('email_supporto,email').eq('id', mid).maybeSingle()
      : { data: null }
    const mr = (m || {}) as { email_supporto?: string | null; email?: string | null }
    contattoAiuto = recapitoEmail(mr.email_supporto) || recapitoEmail(mr.email)
      || recapitoEmail(process.env.CONTATTI_A) || 'info@moovexpress.com'
  }

  return (
    <ClienteShell cliente={{ ragione_sociale: cliente?.ragione_sociale, credito: cliente?.credito }} brandLogo={brandLogo} brandNome={brandNome}
      completaDati={completaDati} versioneDati={versioneDati} contattoAiuto={contattoAiuto} soloEtichette={soloEtichette}>
      <DialogProvider><AvvisoApi brandLogo={brandLogo} brandNome={brandNome} /><BannerPiano /><EsitoCollegamento />{children}</DialogProvider>
    </ClienteShell>
  )
}
