import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Cosa il MIO master ha ricevuto dai livelli superiori della catena.
// RLS: le righe appartengono al master PADRE -> lettura via admin, autorizzazione = target_master_id mio.
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = no scrittura / no rete
  // Il ruolo, non l'elenco di quelli da tenere fuori: escludendo il solo 'cliente' passava
  // l'AUTISTA, che un master_id ce l'ha (3 in produzione) — e qui sotto si legge e si scrive con la
  // chiave di servizio, che scavalca le regole per riga.
  if (!utente?.master_id || !gestisceLaRete(utente)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const mio = utente.master_id
  const adminDb = createAdminSupabase()

  const [rett, cod, resi] = await Promise.all([
    // SI VEDE SOLO QUELLO CHE E' GIA' STATO ADDEBITATO.
    // Mancava il filtro sulla conferma: appena il master di sopra CARICAVA il file, le righe
    // comparivano gia' qui sotto — ancora in attesa, ancora sue, ancora modificabili o
    // cancellabili. Chi le vedeva se le trovava addosso prima che nessuno avesse deciso niente e
    // senza che gli fosse stato tolto un euro. Una rettifica diventa "ricevuta" nel momento in cui
    // il livello di sopra la conferma e il credito viene scalato: prima non esiste, per chi la
    // riceve. E' la stessa regola dei contrassegni, dove la rimessa si vede solo da caricata.
    adminDb.from('rettifiche')
      .select('id,numero_spedizione,peso_iniziale,peso_reale,costo_iniziale,costo_finale,differenza,confermata,stato,propagazione,created_at,masters:master_id(nome)')
      .eq('target_master_id', mio)
      .eq('confermata', true)
      .order('created_at', { ascending: false }).limit(200),
    adminDb.from('distinte_contrassegni')
      .select('id,numero,totale_iniziale,totale_rimborsato,metodo_pagamento,stato,data_pagamento,accettata_target,created_at,masters:master_id(nome),distinte_contrassegni_righe(numero_spedizione,importo_cod)')
      .eq('target_master_id', mio)
      .order('created_at', { ascending: false }).limit(100),
    adminDb.from('distinte_resi')
      .select('id,numero,totale,totale_ldv,stato,accettata_target,created_at,voci,masters:master_id(nome)')
      .eq('target_master_id', mio)
      .order('created_at', { ascending: false }).limit(100),
  ])

  return NextResponse.json({
    rettifiche: rett.data || [],
    contrassegni: cod.data || [],
    resi: resi.data || [],
  })
}
