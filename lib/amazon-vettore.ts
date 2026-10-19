import { vettoreFisico, consegnaConMezziPropri } from '@/lib/vettore'

// CORRIERE → CODICE VETTORE AMAZON, per la conferma di spedizione via API (lib/amazonFulfill).
//
// I codici sono quelli della lista ufficiale di Amazon (amzn-base._TTH_.xsd, CarrierCode, letta il
// 19/10/2026): si confrontano lettera per lettera, quindi vanno scritti esattamente cosi'.
// Il corriere e' quello REALE (vettoreFisico), mai il fornitore tecnico, e riconosce anche i
// contratti GLS/BRT diretti che nel nome non dicono "GLS"/"BRT" (es. "PF CE LIGHT" e' tipo 'gls').
// Un corriere fuori lista esce 'Other' col nome del vettore: Amazon lo vuole solo con 'Other'.
//
// Corriere interno = "Mezzi propri": 'Self Delivery', come nel file di conferma
// (app/api/cliente/reports/marketplace/download). Quel file riconosce gli altri corrieri dal solo
// nome del contratto; qui no, per i contratti diretti di cui sopra.
const CODICE: Record<string, string> = {
  GLS: 'GLS',
  BRT: 'BRT',
  POSTE: 'Poste Italiane',
  SDA: 'SDA',
  UPS: 'UPS',
  DHL: 'DHL',
  TNT: 'TNT',
  FEDEX: 'FedEx',
  INPOST: 'InPost',
  NEXIVE: 'Nexive',
  SAILPOST: 'Sailpost',
  FERCAM: 'FERCAM',
}

export function vettoreAmazon(corriere: { nome_contratto?: string | null; tipo?: string | null; settings?: any } | null | undefined): { carrierCode: string; carrierName?: string; shippingMethod: string } {
  if (consegnaConMezziPropri(corriere)) return { carrierCode: 'Self Delivery', shippingMethod: 'Self Delivery' }
  const brand = corriere ? vettoreFisico(corriere) : ''
  const codice = CODICE[brand]
  if (codice) return { carrierCode: codice, shippingMethod: 'Standard' }
  return { carrierCode: 'Other', carrierName: brand && brand !== 'ALTRO' ? brand : 'Corriere', shippingMethod: 'Standard' }
}
