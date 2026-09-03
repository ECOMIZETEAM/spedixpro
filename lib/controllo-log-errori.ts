import { createAdminSupabase } from '@/lib/supabase-admin'
import { ControlloRisultato } from '@/lib/controllo-tipi'

// CONTROLLO "Log & Errori". Un posto solo dove vedere DOVE il sistema ha dato problemi: raccoglie gli
// stati d'errore sparsi in tante tabelle (annulli, fulfillment, integrazioni, import, webhook, addebiti
// giacenze/resi) + le LDV rimaste su un numero provvisorio da troppo tempo. Sola lettura.
const NON_VUOTO = (v: any) => v != null && String(v).trim() !== '' && String(v).trim().toLowerCase() !== 'null'

export async function trovaLogErrori(giorni = 14): Promise<ControlloRisultato> {
  const admin = createAdminSupabase()
  const dal = new Date(Date.now() - giorni * 864e5).toISOString()
  const righe: any[] = []
  const push = (fonte: string, riferimento: string, errore: string, quando: string) =>
    righe.push({ fonte, riferimento: riferimento || '—', errore: String(errore || '').slice(0, 240), quando: (quando || '').slice(0, 19).replace('T', ' ') })

  // helper: legge una tabella e filtra le righe con la colonna errore valorizzata
  const scan = async (tab: string, colErr: string, colRif: string, fonte: string, colData = 'created_at', extra?: (r: any) => boolean) => {
    try {
      const { data } = await admin.from(tab).select(`${colRif},${colErr},${colData}`).not(colErr, 'is', null).gte(colData, dal).order(colData, { ascending: false }).limit(400)
      for (const r of data || []) { if (!NON_VUOTO((r as any)[colErr])) continue; if (extra && !extra(r)) continue; push(fonte, String((r as any)[colRif] ?? ''), (r as any)[colErr], String((r as any)[colData] ?? '')) }
    } catch { /* tabella/colonna assente: ignoro */ }
  }

  await scan('spedizioni', 'annullamento_errore', 'numero', 'annullo spedizione')
  await scan('ordini_ecommerce', 'fulfillment_errore', 'numero_ordine', 'fulfillment negozio')
  await scan('integrazioni', 'errore', 'piattaforma', 'integrazione negozio', 'updated_at')
  await scan('ordini_importati', 'errore', 'order_id', 'import CSV')
  await scan('webhooks', 'ultimo_errore', 'url', 'webhook cliente', 'ultimo_invio_at')
  await scan('giacenze_da_addebitare', 'ultimo_errore', 'spedizione_id', 'addebito giacenza')
  await scan('resi_da_addebitare', 'ultimo_errore', 'spedizione_id', 'addebito reso')

  // LDV rimaste su numero PROVVISORIO da oltre 6 ore (LDV vera mai arrivata): il cliente vede un numero finto
  try {
    const seiOre = new Date(Date.now() - 6 * 3600e3).toISOString()
    const { data } = await admin.from('spedizioni').select('numero,stato,created_at')
      .or('numero.like.TMP-%,numero.like.SP-%,numero.like.DVA-%,numero.like.%code%')
      .lt('created_at', seiOre).gte('created_at', dal).not('stato', 'in', '(annullata,annullamento_pending,annullamento_manuale,consegnata)')
      .order('created_at', { ascending: false }).limit(400)
    for (const r of data || []) push('LDV provvisoria bloccata', String(r.numero || ''), `numero provvisorio da oltre 6h (stato ${r.stato})`, String(r.created_at || ''))
  } catch { /* ignoro */ }

  const perFonte: Record<string, number> = {}
  for (const r of righe) perFonte[r.fonte] = (perFonte[r.fonte] || 0) + 1
  righe.sort((a, b) => (b.quando || '').localeCompare(a.quando || ''))

  return {
    kpi: [
      { label: 'Errori nel periodo', valore: righe.length.toLocaleString('it-IT'), colore: righe.length ? '#b91c1c' : '#15803d' },
      ...Object.entries(perFonte).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ label: k, valore: String(v), colore: '#c2410c' })),
    ],
    colonne: [
      { key: 'fonte', label: 'Fonte', tipo: 'badge' },
      { key: 'riferimento', label: 'Riferimento', tipo: 'mono' },
      { key: 'errore', label: 'Errore' },
      { key: 'quando', label: 'Quando', align: 'right' },
    ],
    righe, categoriaKey: 'fonte', cercaKeys: ['riferimento', 'errore'], csvNome: 'log-errori', finestra: true, finestra: true,
    nota: 'Stati d\'errore raccolti da tutto il sistema (ultimi giorni). Se una fonte e\' a 0, quel pezzo gira pulito.',
  }
}
