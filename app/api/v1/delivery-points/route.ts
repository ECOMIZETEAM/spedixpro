import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autenticaApiKey, rispostaBlocco } from '@/lib/api-auth'
import { modalitaConsegna, cercaPuntiConsegna, ErrorePunti } from '@/lib/punti-consegna'

// GET /api/v1/delivery-points — i punti dove il contratto della API key puo' consegnare (PuntoPoste,
// Uffici Postali, Fermopoint, locker), vicino a un CAP o a una posizione.
// Query: postalCode (CAP) oppure lat+lng; city facoltativa.
// Il corriere non si indica: la chiave e' gia' legata a un contratto, e ogni contratto ha i suoi
// punti. Il `code` di un punto va in deliveryPoint.code di POST /api/v1/shipments.
//
// Chiesta il 09/11/2026 da un cliente che si integra: il portale sceglieva i punti da settembre,
// l'API no, quindi su questi contratti dall'API non si poteva spedire affatto.
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const _b = rispostaBlocco(ctx); if (_b) return _b

  const p = req.nextUrl.searchParams
  const cap = String(p.get('postalCode') || p.get('cap') || '').trim()
  const citta = String(p.get('city') || p.get('citta') || '').trim()
  const latS = p.get('lat'), lngS = p.get('lng') ?? p.get('lon')
  const lat = latS != null && latS !== '' ? Number(latS) : undefined
  const lng = lngS != null && lngS !== '' ? Number(lngS) : undefined

  const admin = createAdminSupabase()
  const { data: corriere } = await admin.from('corrieri')
    .select('id,tipo,credenziali,settings,nome_contratto').eq('id', ctx.corriereId).maybeSingle()
  if (!corriere) return NextResponse.json({ error: 'Contratto non trovato' }, { status: 400 })

  // CONTRATTO CONDIVISO: le credenziali del fornitore vero le ha il venditore, che cerca per noi.
  if (corriere.tipo === 'moovexpress') {
    const { data: cliente } = await admin.from('clienti').select('master_id').eq('id', ctx.clienteId).maybeSingle()
    const { risolviChiaveDispatch } = await import('@/lib/condivisione-catena')
    const credMv = await risolviChiaveDispatch(admin, (cliente as any)?.master_id, corriere.nome_contratto)
    if (!credMv?.api_key) return NextResponse.json({ error: 'Contratto non configurato correttamente' }, { status: 400 })
    const { puntiMoovexpress } = await import('@/lib/moovexpress')
    const q = new URLSearchParams()
    if (cap) q.set('postalCode', cap)
    if (citta) q.set('city', citta)
    if (lat != null && lng != null) { q.set('lat', String(lat)); q.set('lng', String(lng)) }
    const { stato, corpo } = await puntiMoovexpress(credMv as any, q)
    // Il nome del contratto e' quello di chi chiede, non quello del venditore.
    return NextResponse.json(stato < 300 ? { ...corpo, contratto: corriere.nome_contratto } : corpo, { status: stato })
  }

  const m = modalitaConsegna(corriere)
  if (!m.aUnPunto) {
    return NextResponse.json({
      error: 'Questo contratto consegna a domicilio: non ci sono punti da scegliere.',
      contratto: corriere.nome_contratto, consegna: 'domicilio',
    }, { status: 400 })
  }

  try {
    const punti = await cercaPuntiConsegna(corriere, { cap, citta, lat, lng })
    return NextResponse.json({ contratto: corriere.nome_contratto, tipo_punto: m.tipoPunto, points: punti })
  } catch (e: any) {
    if (e instanceof ErrorePunti) return NextResponse.json({ error: e.message }, { status: e.stato })
    console.error('[V1][DELIVERY-POINTS]', String(e?.message || e).slice(0, 150))
    return NextResponse.json({ error: 'Ricerca punti non disponibile in questo momento.' }, { status: 502 })
  }
}
