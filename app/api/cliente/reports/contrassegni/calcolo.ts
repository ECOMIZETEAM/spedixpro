import { fetchAllStretto } from '@/lib/fetch-all'

// Stati del contrassegno come li vede il cliente. Per il cliente vale lo stato GLOBALE
// `stato_contrassegno` della spedizione (quello della lista Contrassegni del portale).
// LO STATO VERO, NON "In attesa" PER TUTTI: con la stringa fissa nel PDF del cliente risultavano da
// incassare anche i contrassegni gia' rimborsati (2.885 per 202.639 € al 18/09/2026), quelli in
// distinta (174) e quelli annullati perche' il pacco e' tornato indietro (791 per 57.497,91 €).
export const STATI_CONTRASSEGNO: Record<string, string> = {
  in_attesa: 'In attesa',
  in_distinta: 'In lavorazione',
  pagato: 'Pagato',
  reso: 'Annullato (reso)',
  annullata: 'Annullata',
}

// Spedizioni annullate o in annullamento: se il contrassegno risulta annullato, e' perche' il pacco
// non e' partito, non perche' e' tornato indietro.
const ANNULLI = ['annullata', 'annullamento_pending', 'annullamento_manuale', 'storno_richiesto']

// Chiave dello stato del contrassegno di una spedizione. "Annullato (reso)" solo per i resi veri:
// prima lo erano anche le 344 spedizioni annullate mai partite (48.229,12 € di contrassegni al
// 15/10/2026), e il cliente le leggeva come pacchi tornati indietro.
export function chiaveContrassegno(s: { stato?: string | null; stato_contrassegno?: string | null }): string {
  const sc = s.stato_contrassegno || 'in_attesa'
  if (sc === 'annullato') return ANNULLI.includes(String(s.stato || '')) ? 'annullata' : 'reso'
  return STATI_CONTRASSEGNO[sc] ? sc : 'in_attesa'
}

export async function righeContrassegniCliente(
  db: any, clienteId: string,
  f: { dal: string | null; al: string | null; statoSpedizione?: string | null; statoContrassegno?: string | null },
) {
  // Completo, a pagine: prima si fermava a 1.000 righe (Edit Shop, 1/07-15/10: persi i 318
  // contrassegni piu' recenti, 23.686,47 €, tutti quelli dopo il 22/09).
  const speds = await fetchAllStretto<any>(() => {
    let q = db.from('spedizioni')
      .select('id,numero,dest_nome,contrassegno,stato,stato_contrassegno,created_at')
      .eq('cliente_id', clienteId).gt('contrassegno', 0)
    if (f.dal) q = q.gte('created_at', f.dal)
    if (f.al) q = q.lte('created_at', f.al)
    if (f.statoSpedizione && f.statoSpedizione !== 'tutti') q = q.eq('stato', f.statoSpedizione)
    return q.order('created_at', { ascending: true }).order('id', { ascending: true })
  })
  const filtro = f.statoContrassegno && f.statoContrassegno !== 'tutti' ? f.statoContrassegno : null
  const righe: any[] = []
  for (const s of speds) {
    const chiave = chiaveContrassegno(s)
    if (filtro && chiave !== filtro) continue
    righe.push({
      data: s.created_at,
      spedizione: (s.numero || '') + ' - ' + (s.dest_nome || ''),
      contrassegno: Number(s.contrassegno || 0),
      statoContr: STATI_CONTRASSEGNO[chiave],
      statoSpedizione: s.stato || '',
    })
  }
  return righe
}
