import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fulfillSpedizioniShopify } from '@/lib/shopify'
import { fulfillSpedizioniWoo } from '@/lib/wooFulfill'
import { fulfillSpedizioniPrestashop } from '@/lib/prestashopFulfill'
import { fulfillSpedizioniEbay } from '@/lib/ebayFulfill'
import { fulfillSpedizioniTiktok } from '@/lib/tiktokFulfill'
import { fulfillSpedizioniTemu } from '@/lib/temuFulfill'
import { chiudiBorderoSpedisci } from '@/lib/spedisci'
import { chiudiBordereauSpediamopro } from '@/lib/spediamopro'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const supabase = createAdminSupabase()

  const ora = new Date()
  // FINESTRA: prima prendeva solo le create nelle ultime ~22h (created_at >= ieri 23:00): chi saltava
  // un giro (annullo→ripristino 48h, cron fallito, creata tra le 23 e l'1) usciva dalla finestra PER
  // SEMPRE e restava aperta. Ora riprende TUTTO l'arretrato senza distinta degli ultimi 30 giorni,
  // escludendo le annullate/in annullo (non vanno mai in distinta).
  const inizio = new Date(ora)
  inizio.setDate(inizio.getDate() - 30)

  const { data: speds } = await supabase.from('spedizioni')
    .select('id,master_id,cliente_id,corriere_id,colli,peso_reale,costo_totale')
    .is('distinta_id', null)
    .not('stato', 'in', '(annullata,annullamento_pending,annullamento_manuale)')
    .gte('created_at', inizio.toISOString())

  if (!speds?.length) {
    return NextResponse.json({ success: true, distinteCreate: 0, messaggio: 'Nessuna spedizione da chiudere' })
  }

  // AUTODISTINTA OFF (impostazioni cliente): il cron NON chiude le spedizioni di questi clienti —
  // le distinte le fanno loro a mano dal portale. Default (nessuna impostazione) = ON.
  const { data: esclusi } = await supabase.from('clienti').select('id').eq('impostazioni->>autodistinta', 'no')
  const autodistintaOff = new Set((esclusi || []).map((c: any) => c.id))

  const gruppi: Record<string, any[]> = {}
  for (const s of speds) {
    // cliente_id NULL = spedizione PROPRIA del master: prima veniva SALTATA (mai chiusa in distinta).
    // Ora la raggruppo per master+corriere con distinta senza cliente (come la chiusura manuale "m:").
    if (!s.master_id || !s.corriere_id) continue
    if (s.cliente_id && autodistintaOff.has(s.cliente_id)) continue   // autodistinta OFF: chiude lui
    const key = s.master_id + '|' + (s.cliente_id || 'PROPRIA') + '|' + s.corriere_id
    if (!gruppi[key]) gruppi[key] = []
    gruppi[key].push(s)
  }

  let distinteCreate = 0
  for (const key in gruppi) {
    const [masterId, clienteRaw, corriereId] = key.split('|')
    const clienteId = clienteRaw === 'PROPRIA' ? null : clienteRaw
    const righe = gruppi[key]
    const totaleColli = righe.reduce((s, x) => s + Number(x.colli || 1), 0)
    const totalePeso = righe.reduce((s, x) => s + Number(x.peso_reale || 0), 0)
    const prezzoTotale = righe.reduce((s, x) => s + Number(x.costo_totale || 0), 0)
    // NUMERO GLOBALE dalla sequenza DB (atomica): unico su tutta la rete, zero conflitti.
    const { data: numSeq } = await supabase.rpc('prossimo_numero_distinta')
    const numeroDistinta = String(numSeq || Date.now())
    const { data: distinta } = await supabase.from('distinte').insert({
      master_id: masterId, cliente_id: clienteId, corriere_id: corriereId,
      numero: numeroDistinta, data: new Date().toISOString().split('T')[0], stato: 'chiusa', confermata_vettore: true, data_conferma: new Date().toISOString(),
      totale_colli: totaleColli, totale_peso: totalePeso, totale_ldv: righe.length, prezzo_totale: prezzoTotale,
    }).select().single()
    if (distinta?.id) {
      await supabase.from('spedizioni').update({ distinta_id: distinta.id }).in('id', righe.map(r => r.id))
      // Distinta = consegnate al corriere → "spedita" (solo le "in lavorazione", per non sovrascrivere
      // in_transito/consegnata). Come le chiusure manuali: si distinguono dalle etichette create dopo.
      await supabase.from('spedizioni').update({ stato: 'spedita' }).in('id', righe.map(r => r.id)).eq('stato', 'in_lavorazione')
      distinteCreate++
      // Tracking a Shopify per gli ordini ecommerce collegati (best-effort)
      try { await fulfillSpedizioniShopify(supabase, righe.map(r => r.id)) } catch {}
      try { await fulfillSpedizioniWoo(supabase, righe.map(r => r.id)) } catch {}
      try { await fulfillSpedizioniPrestashop(supabase, righe.map(r => r.id)) } catch {}
      try { await fulfillSpedizioniEbay(supabase, righe.map(r => r.id)) } catch {}
      try { await fulfillSpedizioniTiktok(supabase, righe.map(r => r.id)) } catch {}
      try { await fulfillSpedizioniTemu(supabase, righe.map(r => r.id)) } catch {}
      try { await chiudiBorderoSpedisci(supabase, distinta.id) } catch {}
      try { await chiudiBordereauSpediamopro(supabase, distinta.id) } catch {}
    }
  }
  return NextResponse.json({ success: true, distinteCreate, spedizioniChiuse: speds.length })
}