// Mappa una stringa di stato Spedisci.online (localizzata IT/EN) allo stato interno.
// Usata sia dal webhook real-time sia dal polling del cron.
export function mapStatoSpedisci(statusStr: string): string | null {
  const s = (statusStr || '').toLowerCase()
  if (!s) return null
  if (s.includes('consegnat') || s.includes('deliver')) return 'consegnata'
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
  const res = await fetch(`https://${cred.master_domain}/api/v2/shipping/tracking/${tracking}`, {
    headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
  })
  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = { raw_text: text } }

  const eventi: any[] = data?.events || data?.tracking || data?.trackingEvents || data?.eventi
    || (Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []))
  const stati: string[] = []
  for (const k of ['status', 'stato', 'current_status', 'state']) {
    if (typeof data?.[k] === 'string') stati.push(data[k])
  }
  for (const ev of (eventi || [])) {
    for (const k of ['status', 'description', 'descrizione', 'stato', 'state', 'message', 'event', 'text', 'nota']) {
      if (typeof ev?.[k] === 'string') stati.push(ev[k])
    }
  }
  return { stati, raw: data, ok: res.ok }
}

// Chiusura borderò (Close Day) su spedisci.online per una distinta.
// Best-effort: mai bloccante. Salva bordero_id/bordero_pdf sulla distinta.
// Solo per corrieri di tipo 'spedisci'. shipmentId e _contractCode da raw_response.
export async function chiudiBorderoSpedisci(supabase: any, distintaId: string) {
  try {
    const { data: distinta } = await supabase
      .from('distinte').select('id, corriere_id, bordero_id').eq('id', distintaId).maybeSingle()
    if (!distinta || distinta.bordero_id) return { skip: true }

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
        errore = 'HTTP ' + r.status + ': ' + (d.error || text).toString().slice(0, 150)
        continue
      }
      const bid = d.bordero ?? d.id ?? d.shippingListId ?? d.shipping_list_id ?? null
      if (bid != null) ids.push(String(bid))
      const b64 = d.pdf || d.labelData || d.base64 || null
      if (b64 && !pdf) pdf = 'data:application/pdf;base64,' + b64
    }

    await supabase.from('distinte').update({
      bordero_id: ids.length ? ids.join(',') : (errore ? 'ERRORE: ' + errore : null),
      bordero_pdf: pdf,
    }).eq('id', distintaId)

    return { ok: ids.length > 0, bordero_id: ids.join(','), errore }
  } catch (e: any) {
    try {
      await supabase.from('distinte').update({ bordero_id: 'ERRORE: ' + String(e?.message || e).slice(0, 150) }).eq('id', distintaId)
    } catch {}
    return { errore: String(e?.message || e) }
  }
}
