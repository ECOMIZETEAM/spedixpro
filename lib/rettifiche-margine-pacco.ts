// ── SUL PACCO INTERO, CHI CARICA CI PERDE? ──
// Una rettifica «da controllare» e' una riga dove sotto si recupera meno di quanto il fornitore ha addebitato. Ma ognuno
// paga il salto della SUA fascia: se lo scalino del listino di sotto e' piu' basso di quello del fornitore, chi carica
// recupera meno anche quando sul pacco ci guadagna ancora, perche' sulla spedizione aveva margine. Caso vero
// NN669208839 (QUICK, GLS, 17/11/2026): QUICK paga 26,71 + 1,65 = 28,36, MULTI paga 23,74 + 2,90 = 26,64: la
// pagina diceva «mancano 1,25 €», ma MULTI ci guadagnava ancora 1,72. Lorenzo: «multi non ci perde su quelle..
// diminuisce il suo valore ok ma non va sotto» → quelle sono buone. Da controllare restano solo le righe dove, a
// conti fatti sul pacco, chi carica va sotto.
//
// Il conto si fa coi MOVIMENTI, tutte le voci del pacco da tutte e due le parti (spedizione, rettifiche, giacenze,
// resi, rimborsi), mai il solo nolo da una parte e tutto dall'altra: il primo conto fatto a mano il 17/11 metteva le
// giacenze di MULTI contro la sola spedizione del sotto e mostrava perdite che non c'erano (050164152967567 sembrava
// −60 €, era in attivo). Restano fuori i movimenti 'contrassegno': sono i soldi del contrassegno in viaggio, non margine.
// Il costo di chi carica e' quello che il portale gli ha scritto, tranne la partenza dei pacchi SpediamoPro per il
// detentore del contratto, che e' il prezzo vero del fornitore (vedi prezzoVero piu' sotto). Dove il portale resta piu'
// alto del vero (il cambio destinatario che il fornitore non fa pagare) il conto e' prudente, la riga resta da controllare.
const TIPI_DEL_PACCO = ['spedizione', 'rettifica', 'giacenza', 'reso', 'rimborso']
const a2 = (n: number) => Math.round(n * 100) / 100

// righe: rettifiche di chi carica (master_id = caricatore) verso un sotto-master o un cliente.
// Torna, per id di riga, quanto resta a chi carica sul pacco dopo questa rettifica (negativo = ci perde).
export async function marginePacco(admin: any, caricatore: string, righe: any[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const valide = righe.filter((r: any) => r.spedizione_id && (r.target_master_id || r.cliente_id) && r.target_master_id !== caricatore)
  const sped = [...new Set(valide.map((r: any) => r.spedizione_id))] as string[]
  const mov = new Map<string, any[]>()
  for (let i = 0; i < sped.length; i += 100) {
    const { data, error } = await admin.from('movimenti')
      .select('spedizione_id,tipo,importo,riferimento,master_id,master_target_id,cliente_id')
      .in('spedizione_id', sped.slice(i, i + 100)).in('tipo', TIPI_DEL_PACCO)
    if (error) throw new Error('movimenti del pacco: ' + error.message)
    for (const m of (data || [])) { const a = mov.get(m.spedizione_id) || []; a.push(m); mov.set(m.spedizione_id, a) }
  }
  // IL COSTO VERO DEL DETENTORE SUI PACCHI SPEDIAMOPRO. Il movimento di spedizione di chi carica e' il suo listino di
  // costo, non quello che il fornitore ha preso: dove il listino sbagliava (BRT Express sopra 100 kg con 27 € ogni 50 kg,
  // sponda sul volume, corretti il 18/11/2026) la pagina mostrava perdite che non c'erano — 42 righe rosse su 250 con
  // MULTI in attivo sul pacco vero. Il prezzo che SpediamoPro ha addebitato alla partenza e' nella sua risposta
  // (raw_response.totalPrice, in centesimi: 050038152961262 → 3560 = 35,60 €, uguale al suo conto). Vale solo per chi
  // detiene il contratto: chi sta sotto paga quello che gli scrive il padre, e quello resta il suo costo.
  const prezzoVero = new Map<string, number>()
  for (let i = 0; i < sped.length; i += 150) {
    const { data: ss, error: es } = await admin.from('spedizioni')
      .select('id,code:raw_response->>code,prezzo:raw_response->>totalPrice,corrieri(id,master_id,contratto_id)').in('id', sped.slice(i, i + 150))
    if (es) throw new Error('prezzo del fornitore: ' + es.message)
    const contratti = new Set<string>()
    for (const s of (ss || []) as any[]) { const c = Array.isArray(s.corrieri) ? s.corrieri[0] : s.corrieri; if (c?.contratto_id) contratti.add(c.contratto_id) }
    const detentoreDi = new Map<string, string>()
    if (contratti.size) {
      const { data: cc } = await admin.from('corrieri').select('id,master_id').in('id', [...contratti])
      for (const c of (cc || []) as any[]) detentoreDi.set(c.id, c.master_id)
    }
    for (const s of (ss || []) as any[]) {
      const c = Array.isArray(s.corrieri) ? s.corrieri[0] : s.corrieri
      const detentore = c?.contratto_id ? detentoreDi.get(c.contratto_id) : c?.master_id
      const cent = Number(s.prezzo)
      if (/^6A/i.test(String(s.code || '')) && cent > 0 && detentore === caricatore) prezzoVero.set(s.id, cent / 100)
    }
  }
  for (const r of valide) {
    const m = mov.get(r.spedizione_id) || []
    // Quanto ha pagato chi sta sotto a chi carica: il cliente coi movimenti di chi carica, il sotto-master coi suoi
    // movimenti d'albero (i suoi costi, scritti su di se') e con le rettifiche che chi carica gli ha gia' addebitato.
    const sotto = m.filter((x: any) => r.cliente_id
      ? x.cliente_id === r.cliente_id && x.master_id === caricatore
      : !x.cliente_id && x.master_target_id === r.target_master_id && (x.master_id === r.target_master_id || x.master_id === caricatore))
    const mio = m.filter((x: any) => !x.cliente_id && x.master_id === caricatore && x.master_target_id === caricatore)
    const pagatoSotto = -sotto.reduce((s: number, x: any) => s + Number(x.importo || 0), 0)
    // la partenza col prezzo vero del fornitore, se c'e' (vedi prezzoVero); il resto (rettifiche, resi, giacenze,
    // rimborsi) dai movimenti come prima
    const vero = prezzoVero.get(r.spedizione_id)
    const pagatoMio = vero != null
      ? vero - mio.filter((x: any) => x.tipo !== 'spedizione').reduce((s: number, x: any) => s + Number(x.importo || 0), 0)
      : -mio.reduce((s: number, x: any) => s + Number(x.importo || 0), 0)
    // Il costo del fornitore di questa riga si registra alla Conferma (RIPFORN-<rif>): se c'e' gia', e' dentro pagatoMio.
    const costoGia = !!r.rif_fornitore && mio.some((x: any) => x.riferimento === 'RIPFORN-' + r.rif_fornitore)
    const costoRiga = costoGia ? 0 : Number(r.costo_fornitore || 0)
    const recupero = -Number(r.differenza || 0) + Number(r.fuori_sagoma || 0)
    out.set(r.id, a2(pagatoSotto + recupero - pagatoMio - costoRiga))
  }
  return out
}
