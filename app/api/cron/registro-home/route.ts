import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// IL REGISTRO DELLA HOME (scripts/registro-home.sql), ogni due minuti.
//
// Le tre funzioni della home del master non ricontano piu' tutte le spedizioni a ogni apertura: leggono
// un registro (una riga per master, cliente, contratto, giorno e stato) piu' il quaderno delle variazioni
// che il trigger su spedizioni riempie a ogni cambio. Qui si riporta il quaderno nel registro, cosi' resta
// corto e le letture restano veloci. I numeri sono giusti anche se questo giro saltasse per ore (le funzioni
// sommano registro e quaderno): si allungherebbe solo il quaderno.
//
// Alle 02:40 UTC, una volta al giorno, anche la VERIFICA: registro contro spedizioni, chiave per chiave. Se
// una chiave non torna la scrive con [REGISTRO HOME][DIVERSO] (con qualche esempio): vuol dire che qualcosa
// ha cambiato le spedizioni senza passare dal trigger, e va guardato. Sta qui e non in un giro a parte per
// non aggiungere una voce ai cron del progetto.
//
// Prima che lo SQL sia incollato le funzioni non esistono: il giro risponde e non fa niente, senza riempire
// i log di errori.

const FUNZIONE_MANCANTE = 'PGRST202'

function eOraDellaVerifica(d: Date) {
  // Il giro e' ogni due minuti: la finestra di due minuti ne prende uno solo, anche se arriva in ritardo.
  return d.getUTCHours() === 2 && d.getUTCMinutes() >= 40 && d.getUTCMinutes() < 42
}

export async function GET(req: NextRequest) {
  const _b = bloccaCronNonAutorizzato(req); if (_b) return _b
  const admin = createAdminSupabase()

  const { data: consolidate, error } = await admin.rpc('fn_riepilogo_spedizioni_consolida')
  if (error) {
    if (error.code === FUNZIONE_MANCANTE) return NextResponse.json({ registro: 'non ancora creato' })
    console.error('[REGISTRO HOME] consolida fallita:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const forza = req.nextUrl.searchParams.get('verifica') === '1'
  if (!forza && !eOraDellaVerifica(new Date())) return NextResponse.json({ consolidate })

  const { data: verifica, error: eV } = await admin.rpc('fn_riepilogo_spedizioni_verifica')
  if (eV) {
    console.error('[REGISTRO HOME] verifica non riuscita:', eV.message)
    return NextResponse.json({ consolidate, error: eV.message }, { status: 500 })
  }
  const v = verifica as { chiavi_diverse?: number; chiavi?: number; esempi?: unknown; registro_vuoto?: boolean } | null
  if (v?.chiavi_diverse) {
    console.error('[REGISTRO HOME][DIVERSO]', JSON.stringify({ chiavi_diverse: v.chiavi_diverse, chiavi: v.chiavi, esempi: v.esempi }))
  } else {
    console.log('[REGISTRO HOME] verifica:', JSON.stringify({ chiavi_diverse: v?.chiavi_diverse ?? null, chiavi: v?.chiavi ?? null, registro_vuoto: !!v?.registro_vuoto }))
  }
  return NextResponse.json({ consolidate, verifica: v })
}
