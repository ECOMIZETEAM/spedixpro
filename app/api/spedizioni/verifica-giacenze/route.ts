import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { spediamoproSearchStocks } from '@/lib/spediamopro'
import { spedisciStocksAperti } from '@/lib/spedisci'
import { easyparcelTracking, mapStatoEasyparcel } from '@/lib/easyparcel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Interroga i corrieri una spedizione alla volta: un lotto può richiedere minuti.
export const maxDuration = 300

// CONTROLLO AGENTE GIACENZE (monitoraggio del super master, non dei master).
// Per ogni giacenza che risulta SVINCOLATA da noi, chiede al corriere se è DAVVERO uscita:
//  - SpediamoPro: searchStocks → se c'è ancora uno stock attivo (status 1) → FERMA.
//  - Spedisci:    /api/v2/stocks/open → se la LDV è ancora nell'elenco → FERMA.
//  - DVA:         tracking → se lo stato è ancora "in giacenza" → FERMA.
// GRACE 12h: una appena svincolata il corriere non l'ha ancora lavorata → non la marco "ferma" a
// vuoto (si ricontrolla al giro dopo). Salva su giacenza_verifica_esito/at: il report del super
// master li legge senza richiamare i corrieri a ogni apertura.
export async function GET(req: NextRequest) {
  // Passa il cron di Vercel (CRON_SECRET) OPPURE il super master dal bottone "Controlla ora".
  const blocco = bloccaCronNonAutorizzato(req)
  const admin = createAdminSupabase()
  if (blocco) {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    let sm = false
    if (user) {
      const { data: u } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
      if (u?.master_id) {
        const { data: mm } = await admin.from('masters').select('is_super_master').eq('id', u.master_id).single()
        sm = !!mm?.is_super_master
      }
    }
    if (!sm) return blocco
  }

  // Svincolate da (ri)controllare: mai verificate, o verificate da oltre 6h (una "ferma" può
  // sbloccarsi più tardi). Un lotto per giro, così non va in timeout.
  const seiOreFa = new Date(Date.now() - 6 * 3600e3).toISOString()
  const { data: spedRaw } = await admin.from('spedizioni')
    .select('id,numero,tracking_number,stato,raw_response,corrieri(tipo,credenziali)')
    .eq('giacenza_stato', 'svincolata')
    .or(`giacenza_verifica_at.is.null,giacenza_verifica_at.lt.${seiOreFa}`)
    .limit(120)
  const sped = (spedRaw || []) as any[]
  if (!sped.length) return NextResponse.json({ controllate: 0, ok: 0, ferme: 0 })

  // GRACE: quando è stata svincolata (ultima richiesta confermata) → salto le troppo recenti.
  const ids = sped.map(s => s.id)
  const svincoloAt = new Map<string, number>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from('giacenza_richieste')
      .select('spedizione_id,confermata_at').in('spedizione_id', ids.slice(i, i + 200))
      .eq('stato', 'confermata').not('confermata_at', 'is', null)
    for (const r of (data || [])) {
      const t = new Date((r as any).confermata_at).getTime()
      if (t > (svincoloAt.get((r as any).spedizione_id) || 0)) svincoloAt.set((r as any).spedizione_id, t)
    }
  }

  const spedisciCache = new Map<string, { ldv: Set<string>; ok: boolean }>()
  let ok = 0, ferme = 0, errori = 0, controllate = 0, saltate = 0
  const problemi: { ldv: string; corriere: string }[] = []
  const now = new Date().toISOString()

  for (const s of sped) {
    const cred = (s.corrieri?.credenziali || {}) as any
    const tipo = s.corrieri?.tipo
    const svAt = svincoloAt.get(s.id)
    if (svAt && (Date.now() - svAt) < 12 * 3600e3) { saltate++; continue }   // < 12h: troppo recente

    // GIA' CONSEGNATA (o resa al mittente): ha per forza LASCIATO la giacenza del corriere -> 'ok', senza
    // nemmeno interrogare l'API. Evita anche il falso "ferma" per DVA/easyparcel, il cui tracking conserva
    // in eterno il vecchio evento di giacenza (uno storico) anche a pacco ormai consegnato.
    if (s.stato === 'consegnata' || s.stato === 'reso_mittente') {
      await admin.from('spedizioni').update({ giacenza_verifica_at: now, giacenza_verifica_esito: 'ok' }).eq('id', s.id)
      controllate++; ok++; continue
    }

    let esito: 'ok' | 'ferma' | 'errore' = 'ok'
    try {
      if (cred.authcode) {
        const raw: any = s.raw_response || {}
        const code = raw.code || raw?.raw?.data?.code || s.tracking_number
        const spid = raw.id || raw?.raw?.data?.id
        const stocks = ((await spediamoproSearchStocks(cred.authcode, String(code))) || [])
          .filter((st: any) => !spid || Number(st.shipmentId) === Number(spid))
        // SpediamoPro tiene lo STORICO degli stock: dopo lo svincolo RESTA anche il vecchio record
        // status 1 -> "esiste uno status 1" NON basta. Status: 1 = giacenza da lavorare (releaseAction
        // nullo), 2 = "Richiesta svincolo ELABORATA", 3 = "Svincolata". Se ANCHE UN solo stock e' >=2
        // SpediamoPro la mostra svincolata (es. Michele De Cesare: status 1 storico + status 3) -> NON e'
        // ferma. Ferma = attiva (status 1, releaseAction nullo) e MAI arrivata a >=2 (svincolo mai
        // registrato su SpediamoPro = il nostro rilascio non e' passato -> serve davvero ri-svincolare).
        const svincolatoSuSped = stocks.some((st: any) => Number(st.status) >= 2)
        const attivaSenzaSvincolo = stocks.some((st: any) => Number(st.status) === 1 && !st.releaseAction)
        esito = (attivaSenzaSvincolo && !svincolatoSuSped) ? 'ferma' : 'ok'
      } else if (tipo === 'easyparcel' && cred.apikey) {
        const { stati } = await easyparcelTracking(cred.apikey, { ldv: String(s.tracking_number || s.numero) })
        const mappati = (stati || []).map((t: string) => mapStatoEasyparcel(t))
        // NON basta un evento di giacenza nello STORICO (resta li' per sempre, anche dopo la ripartenza:
        // dava un falso "ferma" al 100%). E' "ferma" solo se e' in giacenza E NON ha ripreso la corsa:
        // cioe' manca qualunque evento POST-giacenza (in consegna / consegnata / reso / tentativo consegna).
        const ripresa = mappati.some((m) => m === 'consegnata' || m === 'in_consegna' || m === 'non_consegnato' || m === 'reso_mittente')
        const inGiacenza = mappati.some((m) => m === 'in_giacenza')
        esito = (inGiacenza && !ripresa) ? 'ferma' : 'ok'
      } else if (cred.master_domain && cred.password) {
        const key = String(cred.master_domain)
        let aperti = spedisciCache.get(key)
        if (!aperti) { aperti = await spedisciStocksAperti(cred); spedisciCache.set(key, aperti) }
        esito = !aperti.ok ? 'errore' : (aperti.ldv.has(String(s.tracking_number || s.numero).toUpperCase()) ? 'ferma' : 'ok')
      }
      // Corrieri senza svincolo via API (GLS/interno): niente da verificare → resta 'ok'.
    } catch { esito = 'errore' }

    await admin.from('spedizioni').update({ giacenza_verifica_at: now, giacenza_verifica_esito: esito }).eq('id', s.id)
    controllate++
    if (esito === 'ok') ok++
    else if (esito === 'ferma') { ferme++; problemi.push({ ldv: s.numero || s.tracking_number, corriere: tipo }) }
    else errori++
  }

  return NextResponse.json({ controllate, ok, ferme, errori, saltate, problemi: problemi.slice(0, 50) })
}
