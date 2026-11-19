// ── IL PESO SU CUI SI PAGA, PRIMA E DOPO LA RIPESATURA ──
//
// Un posto solo, perche' lo devono dire uguale la Conferma (nella descrizione del movimento e nel peso fatturato
// della scheda, app/api/rettifiche) e le schermate che mostrano la rettifica prima e dopo (Rettifica Costi, «Dal
// mio network», i report del master e del cliente).
//
// Le schermate mostravano i TOTALI della spedizione, somma dei pesi e somma dei volumi, ma una multicollo si paga
// COLLO PER COLLO: per ognuno il maggiore fra peso e volume, poi si somma (lib/pricing, calcolaPesoFatturato).
// 3UW1WLJ093303 (Poste Business Express V, 2 colli, MD CONSULTING di Ecomize Solution, 17/11/2026): la riga
// diceva volume 27,17 → 27,91 kg, tutto sotto i 30, con 7,92 € di rettifica, e sembrava sbagliata. Si paga
// invece 18,88 + 10 = 28,88 kg prima e 11,25 + 19,35 = 30,60 kg dopo: oltre i 30, fascia dei 50 kg.
// Lorenzo: «altrimenti non si capisce».
//
// Il calcolo e' quello che la Conferma faceva al suo interno, spostato qui senza cambiarlo: divisore di chi
// paga, agevolazione, multicollo partite sui totali prima del 28/09. Sola lettura.

export type PesoPagato = {
  prima: number        // kg su cui si pagava alla partenza
  dopo: number         // kg su cui si paga dopo la ripesatura
  colli: number[]      // i kg di ogni collo ripesato che fanno il «dopo»
  colliPrima: number[] // i kg di ogni collo dichiarato che fanno il «prima» ([] quando il «prima» non e' collo per collo)
  nota: string         // agevolazione che cambia (« — il collo misurato esce dalla scatola…»), o ''
}

// `rettifiche`: righe con id, spedizione_id, cliente_id, colli_ripesati, fattore_volume. Le righe senza colli
// ripesati o senza spedizione non compaiono in `pesiDi`.
export async function pesiPagati(adminDb: any, rettifiche: any[]): Promise<{ pesiDi: Map<string, PesoPagato>; sogliaDi: Map<string, number> }> {
  // Il peso fatturato di un gruppo di colli: per ognuno il maggiore fra peso e volume, poi si somma.
  const fattDi = (colli: any[], fattore: number) => (colli || []).reduce((tot: number, c: any) => {
    const p = Number(c?.weight ?? c?.peso) || 0
    const L = Number(c?.length ?? c?.lunghezza) || 0, W = Number(c?.width ?? c?.larghezza) || 0, H = Number(c?.height ?? c?.altezza) || 0
    const v = (L && W && H && fattore > 0) ? (L * W * H) / fattore : 0
    return tot + Math.max(p, v)
  }, 0)

  // I PESI FATTURATI, riga per riga: quello dichiarato alla partenza e quello dopo la ripesatura,
  // calcolati come li calcola il motore (per collo, col fattore volumetrico di CHI PAGA).
  const pesiDi = new Map<string, PesoPagato>()
  const sogliaDi = new Map<string, number>()   // spedizione -> kg del servizio a peso reale (penale BRT)
  {
    const { fattoreVolumeCorriere, fattoreVolumeCliente } = await import('@/lib/pricing')
    const { pesoSuReale, descriviAgevolazione } = await import('@/lib/agevolazione-misure')
    const idS = [...new Set(rettifiche.map((r: any) => r.spedizione_id).filter(Boolean))]
    const spedInfo = new Map<string, any>()
    // Senza le etichette dentro colli_dettaglio: servono solo peso e lati (vedi colli-senza-etichette).
    const { spedizioniConColliLeggeri } = await import('@/lib/colli-senza-etichette')
    for (const [k, x] of await spedizioniConColliLeggeri(adminDb, idS, 'peso_reale,peso_volume,lunghezza,larghezza,altezza,corriere_id,master_id,created_at,corrieri(settings)')) spedInfo.set(k, x)
    for (const [k, x] of spedInfo) { const kgSoglia = Number(x?.corrieri?.settings?.peso_reale_soglia?.kg) || 0; if (kgSoglia > 0) sogliaDi.set(k, kgSoglia) }
    // SENZA IL DETTAGLIO DEI COLLI le misure della spedizione sono quelle di UN collo solo: ripeterle per
    // tutti i colli inventa un volume che non c'e'. 050026152906222 (2 colli, 59x56x41 e 35x79x40, cioe'
    // 27,09 + 22,12 = 49,21 kg) diceva «da 54,19 kg»: il primo collo contato due volte.
    // IL «DA» E' IL PESO SU CUI SI E' PAGATO ALLA PARTENZA, e su queste multicollo dipende da QUANDO sono
    // partite: fino al 28/09/2026 (dc000a54) il prezzo si faceva sui TOTALI, max(somma dei pesi, somma dei
    // volumi); da li' collo per collo, coi colli che stanno nei `parcels` della risposta del fornitore
    // (colliDaRaw, come nel dettaglio spedizione). Scrivere il collo per collo su una partita prima diceva
    // «da 31,13 kg a 30,6 kg» con 5,45 di addebito (050020152895413, pagata sulla fascia dei 30 kg).
    // Verificato il 30/10/2026 sulle 136 multicollo senza dettaglio con rettifiche in 30 giorni (11/08-02/10;
    // dopo, il dettaglio si salva): delle 87 col peso fatturato ancora quello della partenza, 79 su 80 prima
    // del 28/09 sono sui totali e 7 su 7 dopo sono collo per collo.
    const PREZZO_COLLO_PER_COLLO_DAL = Date.parse('2026-09-28T13:51:34Z')
    const { colliDaRaw } = await import('@/lib/colli-dettaglio')
    const colliDalFornitore = new Map<string, any[]>()
    {
      const senzaDett = [...spedInfo.values()]
        .filter((x: any) => (Number(x.colli) || 1) > 1 && !(Array.isArray(x.colli_dettaglio) && x.colli_dettaglio.length))
        .filter((x: any) => Date.parse(x.created_at) >= PREZZO_COLLO_PER_COLLO_DAL)
        .map((x: any) => x.id)
      for (let i = 0; i < senzaDett.length; i += 150) {
        const { data } = await adminDb.from('spedizioni').select('id,parcels:raw_response->raw->data->parcels').in('id', senzaDett.slice(i, i + 150))
        for (const x of (data || []) as any[]) {
          const colli = colliDaRaw({ parcels: x.parcels })
          if (colli.length) colliDalFornitore.set(x.id, colli)
        }
      }
    }
    const fattori = new Map<string, number>()
    const fattoreDi = async (sp: any) => {
      const k = `${sp.master_id}|${sp.corriere_id}`
      if (fattori.has(k)) return fattori.get(k)!
      let f = 4000
      try { f = Number(await fattoreVolumeCorriere(adminDb, sp.master_id, sp.corriere_id)) || 4000 } catch { /* resta il predefinito */ }
      fattori.set(k, f); return f
    }
    // IL DIVISORE E' QUELLO DI CHI PAGA. Il cliente paga col SUO listino, che puo' avere un fattore
    // diverso dal contratto: 282343J020715 (SDA EXPRESS L) e' stato addebitato a Nova Vision da 132 a
    // 752,4 kg (listino a 5000), ma la riga diceva «da 120 kg a 627 kg», i chili del contratto a 6000.
    // Col suo listino 627 kg fanno 161 €, cioe' 115 di rettifica e non i 138 pagati: i conti non gli
    // tornavano. Lorenzo, 02/11/2026: la descrizione coi chili di ogni livello.
    const listinoDelCliente = new Map<string, string>()
    {
      const idsCli = [...new Set((rettifiche as any[]).map((r: any) => r.cliente_id).filter(Boolean))]
      for (let i = 0; i < idsCli.length; i += 200) {
        const { data } = await adminDb.from('clienti').select('id,listino_cliente_id').in('id', idsCli.slice(i, i + 200))
        for (const c of (data || []) as any[]) if (c.listino_cliente_id) listinoDelCliente.set(c.id, c.listino_cliente_id)
      }
    }
    const fattoriCliente = new Map<string, { f: number; soloReale: boolean }>()
    const fattoreDelCliente = async (listinoId: string, corriereId: string) => {
      const k = `${listinoId}|${corriereId}`
      if (fattoriCliente.has(k)) return fattoriCliente.get(k)!
      let v = { f: 0, soloReale: false }
      try {
        const f = Number(await fattoreVolumeCliente(adminDb, listinoId, corriereId)) || 0
        const { data: l } = await adminDb.from('listini_clienti').select('solo_peso_reale').eq('id', listinoId).maybeSingle()
        v = { f, soloReale: !!(l as any)?.solo_peso_reale }
      } catch { /* resta il fattore del contratto */ }
      fattoriCliente.set(k, v); return v
    }
    for (const r of rettifiche as any[]) {
      const sp = r.spedizione_id ? spedInfo.get(r.spedizione_id) : null
      const dopoColli = Array.isArray(r.colli_ripesati) ? r.colli_ripesati : []
      if (!sp || !dopoColli.length) continue
      const lc = r.cliente_id ? listinoDelCliente.get(r.cliente_id) : undefined
      const delCliente = lc ? await fattoreDelCliente(lc, sp.corriere_id) : null
      // Il divisore scritto sulla riga e' quello con cui il motore ha prezzato CHI PAGA: sulle righe dei
      // master e' l'unico giusto (il contratto del master in fondo puo' avere un altro fattore). Le righe
      // nate prima del 04/11/2026 non ce l'hanno: cliente col suo listino, master col contratto in fondo.
      const f = Number(r.fattore_volume) > 0 ? Number(r.fattore_volume) : (delCliente?.f || await fattoreDi(sp))
      const dett = Array.isArray(sp.colli_dettaglio) && sp.colli_dettaglio.length
        ? sp.colli_dettaglio
        : (colliDalFornitore.get(r.spedizione_id) || [])
      const n = Math.max(1, Number(sp.colli) || 1)
      const primaColli = dett.length ? dett : Array.from({ length: n }, () => ({
        peso: (Number(sp.peso_reale) || 0) / n, lunghezza: sp.lunghezza, larghezza: sp.larghezza, altezza: sp.altezza,
      }))
      // Multicollo senza misure per collo: si parte dai totali salvati alla creazione (peso reale e volume),
      // non dal primo collo moltiplicato. Partita prima del 28/09 col dettaglio: sui totali dei suoi colli,
      // col divisore di chi paga, perche' si e' pagata cosi' (1UW0S0W188578: 16,98 pagati = prezzo sui
      // totali, collo per collo 25,20). Sulle monocollo le misure della spedizione SONO quelle del collo.
      const primaDaiTotali = n <= 1 ? 0
        : !dett.length ? Math.max(Number(sp.peso_reale) || 0, Number(sp.peso_volume) || 0)
        : Date.parse(sp.created_at) < PREZZO_COLLO_PER_COLLO_DAL ? Math.max(
          dett.reduce((t: number, c: any) => t + (Number(c?.weight ?? c?.peso) || 0), 0),
          dett.reduce((t: number, c: any) => {
            const L = Number(c?.length ?? c?.lunghezza) || 0, W = Number(c?.width ?? c?.larghezza) || 0, H = Number(c?.height ?? c?.altezza) || 0
            return t + (L && W && H ? L * W * H : 0)
          }, 0) / f)
        : 0
      // QUANDO VALE L'AGEVOLAZIONE SI PAGA SUL PESO REALE, non sul maggiore fra peso e volume:
      // scrivere il fatturato senza tenerne conto fa sembrare che il peso scenda mentre il prezzo
      // sale (1UW07WF292297: «da 6,89 a 6,30» con 2,50 EUR di addebito). La verita' e' che il collo
      // misurato esce dalla scatola del contratto e da li' in poi si paga a volume.
      const sett = ((sp as any).corrieri || {}).settings || {}
      const perAgev = (colli: any[]) => colli.map((c: any) => ({
        length: Number(c?.length ?? c?.lunghezza) || 0, width: Number(c?.width ?? c?.larghezza) || 0, height: Number(c?.height ?? c?.altezza) || 0,
      }))
      const pesoReale = (colli: any[]) => colli.reduce((t: number, c: any) => t + (Number(c?.weight ?? c?.peso) || 0), 0)
      // Un listino cliente "solo peso reale" fa pagare sempre i chili veri, come nel prezzo.
      const agevPrima = pesoSuReale(sett, perAgev(primaColli), pesoReale(primaColli), !!delCliente?.soloReale)
      const agevDopo = pesoSuReale(sett, perAgev(dopoColli), pesoReale(dopoColli), !!delCliente?.soloReale)
      const nota = (agevPrima && !agevDopo)
        ? ` — il collo misurato esce dalla scatola agevolata ${descriviAgevolazione(sett)}, quindi ora si paga sul volume`
        : (!agevPrima && agevDopo) ? ` — il collo misurato rientra nella scatola agevolata ${descriviAgevolazione(sett)}, quindi ora si paga sul peso reale` : ''
      pesiDi.set(r.id, {
        prima: agevPrima ? pesoReale(primaColli) : (primaDaiTotali > 0 ? primaDaiTotali : fattDi(primaColli, f)),
        dopo: agevDopo ? pesoReale(dopoColli) : fattDi(dopoColli, f),
        nota,
        // I colli del «da», quando il «da» e' collo per collo: non sull'agevolazione (un collo solo, al peso reale)
        // e non sui totali (multicollo partite prima del 28/09 o senza misure per collo).
        colliPrima: agevPrima || primaDaiTotali > 0 ? [] : primaColli.map((c: any) => fattDi([c], f)),
        colli: agevDopo ? dopoColli.map((c: any) => Number(c?.weight) || 0) : dopoColli.map((c: any) => {
          const p = Number(c?.weight) || 0
          const L = Number(c?.length) || 0, W = Number(c?.width) || 0, H = Number(c?.height) || 0
          return Math.max(p, (L && W && H) ? (L * W * H) / f : 0)
        }),
      })
    }
  }
  return { pesiDi, sogliaDi }
}
