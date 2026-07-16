import { NextRequest, NextResponse } from 'next/server'
import { autenticaApiKey } from '@/lib/api-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { spediamoproGetTracking, mapStatoSpediamopro } from '@/lib/spediamopro'
import { mapStatoSpedisci, prioritaStato } from '@/lib/spedisci'
import { inviaWebhook } from '@/lib/webhooks'

// API pubblica MoovExpress — tracking di una spedizione tramite numero di tracking.
// Auth: Authorization: Bearer <api_key>
// GET /api/v1/tracking/{tracking_number}
export async function GET(req: NextRequest, { params }: { params: Promise<{ tracking: string }> }) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const { tracking } = await params
  const trk = decodeURIComponent(tracking || '').trim()
  if (!trk) return NextResponse.json({ error: 'Numero di tracking mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  // Solo spedizioni del cliente della API key (per tracking_number oppure numero LDV)
  const { data: sped } = await admin.from('spedizioni')
    .select('id,stato,tracking_number,numero,corriere_id,dest_citta,dest_provincia,raw_response,cliente_id')
    .eq('cliente_id', ctx.clienteId)
    .or(`tracking_number.eq.${trk},numero.eq.${trk}`)
    .limit(1).maybeSingle()
  if (!sped) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })

  const { data: corriere } = await admin.from('corrieri')
    .select('credenziali,tipo,nome_contratto').eq('id', sped.corriere_id).maybeSingle()

  const base = {
    tracking_number: sped.tracking_number || sped.numero,
    carrier: corriere?.nome_contratto || null,
    status: sped.stato,
    location: sped.dest_citta || '',
  }
  if (!corriere) return NextResponse.json({ ...base, events: [] })

  const cred = (corriere.credenziali || {}) as Record<string, string>

  // Aggiorna lo stato salvato dallo stato live (best-effort, come il tracking del portale)
  // e notifica i webhook del cliente quando lo stato cambia davvero.
  const notifica = (evento: 'tracking.updated' | 'tracking.delivered' | 'tracking.exception', stato: string, eventi: any[]) => {
    inviaWebhook({
      clienteId: sped.cliente_id, corriereId: sped.corriere_id, evento,
      data: {
        tracking_number: sped.tracking_number || sped.numero,
        carrier: corriere?.nome_contratto || null,
        status: stato,
        location: sped.dest_citta || '',
        events: eventi,
      },
    }).catch(() => {})
  }
  const persistiStato = async (nuovo: string | null, eventi: any[] = []) => {
    if (!nuovo || nuovo === sped.stato) return
    if (nuovo === 'eccezione') { notifica('tracking.exception', nuovo, eventi); return }
    if (sped.stato === 'consegnata' || sped.stato === 'annullata') return
    try { await admin.from('spedizioni').update({ stato: nuovo }).eq('id', sped.id) } catch {}
    notifica(nuovo === 'consegnata' ? 'tracking.delivered' : 'tracking.updated', nuovo, eventi)
  }

  try {
    if (corriere.tipo === 'spediamopro') {
      const raw: any = sped.raw_response || {}
      const spid = raw.id || raw?.raw?.data?.id
      if (!spid || !cred.authcode) return NextResponse.json({ ...base, events: [] })
      const tr = await spediamoproGetTracking(cred.authcode, Number(spid))
      const nuovo = mapStatoSpediamopro(tr.status)
      const events = (tr.events || []).map((e: any) => ({
        timestamp: e.at || e.date || '',
        status: [e.title, e.description].filter(Boolean).join(' — ') || 'Evento',
        location: '',
      })).reverse()
      await persistiStato(nuovo, events)
      return NextResponse.json({ ...base, status: nuovo || sped.stato, events })
    }

    // Spedisci: tracking sul dominio del contratto
    const res = await fetch(`https://${cred.master_domain}/api/v2/shipping/tracking/${encodeURIComponent(sped.tracking_number || '')}`, {
      headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
    })
    const text = await res.text()
    let data: any; try { data = JSON.parse(text) } catch { data = {} }
    const grezzi = data.events || data.tracking || data.trackingEvents || (Array.isArray(data) ? data : [])

    // Stato "più avanzato" dagli eventi
    const candidati: string[] = []
    for (const k of ['status', 'stato', 'current_status', 'state']) if (typeof data?.[k] === 'string') candidati.push(data[k])
    for (const e of (Array.isArray(grezzi) ? grezzi : [])) {
      for (const k of ['status', 'description', 'descrizione', 'stato', 'state', 'message', 'event', 'text', 'nota']) {
        if (e && typeof e[k] === 'string') candidati.push(e[k])
      }
    }
    let nuovo: string | null = null
    for (const c of candidati) { const m = mapStatoSpedisci(c); if (m && prioritaStato(m) > prioritaStato(nuovo)) nuovo = m }

    const events = (Array.isArray(grezzi) ? grezzi : []).map((e: any) => ({
      timestamp: e.timestamp || e.date || e.data || e.at || '',
      status: e.status || e.description || e.descrizione || e.message || e.nota || 'Evento',
      location: e.location || e.luogo || e.city || '',
    }))
    await persistiStato(nuovo, events)
    return NextResponse.json({ ...base, status: nuovo || sped.stato, events })
  } catch (e: any) {
    return NextResponse.json({ ...base, events: [], error: 'Tracking non disponibile al momento' })
  }
}
