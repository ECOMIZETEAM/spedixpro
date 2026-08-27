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

  // SELF-HEAL: una FIGLIA può esistere mentre il padre è rimasto propagazione=null (giro di
  // propagazione interrotto a metà, o concorrente). Quel padre riappare come "da decidere" e al
  // re-tentativo dà "già propagata" — la confusione segnalata da Lorenzo. Prima di leggere, marco
  // 'propagata' i padri (miei, confermati, ancora null) che hanno GIA' una figlia, così escono dalle
  // "da decidere". Best-effort, idempotente, non muove denaro (solo il flag propagazione).
  try {
    const { data: candid } = await adminDb.from('rettifiche')
      .select('id').eq('target_master_id', mio).eq('confermata', true).is('propagazione', null)
    const ids = (candid || []).map((r: any) => r.id)
    if (ids.length) {
      const { data: figlie } = await adminDb.from('rettifiche').select('origine_rettifica_id').in('origine_rettifica_id', ids)
      const conFiglia = Array.from(new Set((figlie || []).map((f: any) => f.origine_rettifica_id).filter(Boolean)))
      if (conFiglia.length) await adminDb.from('rettifiche').update({ propagazione: 'propagata' }).in('id', conFiglia as string[])
    }
  } catch { /* best-effort: non deve mai bloccare la lista */ }

  const [rett, cod, resi] = await Promise.all([
    // SI VEDE SOLO QUELLO CHE E' GIA' STATO ADDEBITATO.
    // Mancava il filtro sulla conferma: appena il master di sopra CARICAVA il file, le righe
    // comparivano gia' qui sotto — ancora in attesa, ancora sue, ancora modificabili o
    // cancellabili. Chi le vedeva se le trovava addosso prima che nessuno avesse deciso niente e
    // senza che gli fosse stato tolto un euro. Una rettifica diventa "ricevuta" nel momento in cui
    // il livello di sopra la conferma e il credito viene scalato: prima non esiste, per chi la
    // riceve. E' la stessa regola dei contrassegni, dove la rimessa si vede solo da caricata.
    // LE DA DECIDERE PRIME, POI LE STORICHE. Ordinando solo per data, col tempo le rettifiche già
    // decise (che restano qui) riempivano il tetto e spingevano FUORI dalle 200 le nuove ancora da
    // decidere: il sotto-master smetteva di vederle e non poteva più addebitarle. Ora le null
    // (da decidere) vengono sempre prima e il tetto è ampio, così non spariscono mai.
    adminDb.from('rettifiche')
      .select('id,spedizione_id,numero_spedizione,peso_iniziale,peso_volume_iniziale,peso_reale,peso_volume_reale,costo_iniziale,costo_finale,differenza,fuori_sagoma,confermata,stato,propagazione,created_at,masters:master_id(nome)')
      .eq('target_master_id', mio)
      .eq('confermata', true)
      .order('propagazione', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: false }).limit(1000),
    adminDb.from('distinte_contrassegni')
      .select('id,numero,totale_iniziale,totale_rimborsato,metodo_pagamento,stato,data_pagamento,accettata_target,created_at,masters:master_id(nome),distinte_contrassegni_righe(numero_spedizione,importo_cod)')
      .eq('target_master_id', mio)
      .order('created_at', { ascending: false }).limit(100),
    adminDb.from('distinte_resi')
      .select('id,numero,totale,totale_ldv,stato,accettata_target,created_at,voci,masters:master_id(nome)')
      .eq('target_master_id', mio)
      .order('created_at', { ascending: false }).limit(100),
  ])

  // SPEDIZIONI PROPRIE DEL RICEVENTE: la rettifica è di una spedizione SENZA cliente il cui
  // proprietario è il master stesso (l'ha spedita lui, per conto suo). Sotto di lui non c'è nessuno
  // a cui girarla: è già a suo carico (il credito gli è stato scalato). Non va mostrata come una
  // scelta "propaga / Le assorbo io" — quel bottone suona come accollarsi il costo di un altro,
  // mentre qui il pacco è suo. Si marca `propria` così la UI la mostra come "tua spedizione".
  const rettRows = (rett.data || []) as any[]
  const spedIds = [...new Set(rettRows.map(r => r.spedizione_id).filter(Boolean))]
  const proprieSet = new Set<string>()
  for (let i = 0; i < spedIds.length; i += 300) {
    const { data: ss } = await adminDb.from('spedizioni').select('id,cliente_id,master_id').in('id', spedIds.slice(i, i + 300))
    for (const s of (ss || [])) if ((s as any).cliente_id == null && (s as any).master_id === mio) proprieSet.add((s as any).id)
  }
  for (const r of rettRows) r.propria = !!(r.spedizione_id && proprieSet.has(r.spedizione_id))

  return NextResponse.json({
    rettifiche: rettRows,
    contrassegni: cod.data || [],
    resi: resi.data || [],
  })
}
