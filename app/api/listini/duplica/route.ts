import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Duplica un intero listino cliente (con corrieri, fasce e supplementi).
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  const { listinoId, nome } = await req.json()
  if (!listinoId) return NextResponse.json({ error: 'listinoId mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: src } = await admin.from('listini_clienti').select('*')
    .eq('id', listinoId).eq('master_id', utente.master_id).maybeSingle()
  if (!src) return NextResponse.json({ error: 'Listino non trovato' }, { status: 404 })

  const nuovoNome = (nome && String(nome).trim()) || `${src.nome} (copia)`
  const { data: nuovo, error: e1 } = await admin.from('listini_clienti').insert({
    master_id: utente.master_id, nome: nuovoNome, attivo: src.attivo ?? true,
    fattore_volume: src.fattore_volume, solo_peso_reale: src.solo_peso_reale,
  }).select('id').single()
  if (e1 || !nuovo) return NextResponse.json({ error: e1?.message || 'Errore creazione listino' }, { status: 400 })
  const nid = nuovo.id

  const { data: corrieri } = await admin.from('listini_clienti_corrieri')
    .select('corriere_id,fattore_volume,abilitato').eq('listino_id', listinoId)
  if (corrieri?.length) await admin.from('listini_clienti_corrieri').insert(corrieri.map((c: any) => ({ ...c, listino_id: nid })))

  const { data: fasce } = await admin.from('listini_clienti_fasce')
    .select('corriere_id,zona_id,peso_min,peso_max,prezzo,tipo,fuel').eq('listino_id', listinoId)
  if (fasce?.length) await admin.from('listini_clienti_fasce').insert(fasce.map((f: any) => ({ ...f, listino_id: nid })))

  const { data: sup } = await admin.from('listini_clienti_supplementi')
    .select('corriere_id,tipo,descrizione,valore,tipo_calcolo,nome').eq('listino_id', listinoId)
  if (sup?.length) await admin.from('listini_clienti_supplementi').insert(sup.map((s: any) => ({ ...s, listino_id: nid })))

  return NextResponse.json({ id: nid, nome: nuovoNome })
}
