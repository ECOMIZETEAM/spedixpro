import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fulfillSpedizioniShopify } from '@/lib/shopify'
import { fulfillSpedizioniWoo } from '@/lib/wooFulfill'
import { fulfillSpedizioniPrestashop } from '@/lib/prestashopFulfill'
import { fulfillSpedizioniEbay } from '@/lib/ebayFulfill'
import { fulfillSpedizioniTiktok } from '@/lib/tiktokFulfill'
import { fulfillSpedizioniTemu } from '@/lib/temuFulfill'
import { chiudiBorderoSpedisci } from '@/lib/spedisci'
import { chiudiBordereauSpediamopro } from '@/lib/spediamopro'
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('cliente_id,master_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  const masterId = utente?.master_id
  if (!clienteId) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
  const body = await req.json()
  const ids: string[] = body.spedizioniIds || []
  const corriereId: string = body.corriereId
  if (!ids.length) return NextResponse.json({ error: 'Nessuna spedizione selezionata' }, { status: 400 })
  if (!corriereId) return NextResponse.json({ error: 'Contratto mancante' }, { status: 400 })
  // rileggo le spedizioni per sicurezza: devono essere del cliente, senza distinta, stesso corriere
  const { data: speds } = await supabase
    .from('spedizioni')
    .select('id,colli,peso_fatturato,peso_reale,corriere_id,distinta_id')
    .eq('cliente_id', clienteId)
    .in('id', ids)
  const valide = (speds || []).filter(s => !s.distinta_id && s.corriere_id === corriereId)
  if (!valide.length) return NextResponse.json({ error: 'Nessuna spedizione valida' }, { status: 400 })
  const totaleColli = valide.reduce((a, s) => a + (Number(s.colli) || 0), 0)
  const totalePeso = valide.reduce((a, s) => a + (Number(s.peso_fatturato || s.peso_reale) || 0), 0)
  // NUMERO GLOBALE dalla sequenza DB: stessa numerazione dei master (la distinta risale la rete).
  const { data: numSeq } = await supabase.rpc('prossimo_numero_distinta')
  const numero = String(numSeq || Date.now())
  const oggi = new Date().toISOString().slice(0, 10)
  const { data: distinta, error: errIns } = await supabase
    .from('distinte')
    .insert({ master_id: masterId, cliente_id: clienteId, corriere_id: corriereId, numero, data: oggi, stato: 'chiusa', totale_colli: totaleColli, totale_peso: totalePeso, totale_ldv: valide.length })
    .select('id,numero')
    .single()
  if (errIns || !distinta) return NextResponse.json({ error: 'Errore creazione distinta' }, { status: 500 })
  const validIds = valide.map(s => s.id)
  const { error: errUpd } = await supabase.from('spedizioni').update({ distinta_id: distinta.id }).in('id', validIds)
  // Distinta = consegnate al corriere → "spedita" (solo le "in lavorazione", per non sovrascrivere
  // in_transito/consegnata). Così si distinguono in elenco dalle etichette create dopo.
  await supabase.from('spedizioni').update({ stato: 'spedita' }).in('id', validIds).eq('stato', 'in_lavorazione')
  if (errUpd) return NextResponse.json({ error: 'Errore aggancio spedizioni' }, { status: 500 })
  // Distinta chiusa: rimanda il tracking a Shopify per gli ordini ecommerce collegati (best-effort)
  let fulfillEsiti: any[] = []
  try { fulfillEsiti = await fulfillSpedizioniShopify(supabase, validIds) } catch {}
  try { await fulfillSpedizioniWoo(supabase, validIds) } catch {}
  try { await fulfillSpedizioniPrestashop(supabase, validIds) } catch {}
  try { await fulfillSpedizioniEbay(supabase, validIds) } catch {}
  try { await fulfillSpedizioniTiktok(supabase, validIds) } catch {}
  try { await fulfillSpedizioniTemu(supabase, validIds) } catch {}
  // Chiusura borderò su spedisci.online (best-effort, solo corrieri tipo spedisci)
  try { await chiudiBorderoSpedisci(supabase, distinta.id) } catch {}
  try { await chiudiBordereauSpediamopro(supabase, distinta.id) } catch {}
  return NextResponse.json({ ok: true, distintaId: distinta.id, numero: distinta.numero, totali: { colli: totaleColli, peso: totalePeso, spedizioni: validIds.length }, fulfill: fulfillEsiti })
}