import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { bloccaAgente } from '@/lib/agente'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { chiudiBorderoSpedisci } from '@/lib/spedisci'
import { chiudiBordereauSpediamopro } from '@/lib/spediamopro'

// "Conferma" = TRASMETTI (o ritenta) la chiusura della distinta al provider del corriere.
// Alla creazione la trasmissione parte gia' in automatico: questo bottone serve per le distinte
// rimaste "In attesa" (errore provider, corriere momentaneamente giu', ecc.).
// Funziona su tutta la RETE visibile: l'elenco mostra anche le distinte dei sotto-master, quindi
// la conferma deve poterle raggiungere (prima filtrava solo master_id proprio -> 0 righe, "non
// le fa confermare").
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = no scrittura / no rete
  const body = await req.json()
  const { distinteIds } = body
  if (!distinteIds?.length) return NextResponse.json({ error: 'Nessuna distinta selezionata' }, { status: 400 })
  if (!utente?.master_id) return NextResponse.json({ error: 'Utente senza master' }, { status: 403 })

  const admin = createAdminSupabase()
  const visibili = await sottoAlberoMasterIds(admin, utente.master_id)
  const { data: distinte } = await admin.from('distinte')
    .select('id,numero,confermata_vettore,bordero_id')
    .in('id', distinteIds)
    .in('master_id', visibili)
  if (!distinte?.length) return NextResponse.json({ error: 'Nessuna distinta valida' }, { status: 400 })

  let confermate = 0
  const errori: { numero: string; errore: string }[] = []
  for (const d of distinte) {
    if (d.confermata_vettore && d.bordero_id && !String(d.bordero_id).startsWith('ERRORE')) { confermate++; continue }
    // Ritenta la chiusura sul provider giusto (l'altro fa skip da solo).
    const r1: any = await chiudiBorderoSpedisci(admin, d.id).catch((e: any) => ({ errore: String(e?.message || e) }))
    const r2: any = await chiudiBordereauSpediamopro(admin, d.id).catch((e: any) => ({ errore: String(e?.message || e) }))
    const { data: dopo } = await admin.from('distinte').select('confermata_vettore').eq('id', d.id).maybeSingle()
    if (dopo?.confermata_vettore) { confermate++; continue }
    const err = r1?.errore || r2?.errore
    if (err) { errori.push({ numero: d.numero, errore: String(err).slice(0, 200) }); continue }
    // Nessun errore ma nemmeno trasmissione (es. bordero gia' presente da un giro parziale):
    // attestazione manuale, la distinta risulta confermata.
    await admin.from('distinte').update({ confermata_vettore: true, data_conferma: new Date().toISOString() }).eq('id', d.id)
    confermate++
  }
  return NextResponse.json({ success: true, confermate, errori })
}
