import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// IL MARGINE SALVATO RESTA AL PASSO, SENZA TOCCARE LA TABELLA DEI SOLDI.
//
// `margini_spedizione` serve a ORDINARE l'elenco per margine senza ricalcolare 110.000 righe a ogni
// pagina. Per tenerlo aggiornato la strada ovvia sarebbe un trigger su `movimenti` — ed e' proprio
// quella che NON si prende: `movimenti` e' la tabella da cui dipendono credito e addebiti, e un
// trigger che sbaglia li' non rallenta una lista, impedisce di spedire. Qui invece si guarda ogni
// pochi minuti cosa e' cambiato e si ricalcola: se questo giro salta, l'unico effetto e' che una
// spedizione sta nel posto sbagliato dell'ordinamento per qualche minuto. La cifra mostrata all'utente
// non dipende da qui: quella la calcola sempre la rotta dell'elenco.
//
// COSA FA CAMBIARE UN MARGINE (verificato leggendo il codice il 25/09):
//  - un movimento di tipo 'spedizione' nuovo (creazione, conferma della prenotazione, storno);
//  - una spedizione appena nata, che i movimenti non li ha ancora;
//  - il `costo_totale` riscritto da "modifica spedizione", che conta SOLO dove i movimenti non ci sono
//    (le ripesature e le modifiche di peso scrivono 'rettifica', che sta fuori dal margine per regola).
// In piu' si ripara da solo: a ogni giro prende anche un po' di spedizioni che una riga non ce l'hanno
// proprio, cosi' un buco — da un rilascio, da un errore, da qualunque cosa — si richiude da solo.
export async function GET(req: NextRequest) {
  const _b = bloccaCronNonAutorizzato(req); if (_b) return _b
  const admin = createAdminSupabase()
  const da = new Date(Date.now() - 20 * 60 * 1000).toISOString()   // finestra larga: il giro e' ogni 5 min
  const ids = new Set<string>()

  // 1) spedizioni con un movimento 'spedizione' recente
  for (let from = 0; from < 5000; from += 1000) {
    const { data } = await admin.from('movimenti').select('spedizione_id')
      .eq('tipo', 'spedizione').gte('created_at', da).not('spedizione_id', 'is', null)
      .order('created_at', { ascending: false }).range(from, from + 999)
    for (const m of (data || [])) if ((m as any).spedizione_id) ids.add((m as any).spedizione_id)
    if (!data || data.length < 1000) break
  }
  // 2) spedizioni nate o modificate da poco (la modifica riscrive costo_totale)
  for (const campo of ['created_at', 'updated_at'] as const) {
    const { data } = await admin.from('spedizioni').select('id').gte(campo, da)
      .order(campo, { ascending: false }).limit(1000)
    for (const s of (data || [])) ids.add((s as any).id)
  }
  const daCambiamenti = ids.size

  // 3) AUTO-RIPARAZIONE: un po' di spedizioni che non hanno ancora la riga del margine.
  const { data: senza } = await admin.rpc('spedizioni_senza_margine', { p_quante: 2000 })
  for (const r of ((senza || []) as any[])) ids.add(r.id)
  const daRiparare = ids.size - daCambiamenti

  let righe = 0
  const lista = [...ids]
  for (let i = 0; i < lista.length; i += 1000) {
    const { data: n, error } = await admin.rpc('ricalcola_margini', { p_ids: lista.slice(i, i + 1000) })
    if (error) { console.error('[MARGINI] ricalcolo fallito:', error.message); break }
    righe += Number(n || 0)
  }
  const esito = { spedizioni: lista.length, daCambiamenti, daRiparare, righe }
  if (lista.length) console.log('[MARGINI]', JSON.stringify(esito))
  return NextResponse.json({ success: true, ...esito })
}
