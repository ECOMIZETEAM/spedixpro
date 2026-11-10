import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { raggruppaPerInvio } from '@/lib/network-invii'

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
      .select('id').eq('target_master_id', mio).neq('master_id', mio).eq('confermata', true).is('propagazione', null)
    const ids = (candid || []).map((r: any) => r.id)
    if (ids.length) {
      const { data: figlie } = await adminDb.from('rettifiche').select('origine_rettifica_id').in('origine_rettifica_id', ids)
      const conFiglia = Array.from(new Set((figlie || []).map((f: any) => f.origine_rettifica_id).filter(Boolean)))
      if (conFiglia.length) await adminDb.from('rettifiche').update({ propagazione: 'propagata' }).in('id', conFiglia as string[])
    }
  } catch { /* best-effort: non deve mai bloccare la lista */ }

  const COLONNE = 'id,master_id,spedizione_id,numero_spedizione,peso_iniziale,peso_volume_iniziale,peso_reale,peso_volume_reale,costo_iniziale,costo_finale,differenza,fuori_sagoma,confermata,confermata_il,stato,propagazione,created_at,masters:master_id(nome)'
  const TETTO_STORICHE = 500
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
    // IL TETTO NON BASTA MAI. Anche a mille righe: il 29/09/2026 il livello di sopra ne ha
    // confermate 2.215 in un pomeriggio verso un solo sotto-master, che ne ha viste 999 — e quelle
    // che non vede non puo' accettarle, quindi non puo' nemmeno girarle ai suoi clienti: il
    // recupero si ferma li'. Le righe DA DECIDERE si prendono TUTTE, pagina per pagina; le
    // storiche (gia' decise) restano col loro tetto, che li' serve solo a mostrare lo scorso.
    // IL COSTO DI CHI CARICA NON E' UNA RETTIFICA RICEVUTA. Il detentore di un contratto proprio paga
    // per primo: quando sotto di lui non c'e' niente da recuperare, il suo costo resta in una riga
    // intestata a se' stesso (master_id = target_master_id). Non viene da sopra, non si gira a nessuno.
    (async () => {
      const daDecidere: any[] = []
      for (let da = 0; ; da += 1000) {
        const { data, error } = await adminDb.from('rettifiche')
          .select(COLONNE)
          .eq('target_master_id', mio).neq('master_id', mio).eq('confermata', true).is('propagazione', null)
          .order('created_at', { ascending: false }).order('id', { ascending: false }).range(da, da + 999)
        if (error) { console.error('[NETWORK] rettifiche da decidere:', error.message); break }
        daDecidere.push(...(data || []))
        if (!data || data.length < 1000) break
      }
      // LE GIA' DECISE DALL'ADDEBITO PIU' RECENTE, NON DALLA NASCITA. I blocchi seguono il giorno della conferma
      // (lib/network-invii): leggendole per nascita, una conferma con dentro righe nate giorni prima (i 17
      // supplementi UPS del 30/10 confermati da MULTI il 07/11) restava a meta' sotto il tetto, col totale sbagliato.
      // E IL GIORNO IN CUI CADE IL TETTO SI LEGGE TUTTO. Un tetto fisso di righe taglia un giorno a meta': il 04/11
      // MULTI ha addebitato a Ecomize Solution ~2.370 righe, e le 500 piu' recenti finivano dentro quel giorno. Un
      // blocco a meta' mostra un totale che non e' quello addebitato; toglierlo lasciava la pagina senza storico.
      // Si guarda dove cade la 500esima e si legge da 36 ore prima (il suo giorno intero, piu' un margine): il giorno
      // piu' vecchio, letto a meta', lo toglie raggruppaPerInvio.
      const base = () => adminDb.from('rettifiche').select(COLONNE)
        .eq('target_master_id', mio).neq('master_id', mio).eq('confermata', true).not('propagazione', 'is', null)
      const { data: soglia } = await adminDb.from('rettifiche').select('confermata_il')
        .eq('target_master_id', mio).neq('master_id', mio).eq('confermata', true).not('propagazione', 'is', null)
        .order('confermata_il', { ascending: false, nullsFirst: false }).range(TETTO_STORICHE - 1, TETTO_STORICHE - 1)
      const taglio = (soglia as any)?.[0]?.confermata_il as string | null | undefined
      if (!taglio) {
        // sotto il tetto (o oltre il tetto ci sono solo righe senza ora, storico molto vecchio): come prima
        const { data: storiche } = await base()
          .order('confermata_il', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(TETTO_STORICHE)
        return { data: [...daDecidere, ...(storiche || [])], storicheTagliate: (storiche || []).length >= TETTO_STORICHE, error: null }
      }
      const da = new Date(new Date(taglio).getTime() - 36 * 3600 * 1000).toISOString()
      const storiche: any[] = []
      for (let p = 0; p < 6000; p += 1000) {
        const { data, error } = await base().gte('confermata_il', da)
          .order('confermata_il', { ascending: false }).order('id', { ascending: false }).range(p, p + 999)
        if (error) { console.error('[NETWORK] rettifiche gia\' decise:', error.message); break }
        storiche.push(...(data || []))
        if (!data || data.length < 1000) break
      }
      return { data: [...daDecidere, ...storiche], storicheTagliate: true, error: null }
    })(),
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
    rettifiche: raggruppaPerInvio(rettRows, !!(rett as any).storicheTagliate),
    contrassegni: cod.data || [],
    resi: resi.data || [],
  })
}
