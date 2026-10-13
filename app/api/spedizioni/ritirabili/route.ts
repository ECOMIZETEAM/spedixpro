import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds, contrattiPossedutiNomi } from '@/lib/rete-masters'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { ledgerFornitoriDaNascondere, ledgerDoppioniNelPerimetro } from '@/lib/gambe-visibilita'
import { fetchAll } from '@/lib/fetch-all'

// Corrieri con ritiro ON-DEMAND: spedisci.online / spediamopro (pickup provider) e FedEx diretto
// (Pickup API). GLS/BRT no: la raccolta è con l'accordo standard, non si prenota da qui.
// CONDIVISIONE: una gamba-ponte ('moovexpress') è ritirabile — il ritiro lo prenota l'OWNER reale
// (ritiri/crea risolve la gamba owner e usa il suo contratto, es. Poste on-demand). Senza, il contratto
// condiviso non compariva nemmeno nel menu ("non mi dà il contratto sul ritiro").
const TIPI_RITIRO_PRENOTABILE = ['spedisci', 'spediamopro', 'fedex', 'moovexpress']

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  const admin = createAdminSupabase()
  const isCliente = utente.ruolo === 'cliente'

  // Master: vede tutta la propria rete (sotto-albero). Cliente: solo le proprie.
  const masterIds = isCliente ? [utente.master_id] : await sottoAlberoMasterIds(admin, utente.master_id)
  // VISIBILITÀ PER CONTRATTO: un master vede/ritira i pacchi dei discendenti SOLO sui contratti che
  // possiede (i privati dei sub non sono roba sua). Cliente/agente: filtrati per cliente, non serve.
  const ownedContractNames = isCliente ? null : await contrattiPossedutiNomi(admin, utente.master_id)

  // Ritirabile = spedizione non ancora presa in carico dal corriere e NON già in un ritiro
  // (ritiro_id null). Include anche le 'spedita': la distinta serale marca 'spedita' pure i colli
  // fisicamente ancora dal mittente in attesa di ritiro (caso reale BRT) — escluderle rendeva
  // impossibile prenotare il ritiro il giorno dopo. Restano fuori solo quelle davvero in viaggio
  // (in_transito e oltre).
  // IL TIPO DI CORRIERE SI FILTRA NEL DATABASE, PRIMA DEL TETTO, e le gambe dei fornitori non entrano.
  // Prima si prendevano le 1.000 spedizioni piu' recenti di qualunque corriere e solo dopo si tenevano
  // quelle col ritiro prenotabile: il 13/10/2026 MULTIEXPRESS vedeva solo quelle create dalle 14:10, con
  // 301 gambe "(ingrosso)" su 587 righe (lo stesso pacco due volte), e 9.537 spedizioni prenotabili
  // restavano fuori. La gamba del cliente resta: il ritiro risale da li' al detentore (ritiri/crea).
  const ledgerNascosti = isCliente ? [] : Array.from(new Set([
    ...(await ledgerFornitoriDaNascondere(admin, utente.master_id)),
    ...(await ledgerDoppioniNelPerimetro(admin, masterIds)),
  ]))
  const idsAgente = isAgente(utente) ? idClientiPerFiltro(await clientiAgente(supabase, utente)) : null
  const costruisci = () => {
    let query = admin
      .from('spedizioni')
      .select('id,numero,dest_nome,dest_citta,colli,peso_reale,corriere_id,cliente_id,master_id,created_at,corrieri!inner(tipo,nome_contratto)')
      .in('master_id', masterIds)
      .in('stato', ['in_lavorazione', 'spedita'])
      .is('ritiro_id', null)
      .in('corrieri.tipo', TIPI_RITIRO_PRENOTABILE)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })

    if (isCliente) query = query.eq('cliente_id', utente.cliente_id)
    else if (ownedContractNames && ownedContractNames.length) query = query.in('corrieri.nome_contratto', ownedContractNames)
    if (ledgerNascosti.length) query = query.or(`cliente_id.is.null,cliente_id.not.in.(${ledgerNascosti.join(',')})`)
    // Agente: solo spedizioni dei suoi clienti.
    if (idsAgente) query = query.in('cliente_id', idsAgente)
    return query
  }

  // A blocchi, con un tetto alto (la pagina filtra cliente, giorno e LDV nel browser): 10.000 righe sono
  // giorni di lavoro anche per la rete piu' grande.
  let spedizioni: any[]
  try { spedizioni = await fetchAll(costruisci, 10000, { lancia: true }) }
  catch (e: any) { return NextResponse.json({ error: 'Spedizioni ritirabili non lette: riprova tra qualche secondo.' }, { status: 503 }) }

  // Il tipo di corriere e' gia' filtrato nella query (TIPI_RITIRO_PRENOTABILE, in cima al file).
  const raw = spedizioni || []

  // Risolvo i nomi di master e clienti per il filtro "cliente/master" (solo master)
  const mastMap = new Map<string, string>()
  const cliMap = new Map<string, string>()
  if (!isCliente) {
    const mIds = [...new Set(raw.map((s: any) => s.master_id).filter(Boolean))]
    const cIds = [...new Set(raw.map((s: any) => s.cliente_id).filter(Boolean))]
    if (mIds.length) {
      const { data: ms } = await admin.from('masters').select('id,nome').in('id', mIds)
      for (const m of (ms || [])) mastMap.set(m.id, m.nome || '—')
    }
    if (cIds.length) {
      const { data: cs } = await admin.from('clienti').select('id,ragione_sociale').in('id', cIds)
      for (const c of (cs || [])) cliMap.set(c.id, c.ragione_sociale || '—')
    }
  }

  const out = raw.map((s: any) => {
    // "origine": chi ha fatto la spedizione (cliente se c'è, altrimenti il master proprietario)
    let origine_id: string, origine_nome: string
    if (s.cliente_id) { origine_id = s.cliente_id; origine_nome = cliMap.get(s.cliente_id) || 'Cliente' }
    else { origine_id = s.master_id; origine_nome = mastMap.get(s.master_id) || 'Diretto' }
    return {
      id: s.id, numero: s.numero, dest_nome: s.dest_nome, dest_citta: s.dest_citta,
      colli: s.colli, peso_reale: s.peso_reale, created_at: s.created_at,
      corriere_id: s.corriere_id,
      corriere_nome: (s.corrieri as any)?.nome_contratto || '—',
      // Niente `corriere_tipo`: il tipo serve al filtro qui sopra, non a chi chiama. Usciva
      // fino al portale del cliente col nome del sistema tecnico a valle.
      origine_id, origine_nome,
    }
  })

  return NextResponse.json(out)
}
