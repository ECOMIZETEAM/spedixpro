import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { completaTmp } from '@/lib/tmp-completa'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Corto di proposito: fa una cosa sola su poche righe. Se il fornitore e' lento il giro finisce
// comunque, e fra due minuti ce n'e' un altro.
export const maxDuration = 60

// GIRO VELOCE: completa SOLO le spedizioni ferme sul numero provvisorio, ogni 2 minuti.
//
// Il recupero grosso (/api/spedizioni/tmp-recupero) fa quattro mestieri in una funzione sola —
// numeri provvisori, etichette dei multicollo, SpediamoPro fermi sulla referenza, archiviazione
// delle etichette — e gira ogni 15 minuti. Va benissimo per il resto, non per questo: il cliente
// resta davanti all'elenco con "LDV in elaborazione" e non puo' stampare niente.
//
// MISURATO IL 23/09/2026: alle 16:05 DVA aveva gia' pronte le lettere di vettura di 4 spedizioni
// create alle 15:34; il giro da 15 minuti le ha completate alle 16:15:52. Quei dieci minuti erano
// attesa NOSTRA, sopra a quella del fornitore (che ieri e oggi supera la mezz'ora). Questo giro la
// toglie. Quando invece il fornitore non ha ancora fatto la LDV non c'e' frequenza che tenga: si
// aspetta lui, e lo dice la lista.
//
// Lotto piccolo apposta: 25 righe per giro, ogni 2 minuti, sono 750 tentativi l'ora — piu' di
// quante spedizioni DVA nascano in un'ora. Chi resta fuori lo prende il giro dopo.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  const esito = await completaTmp(admin, { limite: 25 })
  if (esito.completate || esito.soloEtichette) {
    console.log('[TMP-LAMPO] completate', esito.completate, '| solo etichette', esito.soloEtichette, '| su', esito.esaminate)
  }
  return NextResponse.json({ ok: true, ...esito })
}
