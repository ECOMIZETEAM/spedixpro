import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Duplica un intero listino cliente (con corrieri, fasce e supplementi).
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  const { listinoId, nome, maggiorazione, modo } = await req.json()
  if (!listinoId) return NextResponse.json({ error: 'listinoId mancante' }, { status: 400 })
  // Maggiorazione applicata SOLO ai prezzi peso/zona (fasce), non a supplementi/accessori/giacenze.
  // Uguale su TUTTE le fasce di TUTTI i corrieri: % percentuale o € valore fisso aggiunto.
  const magg = Number(maggiorazione) || 0
  const fisso = modo === 'fisso'
  const applicaMagg = (p: any) => {
    if (!magg) return p
    const base = Number(p || 0)
    const nuovo = fisso ? base + magg : base * (1 + magg / 100)
    return Math.round(nuovo * 100) / 100
  }

  const admin = createAdminSupabase()
  const { data: src } = await admin.from('listini_clienti').select('*')
    .eq('id', listinoId).eq('master_id', utente.master_id).maybeSingle()
  if (!src) return NextResponse.json({ error: 'Listino non trovato' }, { status: 404 })

  // Sorgenti lette PRIMA di creare l'header, con fetchAll: oltre le 1000 righe PostgREST tronca in
  // silenzio, e prima la copia usciva parziale/vuota senza avvisare. Se poi una insert fallisce si fa
  // ROLLBACK dell'header (il CASCADE toglie i figli) invece di lasciare un listino a metà (bug "vuoto").
  const { fetchAll } = await import('@/lib/fetch-all')
  const corrieri = await fetchAll(() => admin.from('listini_clienti_corrieri')
    .select('corriere_id,fattore_volume,abilitato').eq('listino_id', listinoId).order('corriere_id', { ascending: true }))
  const fasce = await fetchAll(() => admin.from('listini_clienti_fasce')
    .select('corriere_id,zona_id,peso_min,peso_max,prezzo,tipo,fuel').eq('listino_id', listinoId).order('id', { ascending: true }))
  const sup = await fetchAll(() => admin.from('listini_clienti_supplementi')
    .select('corriere_id,tipo,descrizione,valore,tipo_calcolo,nome').eq('listino_id', listinoId).order('id', { ascending: true }))

  const nuovoNome = (nome && String(nome).trim()) || `${src.nome} (copia)`
  const { data: nuovo, error: e1 } = await admin.from('listini_clienti').insert({
    master_id: utente.master_id, nome: nuovoNome, attivo: src.attivo ?? true,
    fattore_volume: src.fattore_volume, solo_peso_reale: src.solo_peso_reale,
  }).select('id').single()
  if (e1 || !nuovo) return NextResponse.json({ error: e1?.message || 'Errore creazione listino' }, { status: 400 })
  const nid = nuovo.id
  const rollback = async (msg: string) => { await admin.from('listini_clienti').delete().eq('id', nid); return NextResponse.json({ error: msg }, { status: 400 }) }

  if (corrieri.length) {
    const { error } = await admin.from('listini_clienti_corrieri').insert(corrieri.map((c: any) => ({ ...c, listino_id: nid })))
    if (error) return rollback('Copia contratti non riuscita: ' + error.message)
  }
  // Fasce a blocchi di 1000 (l'insert non tronca, ma i pacchetti grandi possono superare i limiti).
  for (let i = 0; i < fasce.length; i += 1000) {
    const { error } = await admin.from('listini_clienti_fasce').insert(fasce.slice(i, i + 1000).map((f: any) => ({ ...f, listino_id: nid, prezzo: applicaMagg(f.prezzo) })))
    if (error) return rollback('Copia prezzi non riuscita: ' + error.message)
  }
  if (sup.length) {
    const { error } = await admin.from('listini_clienti_supplementi').insert(sup.map((s: any) => ({ ...s, listino_id: nid })))
    if (error) return rollback('Copia supplementi non riuscita: ' + error.message)
  }

  return NextResponse.json({ id: nid, nome: nuovoNome, fasce: fasce.length, corrieri: corrieri.length })
}
