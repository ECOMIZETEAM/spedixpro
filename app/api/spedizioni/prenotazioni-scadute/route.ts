import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// RETE DI SICUREZZA DELLA PRENOTAZIONE CREDITO.
//
// In creazione spedizione il credito del cliente viene PRENOTATO prima di chiamare il corriere
// (riferimento 'PRE:<uuid>'), e poi confermato sull'importo definitivo o stornato se la spedizione
// non nasce. Se la rotta muore nel mezzo — funzione riavviata, timeout della piattaforma, errore
// non previsto — la prenotazione resta appesa e il cliente si vede trattenuto un importo per una
// spedizione che non esiste.
//
// Qui si liberano le prenotazioni piu' vecchie di 15 minuti: nessuna creazione dura cosi' tanto
// (le piu' lente, con attesa del tracking e dell'etichetta, stanno sotto il minuto), quindi una
// prenotazione di quell'eta' e' certamente orfana.
// Lo storno e' idempotente: se nel frattempo e' stata confermata, non fa nulla.
const MINUTI_SCADENZA = 15

export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  const soglia = new Date(Date.now() - MINUTI_SCADENZA * 60 * 1000).toISOString()

  const { data: appese, error } = await admin
    .from('movimenti')
    .select('id,riferimento,cliente_id,importo,created_at')
    .like('riferimento', 'PRE:%')
    .eq('tipo', 'spedizione')
    .is('spedizione_id', null)
    .lt('created_at', soglia)
    .limit(500)

  // Il messaggio del database non esce nella risposta: descrive tabelle e colonne interne.
  if (error) { console.error('[PRENOTAZIONI]', error.message); return NextResponse.json({ error: 'Errore interno' }, { status: 500 }) }
  if (!appese?.length) return NextResponse.json({ ok: true, liberate: 0 })

  let liberate = 0
  let importoRestituito = 0
  for (const p of appese) {
    const { error: e } = await admin.rpc('storna_prenotazione_spedizione', { p_riferimento: (p as any).riferimento })
    if (e) { console.error('[PRENOTAZIONI][STORNO]', (p as any).riferimento, e.message); continue }
    liberate++
    importoRestituito += Math.abs(Number((p as any).importo) || 0)
  }

  if (liberate) {
    console.warn('[PRENOTAZIONI] liberate prenotazioni orfane', {
      quante: liberate, importo: Math.round(importoRestituito * 100) / 100,
    })
  }
  return NextResponse.json({ ok: true, liberate, importoRestituito: Math.round(importoRestituito * 100) / 100 })
}
