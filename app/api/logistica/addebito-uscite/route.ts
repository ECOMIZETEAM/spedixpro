import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { vedeLaRete } from '@/lib/perimetro'
import { registraMovimento } from '@/lib/movimenti'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// IL COSTO DELL'USCITA: preparare il pacco, a fasce di peso.
//
// PERCHE' UN GIRO E NON UN AGGANCIO ALLA CREAZIONE. La creazione ha quattro rami, uno per corriere,
// piu' l'API pubblica, l'import e i negozi online: metterci dentro un addebito vorrebbe dire
// scriverlo in otto punti e sperare di non dimenticarne uno. Qui invece si guardano le spedizioni
// GIA' fatte, e cosi' sono coperte tutte le porte insieme, comprese quelle che nasceranno.
// E la creazione non viene toccata: se questo giro si rompe, nessuno smette di spedire.
//
// NON SERVE UNA CODA. La coda e' l'assenza dell'addebito: si cercano le spedizioni che non hanno
// ancora una riga 'uscita' in `logistica_addebiti`. L'indice unico su (spedizione) garantisce che
// non se ne possa creare una seconda, quindi il giro e' ripetibile senza danni per costruzione.
//
// SPENTO PER COSTRUZIONE: si guardano SOLO i clienti che hanno le fasce compilate. Un cliente senza
// fasce non viene nemmeno letto. Il servizio si accende cliente per cliente.

const GIORNI = 40   // finestra: piu' che sufficiente, e non fa rileggere tutto lo storico

export async function GET(req: NextRequest) {
  const anteprima = req.nextUrl.searchParams.get('anteprima') === '1'
  const supabase = await createServerSupabase()
  let master: string | null = null
  if (anteprima) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
    const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
    if (!vedeLaRete(u)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    master = u.master_id
  } else {
    const _b = bloccaCronNonAutorizzato(req); if (_b) return _b
  }

  const admin = createAdminSupabase()

  // 1) Chi ha il servizio acceso, cioe' chi ha le fasce.
  let qf = admin.from('logistica_fasce').select('cliente_id,master_id,peso_max,prezzo')
  if (master) {
    const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
    const rete = await sottoAlberoMasterIds(admin, master)
    qf = qf.in('master_id', rete.length ? rete : ['00000000-0000-0000-0000-000000000000'])
  }
  const { data: fasce } = await qf
  if (!fasce?.length) return NextResponse.json({ anteprima, attivi: 0, da_addebitare: 0, totale: 0, clienti: [] })

  type Fascia = { peso: number; prezzo: number }
  const perCliente = new Map<string, { master_id: string; fasce: Fascia[] }>()
  for (const f of fasce) {
    const r = perCliente.get(f.cliente_id) || { master_id: f.master_id, fasce: [] as Fascia[] }
    r.fasce.push({ peso: Number(f.peso_max), prezzo: Number(f.prezzo) })
    perCliente.set(f.cliente_id, r)
  }
  for (const r of perCliente.values()) r.fasce.sort((a, b) => a.peso - b.peso)

  // La fascia e' la prima che copre il peso. Oltre l'ultima si applica l'ultima: e' quello che fa
  // il motore dei corrieri, e non lasciare scoperto un pacco pesante e' meglio che non addebitarlo.
  const prezzoDi = (fs: Fascia[], peso: number) => {
    for (const f of fs) if (peso <= f.peso) return f.prezzo
    return fs.length ? fs[fs.length - 1].prezzo : 0
  }

  // 2) Le spedizioni di quei clienti, nella finestra, ancora senza addebito d'uscita.
  const dal = new Date(Date.now() - GIORNI * 86400000).toISOString()
  const { data: speds } = await admin.from('spedizioni')
    .select('id,numero,cliente_id,master_id,peso_fatturato,peso_reale,created_at')
    .in('cliente_id', Array.from(perCliente.keys()))
    .gte('created_at', dal)
    .not('stato', 'in', '("annullata","annullamento_manuale")')
    .limit(3000)
  if (!speds?.length) return NextResponse.json({ anteprima, attivi: perCliente.size, da_addebitare: 0, totale: 0, clienti: [] })

  const { data: gia } = await admin.from('logistica_addebiti')
    .select('spedizione_id').eq('tipo', 'uscita').in('spedizione_id', speds.map((s: any) => s.id))
  const fatte = new Set((gia || []).map((g: any) => g.spedizione_id))

  const daFare = speds.filter((s: any) => !fatte.has(s.id))

  if (anteprima) {
    const per = new Map<string, { posti: number; importo: number }>()
    for (const s of daFare) {
      const c = perCliente.get(s.cliente_id)!
      const p = prezzoDi(c.fasce, Number(s.peso_fatturato || s.peso_reale || 0))
      const r = per.get(s.cliente_id) || { posti: 0, importo: 0 }
      r.posti++; r.importo = Math.round((r.importo + p) * 100) / 100
      per.set(s.cliente_id, r)
    }
    const { data: nomi } = await admin.from('clienti').select('id,ragione_sociale').in('id', Array.from(per.keys()).length ? Array.from(per.keys()) : ['00000000-0000-0000-0000-000000000000'])
    const nome = new Map((nomi || []).map((n: any) => [n.id, n.ragione_sociale]))
    return NextResponse.json({
      anteprima: true, attivi: perCliente.size, da_addebitare: daFare.length,
      totale: Math.round(Array.from(per.values()).reduce((t, r) => t + r.importo, 0) * 100) / 100,
      clienti: Array.from(per.entries()).map(([id, r]) => ({ cliente: nome.get(id) || '—', spedizioni: r.posti, importo: r.importo })).sort((a, b) => b.importo - a.importo),
    })
  }

  let addebitate = 0, saltate = 0, euro = 0
  for (const s of daFare) {
    const c = perCliente.get(s.cliente_id)!
    const peso = Number(s.peso_fatturato || s.peso_reale || 0)
    const prezzo = prezzoDi(c.fasce, peso)
    if (!(prezzo > 0)) continue
    const descrizione = `Preparazione pacco ${s.numero || ''} (${peso} kg)`.trim()
    try {
      // Prima il segno, poi il credito: se l'indice unico rifiuta non si tocca niente.
      const { error: eAdd } = await admin.from('logistica_addebiti').insert({
        master_id: c.master_id, cliente_id: s.cliente_id, tipo: 'uscita',
        spedizione_id: s.id, importo: prezzo, descrizione,
      })
      if (eAdd) { if ((eAdd as any).code === '23505') { saltate++; continue } throw eAdd }

      await registraMovimento(admin, {
        masterId: c.master_id, clienteId: s.cliente_id, tipo: 'logistica' as any,
        descrizione, importo: -Math.abs(prezzo), riferimento: s.numero || null, spedizioneId: s.id,
      })
      addebitate++; euro = Math.round((euro + prezzo) * 100) / 100
    } catch (e: any) {
      console.error('[LOGISTICA-USCITE] addebito fallito', s.id, e?.message)
    }
  }

  const esito = { addebitate, saltate_gia_fatte: saltate, euro, clienti_attivi: perCliente.size }
  console.log('[LOGISTICA-USCITE]', JSON.stringify(esito))
  return NextResponse.json(esito)
}
