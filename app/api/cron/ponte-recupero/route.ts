import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { completaPiano } from '@/lib/ponte-scrittura'
import { credenzialiKsyncV1 } from '@/lib/v1-poste'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// IL RECUPERO DEL PONTE UNICO (fase 3 di PONTE-UNICO.md), ogni cinque minuti.
//
// Il ponte unico annota il lavoro in `ponte_in_corso` PRIMA di comprare la LDV, e la LDV appena arriva. Se il
// processo muore (o il database non risponde) fra la LDV e la scrittura, qui la si scrive dal piano annotato: il
// credito della fila e' gia' prenotato, la LDV c'e', e il piano e' quello esatto di quel momento (niente si ricalcola).
// Oggi, nello stesso caso, la staffetta lascia gambe orfane.
//
//   'ldv' da piu' di 2 minuti       → si riprende l'etichetta dal corriere e si scrive (ponte_scrivi e' ripetibile);
//   'in_corso' da piu' di 15 minuti → interrotta prima della LDV: si stornano le prenotazioni della fila. Se il
//                                     corriere avesse creato la lettera senza che arrivasse la risposta, il log
//                                     [PONTE][INTERROTTA PRIMA DELLA LDV] dice dove guardare.
// PONTE_RECUPERO=spento lo ferma.

const ATTESA_LDV_MS = 2 * 60e3
const ATTESA_IN_CORSO_MS = 15 * 60e3
const PER_GIRO = 20

export async function GET(req: NextRequest) {
  const _b = bloccaCronNonAutorizzato(req); if (_b) return _b
  if (process.env.PONTE_RECUPERO === 'spento') return NextResponse.json({ spento: true })
  const admin = createAdminSupabase()
  const ora = Date.now()
  const esito = { scritte: 0, gia_scritte: 0, non_scritte: 0, stornate: 0 }
  // Un piano che dopo un'ora ancora non si scrive non e' un guasto passeggero: lo deve guardare una persona (la LDV
  // c'e' e il credito e' prenotato). Si toglie dal giro, col motivo.
  const nonScritta = async (r: any, motivo: string) => {
    console.error('[PONTE][RECUPERO] non scritta:', r.id, r.ldv, motivo)
    if (ora - Date.parse(r.creato_il) < 60 * 60e3) return
    const { error } = await admin.from('ponte_in_corso').update({ stato: 'da_verificare', errore: motivo.slice(0, 500), aggiornato_il: new Date().toISOString() }).eq('id', r.id).eq('stato', 'ldv')
    console.error('[PONTE][DA VERIFICARE]', JSON.stringify({ id: r.id, ldv: r.ldv, contratto: r.contratto, motivo: motivo.slice(0, 300) }), error ? 'stato non aggiornato: ' + error.message : '')
  }

  // 1. LDV comprate e righe non scritte.
  const { data: conLdv, error: e1 } = await admin.from('ponte_in_corso').select('id,ldv,ldv_dati,piano,contratto,creato_il')
    .eq('stato', 'ldv').lt('aggiornato_il', new Date(ora - ATTESA_LDV_MS).toISOString()).order('creato_il').limit(PER_GIRO)
  if (e1) return NextResponse.json({ error: 'ponte_in_corso: ' + e1.message }, { status: 500 })
  for (const r of (conLdv || []) as any[]) {
    try {
      // L'etichetta dal corriere del detentore: la prima riga del piano e' la sua (il piano va dal detentore in su).
      const rigaDet = (r.piano?.ops || []).find((o: any) => o.op === 'spedizione')?.riga
      let etichettaUrl: string | null = null
      if (rigaDet?.corriere_id && r.ldv_dati?.downloadUrl) {
        const { data: cor } = await admin.from('corrieri').select('id,settings,credenziali').eq('id', rigaDet.corriere_id).maybeSingle()
        if (cor) {
          try {
            const { etichettaKsync } = await import('@/lib/ksync')
            const lab = await etichettaKsync(credenzialiKsyncV1(cor, (cor as any).credenziali || {}), r.ldv_dati.downloadUrl, 'pdf')
            if (lab.bytes?.length) etichettaUrl = `data:application/pdf;base64,${lab.bytes.toString('base64')}`
          } catch (e: any) { console.error('[PONTE][RECUPERO] etichetta non ripresa, si scrive senza:', r.ldv, e?.message) }
        }
      }
      const completo = completaPiano(r.piano, { numero: r.ldv, etichettaUrl, raw: r.ldv_dati })
      const { data, error } = await admin.rpc('ponte_scrivi', { p_piano: completo, p_prova: false })
      if (error) { esito.non_scritte++; await nonScritta(r, error.message); continue }
      if ((data as any)?.gia_scritta) esito.gia_scritte++
      else { esito.scritte++; console.warn('[PONTE][RECUPERATA]', r.id, r.ldv, r.contratto) }
    } catch (e: any) {
      esito.non_scritte++
      await nonScritta(r, String(e?.message || e))
    }
  }

  // 2. Interrotte prima della LDV.
  const { data: ferme, error: e2 } = await admin.from('ponte_in_corso').select('id,master_id,contratto,creato_il')
    .eq('stato', 'in_corso').lt('creato_il', new Date(ora - ATTESA_IN_CORSO_MS).toISOString()).order('creato_il').limit(PER_GIRO)
  if (e2) return NextResponse.json({ error: 'ponte_in_corso: ' + e2.message, ...esito }, { status: 500 })
  for (const r of (ferme || []) as any[]) {
    const { error } = await admin.rpc('ponte_storna', { p_id: r.id, p_errore: 'processo interrotto prima della LDV' })
    if (error) { console.error('[PONTE][RECUPERO] storno non riuscito:', r.id, error.message); continue }
    esito.stornate++
    console.error('[PONTE][INTERROTTA PRIMA DELLA LDV]', JSON.stringify({ id: r.id, master: r.master_id, contratto: r.contratto, creato_il: r.creato_il }))
  }

  if (esito.scritte || esito.non_scritte || esito.stornate) console.log('[PONTE][RECUPERO]', JSON.stringify(esito))
  return NextResponse.json(esito)
}
