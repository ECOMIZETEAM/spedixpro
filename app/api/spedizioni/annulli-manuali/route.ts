import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'

// Coda annulli MANUALI (Spedisci): le vede SOLO il detentore del contratto
// (annullamento_owner_id = suo master). Le richiede via assistenza WhatsApp e poi conferma.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || (utente.ruolo || '').toLowerCase() === 'cliente') return NextResponse.json([])

  const admin = createAdminSupabase()
  const data = await fetchAll(() => admin.from('spedizioni')
    .select('id,numero,tracking_number,dest_nome,dest_citta,dest_provincia,created_at,annullamento_richiesto_at,corrieri(nome_contratto)')
    .eq('stato', 'annullamento_manuale')
    .eq('annullamento_owner_id', utente.master_id)
    .order('annullamento_richiesto_at', { ascending: true }))

  const ids = (data || []).map((s: any) => s.id)

  // SE IL FORNITORE L'HA RIPESATA, IL PACCO HA VIAGGIATO.
  // Una ripesatura e' una misura fatta dal corriere sul collo vero: se c'e', quella spedizione e'
  // partita, e chiedere l'annullo non ha piu' senso. Segnalarlo qui evita di andare a chiederlo
  // all'assistenza per un pacco gia' consegnato — e spiega perche' la sua rettifica resta in attesa.
  const ripesate = new Set<string>()
  // COSTO PAGATO DAL DETENTORE per la LDV: serve nel file che manda all'assistenza per farsi rimborsare
  // l'annullo. E' quanto e' stato addebitato al SUO conto (righe movimenti col suo master_id e SENZA
  // cliente_id — quelle col cliente_id sono il prezzo di VENDITA al cliente, non il suo costo). Somma
  // base + eventuali rettifiche/ripesature = quello che ha pagato davvero per quel pacco.
  const costoPerSped = new Map<string, number>()
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300)
    const { data: mv } = await admin.from('movimenti')
      .select('spedizione_id,tipo,riferimento,importo,cliente_id')
      .in('spedizione_id', chunk).eq('master_id', utente.master_id)
    for (const m of (mv || [])) {
      const sid = (m as any).spedizione_id; if (!sid) continue
      if ((m as any).tipo === 'rettifica' && String((m as any).riferimento || '').startsWith('RIPFORN-')) ripesate.add(sid)
      // Solo le righe del COSTO del detentore (senza cliente_id): il prezzo pagato per la LDV.
      if ((m as any).cliente_id == null) costoPerSped.set(sid, (costoPerSped.get(sid) || 0) + Number((m as any).importo || 0))
    }
  }

  // ULTIMO STATO DI TRACKING per riga: i pacchi in coda NON vengono piu' tracciati (il cron li esclude
  // per non perdere lo stato d'annullo), quindi lo stato "vivo" del corriere sta nei tracking_events
  // gia' salvati (webhook delle piattaforme + cronologie). Mostrarlo in schermata fa vedere al volo se
  // il pacco e' in transito/consegnato — cioe' se e' partito e l'annullo non ha piu' senso.
  const ultimoStato = new Map<string, { stato: string; data: string | null }>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data: ev } = await admin.from('tracking_events')
      .select('spedizione_id,stato,data_evento')
      .in('spedizione_id', ids.slice(i, i + 300))
      .not('stato', 'is', null)   // molti eventi hanno solo luogo/descrizione (stato null): ci serve l'ultimo stato VERO
      .order('data_evento', { ascending: false })
    for (const e of (ev || [])) {
      const sid = (e as any).spedizione_id; if (!sid || ultimoStato.has(sid)) continue  // il primo = il piu' recente
      ultimoStato.set(sid, { stato: (e as any).stato, data: (e as any).data_evento })
    }
  }

  return NextResponse.json((data || []).map((s: any) => ({
    ...s,
    ripesata: ripesate.has(s.id),
    costo_pagato: Math.abs(Math.round((costoPerSped.get(s.id) || 0) * 100) / 100) || 0,
    stato_tracking: ultimoStato.get(s.id)?.stato || null,
    stato_tracking_data: ultimoStato.get(s.id)?.data || null,
  })))
}
