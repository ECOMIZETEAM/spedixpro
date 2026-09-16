import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'

export const dynamic = 'force-dynamic'

// Riconosce la piattaforma di provenienza dell'ordine importato dalla riga originale (raw).
export function piattaformaDa(raw: any): 'amazon' | 'shopify' | 'temu' | 'altro' {
  if (!raw || typeof raw !== 'object') return 'altro'
  // Temu PRIMA: il suo export ha colonne inequivocabili (Sconto di Temu, la email "virtuale" di
  // relay, l'ID articolo dell'ordine). Va riconosciuto, se no gli ordini Temu finiscono in "altro"
  // e non escono quando si scarica il tracking per piattaforma.
  if ('sconto_di_temu' in raw || 'email_virtuale' in raw || 'id_articolo_dellordine' in raw) return 'temu'
  if ('orderitemid' in raw || 'order_item_id' in raw || 'amazonorderid' in raw) return 'amazon'
  if ('lineitem_name' in raw || 'financial_status' in raw || 'shipping_name' in raw || 'shipping_zip' in raw) return 'shopify'
  return 'altro'
}

// Recupera gli ordini importati DA FILE che NON risultano spediti (restano 'da_spedire'/'errore',
// senza spedizione_id) ma il cui PACCO È GIÀ PARTITO: il cliente ha creato la spedizione a mano da
// "Nuova Spedizione" mettendo il codice ordine nel riferimento, POI ha importato il file del
// marketplace → la riga importata non si è mai agganciata alla spedizione e sparisce dal report anche
// se spedita (spesso già consegnata). Li riaggancio per rif_ordine = ordine, così tornano nel report
// e nel file di conferma. (Causa dei "dopo aver spedito non trovo tutti gli ordini nel report".)
// Perché lo stato è rimasto indietro: quel pacco è nato da un'ALTRA porta (Nuova Spedizione), non
// dalla lista ordini, quindi lo stato dell'ordine importato non è mai passato a 'spedito'.
// Finestra 120gg: una conferma più vecchia è fuori dai tempi utili di Amazon, e non vale il costo di
// scandagliare backlog enormi di 'da spedire' MAI spediti (clienti con migliaia di righe). Due sole
// query (ordini + spedizioni del cliente) con aggancio in memoria: niente .in() a blocchi sui rif.
export async function ordiniSpeditiPerRiferimento(supabase: any, clienteId: string, spedSelect: string) {
  const DA = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString()
  const orfani = await fetchAll(() => supabase
    .from('ordini_importati')
    .select('id, order_id, contenuto, colli, raw, articoli')
    .eq('cliente_id', clienteId)
    .in('stato', ['da_spedire', 'errore'])
    .is('integrazione_id', null)
    .is('spedizione_id', null)
    .gte('created_at', DA)
    .order('id', { ascending: true }))
  const rifDi = (o: any) => o.order_id || o.raw?.amazonorderid || o.raw?.amazon_order_id || o.raw?.orderid || null
  const conRif = (orfani || []).map((o: any) => ({ o, rif: rifDi(o) })).filter((x: any) => x.rif)
  if (!conRif.length) return []

  // Tutte le spedizioni valide del cliente (120gg) con un riferimento: UNA fetch, poi aggancio in
  // memoria per rif_ordine. Ordinate desc → per ogni rif tengo la spedizione più recente.
  const speds = await fetchAll(() => supabase
    .from('spedizioni')
    .select(spedSelect + ', rif_ordine')
    .eq('cliente_id', clienteId)
    .not('rif_ordine', 'is', null)
    .is('cancellata_il', null)
    .gte('created_at', DA)
    .order('created_at', { ascending: false }))
  const ANN = ['annullata', 'annullamento_pending', 'annullamento_manuale']
  const spedDiRif = new Map<string, any>()
  for (const s of (speds || [])) {
    if (ANN.includes(String((s as any).stato || ''))) continue
    const rif = (s as any).rif_ordine
    if (rif && !spedDiRif.has(rif)) spedDiRif.set(rif, s)
  }

  // Aggancio + dedup per riferimento: non confermare due volte lo stesso ordine col medesimo tracking.
  const visti = new Set<string>()
  const out: any[] = []
  for (const { o, rif } of conRif) {
    if (visti.has(rif as string)) continue
    const sp = spedDiRif.get(rif as string)
    if (!sp) continue
    visti.add(rif as string)
    out.push({ ...o, spedizioni: sp })
  }
  return out
}

// Report degli ordini importati DA FILE (non dai negozi collegati) e già SPEDITI:
// raggruppati per piattaforma (Amazon/Shopify) e per data di spedizione, con i conteggi.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  // Stesse condizioni del file scaricabile (annullate escluse, tiebreaker in paginazione):
  // i numeri a video devono coincidere con quelli del file, altrimenti il cliente non torna.
  const righe = await fetchAll(() => supabase
    .from('ordini_importati')
    .select('id, raw, articoli, spedizioni!inner(created_at, stato, cancellata_il)')
    .eq('cliente_id', utente.cliente_id)
    .eq('stato', 'spedito')
    .is('integrazione_id', null)                 // solo ordini caricati da FILE (non dai negozi collegati)
    .not('spedizione_id', 'is', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true }))

  // Ordini "uniti" (accoppiati nel capofila): niente spedizione propria, ma vanno CONTATI e messi nel
  // file col tracking del capofila (vedi la rotta download). Senza, il numero a video < record nel file.
  const uniti = await fetchAll(() => supabase
    .from('ordini_importati')
    .select('id, raw, articoli, unito_in')
    .eq('cliente_id', utente.cliente_id)
    .eq('stato', 'unito')
    .is('integrazione_id', null)
    .not('unito_in', 'is', null)
    .order('id', { ascending: true }))
  const capoIds = Array.from(new Set((uniti || []).map((u: any) => u.unito_in).filter(Boolean)))
  const spedDiCapo = new Map<string, any>()
  if (capoIds.length) {
    const capi = await fetchAll(() => supabase.from('ordini_importati')
      .select('id, spedizioni(created_at, stato, cancellata_il)').in('id', capoIds))
    for (const c of (capi || [])) if ((c as any).spedizioni) spedDiCapo.set((c as any).id, (c as any).spedizioni)
  }
  const unitiConSped = (uniti || []).map((u: any) => ({ ...u, spedizioni: spedDiCapo.get(u.unito_in) })).filter((u: any) => u.spedizioni)

  // Ordini spediti "per riferimento" (pacco partito da Nuova Spedizione, ordine importato dopo → mai
  // agganciato): vanno CONTATI come gli altri, se no il numero a video < record nel file scaricabile.
  const orfani = await ordiniSpeditiPerRiferimento(supabase, utente.cliente_id, 'created_at, stato, cancellata_il')

  const righeTutte = [...(righe || []), ...unitiConSped, ...orfani]

  const ANNULLATI = ['annullata', 'annullamento_pending', 'annullamento_manuale']
  // Raggruppo per piattaforma + data di spedizione. Conto ORDINI e RIGHE: Amazon evade per
  // ARTICOLO, quindi un ordine multi-prodotto vale piu' righe nel file. Mostrare solo gli ordini
  // faceva sembrare sbagliato il conteggio di Amazon (113 ordini -> 114 record).
  const mappa = new Map<string, { piattaforma: string; data: string; n: number; righe: number }>()
  const totali: Record<string, number> = { amazon: 0, shopify: 0, altro: 0 }
  for (const r of righeTutte) {
    const sp: any = (r as any).spedizioni
    if (sp?.cancellata_il || ANNULLATI.includes(String(sp?.stato || ''))) continue
    const piatt = piattaformaDa((r as any).raw)
    const dataSped = (sp?.created_at || '').slice(0, 10) || '—'
    const arts = Array.isArray((r as any).articoli) ? (r as any).articoli.filter((a: any) => a && a.order_item_id) : []
    const nRighe = arts.length || 1
    const key = `${piatt}|${dataSped}`
    if (!mappa.has(key)) mappa.set(key, { piattaforma: piatt, data: dataSped, n: 0, righe: 0 })
    const g = mappa.get(key)!
    g.n++; g.righe += nRighe
    totali[piatt] = (totali[piatt] || 0) + 1
  }

  const gruppi = Array.from(mappa.values()).sort((a, b) => (a.data < b.data ? 1 : -1))
  return NextResponse.json({ gruppi, totali })
}
