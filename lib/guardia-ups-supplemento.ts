import { costruisciCatena } from '@/lib/cascata'

// UPS: IL SUPPLEMENTO DELLE LOCALITA' REMOTE CHE LE NOSTRE ZONE NON CONOSCONO NON LO PAGA IL DETENTORE.
//
// Su UPS il fornitore non dice "questa destinazione e' remota": il supplemento (partenza o arrivo remoti,
// circa +1,74 € sull'estero, +1,79 € in Italia, oltre +9 € sulle remote alte) sta DENTRO il prezzo base del
// preventivo, con gli accessori a zero. La guardia delle destinazioni speciali (lib/guardia-destinazione-speciale)
// quindi non lo vede. Le liste di CAP remoti non saranno mai complete: dal 10 al 26/11/2026 ne sono comparsi 17
// esteri nuovi, piu' le partenze, e ogni volta il detentore (MULTIEXPRESS) pagava il fornitore piu' di quanto
// incassava da chi sta sotto. Esempi: 1ZGE70566819924599 Langogne, GTS pagava 10,50 e il fornitore 17,81;
// 1ZGE70566824239874 Zagabria, 12,00 contro 24,20.
//
// La regola si ferma SOLO quando servono tutte e due:
//  1) il preventivo del fornitore supera di almeno 1,40 € il listino del detentore per lo stesso pacco
//     (il listino base di MULTI coincide col fornitore entro pochi centesimi: oltre la soglia c'e' un supplemento
//     che le zone non prevedono);
//  2) il fornitore costa piu' di quanto il detentore incassa da chi sta sotto, cioe' il detentore andrebbe sotto.
// La seconda condizione e' quella che conta: sulle 388 spedizioni UPS vere dal 10 al 26/11 la sola prima ne avrebbe
// fermate 23, fra cui 17 partenze remote dove MULTI incassava comunque piu' del costo (Velox paga 19,80 su un
// costo di 14,80). Con tutte e due se ne fermano 6, tutte in perdita vera, nessuna buona.
// Il detentore che spedisce per se' non si ferma: paga lui il costo vero e sotto non c'e' nessuno.
// Ogni volta che la soglia e' superata (ferma o no) resta una riga nei log [GUARDIA][UPS-SUPPLEMENTO] con paese,
// CAP di arrivo e di partenza: sono i CAP da aggiungere alle zone remote.

export const SOGLIA_SUPPLEMENTO_UPS = 1.4

export function contrattoUps(nomeContratto: unknown): boolean {
  return /^\s*UPS\b/i.test(String(nomeContratto || ''))
}

export function messaggioSupplementoUps(dove: string): string {
  return `Località remota per questo corriere (${dove}): il corriere applica un supplemento che il listino non prevede e la spedizione verrebbe venduta sotto costo. Scegli un altro corriere.`
}

// `prezzoClienteTotale`: quanto paga il cliente quando chi spedisce e' un cliente DIRETTO del detentore (comprende
// contrassegno e assicurazione, e allora si confronta col totale del fornitore). Assente = nessun cliente.
export async function upsSupplementoScoperto(admin: any, p: {
  quotation: any
  masterDirettoId: string
  corriereOwnerId: string
  corriereNome: string
  provincia: string; cap: string; citta: string; paese: string
  packages: any[]
  mittCap?: string; mittProvincia?: string
  prezzoClienteTotale?: number
}): Promise<{ ferma: boolean; fornitore?: number; listino?: number; ricavo?: number | null }> {
  if (!contrattoUps(p.corriereNome)) return { ferma: false }
  const totale = Number(p.quotation?.totalPrice) / 100
  const accessori = Number(p.quotation?.priceBreakdown?.accessoryServicePrice || 0) / 100
  const fornitore = Math.round((totale - accessori) * 100) / 100
  if (!(fornitore > 0)) return { ferma: false }
  let catena: any[] = []
  try {
    const r = await costruisciCatena(admin, {
      masterDirettoId: p.masterDirettoId, corriereOwnerId: p.corriereOwnerId, costoSpedizione: 0,
      provincia: p.provincia || '', packages: p.packages, cap: p.cap, citta: p.citta, paese: p.paese || 'IT',
      corriereNome: p.corriereNome, mittCap: p.mittCap, mittProvincia: p.mittProvincia, mittPaese: 'IT',
    } as any)
    if (r.errore) return { ferma: false, fornitore }
    catena = r.catena || []
  } catch { return { ferma: false, fornitore } }   // non riesco a calcolare → non fermo (prudente)
  const i = catena.findIndex((l: any) => l.isProprietario)
  if (i < 0) return { ferma: false, fornitore }
  const listino = Number(catena[i].prezzo)
  const diff = Math.round((fornitore - listino) * 100) / 100
  if (!(diff >= SOGLIA_SUPPLEMENTO_UPS)) return { ferma: false, fornitore, listino }
  let ferma: boolean
  let ricavo: number | null = null
  if (i > 0) {
    ricavo = Number(catena[i - 1].prezzo)
    ferma = fornitore > ricavo + 0.005
  } else if (p.prezzoClienteTotale != null && p.prezzoClienteTotale > 0) {
    ricavo = p.prezzoClienteTotale
    ferma = totale > ricavo + 0.005
  } else {
    ferma = false   // il detentore spedisce per se': paga lui, sotto non c'e' nessuno
  }
  console.warn('[GUARDIA][UPS-SUPPLEMENTO]', JSON.stringify({
    contratto: p.corriereNome, paese: p.paese, cap: p.cap, citta: p.citta, mittCap: p.mittCap,
    fornitore, listino, ricavo, diff, ferma,
  }))
  return { ferma, fornitore, listino, ricavo }
}
