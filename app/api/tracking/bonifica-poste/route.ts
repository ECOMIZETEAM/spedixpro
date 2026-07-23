import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { prioritaStato } from '@/lib/spedisci'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// BONIFICA TEMPORANEA tracking Spedisci: il provider ha chiuso il polling (webhook-only) e le
// spedizioni gia' in viaggio prima dell'attivazione del webhook hanno il popup vuoto finche' non
// arriva il prossimo evento. Le LDV Spedisci sono codici POSTE: qui si interroga il tracking
// PUBBLICO di poste.it a piccole dosi (15 per giro, una ogni ~1.5s) per riempire cronologia e
// stato. Si esaurisce da sola: quando tutte hanno la cronologia non fa piu' nulla.
// NB: quota volutamente minuscola per non far scattare il rate-limit di Poste (400 = bloccati).

function mappaFrase(str: string): string | null {
  const t = (str || '').toLowerCase()
  if (!t) return null
  if (t.includes('non consegnat') || t.includes('mancata') || t.includes('tentativo di consegna')) return 'non_consegnato'
  if (t.includes('consegnat')) return 'consegnata'
  if (t.includes('giacenz')) return 'in_giacenza'
  if (t.includes('reso') || t.includes('restituz') || t.includes('al mittente') || t.includes('rientro')) return 'reso_mittente'
  if (t.includes('in consegna')) return 'in_consegna'
  if (t.includes('transito')) return 'in_transito'
  if (t.includes('presa in carico') || t.includes('accettat')) return 'spedita'
  return null
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const admin = createAdminSupabase()

  const { data: corr } = await admin.from('corrieri').select('id').eq('tipo', 'spedisci')
  const corrIds = (corr || []).map((c: any) => c.id)
  if (!corrIds.length) return NextResponse.json({ ok: true, fatte: 0 })

  // Candidate: attive (Poste le conosce solo dopo la presa in carico: escludo in_lavorazione)
  const { data: cand } = await admin.from('spedizioni')
    .select('id,numero,tracking_number,stato')
    .in('corriere_id', corrIds)
    .in('stato', ['spedita', 'in_transito', 'in_consegna', 'non_consegnato', 'in_giacenza'])
    .order('created_at', { ascending: true })
    .limit(400)
  if (!cand?.length) return NextResponse.json({ ok: true, fatte: 0 })

  // Solo quelle SENZA cronologia
  const { data: gia } = await admin.from('tracking_events').select('spedizione_id').in('spedizione_id', cand.map((c: any) => c.id))
  const conEventi = new Set((gia || []).map((g: any) => g.spedizione_id))
  // Priorita' agli stati piu' avanzati (in consegna prima di spedita): sono i piu' guardati dai clienti
  const lista = cand.filter((c: any) => !conEventi.has(c.id))
    .sort((a: any, b: any) => prioritaStato(b.stato) - prioritaStato(a.stato))
    .slice(0, 15)
  if (!lista.length) return NextResponse.json({ ok: true, fatte: 0, messaggio: 'bonifica esaurita' })

  let cronologie = 0, stati = 0, vuote = 0
  for (const sp of lista) {
    try {
      const r = await fetch('https://www.poste.it/online/dovequando/DQ-REST/ricercasemplice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Origin': 'https://www.poste.it', 'Referer': 'https://www.poste.it/cerca/index.html' },
        body: JSON.stringify({ tipoRichiedente: 'WEB', codiceSpedizione: sp.tracking_number || sp.numero, periodoRicerca: 6 }),
      })
      if (!r.ok) { vuote++; if (vuote >= 6) break; continue }   // 400 in serie = bloccati: stop, riprova al giro dopo
      const j: any = await r.json().catch(() => null)
      const evs: any[] = Array.isArray(j?.listaMovimenti) ? j.listaMovimenti : []
      if (!evs.length) { vuote++; if (vuote >= 6) break; continue }
      vuote = 0
      const eventi = evs.map((e: any) => ({
        stato: mappaFrase(e?.statoLavorazione),
        descrizione: String(e?.statoLavorazione || '').slice(0, 300),
        luogo: (String(e?.luogo || '').slice(0, 200)) || null,
        data_evento: new Date(Number(e?.dataOra) || Date.now()).toISOString(),
      })).filter((e: any) => e.descrizione)
      if (!eventi.length) continue
      await admin.from('tracking_events').delete().eq('spedizione_id', sp.id)
      await admin.from('tracking_events').insert(eventi.map((e: any) => ({ spedizione_id: sp.id, ...e })))
      cronologie++
      let avanzato: string | null = null
      for (const e of eventi) if (e.stato && prioritaStato(e.stato) > prioritaStato(avanzato)) avanzato = e.stato
      // Regole di sempre: solo avanti, terminali intoccabili, reso appiccicoso
      if (avanzato && avanzato !== sp.stato && prioritaStato(avanzato) > prioritaStato(sp.stato)
          && !(sp.stato === 'reso_mittente' && avanzato === 'consegnata')) {
        const upd: any = { stato: avanzato }
        if (avanzato === 'in_giacenza') upd.giacenza_data = new Date().toISOString()
        await admin.from('spedizioni').update(upd).eq('id', sp.id)
        stati++
      }
    } catch { /* singola LDV: pazienza, riprova al giro dopo */ }
    await new Promise(res => setTimeout(res, 1500))
  }
  console.log(`[BONIFICA-POSTE] cronologie=${cronologie} stati=${stati} vuote=${vuote} candidate=${lista.length}`)
  return NextResponse.json({ ok: true, fatte: cronologie, stati, vuote })
}
