import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { createServerSupabase } from '@/lib/supabase'
import { gestisceLaRete } from '@/lib/ruoli'
import { calcolaRipesature } from '@/lib/ripesature-calcolo'
import { creaRettificaDaEsito } from '@/lib/ripesature-crea'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// RECUPERO DELLE RIPESATURE — dalle misure che abbiamo gia' in casa.
//
// Come funzionava prima: questa rotta interrogava OneTracking dal server, una LDV alla volta, col
// cookie salvato in `onetracking_sessione`. Quella sessione e' morta il 21/08/2026 e nessuno se n'e'
// accorto: l'ultimo recupero e' del 31/08. Adesso le misure le porta il giro sul Mac dentro
// `ripesature_misure` e qui si fa solo il CONTO — quindi non c'e' piu' niente che possa scadere.
//
// LE REGOLE, quelle che valgono soldi:
//  * SOLO RECUPERI, MAI RIMBORSI. Se il collo pesa MENO del dichiarato non si restituisce niente e
//    non si chiede niente: lo dice `creaRettificaDaEsito` (differenza < 0.01 -> nessuna riga).
//  * NIENTE RETTIFICA SE IL PREZZO NON CAMBIA. Il collo si riprezza col listino di OGNI livello: se
//    passa da 1 a 2 kg e quel listino fa lo stesso prezzo fino a 2 kg, la differenza e' zero e non
//    nasce nulla. Se passa da 7 a 13 kg e cambia scaglione, nasce.
//  * LA RETTIFICA NASCE SUL DETENTORE DEL CONTRATTO (MULTIEXPRESS) verso il suo figlio DIRETTO, che
//    poi la gira a valle dal suo pannello. Non scende da sola fino al cliente finale.
//  * SOLO I CONTRATTI DEL DETENTORE: un master con un Poste suo (Velox Logistick, "Poste STANDARD I")
//    paga il proprio fornitore, e quel costo non passa da noi. Lo filtra la coda nel database.
//  * SOLO COLLO SINGOLO: sul multicollo una misura non e' la spedizione (vedi la coda).
const MASTER_DETENTORE = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b'   // MULTIEXPRESS
const PER_GIRO = 150
const BUDGET_MS = 240_000

// Cron (Bearer CRON_SECRET) oppure sessione del super-master (MULTIEXPRESS o radice).
async function autorizzato(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization') || ''
  if (process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET) return true
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!gestisceLaRete(u as any) || !u?.master_id) return false
  return u.master_id === MASTER_DETENTORE   // SOLO MULTIEXPRESS (detentore dei contratti Poste)
}

export async function GET(req: NextRequest) {
  const admin = createAdminSupabase()
  if (!(await autorizzato(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const { data: coda, error: erroreCoda } = await admin.rpc('prossime_ripesature_da_calcolare', {
    p_master: MASTER_DETENTORE, lim: PER_GIRO,
  })
  if (erroreCoda) return NextResponse.json({ error: 'Coda non leggibile' }, { status: 500 })

  const inizio = Date.now()
  let controllate = 0, rettificate = 0, nessunRecupero = 0, gia = 0, nonCalcolabili = 0, errori = 0, recuperoTot = 0
  for (const r of (coda || []) as any[]) {
    if (Date.now() - inizio > BUDGET_MS) break
    controllate++
    const segna = (esito: string, extra: Record<string, any> = {}) =>
      admin.from('ripesature_check').upsert({
        spedizione_id: r.spedizione_id, controllato_il: new Date().toISOString(), esito, ...extra,
      })
    try {
      // Il collo COME L'HA MISURATO IL CORRIERE. Si passano le MISURE, non il solo peso: il
      // supplemento lo fa il volume, e col solo peso meta' delle righe uscirebbe negativa.
      const rip = {
        idOrdine: r.ldv, idVerifiche: [], ldv: r.ldv, addebitoFornitore: 0,
        colli: [{
          peso: Number(r.peso) || 0,
          lunghezza: Number(r.lunghezza), larghezza: Number(r.larghezza), altezza: Number(r.altezza),
        }],
        dataChiusura: '', mittente: '', destinatario: '',
      }
      const [esito] = await calcolaRipesature(admin, [rip as any])
      if (!esito?.trovata) { nonCalcolabili++; await segna('no-misure', { dettaglio: esito?.motivo || 'spedizione non ricostruita' }); continue }

      // IL COLLO DEVE ESSERE DIVENTATO PIU' GRANDE, altrimenti non si tocca niente.
      // Il motore confronta "prezzo rifatto oggi col collo vero" contro "quello che risulta
      // addebitato nei movimenti": se nel frattempo il listino e' cambiato, quella differenza esce
      // positiva ANCHE su un collo piu' piccolo. Nella prova a vuoto usciva una rettifica di 0,49
      // EUR su una spedizione passata da 1,0 a 0,9 kg — un addebito che col ripesato non c'entra.
      // La ripesatura si paga solo se il pacco e' piu' grande di quello per cui si e' pagato.
      const pesoPrima = Math.max(Number(esito.pesoRealePrima) || 0, Number(esito.pesoVolumePrima) || 0)
      const pesoDopo = Math.max(Number(esito.pesoDopo) || 0, Number(esito.pesoVolumeDopo) || 0)
      if (pesoDopo <= pesoPrima + 0.001) {
        nessunRecupero++
        await segna('ok', { dettaglio: `collo non piu' grande (${pesoPrima.toFixed(2)} → ${pesoDopo.toFixed(2)} kg)` })
        continue
      }

      const cr = await creaRettificaDaEsito(admin, MASTER_DETENTORE, esito)
      if (cr.creata) {
        rettificate++; recuperoTot += cr.recupero || 0
        await segna('rettificata', { rettifica_id: cr.rettificaId || null, recupero: cr.recupero || null })
        continue
      }
      const motivo = cr.motivo || ''
      if (motivo.includes('gia')) { gia++; await segna('gia-rettificata', { dettaglio: motivo }) }
      // "nessun recupero" = il collo vero costa uguale a quello dichiarato con il listino di quel
      // livello: e' la risposta giusta, non un buco. Si segna come controllata e non si torna piu'.
      else if (motivo.includes('nessun recupero')) { nessunRecupero++; await segna('ok', { dettaglio: 'stesso prezzo col suo listino' }) }
      else { nonCalcolabili++; await segna('non-calcolabile', { dettaglio: motivo.slice(0, 150) }) }
    } catch (e: any) {
      errori++
      try { await segna('errore', { dettaglio: String(e?.message || e).slice(0, 150) }) } catch { /* pazienza */ }
    }
  }

  // Quante ne restano dopo questo giro (per il pannello).
  const { data: restanti } = await admin.rpc('prossime_ripesature_da_calcolare', { p_master: MASTER_DETENTORE, lim: 500 })
  return NextResponse.json({
    ok: true,
    controllate, rettificate, nessunRecupero, giaRettificate: gia, nonCalcolabili, errori,
    recuperoTot: Math.round(recuperoTot * 100) / 100,
    arretrato: (restanti || []).length,
    durataSec: Math.round((Date.now() - inizio) / 1000),
  })
}
