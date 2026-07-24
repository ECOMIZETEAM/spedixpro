import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente, bloccaAgente } from '@/lib/agente'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'

// CARICA le rimesse contrassegni RICEVUTE (già accettate dal network): per ogni rimessa
// selezionata crea le MIE distinte verso i clienti diretti e/o verso la prima linea dei
// sotto-master (che a loro volta accetteranno e caricheranno → cascata multi-livello).
// GET  → elenco rimesse accettate NON ancora caricate (per la sezione in Distinte Contrassegni)
// POST → { distintaIds: [] } carica quelle selezionate

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente' || isAgente(utente)) return NextResponse.json([])
  const admin = createAdminSupabase()
  const { data } = await admin.from('distinte_contrassegni')
    .select('id,numero,totale_iniziale,created_at,accettata_target_at,masters:master_id(nome),distinte_contrassegni_righe(id)')
    .eq('target_master_id', utente.master_id)
    .eq('accettata_target', true)
    .eq('caricata_target', false)
    .order('created_at', { ascending: false })
  return NextResponse.json((data || []).map((d: any) => ({
    id: d.id, numero: d.numero, totale: Number(d.totale_iniziale || 0), created_at: d.created_at,
    mittente: d.masters?.nome || '—', righe: (d.distinte_contrassegni_righe || []).length,
  })))
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = no scrittura
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const mio = utente.master_id
  const body = await req.json().catch(() => ({}))
  const distintaIds: string[] = Array.isArray(body.distintaIds) ? body.distintaIds.filter(Boolean) : []
  if (!distintaIds.length) return NextResponse.json({ error: 'Seleziona almeno una rimessa da caricare' }, { status: 400 })

  const admin = createAdminSupabase()

  // CLAIM ATOMICO: marco SUBITO caricata_target=true con le condizioni nel WHERE e lavoro solo
  // sulle righe ritornate. Due click concorrenti (due tab/dispositivi) non possono più caricare
  // la stessa rimessa due volte: il secondo non "vince" nessuna riga → niente doppio pagamento.
  const { data: ricevute } = await admin.from('distinte_contrassegni')
    .update({ caricata_target: true, caricata_target_at: new Date().toISOString() })
    .in('id', distintaIds)
    .eq('target_master_id', mio).eq('accettata_target', true).eq('caricata_target', false)
    .select('id,numero')
  if (!ricevute?.length) return NextResponse.json({ error: 'Nessuna rimessa caricabile tra quelle selezionate (già caricate, non accettate o non tue).' }, { status: 400 })
  const ricevuteIds = ricevute.map((r: any) => r.id)
  // In caso di errore a metà: riapro il claim così nulla resta bloccato/perso.
  const annullaClaim = async () => {
    try { await admin.from('distinte_contrassegni').update({ caricata_target: false, caricata_target_at: null }).in('id', ricevuteIds) } catch {}
  }

  try {
    // LDV delle rimesse selezionate — PAGINATO (PostgREST tronca a 1000: con "Seleziona tutte" su
    // rimesse grandi le LDV oltre il tetto sparirebbero in silenzio = contrassegni mai rimessi).
    const righeRic = await fetchAll(() => admin.from('distinte_contrassegni_righe')
      .select('numero_spedizione').in('distinta_id', ricevuteIds).order('id', { ascending: true }))
    const numeri = Array.from(new Set((righeRic || []).map((r: any) => r.numero_spedizione).filter(Boolean)))
    if (!numeri.length) { await annullaClaim(); return NextResponse.json({ error: 'Nessuna LDV nelle rimesse selezionate' }, { status: 400 }) }

    // Spedizioni (mie o del mio sotto-albero: la rimessa è indirizzata a me)
    const spedizioni: any[] = []
    for (let i = 0; i < numeri.length; i += 200) {
      const chunk = await fetchAll(() => admin.from('spedizioni')
        .select('id,master_id,cliente_id,contrassegno,numero')
        .in('numero', numeri.slice(i, i + 200)).gt('contrassegno', 0).order('id', { ascending: true }))
      spedizioni.push(...chunk)
    }
    if (!spedizioni.length) { await annullaClaim(); return NextResponse.json({ error: 'Spedizioni non trovate' }, { status: 404 }) }

    // Prima linea per ogni discendente (il figlio DIRETTO attraverso cui discende, come resi/elenco)
    const primaLinea = new Map<string, string>()
    {
      let frontier = [mio]
      for (let i = 0; i < 12 && frontier.length; i++) {
        const { data: figli } = await admin.from('masters').select('id,parent_master_id').in('parent_master_id', frontier)
        const nuovi: string[] = []
        for (const c of (figli || [])) {
          if (primaLinea.has(c.id)) continue
          primaLinea.set(c.id, c.parent_master_id === mio ? c.id : (primaLinea.get(c.parent_master_id) || c.id))
          nuovi.push(c.id)
        }
        frontier = nuovi
      }
    }

    // ANTI-DUPLICATO PER-MASTER: escludo le spedizioni già in una distinta creata da ME.
    // Tutto PAGINATO e a chunk (id delle mie distinte possono superare i limiti di URL/1000 righe).
    const mieDist = await fetchAll(() => admin.from('distinte_contrassegni').select('id').eq('master_id', mio).order('id', { ascending: true }))
    const giaMie = new Set<string>()
    for (let i = 0; i < mieDist.length; i += 200) {
      const mieRighe = await fetchAll(() => admin.from('distinte_contrassegni_righe')
        .select('spedizione_id').in('distinta_id', mieDist.slice(i, i + 200).map((d: any) => d.id)).order('id', { ascending: true }))
      for (const r of mieRighe) if ((r as any).spedizione_id) giaMie.add((r as any).spedizione_id)
    }
    const daCaricare = spedizioni.filter((s: any) => !giaMie.has(s.id))
    const giaCaricate = spedizioni.length - daCaricare.length

    // DUE RAMI: spedizioni MIE → distinta al cliente; di un SOTTO-MASTER → rimessa alla sua prima linea.
    const clientiMap: Record<string, any[]> = {}
    const masterMap: Record<string, any[]> = {}
    let senzaDestinatario = 0
    for (const s of daCaricare) {
      if (s.master_id === mio) {
        if (!s.cliente_id) { senzaDestinatario++; continue }
        ;(clientiMap[s.cliente_id] = clientiMap[s.cliente_id] || []).push(s)
      } else {
        const fl = primaLinea.get(s.master_id)
        if (!fl) { senzaDestinatario++; continue }
        ;(masterMap[fl] = masterMap[fl] || []).push(s)
      }
    }

    let create = 0
    // Verso i miei CLIENTI (livello finale): stato_contrassegno globale = stato del CLIENTE → in_distinta.
    for (const [clienteId, sped] of Object.entries(clientiMap)) {
      const totale = sped.reduce((acc, s) => acc + Number(s.contrassegno || 0), 0)
      const { data: distinta } = await admin.from('distinte_contrassegni').insert({
        master_id: mio, cliente_id: clienteId, totale_iniziale: totale, totale_rimborsato: totale, stato: 'in_lavorazione',
      }).select().single()
      if (!distinta) continue
      await admin.from('distinte_contrassegni_righe').insert(sped.map(s => ({
        distinta_id: distinta.id, spedizione_id: s.id, numero_spedizione: s.numero,
        importo_cod: Number(s.contrassegno), importo_sistema: Number(s.contrassegno),
      })))
      await admin.from('spedizioni').update({ stato_contrassegno: 'in_distinta', distinta_contrassegno_id: distinta.id })
        .in('id', sped.map(s => s.id)).neq('stato_contrassegno', 'pagato')
      create++
    }
    // Verso i SOTTO-MASTER (rimessa): niente stato globale (lo vede il loro elenco per-livello).
    for (const [flId, sped] of Object.entries(masterMap)) {
      const totale = sped.reduce((acc, s) => acc + Number(s.contrassegno || 0), 0)
      const { data: distinta } = await admin.from('distinte_contrassegni').insert({
        master_id: mio, target_master_id: flId, totale_iniziale: totale, totale_rimborsato: totale, stato: 'in_lavorazione',
      }).select().single()
      if (!distinta) continue
      await admin.from('distinte_contrassegni_righe').insert(sped.map(s => ({
        distinta_id: distinta.id, spedizione_id: s.id, numero_spedizione: s.numero,
        importo_cod: Number(s.contrassegno), importo_sistema: Number(s.contrassegno),
      })))
      create++
    }

    return NextResponse.json({
      success: true, rimesseCaricate: ricevute.length, distinteCreate: create, giaCaricate,
      spedizioniTrovate: spedizioni.length, senzaDestinatario,
    })
  } catch (e: any) {
    // Errore a metà: riapro il claim, l'utente riprova e l'anti-duplicato salta ciò che è già entrato.
    await annullaClaim()
    console.error('[COD][CARICA-RICEVUTE] errore:', e?.message)
    return NextResponse.json({ error: 'Errore durante il caricamento: riprova. Nessuna rimessa è andata persa.' }, { status: 500 })
  }
}
