import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autenticaApiKey, rispostaBlocco } from '@/lib/api-auth'
import { leggiEtichettaCompleta } from '@/lib/etichette'

// Scarica l'etichetta (LDV) PDF della spedizione creata via API
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const _b = rispostaBlocco(ctx); if (_b) return _b
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: s } = await admin.from('spedizioni')
    .select('id,numero,etichetta_url,etichetta_path,colli_dettaglio,raw_response,cliente_id,corriere_id,rif_ordine,contenuto,stato').eq('id', id).maybeSingle()
  if (!s || s.cliente_id !== ctx.clienteId) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  // Annullata: niente etichetta, come nelle tre porte del portale. Chi integra annulla con DELETE e poi,
  // per automazione o per errore, la riscaricava: un pacco spedito con quella LDV lo paga il detentore.
  if ((s as any).stato === 'annullata') return NextResponse.json({ error: 'Spedizione annullata: l\'etichetta non è più valida.' }, { status: 409 })
  // leggiEtichettaCompleta sa dove vive il PDF (Storage o base64) ED è MULTICOLLO: su una spedizione
  // a più colli unisce tutte le etichette in un unico PDF, così chi si integra via API non riceve il
  // solo primo collo. Prima usava leggiEtichetta (singola) e non leggeva nemmeno colli_dettaglio.
  // SDA EXPRESS L esce com'e' arrivata da Poste (resaSda:false): da qui la catena della condivisione
  // scarica l'etichetta e la SALVA sulla riga del compratore (lib/moovexpress). Servita gia' riscritta,
  // il cliente finale avrebbe avuto la resa coi dati della gamba a monte invece che della sua riga, e
  // rileggerla per riscriverla cancellava i codici (provato il 13/10). La resa pulita la fa il portale
  // di chi stampa, sulla sua riga; chi si integra via API riceve la stessa 1011 di sempre.
  const et = await leggiEtichettaCompleta(admin, s as any, { resaSda: false })
  if (!et) return NextResponse.json({ error: 'Etichetta non disponibile' }, { status: 404 })
  return new NextResponse(et.buffer as any, {
    headers: {
      'Content-Type': et.mime,
      'Content-Disposition': `attachment; filename="ldv_${s.numero || s.id}.${et.ext}"`,
    },
  })
}
