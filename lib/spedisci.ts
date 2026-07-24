// Mappa una stringa di stato Spedisci.online (localizzata IT/EN) allo stato interno.
// Usata sia dal webhook real-time sia dal polling del cron.
// Sceglie la tariffa del CONTRATTO del corriere tra quelle del pannello. Il confronto per
// codice_contratto esatto NON basta piu': su alcuni pannelli Spedisci (es. spedizioniamas) il
// contractCode e' CIFRATO e CAMBIA A OGNI RISPOSTA (payload Laravel con IV casuale), quindi
// l'uguaglianza col codice salvato non combacia mai ("Contratto non disponibile"). Strategia:
//  1) match esatto sul codice salvato (pannelli con codici stabili in chiaro);
//  2) match sul vettore salvato (credenziali.carrier_code);
//  3) pannello con UNA SOLA tariffa -> e' per forza quella;
//  4) nessun codice salvato -> prima tariffa (comportamento storico);
//  5) altrimenti null: ambiguo, meglio errore chiaro che etichetta col vettore sbagliato.
export function trovaRateContratto(rates: any[], cred: any): any | null {
  if (!Array.isArray(rates) || !rates.length) return null
  if (cred?.codice_contratto) {
    const esatto = rates.find((r: any) => r.contractCode === cred.codice_contratto)
    if (esatto) return esatto
  }
  if (cred?.carrier_code) {
    const perVettore = rates.find((r: any) => r.carrierCode === cred.carrier_code)
    if (perVettore) return perVettore
  }
  if (rates.length === 1) return rates[0]
  if (!cred?.codice_contratto) return rates[0]
  return null
}

export function mapStatoSpedisci(statusStr: string): string | null {
  const s = (statusStr || '').toLowerCase()
  if (!s) return null
  if (s.includes('consegnat') || s.includes('delivered')) return 'consegnata'  // NB: 'delivered' (non 'deliver') per non catturare "out for delivery"
  if (s.includes('giacenz') || s.includes('stock') || s.includes('deposit') || s.includes('giacenza')) return 'in_giacenza'
  if (s.includes('reso') || s.includes('return to sender') || s.includes('al mittente') || s.includes('rientro')) return 'reso_mittente'
  if (s.includes('in consegna') || s.includes('out for delivery') || s.includes('distribuzione') || s.includes('in distribuzione')) return 'in_consegna'
  if (s.includes('transit') || s.includes('transito') || s.includes('arrivat') || s.includes('hub') || s.includes('partenz') || s.includes('viaggio') || s.includes('smistament')) return 'in_transito'
  if (s.includes('presa in carico') || s.includes('spedit') || s.includes('accettat') || s.includes('ritirat') || s.includes('partita') || s.includes('picked') || s.includes('lavorazione')) return 'spedita'
  if (s.includes('mancata') || s.includes('fallit') || s.includes('exception') || s.includes('rifiut') || s.includes('problema') || s.includes('indirizzo errato') || s.includes('anomal')) return 'non_consegnato'
  return null
}

// Ranking per scegliere lo stato "più avanzato" tra più eventi (ordine non garantito).
const _RANK: Record<string, number> = {
  spedita: 1, in_transito: 2, in_consegna: 3, in_giacenza: 4,
  non_consegnato: 5, reso_mittente: 6, consegnata: 7,
}
export function prioritaStato(stato: string | null): number {
  return stato ? (_RANK[stato] || 0) : 0
}

// Interroga il tracking Spedisci e restituisce tutte le stringhe di stato candidate
// (stato top-level + descrizioni/stati dei singoli eventi) + il raw della risposta.
export async function spedisciTrackingStati(
  cred: { master_domain?: string; password?: string },
  tracking: string
): Promise<{ stati: string[]; raw: any; ok: boolean }> {
  // Endpoint CORRETTO: /api/v2/tracking/{tracking} (NON /shipping/tracking, che dà 404).
  // Struttura risposta: { return: { shipment: [ { shipment: {...stato...}, tracking: [ {data, StatusDescription, phase, officeDescription}, ... ] } ] } }
  const res = await fetch(`https://${cred.master_domain}/api/v2/tracking/${tracking}`, {
    headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
  })
  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = { raw_text: text } }

  const ship: any = data?.return?.shipment
  const first: any = Array.isArray(ship) ? ship[0] : ship
  const eventi: any[] = Array.isArray(first?.tracking) ? first.tracking : []
  const stati: string[] = []
  // Stato "testa" della spedizione
  for (const k of ['statusDescription', 'customerStatusDescription', 'descrizioneStato', 'descrizioneStatoCliente']) {
    if (typeof first?.shipment?.[k] === 'string') stati.push(first.shipment[k])
  }
  // Descrizioni/fasi dei singoli eventi
  for (const ev of eventi) {
    for (const k of ['StatusDescription', 'appStatusDescription', 'ivrStatusDescription', 'phase', 'descrizioneStato']) {
      if (typeof ev?.[k] === 'string') stati.push(ev[k])
    }
  }
  // Fallback compat (vecchia struttura, mai usata ma innocua)
  for (const k of ['status', 'stato', 'current_status', 'state']) if (typeof data?.[k] === 'string') stati.push(data[k])
  return { stati, raw: data, ok: res.ok }
}

// Chiusura borderò (Close Day) su spedisci.online per una distinta.
// Best-effort: mai bloccante. Salva bordero_id/bordero_pdf sulla distinta.
// Solo per corrieri di tipo 'spedisci'. shipmentId e _contractCode da raw_response.
export async function chiudiBorderoSpedisci(supabase: any, distintaId: string) {
  try {
    const { data: distinta } = await supabase
      .from('distinte').select('id, corriere_id, bordero_id').eq('id', distintaId).maybeSingle()
    // Gia' chiusa: skip. Se il tentativo precedente era finito in ERRORE si RITENTA.
    if (!distinta || (distinta.bordero_id && !String(distinta.bordero_id).startsWith('ERRORE'))) return { skip: true }

    const { data: corriere } = await supabase
      .from('corrieri').select('id, tipo, credenziali').eq('id', distinta.corriere_id).maybeSingle()
    if (!corriere || corriere.tipo !== 'spedisci') return { skip: true }
    const cred = (corriere.credenziali || {}) as any
    if (!cred.master_domain || !cred.password) return { errore: 'credenziali spedisci mancanti' }

    const { data: speds } = await supabase
      .from('spedizioni').select('id, numero, raw_response').eq('distinta_id', distintaId)

    // Raggruppa per contract_code (di norma uno solo per distinta)
    const gruppi = new Map<string, number[]>()
    for (const s of speds || []) {
      const raw = (s.raw_response || {}) as any
      const sid = raw.shipmentId
      const cc = raw._contractCode
      if (!sid || !cc) continue
      if (!gruppi.has(cc)) gruppi.set(cc, [])
      gruppi.get(cc)!.push(Number(sid))
    }
    if (!gruppi.size) return { errore: 'nessuna spedizione con shipmentId/contractCode' }

    const ids: string[] = []
    let pdf: string | null = null
    let errore: string | null = null
    let giaChiusa = false
    for (const [contractCode, shipmentIds] of gruppi) {
      const r = await fetch(`https://${cred.master_domain}/api/v2/shippinglist/create`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipment_ids: shipmentIds, contract_code: contractCode }),
      })
      const text = await r.text()
      let d: any = {}
      try { d = JSON.parse(text) } catch { d = {} }
      if (!r.ok || d.error) {
        const msg = (d.error || text).toString()
        // "Nessuna spedizione trovata": Spedisci ha GIA' chiuso il bordero' dal lato suo (chiusura
        // automatica serale loro) -> non c'e' piu' nulla da trasmettere, non e' un guasto.
        // Succedeva a TUTTE le distinte del cron delle 23: le manuali diurne chiudono regolarmente.
        if (/nessuna spedizione trovata/i.test(msg)) { giaChiusa = true; continue }
        errore = 'HTTP ' + r.status + ': ' + msg.slice(0, 200)
        continue
      }
      const bid = d.bordero ?? d.id ?? d.shippingListId ?? d.shipping_list_id ?? null
      if (bid != null) ids.push(String(bid))
      const b64 = d.pdf || d.labelData || d.base64 || null
      if (b64 && !pdf) pdf = 'data:application/pdf;base64,' + b64
    }

    // confermata_vettore = TRASMESSA davvero al provider (o gia' chiusa dal lato loro).
    const chiusaOk = ids.length > 0 || (giaChiusa && !errore)
    await supabase.from('distinte').update({
      bordero_id: ids.length ? ids.join(',') : (giaChiusa && !errore ? 'N/A' : (errore ? 'ERRORE: ' + errore : null)),
      bordero_pdf: pdf,
      ...(chiusaOk ? { confermata_vettore: true, data_conferma: new Date().toISOString() } : {}),
    }).eq('id', distintaId)

    return { ok: chiusaOk, bordero_id: ids.join(','), errore }
  } catch (e: any) {
    try {
      await supabase.from('distinte').update({ bordero_id: 'ERRORE: ' + String(e?.message || e).slice(0, 150) }).eq('id', distintaId)
    } catch {}
    return { errore: String(e?.message || e) }
  }
}
