import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fulfillSpedizioniShopify } from '@/lib/shopify'
import { fulfillSpedizioniWoo } from '@/lib/wooFulfill'
import { fulfillSpedizioniPrestashop } from '@/lib/prestashopFulfill'
import { chiudiBorderoSpedisci } from '@/lib/spedisci'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const supabase = createAdminSupabase()

  const ora = new Date()
  const inizio = new Date(ora)
  inizio.setDate(inizio.getDate() - 1)
  inizio.setHours(23, 0, 0, 0)

  const { data: speds } = await supabase.from('spedizioni')
    .select('id,master_id,cliente_id,corriere_id,colli,peso_reale,costo_totale')
    .is('distinta_id', null)
    .gte('created_at', inizio.toISOString())

  if (!speds?.length) {
    return NextResponse.json({ success: true, distinteCreate: 0, messaggio: 'Nessuna spedizione da chiudere' })
  }

  const gruppi: Record<string, any[]> = {}
  for (const s of speds) {
    if (!s.master_id || !s.cliente_id || !s.corriere_id) continue
    const key = s.master_id + '|' + s.cliente_id + '|' + s.corriere_id
    if (!gruppi[key]) gruppi[key] = []
    gruppi[key].push(s)
  }

  let distinteCreate = 0
  for (const key in gruppi) {
    const [masterId, clienteId, corriereId] = key.split('|')
    const righe = gruppi[key]
    const totaleColli = righe.reduce((s, x) => s + Number(x.colli || 1), 0)
    const totalePeso = righe.reduce((s, x) => s + Number(x.peso_reale || 0), 0)
    const prezzoTotale = righe.reduce((s, x) => s + Number(x.costo_totale || 0), 0)
    const { data: ultima } = await supabase.from('distinte')
      .select('numero').eq('master_id', masterId).order('created_at', { ascending: false }).limit(1).single()
    let numeroInt = 1000
    if (ultima?.numero) { const n = parseInt(String(ultima.numero).replace(/\D/g, '')); if (!isNaN(n)) numeroInt = n }
    const numeroDistinta = String(numeroInt + 1)
    const { data: distinta } = await supabase.from('distinte').insert({
      master_id: masterId, cliente_id: clienteId, corriere_id: corriereId,
      numero: numeroDistinta, data: new Date().toISOString().split('T')[0], stato: 'chiusa', confermata_vettore: true, data_conferma: new Date().toISOString(),
      totale_colli: totaleColli, totale_peso: totalePeso, totale_ldv: righe.length, prezzo_totale: prezzoTotale,
    }).select().single()
    if (distinta?.id) {
      await supabase.from('spedizioni').update({ distinta_id: distinta.id }).in('id', righe.map(r => r.id))
      distinteCreate++
      // Tracking a Shopify per gli ordini ecommerce collegati (best-effort)
      try { await fulfillSpedizioniShopify(supabase, righe.map(r => r.id)) } catch {}
      try { await fulfillSpedizioniWoo(supabase, righe.map(r => r.id)) } catch {}
      try { await fulfillSpedizioniPrestashop(supabase, righe.map(r => r.id)) } catch {}
      try { await chiudiBorderoSpedisci(supabase, distinta.id) } catch {}
    }
  }
  return NextResponse.json({ success: true, distinteCreate, spedizioniChiuse: speds.length })
}