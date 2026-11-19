import { createServerSupabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import DashboardLayout from '../components/Layout'
import { getPermessiUtente } from '@/lib/permessi'
import AbbonamentoGate from './AbbonamentoGate'
import BannerPiano from '../components/BannerPiano'
import AvvisoImportante from './AvvisoImportante'
import CongelatoGate from './CongelatoGate'
import BannerDemo from '../components/BannerDemo'
import { DialogProvider } from '../components/DialogProvider'
import { cookies } from 'next/headers'
import { Outfit } from 'next/font/google'

// Il carattere della grafica nuova (v11). preload: false: con la grafica di oggi la pagina non lo scarica nemmeno.
const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit', display: 'swap', preload: false })
function luceNotte(scelta: string): boolean {
  if (scelta === 'notte') return true
  if (scelta !== 'auto') return false
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]))
  const m = Number(p.hour) * 60 + Number(p.minute)
  return m < 7 * 60 || m >= 18 * 60 + 12
}
// La luce con cui la pagina nasce, decisa QUI sul server: la scelta di chi guarda (biscotto mx_tema: auto, giorno o
// notte) e, in Auto, l'ora di Roma. Così la pagina arriva già col vetro giusto, senza uno script che la ritocchi prima
// del disegno (React non lo accetta, e il server e il browser disegnerebbero due pagine diverse). Stesse soglie di
// luceDellOra in components/grafica/CorniceNuova.tsx.
function luceIniziale(scelta: string): string {
  // 27/10: il giorno è il plastico bianco («argilla», dai riferimenti RoutaX di Lorenzo); la notte resta la notte
  return luceNotte(scelta) ? 'notte' : 'argilla'
}

// Mai in cache: dipende dalla sessione. Senza questo Vercel puo' servire una versione resa
// SENZA utente -> sidebar assente al primo accesso (il portale cliente aveva gia' lo stesso
// accorgimento per lo stesso identico motivo).
export const dynamic = 'force-dynamic'
export default async function Layout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { data: utente, error: errUtente } = await supabase
    .from('utenti').select('nome,ruolo,master_id,attivo').eq('id', user.id).maybeSingle()
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
  const graficaNuova = puoGraficaNuova && biscotti.get('mx_grafica')?.value === 'nuova'
  const graficaScelta = ['auto', 'giorno', 'notte'].includes(biscotti.get('mx_tema')?.value || '') ? biscotti.get('mx_tema')!.value : 'auto'
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
      // l'entrata animata della Plancia, una volta per sessione (biscotto di sessione mx_entrata, lo mette la Plancia)
      graficaEntrata: graficaNuova && !biscotti.get('mx_entrata'),
      graficaLuce: graficaNuova ? luceIniziale(graficaScelta) : undefined,
      graficaProposta: graficaNuova && ['a', 'b', 'c', 'd'].includes(biscotti.get('mx_plancia')?.value || '') ? biscotti.get('mx_plancia')!.value : '',
    }}>
      <DialogProvider>
        {demo && demoScadenza && <BannerDemo scadenza={demoScadenza} />}
        {!demo && (utente?.ruolo === 'master' || utente?.ruolo === 'admin') && <AbbonamentoGate />}
        {!demo && <CongelatoGate />}
        {!demo && <AvvisoImportante />}
        {!demo && <BannerPiano linkUpgrade="/dashboard/abbonamento" />}
        {children}
      </DialogProvider>
    </DashboardLayout>
  )
  if (!graficaNuova) return pagina
  return <div className={outfit.variable} style={{ display: 'contents' }}>{pagina}</div>
}
