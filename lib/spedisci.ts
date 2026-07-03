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
