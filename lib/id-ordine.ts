// ID Ordine REALE per un insieme di spedizioni: dall'ordine COLLEGATO via spedizione_id.
// CSV -> ordini_importati.order_id ; integrazioni -> ordini_ecommerce.numero_ordine/ordine_esterno_id.
// (Le colonne spedizioni.id_ordine_esterno/rif_ordine non sono popolate.)
export async function mappaIdOrdine(admin: any, spedIds: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  if (!spedIds?.length) return m
  for (let i = 0; i < spedIds.length; i += 300) {
    const chunk = spedIds.slice(i, i + 300)
    for (let from = 0; ; from += 1000) {
      const { data: imp } = await admin.from('ordini_importati').select('spedizione_id,order_id').in('spedizione_id', chunk).not('order_id', 'is', null).range(from, from + 999)
      for (const o of (imp || [])) { const sid = (o as any).spedizione_id, v = (o as any).order_id; if (sid && v && !m.has(sid)) m.set(sid, String(v)) }
      if (!imp?.length || imp.length < 1000) break
    }
    const { data: ecom } = await admin.from('ordini_ecommerce').select('spedizione_id,numero_ordine,ordine_esterno_id').in('spedizione_id', chunk)
    for (const o of (ecom || [])) { const sid = (o as any).spedizione_id, v = (o as any).numero_ordine || (o as any).ordine_esterno_id; if (sid && v && !m.has(sid)) m.set(sid, String(v)) }
  }
  return m
}
