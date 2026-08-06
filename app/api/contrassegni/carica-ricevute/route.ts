import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente, bloccaAgente } from '@/lib/agente'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'
import { mappaPrimaLinea } from '@/lib/prima-linea'

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
  const mio = utente.master_id
  const admin = createAdminSupabase()
  const { data } = await admin.from('distinte_contrassegni')
    .select('id,numero,totale_iniziale,created_at,accettata_target_at,masters:master_id(nome),distinte_contrassegni_righe(id)')
    .eq('target_master_id', mio)
    .eq('accettata_target', true)
    .eq('caricata_target', false)
    .order('created_at', { ascending: false })

  const rimesse = (data || []).map((d: any) => ({
    id: d.id, numero: d.numero, totale: Number(d.totale_iniziale || 0), created_at: d.created_at,
    // L'embed di PostgREST torna a volte l'oggetto e a volte l'array a un elemento: se si legge
    // solo `.nome` la colonna "Da" resta vuota senza che nulla segnali l'errore.
    mittente: (Array.isArray(d.masters) ? d.masters[0]?.nome : d.masters?.nome) || '—',
    righe: (d.distinte_contrassegni_righe || []).length,
    destinatari: [] as any[],
  }))
  if (!rimesse.length) return NextResponse.json([])

  // A CHI ANDRANNO — visibile PRIMA di accettare, non dopo.
  // "Da MULTIEXPRESS, 74 spedizioni, 3.812 euro" non dice niente a chi deve decidere: la domanda
  // vera e' quanto ne va a ciascuno dei propri clienti e sotto-master. E' la stessa ripartizione
  // che il POST fa davvero al momento del carico — qui si mostra soltanto, non si scrive nulla.
  try {
    await ripartizionePerDestinatario(admin, mio, rimesse)
  } catch (e: any) {
    // La ripartizione e' un di piu': se salta, l'elenco delle rimesse deve restare utilizzabile.
    console.error('[COD][RIMESSE] ripartizione non calcolata:', e?.message)
  }

  return NextResponse.json(rimesse)
}

// Riempie `destinatari` su ogni rimessa: chi (cliente o sotto-master di prima linea), quante
// spedizioni e quanti euro. Stessa regola del carico vero, cosi' l'anteprima non promette una
// divisione diversa da quella che poi avviene.
async function ripartizionePerDestinatario(admin: any, mio: string, rimesse: any[]) {
  const ids = rimesse.map(r => r.id)
  const righe = await fetchAll(() => admin.from('distinte_contrassegni_righe')
    .select('distinta_id,numero_spedizione,importo_cod').in('distinta_id', ids).order('id', { ascending: true }))
  if (!righe.length) return

  const numeri = Array.from(new Set(righe.map((r: any) => r.numero_spedizione).filter(Boolean)))
  const sped = new Map<string, any>()
  for (let i = 0; i < numeri.length; i += 200) {
    const chunk = await fetchAll(() => admin.from('spedizioni')
      .select('numero,master_id,cliente_id').in('numero', numeri.slice(i, i + 200)).order('id', { ascending: true }))
    for (const s of chunk) sped.set((s as any).numero, s)
  }

  const primaLinea = await mappaPrimaLinea(admin, mio)

  // Chiave di raggruppamento identica a quella dell'area di sosta: cliente mio, oppure il figlio
  // diretto attraverso cui scende il ramo.
  const per = new Map<string, Map<string, { chiave: string; tipo: string; spedizioni: number; totale: number }>>()
  const cliIds = new Set<string>(), mstIds = new Set<string>()
  for (const r of righe as any[]) {
    const s = sped.get(r.numero_spedizione)
    let chiave: string
    if (!s) chiave = '?:'
    else if (s.master_id === mio) { if (!s.cliente_id) chiave = '?:'; else { chiave = `c:${s.cliente_id}`; cliIds.add(s.cliente_id) } }
    else { const fl = primaLinea.get(s.master_id); if (!fl) chiave = '?:'; else { chiave = `m:${fl}`; mstIds.add(fl) } }
    if (!per.has(r.distinta_id)) per.set(r.distinta_id, new Map())
    const g = per.get(r.distinta_id)!
    if (!g.has(chiave)) g.set(chiave, { chiave, tipo: chiave[0] === 'c' ? 'cliente' : chiave[0] === 'm' ? 'sotto-master' : 'da assegnare', spedizioni: 0, totale: 0 })
    const v = g.get(chiave)!
    v.spedizioni++; v.totale += Number(r.importo_cod) || 0
  }

  // I nomi vanno letti con l'admin: con le regole per riga un master NON vede i propri sotto-master
  // nella tabella `masters`, e la colonna resterebbe muta — e' esattamente il "nessun nome".
  const [{ data: cli }, { data: mst }] = await Promise.all([
    cliIds.size ? admin.from('clienti').select('id,ragione_sociale').in('id', Array.from(cliIds)) : Promise.resolve({ data: [] as any[] }),
    mstIds.size ? admin.from('masters').select('id,nome').in('id', Array.from(mstIds)) : Promise.resolve({ data: [] as any[] }),
  ])
  const nomeCli = new Map((cli || []).map((c: any) => [c.id, c.ragione_sociale]))
  const nomeMst = new Map((mst || []).map((m: any) => [m.id, m.nome]))

  for (const r of rimesse) {
    const g = per.get(r.id)
    if (!g) continue
    r.destinatari = Array.from(g.values())
      .map(v => ({
        ...v,
        totale: Math.round(v.totale * 100) / 100,
        nome: v.chiave[0] === 'c' ? (nomeCli.get(v.chiave.slice(2)) || 'cliente')
            : v.chiave[0] === 'm' ? (nomeMst.get(v.chiave.slice(2)) || 'sotto-master')
            : 'destinatario non riconosciuto',
      }))
      .sort((a, b) => (a.tipo === b.tipo ? b.totale - a.totale : a.tipo === 'cliente' ? -1 : 1))
  }
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

    // Prima linea per ogni discendente (il figlio DIRETTO attraverso cui discende, come resi/elenco).
    // Stessa funzione dell'anteprima qui sopra: se divergessero, il riquadro prometterebbe una
    // divisione e il carico ne farebbe un'altra.
    const primaLinea = await mappaPrimaLinea(admin, mio)

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

    // AREA DI SOSTA: le rimesse accettate NON generano piu' distinte automatiche. I contrassegni
    // entrano nel "da caricare" gia' divisi per destinatario (cliente o sotto-master) e sara' il
    // master a scegliere a chi caricarli, esattamente come per il file del corriere.
    const inSosta: any[] = []
    for (const [clienteId, sped] of Object.entries(clientiMap)) {
      for (const sp of sped) inSosta.push({ master_id: mio, spedizione_id: sp.id, importo: Number(sp.contrassegno) || 0,
        cliente_id: clienteId, target_master_id: null, origine: 'rimessa', origine_id: ricevuteIds[0] || null })
    }
    for (const [flId, sped] of Object.entries(masterMap)) {
      for (const sp of sped) inSosta.push({ master_id: mio, spedizione_id: sp.id, importo: Number(sp.contrassegno) || 0,
        cliente_id: null, target_master_id: flId, origine: 'rimessa', origine_id: ricevuteIds[0] || null })
    }
    let create = 0
    for (let i = 0; i < inSosta.length; i += 500) {
      const { data: ins } = await admin.from('cod_da_caricare')
        .upsert(inSosta.slice(i, i + 500), { onConflict: 'master_id,spedizione_id', ignoreDuplicates: true })
        .select('id')
      create += (ins || []).length
    }

    return NextResponse.json({
      success: true, rimesseCaricate: ricevute.length, inAttesa: create, giaCaricate,
      spedizioniTrovate: spedizioni.length, senzaDestinatario,
    })
  } catch (e: any) {
    // Errore a metà: riapro il claim, l'utente riprova e l'anti-duplicato salta ciò che è già entrato.
    await annullaClaim()
    console.error('[COD][CARICA-RICEVUTE] errore:', e?.message)
    return NextResponse.json({ error: 'Errore durante il caricamento: riprova. Nessuna rimessa è andata persa.' }, { status: 500 })
  }
}
