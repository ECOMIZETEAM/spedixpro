import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { spediamoproGetTracking, spediamoproEventiIndicanoReso } from '@/lib/spediamopro'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// RECUPERO (sola RILEVAZIONE) dei resi SpediamoPro nascosti sotto stato='consegnata'.
//
// Lo status numerico di SpediamoPro non distingue il reso: una riconsegna al mittente registra
// 10/12 = consegnata, quindi tutti i resi che il corriere ha chiuso da solo prima del fix sono
// rimasti marcati "consegnata" e non addebitati. Non c'e' un segnale in database per distinguerli:
// l'unico modo e' ricontrollare il tracking, dove il reso c'e' scritto negli EVENTI.
//
// Qui si ricontrollano le consegnate SpediamoPro a lotti e si SEGNA in resi_recupero_check quali
// sono in realta' resi al mittente — SENZA toccare ne' lo stato ne' i soldi: serve a CONTARE il
// backlog prima di decidere l'addebito a mano (scelta "prima rileva e conta"). L'anti-join sulla PK
// fa esaurire il giro da solo quando tutte sono state controllate. Cron dedicato, separato dal
// tracking vivo (/api/tracking/aggiorna), per non rallentarlo.
const PER_GIRO = 600
const BATCH = 16

export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()

  const { data: cor } = await admin.from('corrieri').select('id,credenziali').eq('tipo', 'spediamopro')
  const authDi = new Map<string, string>()
  for (const c of (cor || [])) if ((c as any)?.credenziali?.authcode) authDi.set((c as any).id, (c as any).credenziali.authcode)
  if (!authDi.size) return NextResponse.json({ ok: true, messaggio: 'nessun contratto spediamopro' })

  const { data: cand } = await admin.rpc('prossime_reso_da_controllare', { lim: PER_GIRO })
  if (!cand?.length) return NextResponse.json({ ok: true, esaurito: true, messaggio: 'nessuna consegnata da controllare' })

  const inizio = Date.now()
  let controllate = 0, sospetti = 0, errori = 0
  for (let i = 0; i < cand.length; i += BATCH) {
    // Margine sotto maxDuration: meglio fermarsi puliti e riprendere al giro dopo che essere uccisi.
    if (Date.now() - inizio > 260000) break
    const gruppo = cand.slice(i, i + BATCH)
    await Promise.all(gruppo.map(async (s: any) => {
      const authcode = authDi.get(s.corriere_id)
      const spid = s.sp_id || s.sp_id2
      if (!authcode || !spid) {
        await admin.from('resi_recupero_check').upsert({ spedizione_id: s.id, sospetto: false, dettaglio: 'senza authcode/sp_id' })
        controllate++
        return
      }
      try {
        const tr = await spediamoproGetTracking(authcode, Number(spid))
        const sospetto = spediamoproEventiIndicanoReso(tr.events)
        await admin.from('resi_recupero_check').upsert({
          spedizione_id: s.id, sospetto, status_num: tr.status ?? null,
          dettaglio: sospetto ? 'reso rilevato negli eventi' : null,
        })
        controllate++; if (sospetto) sospetti++
      } catch (e: any) {
        // Marco comunque come controllata (errore) per non ripescarla all'infinito; i pochi errori
        // si potranno rilanciare cancellando le righe con dettaglio che comincia per 'errore'.
        await admin.from('resi_recupero_check').upsert({ spedizione_id: s.id, sospetto: false, dettaglio: 'errore: ' + String(e?.message || e).slice(0, 120) })
        errori++
      }
    }))
  }
  console.log(`[RECUPERO-RESI] controllate=${controllate} sospetti=${sospetti} errori=${errori} durata=${Math.round((Date.now() - inizio) / 1000)}s`)
  return NextResponse.json({ ok: true, controllate, sospetti, errori })
}
