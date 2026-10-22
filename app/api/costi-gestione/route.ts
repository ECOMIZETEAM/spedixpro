import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { registraAudit } from '@/lib/audit'
import {
  dataFineDaDurata, dataValida, leggiCostiGestione, oggiRoma, puoGestireCosti, riepilogoCosti,
  type Periodicita,
} from '@/lib/costi-gestione'

export const dynamic = 'force-dynamic'

// COSTI DI GESTIONE del master (scripts/costi-gestione.sql): personale, affitto, mezzi, marketing...
// Servono a calcolare l'utile netto e non muovono soldi. Li legge e li scrive SOLO il titolare o un suo
// admin (Lorenzo, 22/10): ci sono gli stipendi delle persone. La tabella e' chiusa ad anon e
// authenticated, quindi si passa dal client di servizio e il master si prende dalla sessione, mai dal
// browser.

async function chiamante() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { errore: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  if (!puoGestireCosti(utente as any)) {
    return { errore: NextResponse.json({ error: 'I costi di gestione li vede solo il titolare.' }, { status: 403 }) }
  }
  return { userId: user.id, ruolo: (utente as any).ruolo as string, masterId: (utente as any).master_id as string }
}

const PERIODICITA: Periodicita[] = ['una_tantum', 'mensile', 'annuale']
const pulito = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

// La riga da salvare, letta e controllata dal corpo della richiesta. La data di fine la calcola il
// server dalla durata: dal browser arriva "3 mesi", non una data che potrebbe non tornare.
function leggiVoce(body: any): { riga: Record<string, any> } | { errore: string } {
  const categoria = pulito(body?.categoria, 60)
  const descrizione = pulito(body?.descrizione, 120)
  const note = pulito(body?.note, 300)
  const importo = Math.round(Number(body?.importo) * 100) / 100
  const periodicita = String(body?.periodicita || '') as Periodicita
  const inizio = body?.dataInizio
  if (!categoria) return { errore: 'Scegli una categoria' }
  if (!descrizione) return { errore: 'Scrivi a cosa si riferisce il costo (es. il nome della persona)' }
  if (!isFinite(importo) || importo <= 0 || importo > 10000000) return { errore: 'Importo non valido' }
  if (!PERIODICITA.includes(periodicita)) return { errore: 'Indica ogni quanto si paga' }
  if (!dataValida(inizio)) return { errore: 'Data di inizio non valida' }

  let fine: string | null = inizio
  if (periodicita !== 'una_tantum') {
    const durata = String(body?.durata || '')
    const n = Math.floor(Number(body?.durataNumero))
    if (durata === 'sempre') fine = null
    else if (durata === 'mesi' || durata === 'anni') {
      const mesi = durata === 'anni' ? n * 12 : n
      if (!(n >= 1) || mesi > 600) return { errore: 'Durata non valida' }
      fine = dataFineDaDurata(inizio, mesi)
    } else if (durata === 'data') {
      if (!dataValida(body?.dataFine)) return { errore: 'Data di fine non valida' }
      if (body.dataFine < inizio) return { errore: 'La data di fine viene prima di quella di inizio' }
      fine = body.dataFine
    } else return { errore: 'Indica per quanto tempo vale' }
  }
  return { riga: { categoria, descrizione, importo, periodicita, data_inizio: inizio, data_fine: fine, note: note || null } }
}

export async function GET(req: NextRequest) {
  const c = await chiamante()
  if ('errore' in c) return c.errore
  // Il periodo del riepilogo: quello chiesto (le card della dashboard), altrimenti il mese in corso intero.
  const oggi = oggiRoma()
  let dal = req.nextUrl.searchParams.get('dal') || ''
  let al = req.nextUrl.searchParams.get('al') || ''
  if (!dataValida(dal) || !dataValida(al) || al < dal) {
    dal = oggi.slice(0, 8) + '01'
    const [y, m] = [+oggi.slice(0, 4), +oggi.slice(5, 7)]
    al = oggi.slice(0, 8) + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')
  }
  try {
    const voci = await leggiCostiGestione(createAdminSupabase(), c.masterId)
    return NextResponse.json({ voci, dal, al, ...riepilogoCosti(voci, dal, al) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Errore' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const c = await chiamante()
  if ('errore' in c) return c.errore
  const v = leggiVoce(await req.json().catch(() => ({})))
  if ('errore' in v) return NextResponse.json({ error: v.errore }, { status: 400 })
  const { data, error } = await createAdminSupabase().from('costi_gestione')
    .insert({ ...v.riga, master_id: c.masterId, created_by: c.userId, updated_by: c.userId })
    .select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await registraAudit({ utenteId: c.userId, ruolo: c.ruolo, azione: 'costo_gestione_aggiunto', risorsa: (data as any)?.id, dettaglio: `${v.riga.categoria} · ${v.riga.descrizione} · ${v.riga.importo} ${v.riga.periodicita}` })
  return NextResponse.json({ ok: true, id: (data as any)?.id })
}

export async function PATCH(req: NextRequest) {
  const c = await chiamante()
  if ('errore' in c) return c.errore
  const body = await req.json().catch(() => ({} as any))
  const id = String(body?.id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Voce non valida' }, { status: 400 })
  const v = leggiVoce(body)
  if ('errore' in v) return NextResponse.json({ error: v.errore }, { status: 400 })
  // Il filtro sul master e' il permesso: una voce di un altro master non si trova, quindi non si tocca.
  const { data, error } = await createAdminSupabase().from('costi_gestione')
    .update({ ...v.riga, updated_by: c.userId, updated_at: new Date().toISOString() })
    .eq('id', id).eq('master_id', c.masterId).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data?.length) return NextResponse.json({ error: 'Voce non trovata' }, { status: 404 })
  await registraAudit({ utenteId: c.userId, ruolo: c.ruolo, azione: 'costo_gestione_modificato', risorsa: id, dettaglio: `${v.riga.categoria} · ${v.riga.descrizione} · ${v.riga.importo} ${v.riga.periodicita}` })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const c = await chiamante()
  if ('errore' in c) return c.errore
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Voce non valida' }, { status: 400 })
  const { data, error } = await createAdminSupabase().from('costi_gestione')
    .delete().eq('id', id).eq('master_id', c.masterId).select('categoria,descrizione,importo,periodicita')
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data?.length) return NextResponse.json({ error: 'Voce non trovata' }, { status: 404 })
  const r: any = data[0]
  await registraAudit({ utenteId: c.userId, ruolo: c.ruolo, azione: 'costo_gestione_eliminato', risorsa: id, dettaglio: `${r.categoria} · ${r.descrizione} · ${r.importo} ${r.periodicita}` })
  return NextResponse.json({ ok: true })
}
