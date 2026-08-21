import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { createServerSupabase } from '@/lib/supabase'
import { gestisceLaRete } from '@/lib/ruoli'
import { fetchDettaglioOT, miglioreRilevato, type SessioneOT } from '@/lib/onetracking'
import { calcolaRipesature } from '@/lib/ripesature-calcolo'
import { creaRettificaDaEsito } from '@/lib/ripesature-crea'
import { inviaAllertaOneTracking } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// MULTIEXPRESS = detentore del contratto PDB: le rettifiche nascono a questo livello e scendono al
// figlio diretto (sotto-master o cliente), come quando E&A carica il file a mano.
const MASTER_DETENTORE = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b'
const PER_GIRO = 40

const dorme = (ms: number) => new Promise(r => setTimeout(r, ms))

// Cron (Bearer CRON_SECRET) oppure sessione del super-master (MULTIEXPRESS o radice).
async function autorizzato(req: NextRequest, admin: any): Promise<boolean> {
  const auth = req.headers.get('authorization') || ''
  if (process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET) return true
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!gestisceLaRete(u as any) || !u?.master_id) return false
  if (u.master_id === MASTER_DETENTORE) return true
  const { data: m } = await admin.from('masters').select('parent_master_id').eq('id', u.master_id).maybeSingle()
  return !(m as any)?.parent_master_id   // solo il master RADICE
}

export async function GET(req: NextRequest) {
  const admin = createAdminSupabase()
  if (!(await autorizzato(req, admin))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const { data: sess } = await admin.from('onetracking_sessione').select('*').eq('id', 1).maybeSingle()
  if (!sess?.url_template || sess?.stato !== 'attiva') {
    return NextResponse.json({ ok: true, sessioneScaduta: true, controllate: 0, rettificate: 0,
      messaggio: 'Sessione OneTracking non attiva: incolla un cURL fresco.' })
  }
  const sessione: SessioneOT = { url_template: sess.url_template, headers: sess.headers || {} }

  const { data: pdb } = await admin.from('corrieri').select('id')
    .eq('nome_contratto', 'Poste Delivery Business S').eq('tipo', 'spediamopro')
  const pdbIds = (pdb || []).map((c: any) => c.id)
  if (!pdbIds.length) return NextResponse.json({ ok: true, controllate: 0, rettificate: 0, messaggio: 'nessun corriere PDB' })

  // Candidati: consegnate PDB, le piu' RECENTI prima (le nuove consegne hanno priorita'), non ancora
  // controllate. L'anti-join su ripesature_check fa avanzare il giro da solo.
  const { data: cand } = await admin.from('spedizioni')
    .select('id,tracking_number')
    .in('corriere_id', pdbIds).eq('stato', 'consegnata').not('tracking_number', 'is', null)
    .order('created_at', { ascending: false }).limit(400)
  const ids = (cand || []).map((c: any) => c.id)
  const { data: giaCheck } = ids.length
    ? await admin.from('ripesature_check').select('spedizione_id').in('spedizione_id', ids)
    : { data: [] as any[] }
  const fatti = new Set((giaCheck || []).map((g: any) => g.spedizione_id))
  const daControllare = (cand || []).filter((c: any) => !fatti.has(c.id))
  const arretrato = daControllare.length
  const daFare = daControllare.slice(0, PER_GIRO)

  const inizio = Date.now()
  let controllate = 0, rettificate = 0, senzaMisure = 0, gia = 0, recuperoTot = 0, sessioneScaduta = false
  for (const s of daFare) {
    if (Date.now() - inizio > 255000) break
    const ldv = String((s as any).tracking_number)
    const f = await fetchDettaglioOT(sessione, ldv)
    if (f.scaduta) { sessioneScaduta = true; break }
    controllate++
    const best = miglioreRilevato(f.json)
    if (!best || !best.lunghezza || !best.larghezza || !best.altezza) {
      await admin.from('ripesature_check').upsert({ spedizione_id: (s as any).id, controllato_il: new Date().toISOString(), esito: 'no-misure', dettaglio: f.motivo || null })
      senzaMisure++
      await dorme(1200 + Math.floor(Math.random() * 800)); continue
    }
    try {
      const rip = {
        idOrdine: ldv, idVerifiche: [], ldv, addebitoFornitore: 0,
        colli: [{ peso: best.peso || 0, lunghezza: best.lunghezza, larghezza: best.larghezza, altezza: best.altezza }],
        dataChiusura: '', mittente: '', destinatario: '',
      }
      const [esito] = await calcolaRipesature(admin, [rip as any])
      const cr = await creaRettificaDaEsito(admin, MASTER_DETENTORE, esito)
      const esitoCheck = cr.creata ? 'rettificata'
        : (cr.motivo || '').includes('gia') ? 'gia-rettificata'
        : (cr.motivo || '').includes('errore') ? 'errore'
        : (cr.motivo || '').includes('trovata') ? 'non-trovata'
        : 'ok'
      await admin.from('ripesature_check').upsert({
        spedizione_id: (s as any).id, controllato_il: new Date().toISOString(),
        esito: esitoCheck, rettifica_id: cr.rettificaId || null,
        recupero: cr.recupero || null, dettaglio: cr.motivo || null,
      })
      if (cr.creata) { rettificate++; recuperoTot += cr.recupero || 0 }
      else if (esitoCheck === 'gia-rettificata') gia++
    } catch (e: any) {
      await admin.from('ripesature_check').upsert({ spedizione_id: (s as any).id, controllato_il: new Date().toISOString(), esito: 'errore', dettaglio: String(e?.message || e).slice(0, 150) })
    }
    await dorme(1500 + Math.floor(Math.random() * 1000))   // gentile col portale
  }

  if (sessioneScaduta) {
    await admin.from('onetracking_sessione').update({ stato: 'scaduta' }).eq('id', 1)
    // Avviso UNA sola volta per scadenza (si riarma quando si incolla un cookie fresco).
    if (!sess.scaduta_notificata && sess.email_alert) {
      await inviaAllertaOneTracking(sess.email_alert, arretrato)
      await admin.from('onetracking_sessione').update({ scaduta_notificata: true }).eq('id', 1)
    }
  } else if (controllate > 0) {
    await admin.from('onetracking_sessione').update({ ultimo_ok_il: new Date().toISOString() }).eq('id', 1)
  }

  return NextResponse.json({
    ok: true, sessioneScaduta,
    controllate, rettificate, senzaMisure, giaRettificate: gia,
    recuperoTot: Math.round(recuperoTot * 100) / 100,
    arretrato: Math.max(0, arretrato - controllate),
    durataSec: Math.round((Date.now() - inizio) / 1000),
  })
}
