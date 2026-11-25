import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds, contrattiPossedutiNomi } from '@/lib/rete-masters'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { STATI_RITIRO_ANNULLATI } from '@/lib/ritiro-vista'
import { giorniFaRoma } from '@/lib/date-roma'

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
  const idsAgente = isAgente(utente) ? idClientiPerFiltro(await clientiAgente(supabase, utente)) : null
  // Gli stessi filtri per le due letture qui sotto: senza ritiro, e con un ritiro annullato.
  const base = () => {
    let q = admin
      .from('spedizioni')
      .select(`id,numero,dest_nome,dest_citta,colli,peso_reale,corriere_id,cliente_id,master_id,raw_response,created_at,${ownedContractNames && ownedContractNames.length ? 'corrieri!inner(tipo,nome_contratto)' : 'corrieri(tipo,nome_contratto)'}`)
      .in('master_id', masterIds)
      .in('stato', ['in_lavorazione', 'spedita'])
    if (isCliente) q = q.eq('cliente_id', utente.cliente_id)
    else if (ownedContractNames && ownedContractNames.length) q = q.in('corrieri.nome_contratto', ownedContractNames)
    // Agente: solo spedizioni dei suoi clienti.
    if (idsAgente) q = q.in('cliente_id', idsAgente)
    return q
  }

  const { data: senzaRitiro, error } = await base().is('ritiro_id', null)
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // RITIRO ANNULLATO = DI NUOVO RITIRABILE (Lorenzo, 25/11/2026). Se il corriere annulla o rifiuta la
  // prenotazione e il pacco e' ancora fermo (in_lavorazione/spedita, come sopra), la spedizione resta legata
  // al ritiro annullato — lo storico non si perde — ma si puo' prenotare di nuovo. Prima restava fuori da
  // qui per sempre: 102 pacchi fermi in 30 giorni. Solo i ritiri degli ultimi 30 giorni, letti a blocchi: un
  // .in() con centinaia di id fa un indirizzo troppo lungo e la lettura fallisce senza dirlo.
  const { data: annullati, error: errA } = await admin.from('ritiri').select('id')
    .in('stato', STATI_RITIRO_ANNULLATI).gte('data_ritiro', giorniFaRoma(30))
    .order('data_ritiro', { ascending: false }).order('id', { ascending: true }).limit(1000)
  if (errA) return NextResponse.json({ error: errA.message }, { status: 400 })
  const idsAnnullati = (annullati || []).map((r: any) => r.id)
  const conRitiroAnnullato: any[] = []
  for (let i = 0; i < idsAnnullati.length; i += 150) {
    const { data, error: e } = await base().in('ritiro_id', idsAnnullati.slice(i, i + 150))
    if (e) return NextResponse.json({ error: e.message }, { status: 400 })
    conRitiroAnnullato.push(...(data || []))
  }
  const spedizioni = [...(senzaRitiro || []), ...conRitiroAnnullato]
    .sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))

  // Corrieri con ritiro ON-DEMAND: spedisci.online / spediamopro (pickup provider) e FedEx diretto
  // (Pickup API). GLS/BRT no: la raccolta è con l'accordo standard, non si prenota da qui.
  // CONDIVISIONE: una gamba-ponte ('moovexpress') è ritirabile — il ritiro lo prenota l'OWNER reale
  // (ritiri/crea risolve la gamba owner e usa il suo contratto, es. Poste on-demand). Senza, il contratto
  // condiviso non compariva nemmeno nel menu ("non mi dà il contratto sul ritiro").
  const raw = (spedizioni || []).filter((s: any) => ['spedisci', 'spediamopro', 'fedex', 'moovexpress'].includes(s.corrieri?.tipo))

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
