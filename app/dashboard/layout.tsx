import { profiloDellaRichiesta } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import DashboardLayout from '../components/Layout'
import { getPermessiUtente } from '@/lib/permessi'
import AbbonamentoGate from './AbbonamentoGate'
import BannerPiano from '../components/BannerPiano'
import BannerNovitaTiktok from '../components/BannerNovitaTiktok'
import AvvisoImportante from './AvvisoImportante'
import CongelatoGate from './CongelatoGate'
import BannerDemo from '../components/BannerDemo'
import { DialogProvider } from '../components/DialogProvider'
import { contabilitaAttiva } from '@/lib/contabilita-banca'
import { eTitolareOAdmin } from '@/lib/ruoli'
import { AvvisoVerifica } from '../components/VerificaDuePassaggi'
import { cookies, headers } from 'next/headers'
import { after } from 'next/server'
import { segnaVisitaGrafica } from '@/lib/grafica-visite'
import { outfit, luceIniziale, sceltaTema } from '@/app/components/grafica/server'
import { RuoloUtente } from './RuoloUtente'

// Mai in cache: dipende dalla sessione. Senza questo Vercel puo' servire una versione resa
// SENZA utente -> sidebar assente al primo accesso (il portale cliente aveva gia' lo stesso
// accorgimento per lo stesso identico motivo).
export const dynamic = 'force-dynamic'
export default async function Layout({ children }: { children: React.ReactNode }) {
  // Sessione e profilo una volta sola per pagina: getPermessiUtente qui sotto e i layout annidati
  // riusano questa stessa verifica invece di rifarla (lib/supabase, profiloDellaRichiesta).
  const { supabase, user, utente, errore: errUtente } = await profiloDellaRichiesta()
  if (!user) redirect('/')
  // Un guasto MOMENTANEO della query non deve buttare fuori nessuno: si distingue l'errore
  // (rete/database non raggiungibile -> si lascia proseguire con permessi minimi) dal caso in cui
  // la riga davvero non esiste.
  if (errUtente) throw new Error('Profilo non leggibile in questo momento, riprova fra poco')
  // Account autenticato ma SENZA riga in `utenti`: senza questo controllo i ripieghi qui sotto
  // (ruolo 'master', isFull true) gli davano il menu amministrativo completo. Ne esistono davvero:
  // si creano quando l'utente nasce in auth ma l'inserimento in `utenti` fallisce a meta'.
  // Stesso trattamento per chi e' stato disattivato dal master: fuori.
  if (!utente || utente.attivo === false) redirect('/api/auth/logout')
  // Permessi effettivi dell'utente (admin/master = tutto; operatore/agente = da Impostazioni Permessi)
  const perm = await getPermessiUtente()
  // Brand del master (logo/nome) da mostrare in alto a sinistra
  let brandLogo: string | null = null
  let brandNome: string | null = null
  let superMaster = false
  let demo = false
  let demoScadenza: string | null = null
  let ottimizzaMargini = false
  let vedeReteCompleta = false
  if (utente?.master_id) {
    const { data: m } = await supabase.from('masters').select('logo_url,nome,is_super_master,demo,demo_scadenza,ottimizza_margini,vede_rete_completa,parent_master_id').eq('id', utente.master_id).single()
    brandLogo = m?.logo_url || null
    brandNome = m?.nome || null
    superMaster = !!m?.is_super_master
    demo = m?.demo === true
    demoScadenza = m?.demo_scadenza || null
    ottimizzaMargini = m?.ottimizza_margini === true
    // Vede l'INTERA rete: super master, flag esplicito, o vertice senza padre (root). Abilita la
    // voce "Accessi Rete" (elenco piatto master+clienti con accesso diretto).
    vedeReteCompleta = !!(m?.is_super_master || m?.vede_rete_completa || m?.parent_master_id === null)
  }
  // Prova demo terminata: fuori dal gestionale, verso la pagina che spiega com'è andata.
  if (demo && demoScadenza && new Date(demoScadenza).getTime() < Date.now()) redirect('/demo-scaduta')
  // GRAFICA NUOVA: per ora solo il super master che l'ha accesa (/api/grafica). Lorenzo 27/10: niente in produzione
  // finché tutte le pagine non sono fatte e controllate; poi il pulsante a tutti, col voto.
  // GRAFICA_PROVA_MASTER_IDS: i master con cui si guarda l'anteprima in locale (Lorenzo: «entra con ecomize LL»);
  // in produzione la variabile non c'è.
  const prova = (process.env.GRAFICA_PROVA_MASTER_IDS || '').split(',').map(x => x.trim()).filter(Boolean)
  const puoGraficaNuova = superMaster || (!!utente?.master_id && prova.includes(utente.master_id))
  const biscotti = await cookies()
  const graficaPiena = puoGraficaNuova && biscotti.get('mx_grafica')?.value === 'nuova'
  // PROVA PER TUTTI (Lorenzo 19/11): il pulsante «Scopri la nuova versione» c'è quando GRAFICA_PROVA_APERTA=1 (in
  // produzione si accende solo col suo ok), e mai per l'agente, che ha la sua plancia confinata e non ancora disegnata.
  // La prova vale per la pagina aperta con «?nuova=1»: il proxy lo dice con x-grafica-prova.
  const provaAperta = (process.env.GRAFICA_PROVA_APERTA === '1' || puoGraficaNuova) && String(utente?.ruolo || '').toLowerCase() !== 'agente'
  const intestazioni = await headers()
  const provaQui = provaAperta && !graficaPiena && intestazioni.get('x-grafica-prova') === '1'
  // «?versione=oggi» (dalla Nuova spedizione su una pagina): quella pagina tutta nella versione di oggi, cornice compresa
  const graficaNuova = (graficaPiena || provaQui) && intestazioni.get('x-grafica-oggi') !== '1'
  // chi apre la prova (registro grafica_visite, Lorenzo 21/11: «controllate chi la visualizza»): dopo la risposta
  if (graficaNuova) { const ua = intestazioni.get('user-agent') || ''; after(() => segnaVisitaGrafica({ utente: user.id, master: utente?.master_id, ruolo: utente?.ruolo, userAgent: ua })) }
  const graficaScelta = sceltaTema(biscotti.get('mx_tema')?.value)
  const pagina = (
    <DashboardLayout user={{
      nome: utente?.nome || 'Admin',
      ruolo: utente?.ruolo || 'master',
      brandLogo, brandNome,
      isFull: perm?.isFull ?? true,
      gestioneRete: perm?.gestioneRete ?? false,
      permessi: perm?.permessi || {},
      superMaster,
      // Rettifiche automatiche OneTracking: solo MULTIEXPRESS (detentore PDB), gli altri no.
      isMultiexpress: utente?.master_id === 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b',
      ottimizzaMargini,
      vedeReteCompleta,
      graficaNuova,
      graficaScelta,
      // in prova: la striscia in alto, il voto, le voci non ancora pronte spente
      graficaProva: provaQui,
      // il pulsante «Scopri la nuova versione» nella barra di oggi
      provaNuova: provaAperta && !graficaNuova,
      // l'entrata animata della Plancia, una volta per sessione (biscotto di sessione mx_entrata, lo mette la Plancia)
      graficaEntrata: graficaNuova && !biscotti.get('mx_entrata'),
      // «Auto» è il chiaro/scuro del dispositivo (biscotto mx_scuro), vedi luceIniziale
      graficaLuce: graficaNuova ? luceIniziale(graficaScelta, { scuro: biscotti.get('mx_scuro')?.value }) : undefined,
      graficaProposta: graficaNuova && ['a', 'b', 'c', 'd'].includes(biscotti.get('mx_plancia')?.value || '') ? biscotti.get('mx_plancia')!.value : '',
      // Estratto conto: in prova solo su alcuni master, e solo per titolare e admin.
      contabilita: contabilitaAttiva(utente?.master_id) && eTitolareOAdmin(utente),
    }}>
      <DialogProvider>
        {demo && demoScadenza && <BannerDemo scadenza={demoScadenza} />}
        {!demo && (utente?.ruolo === 'master' || utente?.ruolo === 'admin') && <AbbonamentoGate />}
        {!demo && <CongelatoGate />}
        {!demo && <AvvisoImportante />}
        {!demo && <BannerPiano linkUpgrade="/dashboard/abbonamento" />}
        {/* L'annuncio TikTok Shop (prima quello Shopify) e' per chi gestisce il portale e i clienti: non per agenti
            e autisti, ne' per le prove demo, i cui clienti un negozio non lo possono collegare. */}
        {!demo && ['master', 'admin', 'operatore'].includes(String(utente?.ruolo || '').toLowerCase()) && <BannerNovitaTiktok per="master" />}
        <AvvisoVerifica />
        <RuoloUtente ruolo={utente?.ruolo || 'master'} haMaster={!!utente?.master_id}>{children}</RuoloUtente>
      </DialogProvider>
    </DashboardLayout>
  )
  if (!graficaNuova) return pagina
  return <div className={outfit.variable} style={{ display: 'contents' }}>{pagina}</div>
}
