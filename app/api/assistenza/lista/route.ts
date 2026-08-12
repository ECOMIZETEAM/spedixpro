import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'
import { mascheraCatena, assegnatoPer } from '@/lib/ticket-accesso'

// Lista ticket:
// - ricevuti: ticket che il MIO master deve gestire (aperti da miei clienti o sotto-master)
// - miei: ticket che HO aperto io (verso la mia linea superiore, o come cliente)
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ricevuti: [], miei: [] })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const masterId = utente?.master_id
  const ruolo = (utente?.ruolo || '').toLowerCase()
  const admin = createAdminSupabase()

  const cols = 'id,codice,oggetto,messaggio,stato,risposta,aperto_da,tipo_apertura,cliente_id,owner_master_id,aperto_master_id,aperto_letto,non_letto_owner,categoria,pod_url,allegati,created_at,updated_at,inoltrato_a_master_id,rete_master_ids,rete_non_letti,assegnazioni'

  // Ordinamento per ULTIMA ATTIVITA' (updated_at): un ticket vecchio con una risposta fresca
  // del cliente deve risalire in cima, non restare sepolto (prima "spariva" dalla vista).
  // fetchAll: lo STORICO (chiusi compresi) deve restare visibile per sempre — senza paginazione
  // PostgREST tronca a 1000 righe e i ticket più vecchi sparirebbero in silenzio.
  if (ruolo === 'cliente' || utente?.cliente_id) {
    if (!utente?.cliente_id) return NextResponse.json({ ricevuti: [], miei: [] })
    const miei = await fetchAll(() => admin.from('tickets').select(cols)
      .eq('cliente_id', utente.cliente_id).order('updated_at', { ascending: false }))
    // Al cliente la catena di inoltro non va mostrata: uscivano nel corpo della risposta e
    // bastava guardarla per sapere che la richiesta era stata girata più in alto, e a chi.
    const puliti = (miei || []).map((r: any) => ({ ...r, inoltrato_a_master_id: undefined, rete_master_ids: undefined, rete_non_letti: undefined, assegnazioni: undefined, assegnato_id: undefined, assegnato_nome: undefined }))
    return NextResponse.json({ ricevuti: [], miei: puliti })
  }
  // Agente: sola lettura sui SUOI clienti, niente dati del master né della rete (lib/agente.ts).
  // I ticket non hanno un agente, quindi non c'è un perimetro da applicare: resta fuori.
  if (ruolo === 'agente') return NextResponse.json({ ricevuti: [], miei: [], rete: [] })

  // Master: ricevuti (owner) + miei (aperti verso la linea superiore) + RETE (inoltrati a me
  // da un master sotto di me: partecipo alla catena, il cliente non mi vede).
  const [ricevuti, miei, rete] = await Promise.all([
    fetchAll(() => admin.from('tickets').select(cols).eq('owner_master_id', masterId).order('updated_at', { ascending: false })),
    fetchAll(() => admin.from('tickets').select(cols).eq('aperto_master_id', masterId).order('updated_at', { ascending: false })),
    fetchAll(() => admin.from('tickets').select(cols).contains('rete_master_ids', [masterId]).order('updated_at', { ascending: false })),
  ])
  // rete_nuovo va calcolato PRIMA di mascherare (usa il rete_non_letti pieno), poi si maschera la
  // catena oltre il proprio bersaglio d'inoltro (come nel dettaglio) e si deriva l'assegnazione DEL
  // MASTER che guarda (E&A vede chi ha in carico E&A, non l'assegnatario del sotto-master).
  const conNuovo = (r: any) => ({ ...mascheraCatena(r, masterId), rete_nuovo: Array.isArray(r.rete_non_letti) && r.rete_non_letti.includes(masterId), ...assegnatoPer(r, masterId), assegnazioni: undefined })
  // I MIEI ticket (aperti da me verso la mia linea superiore): sono il RICHIEDENTE, e come per un
  // cliente NON devo sapere se e a CHI la mia richiesta viene girata ancora più su. Prima questi
  // campi uscivano nel ramo master e il sotto-master vedeva "inoltrato a MoovExpress". Nei RICEVUTI
  // (li gestisco io) e nella RETE (partecipo alla catena) restano, lì è giusto vederli.
  const senzaCatenaSopra = (r: any) => ({ ...r, inoltrato_a_master_id: undefined, rete_master_ids: undefined, rete_non_letti: undefined, assegnazioni: undefined, assegnato_id: undefined, assegnato_nome: undefined })
  // ricevuti (sono owner): maschero la catena oltre il mio bersaglio d'inoltro + assegnazione mia.
  // miei (richiedente): via del tutto i campi catena. rete (partecipo): rete_nuovo + maschera + mia.
  const conMia = (r: any) => ({ ...mascheraCatena(r, masterId), ...assegnatoPer(r, masterId), assegnazioni: undefined })
  return NextResponse.json({ ricevuti: (ricevuti || []).map(conMia), miei: (miei || []).map(senzaCatenaSopra), rete: (rete || []).map(conNuovo) })
}
