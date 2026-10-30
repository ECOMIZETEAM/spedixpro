import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAllStretto } from '@/lib/fetch-all'

// Pezzi comuni ai report del portale CLIENTE.

// IL CLIENTE SI PRENDE DALLA SESSIONE (utenti.cliente_id), MAI DA UN PARAMETRO: ogni report legge
// soldi e indirizzi di un'azienda, e un id passato nell'indirizzo basterebbe a leggere quelli di
// un'altra. Senza sessione o senza cliente si risponde con un errore vero: prima usciva un elenco
// vuoto e la pagina diceva "Nessun risultato", come se non ci fosse niente da mostrare.
export async function sessioneCliente(): Promise<
  { supabase: any; clienteId: string; masterId: string | null } | { errore: NextResponse }
> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { errore: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: utente, error } = await supabase.from('utenti').select('cliente_id,master_id').eq('id', user.id).maybeSingle()
  if (error) return { errore: NextResponse.json({ error: error.message }, { status: 500 }) }
  if (!utente?.cliente_id) return { errore: NextResponse.json({ error: 'Non autorizzato' }, { status: 403 }) }
  return { supabase, clienteId: utente.cliente_id, masterId: utente.master_id || null }
}

// Intestazione dei PDF: ragione sociale del cliente e dati del suo master. I dati del master sono
// solo l'intestazione: se non si leggono il report esce lo stesso, senza logo (come prima).
// La ragione sociale invece si legge o si ferma tutto: e' la stessa riga da cui viene l'aliquota IVA.
export async function intestazione(supabase: any, clienteId: string, masterId: string | null) {
  const { data: cliente, error } = await supabase.from('clienti')
    .select('ragione_sociale,aliquota_iva').eq('id', clienteId).maybeSingle()
  if (error) throw new Error('lettura del cliente non riuscita: ' + error.message)
  let master: any = {}
  if (masterId) {
    const { data, error: eM } = await supabase.from('masters')
      .select('nome,logo_url,indirizzo,cap,citta,provincia,email,email_sede,piva,partita_iva')
      .eq('id', masterId).maybeSingle()
    if (eM) console.error('[REPORT CLIENTE] intestazione del master non letta:', eM.message)
    master = data || {}
  }
  return {
    cliente: { ragione_sociale: cliente?.ragione_sociale || '' },
    master,
    aliquotaIva: aliquotaDi(cliente?.aliquota_iva),
  }
}

// L'aliquota IVA e' quella della scheda del cliente; vuota vale 22 (il default della scheda).
// Prima i PDF scrivevano 22% a tutti, anche ai 126 clienti allo 0%.
export function aliquotaDi(v: any): number {
  if (v === null || v === undefined || String(v).trim() === '') return 22
  const n = Number(v)
  return Number.isFinite(n) ? n : 22
}

// Lettura COMPLETA di un elenco di id: a blocchi di 200 (oltre ~25 KB di indirizzo PostgREST
// respinge la richiesta con 400) e ogni blocco a pagine da 1000 (oltre, PostgREST tronca in
// silenzio). `build(blocco)` deve ordinare su una chiave univoca. Una pagina che non si legge
// LANCIA: un report a cui manca un pezzo non deve sembrare completo.
// Quattro blocchi alla volta: in fila, gli eventi di tracking di un mese di un cliente grande
// (~10.000 pacchi consegnati) erano un centinaio di richieste una dietro l'altra.
export async function leggiPerBlocchi<T = any>(ids: string[], build: (blocco: string[]) => any): Promise<T[]> {
  const blocchi: string[][] = []
  for (let i = 0; i < ids.length; i += 200) blocchi.push(ids.slice(i, i + 200))
  const out: T[] = []
  for (let i = 0; i < blocchi.length; i += 4) {
    const giro = await Promise.all(blocchi.slice(i, i + 4).map(b => fetchAllStretto<T>(() => build(b))))
    for (const righe of giro) out.push(...righe)
  }
  return out
}

// QUANTO IL CLIENTE HA DAVVERO PAGATO PER LE SPEDIZIONI ANNULLATE: i suoi movimenti di spedizione,
// rimborso e rettifica su quei pacchi. Di norma e' 0 — l'annullo storna spedizione e rettifiche
// (lib/annullaSpedizione) — e infatti il report le mostra a 0 e fuori dai totali. Ma un pacco
// annullato e poi PARTITO viene ri-addebitato ("Ri-addebito ... pacco annullato ma PARTITO, rimesso
// in lista") e resta in stato 'annullata': negli ultimi 30 giorni al 15/10/2026 erano 10 spedizioni
// per 65,25 € (es. 050015292921577, 7,00 € pagati). Uno zero fisso nasconderebbe soldi pagati davvero.
// Solo i movimenti di QUESTO cliente: sulle spedizioni condivise ci sono anche quelli dei conti
// "(ingrosso)" dei master, sulla stessa spedizione.
export async function pagatoSuAnnullate(db: any, clienteId: string, ids: string[]): Promise<Map<string, number>> {
  const mov = await leggiPerBlocchi<any>(ids, (b) => db.from('movimenti')
    .select('id,spedizione_id,importo').eq('cliente_id', clienteId)
    .in('tipo', ['spedizione', 'rimborso', 'rettifica']).in('spedizione_id', b)
    .order('spedizione_id', { ascending: true }).order('id', { ascending: true }))
  const out = new Map<string, number>()
  for (const m of mov) out.set(m.spedizione_id, (out.get(m.spedizione_id) || 0) - Number(m.importo || 0))
  for (const [k, v] of out) out.set(k, Math.round(v * 100) / 100)
  return out
}

export function erroreReport(e: any): NextResponse {
  const msg = String(e?.message || e || 'Errore nella lettura dei dati')
  console.error('[REPORT CLIENTE]', msg)
  return NextResponse.json({ error: msg }, { status: 500 })
}
