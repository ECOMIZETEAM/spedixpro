import { raggruppaPerInvio } from '@/lib/network-invii'
import { senzaChili } from '@/lib/rettifiche-perche'
import { inizioGiornoRomaISO } from '@/lib/date-roma'

// ── «DAL MIO NETWORK»: COSA HA RICEVUTO UN MASTER DAL LIVELLO SOPRA ──
// Rettifiche (gia' raggruppate per addebito, lib/network-invii), altri addebiti dello stesso giorno, rimesse dei
// contrassegni e distinte di reso. La legge app/api/network/ricevuti, che controlla chi chiede e fa prima la sua
// autoriparazione (quella scrive); qui solo letture, cosi' il conto si rifa' sui dati veri di un master senza la sua
// sessione, come lib/rettifiche-non-girate.
export async function datiRicevuti(adminDb: any, mio: string) {
  const COLONNE = 'id,master_id,spedizione_id,numero_spedizione,peso_iniziale,peso_volume_iniziale,peso_reale,peso_volume_reale,colli_ripesati,fattore_volume,costo_iniziale,costo_finale,differenza,fuori_sagoma,confermata,confermata_il,stato,propagazione,perche,created_at,masters:master_id(nome)'
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
  // Le rettifiche senza chili (senzaChili in lib/rettifiche-perche) chi le ha ricevute non le vede.
  const rettRows = ((rett.data || []) as any[]).filter(r => !senzaChili(r))
  const spedIds = [...new Set(rettRows.map(r => r.spedizione_id).filter(Boolean))]
  const proprieSet = new Set<string>()
  for (let i = 0; i < spedIds.length; i += 300) {
    const { data: ss } = await adminDb.from('spedizioni').select('id,cliente_id,master_id').in('id', spedIds.slice(i, i + 300))
    for (const s of (ss || [])) if ((s as any).cliente_id == null && (s as any).master_id === mio) proprieSet.add((s as any).id)
  }
  for (const r of rettRows) r.propria = !!(r.spedizione_id && proprieSet.has(r.spedizione_id))

  // IL PESO SU CUI SI PAGA, SULLE MULTICOLLO (lib/rettifiche-peso-pagato, lo stesso della Conferma e di Rettifica
  // Costi): i totali della riga non lo dicono, perche' si paga collo per collo. 3UW1WLJ093303 arrivava a Ecomize
  // Solution come «27,2 → 27,9 kg (vol.)» con 6,28 € di addebito; si paga 28,88 → 30,60 kg, oltre i 30.
  // I colli ripesati servono solo a questo conto: non escono dalla rotta.
  const multi = rettRows.filter(r => Array.isArray(r.colli_ripesati) && r.colli_ripesati.length > 1)
  if (multi.length) {
    try {
      const { pesiPagati } = await import('@/lib/rettifiche-peso-pagato')
      const { pesiDi } = await pesiPagati(adminDb, multi)
      for (const r of multi) { const p = pesiDi.get(r.id); if (p && p.dopo > 0) r.peso_pagato = p }
    } catch (e: any) { console.error('[NETWORK] peso su cui si paga:', e?.message) }
  }
  for (const r of rettRows) delete r.colli_ripesati
  // GIRATE SOTTO: per ogni riga caricata, la rettifica nata per chi sta sotto — quanto chiede e se e' gia' confermata
  // (quindi incassata). Il blocco dice cosi' quanto ti hanno scalato e quanto stai recuperando (Lorenzo, 16/11/2026).
  // Una figlia sola per riga: la garantisce l'indice unico su origine_rettifica_id.
  // A CHI E' ANDATA (Lorenzo, 19/11/2026: «controlla se veramente a quel cliente è stata addebitata la rettifica»): il
  // nome del cliente o del sotto-master e lo stato della figlia, per la tendina «Già girate ai clienti».
  const caricate = rettRows.filter(r => r.propagazione === 'propagata').map(r => r.id)
  const figlie = new Map<string, { euro: number; confermata: boolean; a: string | null; stato: string | null }>()
  const ffTutte: any[] = []
  for (let i = 0; i < caricate.length; i += 300) {
    const { data: ff } = await adminDb.from('rettifiche').select('origine_rettifica_id,differenza,fuori_sagoma,confermata,stato,cliente_id,target_master_id')
      .in('origine_rettifica_id', caricate.slice(i, i + 300))
    ffTutte.push(...(ff || []))
  }
  const nomi = new Map<string, string>()
  const idCli = [...new Set(ffTutte.map(f => f.cliente_id).filter(Boolean))] as string[]
  const idMst = [...new Set(ffTutte.map(f => f.target_master_id).filter(Boolean))] as string[]
  for (let i = 0; i < idCli.length; i += 300) {
    const { data } = await adminDb.from('clienti').select('id,ragione_sociale').in('id', idCli.slice(i, i + 300))
    for (const c of (data || []) as any[]) nomi.set(c.id, String(c.ragione_sociale || '').trim())
  }
  for (let i = 0; i < idMst.length; i += 300) {
    const { data } = await adminDb.from('masters').select('id,nome').in('id', idMst.slice(i, i + 300))
    for (const m of (data || []) as any[]) nomi.set(m.id, m.nome)
  }
  for (const f of ffTutte) figlie.set(f.origine_rettifica_id, {
    euro: Math.round((-Number(f.differenza || 0) + Number(f.fuori_sagoma || 0)) * 100) / 100, confermata: !!f.confermata,
    a: nomi.get(f.cliente_id || f.target_master_id) || null, stato: f.stato || null })
  for (const r of rettRows) if (figlie.has(r.id)) r.figlia = figlie.get(r.id)

  const raggruppate = raggruppaPerInvio(rettRows, !!(rett as any).storicheTagliate)

  // GLI ALTRI ADDEBITI DELLO STESSO GIORNO, che non sono ripesature: adeguamenti del contrassegno, correzioni scritte
  // a mano. Sono movimenti 'rettifica' del livello sopra senza una riga in `rettifiche`, e la pagina non li vedeva: il
  // 19/11/2026 Ecomize Solution ha sommato dalla Lista movimenti le rettifiche del 17/11 (205 movimenti, 907,59 €) e
  // in «Dal mio network» non ritrovava il conto, perche' 49 adeguamenti del contrassegno (63,39 €) non c'erano. Ora il
  // blocco del giorno torna col totale dei movimenti. Si leggono solo per i giorni gia' in pagina e non a meta'.
  // Un movimento e' «di una riga» se sulla stessa spedizione c'e' una rettifica dello stesso mittente con lo stesso
  // importo (anche una che la pagina non mostra, come le senza chili: quelle restano fuori, decisione del 13/11).
  const altri: any[] = []
  try {
    const blocchiInteri = new Set<string>()
    const primoGiorno = new Map<string, string>()   // mittente -> AAAA-MM-GG del suo blocco piu' vecchio intero
    for (const r of raggruppate as any[]) {
      if (r.blocco_parziale || !r.blocco) continue
      blocchiInteri.add(r.blocco)
      // La finestra parte dal primo giorno con righe gia' decise: le da decidere possono essere di mesi fa (Ecomize
      // Solution ne ha due del 13 e 14/09), e da li' si leggerebbero mille movimenti di giorni che la pagina non mostra.
      if (!r.propagazione) continue
      const [mitt, giorno] = String(r.blocco).split('|')
      if (!primoGiorno.has(mitt) || giorno < primoGiorno.get(mitt)!) primoGiorno.set(mitt, giorno)
    }
    const CHIAVE = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
    const GIORNO = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' })
    for (const [mitt, giorno] of primoGiorno) {
      const mov: any[] = []
      for (let da = 0; da < 20000; da += 1000) {
        const { data, error } = await adminDb.from('movimenti')
          .select('id,spedizione_id,importo,descrizione,created_at,spedizioni(numero)')
          .eq('tipo', 'rettifica').eq('master_id', mitt).eq('master_target_id', mio).is('cliente_id', null)
          .gte('created_at', inizioGiornoRomaISO(giorno)).order('created_at').order('id').range(da, da + 999)
        if (error) { console.error('[NETWORK] altri addebiti:', error.message); break }
        mov.push(...(data || []))
        if (!data || data.length < 1000) break
      }
      const sped = [...new Set(mov.map(m => m.spedizione_id).filter(Boolean))] as string[]
      const importiRighe = new Map<string, number[]>()
      for (let i = 0; i < sped.length; i += 300) {
        const { data } = await adminDb.from('rettifiche').select('spedizione_id,differenza,fuori_sagoma')
          .eq('master_id', mitt).eq('target_master_id', mio).in('spedizione_id', sped.slice(i, i + 300))
        for (const x of (data || []) as any[]) {
          const a = importiRighe.get(x.spedizione_id) || []
          a.push(-Number(x.differenza || 0) + Number(x.fuori_sagoma || 0)); importiRighe.set(x.spedizione_id, a)
        }
      }
      for (const m of mov) {
        const euro = -Number(m.importo || 0)
        // A 0 €: una rettifica annullata sulla stessa riga (il 12/11 le agevolazioni false), non un addebito.
        if (Math.abs(euro) < 0.005) continue
        if ((importiRighe.get(m.spedizione_id) || []).some(v => Math.abs(v - euro) < 0.011)) continue
        const t = new Date(m.created_at).getTime()
        const blocco = mitt + '|' + CHIAVE.format(t)
        if (!blocchiInteri.has(blocco) && CHIAVE.format(t) < giorno) continue
        altri.push({ id: m.id, master_id: mitt, blocco, invio_giorno: GIORNO.format(t), addebitata_ts: t,
          numero_spedizione: (Array.isArray(m.spedizioni) ? m.spedizioni[0] : m.spedizioni)?.numero || null,
          descrizione: m.descrizione, euro: Math.round(euro * 100) / 100 })
      }
    }
  } catch (e: any) { console.error('[NETWORK] altri addebiti:', e?.message) }

  return {
    rettifiche: raggruppate,
    altriAddebiti: altri,
    contrassegni: cod.data || [],
    resi: resi.data || [],
  }
}
