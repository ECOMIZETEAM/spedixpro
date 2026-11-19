// IL GUADAGNO OPERATIVO di un master in un periodo, una cifra sola: quello del Report Guadagno Totale
// (app/api/reports/guadagno-totale). Sta qui perche' lo usa anche la Salute del conto (lib/salute-conto):
// due conti diversi dello stesso guadagno finirebbero per non tornare fra loro.
//
// = Spedizioni (margine, per DATA CREAZIONE: stessa base della card Guadagno Spedizioni e del Report
//   Spedizioni — guadagno_spedizioni_serie_v1)
// + Rettifiche + Rimborsi + Resi + Giacenze + Commissioni + Accessori + Logistica (margine a catena,
//   PER TIPO, in UNA sola chiamata guadagno_master_serie_v1 — chain-aware e dedup dei self dei sub)
// Il CANONE abbonamento NON entra qui (regola Lorenzo 6/10): il Guadagno Totale e' SOLO operativo.
// L'abbonamento e' overhead/ricavo di piattaforma e si vede nelle sue pagine dedicate, non e' guadagno
// operativo. Tolto anche dal calderone (calderone_dettaglio_v2), cosi' Guadagno Totale == Profitto.
//
// NON si sommano le "card" a schermo una per una: la card "Supplementi" somma per DESCRIZIONE
// (giacenz/riconsegn/supplement) e ridonda su giacenze+rettifiche (doppio conteggio) — qui si conta PER
// TIPO, una volta sola. ESCLUSI i pass-through (non sono profitto): 'ricarica' (deposito credito) e
// 'contrassegno' (cassa COD incassata per conto del cliente, senza spedizione_id).
//
// Prova di non-sovrapposizione (MULTIEXPRESS set. 2026): la chiamata unica sugli 8 tipi = somma delle 8
// voci per-tipo, al centesimo; totale operativo 60.263,76 (spedizioni 39.215,38 + altri 21.048,38),
// canone 0. Verificato sui dati veri prima del rilascio.
const TIPI_OPERATIVI = ['rettifica', 'rimborso', 'reso', 'giacenza', 'commissione', 'accessorio', 'logistica']
const r2 = (x: number) => Math.round(x * 100) / 100

export type GuadagnoOperativo = { ricavi: number, costi: number, guadagno: number }

/** `dal` e `alEnd` sono istanti ISO (il Report usa i giorni in UTC: 'T00:00:00.000Z' e 'T23:59:59.999Z'). */
export async function guadagnoOperativo(admin: any, M: string, dal: string, alEnd: string): Promise<GuadagnoOperativo> {
  const perMese = (Date.parse(alEnd) - Date.parse(dal)) / 86400000 > 92
  const [sped, altri, consInc, consPag, ingrossoAdj] = await Promise.all([
    // SPEDIZIONI col metodo esatto del Report Spedizioni (data creazione)
    admin.rpc('guadagno_spedizioni_serie_v1', { p_master: M, p_dal: dal, p_al: alEnd, p_per_mese: perMese }),
    // Le altre 7 voci operative, PER TIPO, in un colpo (chain-aware, niente doppi conteggi)
    admin.rpc('guadagno_master_serie_v1', { p_master: M, p_dal: dal, p_al: alEnd, p_per_mese: perMese, p_tipi: TIPI_OPERATIVI }),
    // CONSUMABILI (tipo 'consumabile', senza spedizione_id): ricavo = quello che il master addebita
    admin.from('movimenti').select('importo').eq('tipo', 'consumabile').eq('master_id', M).gte('created_at', dal).lte('created_at', alEnd),
    // CONSUMABILI costo = quello che il parent addebita al master
    admin.from('movimenti').select('importo').eq('tipo', 'consumabile').eq('master_target_id', M).neq('master_id', M).gte('created_at', dal).lte('created_at', alEnd),
    // CORREZIONE NODI-CODICE (grafo corrieri_condivisi). Una spedizione d'ingrosso vive su PIU' righe-gamba
    // legate dal tracking_number (originatrice + gamba-ledger per ogni passaggio). Il costo d'acquisto e il
    // ricavo-ponte stanno su gambe-ledger dove master_target=NULL, e la RPC spedizioni attribuisce il costo
    // SOLO via master_target_id=p_master: la sua guardia "cm null OR pc null => azzera entrambi" quindi
    // CANCELLA del tutto quelle righe (NON le gonfia). Risultato: il ricavo-vendita del PONTE (Wave verso
    // MULTI) e il margine SDA dell'ACQUIRENTE (MULTI: addebito ai suoi sub meno il costo verso Wave)
    // sparivano. Qui si recuperano. Verificato sui dati veri 6/10: Wave-vende-a-MULTI = MULTI-paga-Wave al
    // centesimo (stesso snapshot). Vuota (0/0) per i master NON-codice. Resiliente: se la funzione non è
    // ancora in DB, l'errore si ignora e l'adj resta 0 (il deploy non dipende dall'ordine con la migrazione).
    admin.rpc('guadagno_ingrosso_adj_v1', { p_master: M, p_dal: dal, p_al: alEnd }),
  ])
  if (sped.error) throw new Error(sped.error.message)
  if (altri.error) throw new Error(altri.error.message)

  let ricavi = 0, costi = 0
  for (const row of (sped.data || [])) { ricavi += Number((row as any).ricavi || 0); costi += Number((row as any).costi || 0) }
  for (const row of (altri.data || [])) { ricavi += Number((row as any).ricavi || 0); costi += Number((row as any).costi || 0) }
  // Consumabili: importi negativi (addebiti) → il ricavo è -importo
  ricavi += (consInc.data || []).reduce((s: number, x: any) => s + (-(Number(x.importo || 0))), 0)
  costi += (consPag.data || []).reduce((s: number, x: any) => s + (-(Number(x.importo || 0))), 0)
  // Correzione nodi-codice (ricavo-ponte mancante + costo-ingrosso invisibile). Se la funzione non c'è
  // ancora in DB (ingrossoAdj.error) l'adj resta 0: nessun effetto finché non si applica la migrazione.
  if (!ingrossoAdj.error && ingrossoAdj.data) {
    const a: any = Array.isArray(ingrossoAdj.data) ? ingrossoAdj.data[0] : ingrossoAdj.data
    ricavi += Number(a?.ricavi_adj || 0)
    costi += Number(a?.costi_adj || 0)
  }
  ricavi = r2(ricavi)
  costi = r2(costi)
  return { ricavi, costi, guadagno: r2(ricavi - costi) }
}
