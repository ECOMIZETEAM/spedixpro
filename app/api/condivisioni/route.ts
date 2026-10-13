import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente } from '@/lib/permessi'

/* CONDIVISIONE CONTRATTI TRA MASTER — il pannello "Collegamenti" di Elenco Master.
 *
 * Torna il codice del master (da dare a chi vuole collegarsi) e le richieste di collegamento, inviate e
 * ricevute. Il collegamento si chiede con /api/condivisioni/collega e si approva con /[id]/accetta; i
 * contratti poi li condivide il venditore assegnando un listino dalla scheda del collegato
 * (lib/condivisione-engine.ts). La vecchia condivisione "per contratto" creata qui con un POST non c'è
 * più: nessuna pagina la usava, e materializzava il contratto sul compratore senza la regola unica.
 *
 * Sicurezza: `corrieri_condivisi` è service-role only (RLS senza policy, revoca anon/authenticated), quindi
 * l'isolamento fra tenant lo rifà QUI a mano — solo master/admin. Vedi CONDIVISIONE-CONTRATTI.md.
 */

async function attore() {
  const p = await getPermessiUtente()
  // Solo lo staff decisionale (master/admin) gestisce i contratti: non operatori, mai agenti/clienti.
  if (!p?.masterId || !p.isFull) return null
  return { masterId: p.masterId }
}

export async function GET() {
  const a = await attore()
  if (!a) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  const admin = createAdminSupabase()

  // Il mio codice (per darlo a chi vuole connettersi).
  const { data: me } = await admin.from('masters').select('nome,codice_condivisione').eq('id', a.masterId).single()

  // Condivisioni che HO CREATO io (sono il venditore).
  const { data: rivendoRaw } = await admin.from('corrieri_condivisi')
    .select('id,corriere_id,master_id,stato,credito_modo,created_at,accettata_il,revocata_il')
    .eq('fornitore_master_id', a.masterId).order('created_at', { ascending: false })

  // Condivisioni RICEVUTE (sono il compratore/acquirente).
  const { data: ricevutiRaw } = await admin.from('corrieri_condivisi')
    .select('id,corriere_id,fornitore_master_id,stato,credito_modo,created_at,accettata_il')
    .eq('master_id', a.masterId).order('created_at', { ascending: false })

  // Nomi contratto + nomi master, risolti a mano (service-role: nessun join implicito via RLS).
  const corriereIds = Array.from(new Set([...(rivendoRaw || []), ...(ricevutiRaw || [])].map(r => r.corriere_id).filter(Boolean)))
  const masterIds = Array.from(new Set([
    ...(rivendoRaw || []).map(r => r.master_id),
    ...(ricevutiRaw || []).map(r => r.fornitore_master_id),
  ].filter(Boolean)))
  const [{ data: corrieriNomi }, { data: mastersNomi }] = await Promise.all([
    corriereIds.length ? admin.from('corrieri').select('id,nome_contratto').in('id', corriereIds) : Promise.resolve({ data: [] as any[] }),
    masterIds.length ? admin.from('masters').select('id,nome').in('id', masterIds) : Promise.resolve({ data: [] as any[] }),
  ])
  const nomeCorriere = new Map((corrieriNomi || []).map((c: any) => [c.id, c.nome_contratto]))
  const nomeMaster = new Map((mastersNomi || []).map((m: any) => [m.id, m.nome]))

  const rivendo = (rivendoRaw || []).map(r => ({
    id: r.id, stato: r.stato, credito_modo: r.credito_modo, creata_il: r.created_at,
    accettata_il: r.accettata_il, revocata_il: r.revocata_il,
    contratto: nomeCorriere.get(r.corriere_id) || '—',
    compratore: nomeMaster.get(r.master_id) || '—',
  }))
  const ricevuti = (ricevutiRaw || []).map(r => ({
    id: r.id, stato: r.stato, credito_modo: r.credito_modo, creata_il: r.created_at, accettata_il: r.accettata_il,
    contratto: nomeCorriere.get(r.corriere_id) || '—',
    fornitore: nomeMaster.get(r.fornitore_master_id) || '—',
  }))

  return NextResponse.json({
    codice: me?.codice_condivisione || null,
    nome: me?.nome || null,
    rivendo, ricevuti,
  })
}
