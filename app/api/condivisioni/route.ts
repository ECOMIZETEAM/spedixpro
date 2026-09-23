import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente } from '@/lib/permessi'
import { generaListinoIngrosso, ListinoIngrossoError } from '@/lib/listino-ingrosso'

/* CONDIVISIONE CONTRATTI TRA MASTER — lato venditore (Fase 2).
 *
 * Un master rivende un suo contratto a un altro master, ovunque nell'albero. Qui NON si tocca il motore
 * prezzi/credito: si gestisce solo il RECORD della condivisione (`corrieri_condivisi`). Cliente-ledger,
 * api_key e listino d'ingrosso arrivano nella fetta successiva; l'accetta del compratore nella Fase 3.
 *
 * Sicurezza: `corrieri_condivisi` è service-role only (RLS senza policy, revoca anon/authenticated), quindi
 * l'isolamento fra tenant lo rifà QUI a mano — solo master/admin, e un contratto lo si condivide solo se è
 * DAVVERO del proprio master. Vedi CONDIVISIONE-CONTRATTI.md.
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

  // I miei contratti condivisibili: contratti DEL mio master, attivi, che non siano già ricevuti via
  // condivisione (niente ri-catena in questa fetta).
  const { data: mieiCorrieri } = await admin.from('corrieri')
    .select('id,nome_contratto,tipo,attivo,condivisibile,proprio')
    .eq('master_id', a.masterId).eq('attivo', true).neq('tipo', 'moovexpress')
    .order('nome_contratto')

  // Condivisioni che HO CREATO io (sono il venditore).
  const { data: rivendoRaw } = await admin.from('corrieri_condivisi')
    .select('id,corriere_id,master_id,stato,credito_modo,created_at,accettata_il,revocata_il,markup')
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

  const descriviMarkup = (m: any): string => {
    const d = m?.default
    if (!d || !Number(d.valore)) return '—'
    return d.mode === 'fisso' ? `+ € ${Number(d.valore).toFixed(2)}` : `+ ${Number(d.valore)}%`
  }
  const rivendo = (rivendoRaw || []).map(r => ({
    id: r.id, stato: r.stato, credito_modo: r.credito_modo, creata_il: r.created_at,
    accettata_il: r.accettata_il, revocata_il: r.revocata_il,
    ricarico: descriviMarkup(r.markup),
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
    contratti: mieiCorrieri || [],
    rivendo, ricevuti,
  })
}

export async function POST(req: NextRequest) {
  const a = await attore()
  if (!a) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  const admin = createAdminSupabase()

  const corpo = await req.json().catch(() => ({} as any))
  const codice = String(corpo?.codice || '').trim().toUpperCase()
  const corriereId = String(corpo?.corriere_id || '').trim()
  const markup = corpo?.markup ?? null   // { default:{mode,valore}, perFascia } — il prezzo d'ingrosso
  if (!codice || !corriereId) return NextResponse.json({ error: 'Serve il codice del compratore e il contratto.' }, { status: 400 })

  // Il compratore, dal codice. Mai esposto un elenco: si risolve solo un codice che già si possiede.
  const { data: compratore } = await admin.from('masters').select('id,nome').eq('codice_condivisione', codice).maybeSingle()
  if (!compratore) return NextResponse.json({ error: 'Codice non valido.' }, { status: 404 })
  if (compratore.id === a.masterId) return NextResponse.json({ error: 'Non puoi condividere un contratto con te stesso.' }, { status: 400 })

  // Il contratto DEVE essere del mio master (perimetro a mano: il service-role bypassa la RLS).
  const { data: corriere } = await admin.from('corrieri').select('id,master_id,attivo,tipo,nome_contratto').eq('id', corriereId).maybeSingle()
  if (!corriere || corriere.master_id !== a.masterId) return NextResponse.json({ error: 'Contratto non trovato tra i tuoi.' }, { status: 404 })
  if (!corriere.attivo) return NextResponse.json({ error: 'Il contratto non è attivo.' }, { status: 400 })
  if (corriere.tipo === 'moovexpress') return NextResponse.json({ error: 'Un contratto ricevuto da un altro master non è ri-condivisibile qui.' }, { status: 400 })

  // Niente doppioni: una condivisione VIVA (in attesa o attiva) per la stessa coppia contratto→compratore.
  const { data: gia } = await admin.from('corrieri_condivisi')
    .select('id,stato').eq('corriere_id', corriereId).eq('master_id', compratore.id)
    .in('stato', ['in_attesa', 'attiva']).maybeSingle()
  if (gia) return NextResponse.json({ error: `Questo contratto è già condiviso con ${compratore.nome} (${gia.stato === 'attiva' ? 'attivo' : 'in attesa'}).` }, { status: 409 })

  // Genera il LISTINO D'INGROSSO (costo del venditore + ricarico) PRIMA di creare la condivisione: se
  // manca il costo da cui partire, non si crea nulla di monco. È il prezzo che pagherà il compratore.
  let listinoIngrossoId: string
  try {
    const r = await generaListinoIngrosso(admin, {
      fornitoreMasterId: a.masterId, corriereId, markup,
      nome: `Ingrosso ${compratore.nome} · ${corriere.nome_contratto || ''}`.trim(),
    })
    listinoIngrossoId = r.listinoId
  } catch (e: any) {
    if (e instanceof ListinoIngrossoError) return NextResponse.json({ error: e.message }, { status: 400 })
    console.error('[condivisioni] listino ingrosso', e)
    return NextResponse.json({ error: 'Non sono riuscito a preparare il listino d’ingrosso.' }, { status: 500 })
  }

  const { data: creata, error } = await admin.from('corrieri_condivisi').insert({
    corriere_id: corriereId,
    master_id: compratore.id,          // ACQUIRENTE (semantica della tabella scheletro)
    fornitore_master_id: a.masterId,   // VENDITORE
    stato: 'in_attesa',
    credito_modo: 'prepagato',
    listino_ingrosso_id: listinoIngrossoId,
    markup: markup || null,
  }).select('id').single()
  if (error) {
    console.error('[condivisioni] insert', error)
    // Niente condivisione = niente listino orfano: pulisco quello appena creato.
    await admin.from('listini_clienti').delete().eq('id', listinoIngrossoId)
    return NextResponse.json({ error: 'Creazione non riuscita.' }, { status: 500 })
  }

  // Marca il contratto come condivisibile (era il flag dormiente `condivisibile`).
  await admin.from('corrieri').update({ condivisibile: true }).eq('id', corriereId)

  return NextResponse.json({ ok: true, id: creata.id, compratore: compratore.nome })
}
