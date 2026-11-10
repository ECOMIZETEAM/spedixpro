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
  // Resa pulita SDA EXPRESS L con la stessa regola della stampa dall'elenco: chi stampa con la Zebra
  // riceve la 1011 anche da qui.
  const resaSda = async () => {
    const { resaSdaAdatta } = await import('@/lib/formato-etichetta')
    const { data: utente } = await supabase.from('utenti').select('ruolo, cliente_id, master_id').eq('id', user.id).single()
    return resaSdaAdatta(admin, utente as any)
  }
  let et = await leggiEtichettaCompleta(admin, sped as any, { resaSda })

  // Ripiego on-demand: l'etichetta GLS può non essere pronta subito dopo la creazione (GLS la genera con
  // un attimo di ritardo), e quella di un PONTE fra reti si chiede al venditore. Se manca, la si prende
  // ORA e la si salva — così il tasto non resta "non disponibile" per un problema di sola tempistica.
  // master_id letto a parte: nella select sopra accenderebbe la riscrittura del mittente in leggiEtichettaCompleta.
  if (!et) {
    const { recuperaEtichettaMancante } = await import('@/lib/etichette')
    const { data: m } = await admin.from('spedizioni').select('master_id').eq('id', id).maybeSingle()
    et = await recuperaEtichettaMancante(admin, { id, ...(sped as any), master_id: m?.master_id || null })
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

  return new NextResponse(new Uint8Array(et.buffer), {
    headers: {
      'Content-Type': et.mime,
      'Content-Disposition': `attachment; filename="etichetta-${(ldvProvvisoria(sped.numero) ? sped.tracking_number : sped.numero) || id}.${et.ext}"`,
    },
  })
}
