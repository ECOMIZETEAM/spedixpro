import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { ldvProvvisoria } from '@/lib/numero-spedizione'

// Etichetta aperta dal DETTAGLIO spedizione. Usa leggiEtichettaCompleta come tutti gli altri punti:
// così su una spedizione MULTICOLLO escono TUTTI i colli (una pagina ciascuno) e non solo il primo.
// (Prima leggeva l'etichetta singola: da qui usciva un collo solo, es. 3UW1WLJ012948 a 3 colli.)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non autenticato', { status: 401 })
  // Lettura sotto RLS: se l'utente non può vedere la spedizione, torna null → 404 (auth per tenant).
  const { data: sped } = await supabase.from('spedizioni')
    .select('raw_response,tracking_number,numero,etichetta_url,etichetta_path,colli_dettaglio,corriere_id,colli,contenuto,rif_ordine')
    .eq('id', id).single()
  if (!sped) return new NextResponse('Non trovata', { status: 404 })

  const { leggiEtichettaCompleta } = await import('@/lib/etichette')
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  let et = await leggiEtichettaCompleta(admin, sped as any)

  // Ripiego GLS on-demand: l'etichetta del contratto proprio può non essere pronta subito dopo la
  // creazione (GLS la genera con un attimo di ritardo). Se manca, la si scarica ORA e la si salva —
  // così il tasto non resta "non disponibile" per un problema di sola tempistica.
  if (!et && (sped as any)?.raw_response?._gls) {
    try {
      const { recuperaEtichettaGlsSalvando } = await import('@/lib/gls')
      const buf = await recuperaEtichettaGlsSalvando(admin, { id, ...(sped as any) })
      if (buf?.length) et = { buffer: buf, mime: 'application/pdf', ext: 'pdf' }
    } catch (e) { console.error('[ETICHETTA][GLS] recupero on-demand:', e) }
  }

  if (!et) {
    return new NextResponse(`
      <html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2>⚠️ Etichetta non disponibile</h2>
        <p>LDV: ${sped.tracking_number || '—'}</p>
        <p>L'etichetta non è stata salvata. Ricreare la spedizione.</p>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } })
  }

  // RISCRITTURA ETICHETTA SpediamoPro: sul PDF sostituisci il CODICE interno del provider col nostro
  // RIFERIMENTO ORDINE e la "campionatura generica" col CONTENUTO dichiarato dal mittente su MoovExpress.
  // Solo spediamopro, solo PDF; ogni errore -> etichetta ORIGINALE (mai degradare la LDV).
  if (et && et.mime === 'application/pdf') {
    try {
      const { data: corr } = await admin.from('corrieri').select('tipo').eq('id', (sped as any).corriere_id).maybeSingle()
      if ((corr as any)?.tipo === 'spediamopro' && ((sped as any).rif_ordine || (sped as any).contenuto)) {
        const { riscriviEtichettaSpediamopro, codiceProviderSpediamopro } = await import('@/lib/etichetta-spediamopro')
        const nuovo = await riscriviEtichettaSpediamopro(et.buffer, {
          code: codiceProviderSpediamopro((sped as any).raw_response),
          rifOrdine: (sped as any).rif_ordine, contenuto: (sped as any).contenuto,
        })
        et = { ...et, buffer: nuovo }
      }
    } catch (e) { console.error('[ETICHETTA][SPEDIAMOPRO] rewrite serve:', e) }
  }

  return new NextResponse(new Uint8Array(et.buffer), {
    headers: {
      'Content-Type': et.mime,
      'Content-Disposition': `attachment; filename="etichetta-${(ldvProvvisoria(sped.numero) ? sped.tracking_number : sped.numero) || id}.${et.ext}"`,
    },
  })
}
