import { vettoreFisico, consegnaConMezziPropri } from '@/lib/vettore'
import { senzaNomiFornitori, isProviderTecnico } from '@/lib/corriere-logo'

// CORRIERE → CODICE VETTORE AMAZON, per la conferma di spedizione via API (lib/amazonFulfill).
//
// I codici sono quelli della lista ufficiale di Amazon (amzn-base._TTH_.xsd, CarrierCode, letta il
// 19/10/2026): si confrontano lettera per lettera, quindi vanno scritti esattamente cosi'.
// Il corriere e' quello REALE (vettoreFisico), mai il fornitore tecnico, e riconosce anche i
// contratti GLS/BRT diretti che nel nome non dicono "GLS"/"BRT" (es. "PF CE LIGHT" e' tipo 'gls').
// Un corriere fuori lista esce 'Other' con un nome: Amazon lo vuole solo con 'Other'.
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
  HERMES: 'Hermes',
}

export function vettoreAmazon(corriere: { nome_contratto?: string | null; tipo?: string | null; settings?: any } | null | undefined): { carrierCode: string; carrierName?: string; shippingMethod: string } {
  if (consegnaConMezziPropri(corriere)) return { carrierCode: 'Self Delivery', shippingMethod: 'Self Delivery' }
  // Il NOME che va ad Amazon lo vedono venditore e compratore: mai il fornitore tecnico. Il tipo di
  // un contratto via fornitore (spediamopro, spedisci, easyparcel…) non entra nel riconoscimento,
  // perche' vettoreFisico, quando il nome non dice niente, ripiega proprio sul tipo; e dal nome
  // si tolgono i nomi dei fornitori, come nelle altre schermate (lib/corriere-logo).
  const nome = senzaNomiFornitori(String(corriere?.nome_contratto || '')).trim()
  const t = String(corriere?.tipo || '').toLowerCase()
  const viaFornitore = isProviderTecnico(t) || t === 'moovexpress'
  const tipo = viaFornitore ? null : (corriere?.tipo ?? null)
  const brand = corriere ? vettoreFisico({ nome_contratto: nome, tipo }) : ''
  const codice = CODICE[brand]
  if (codice) return { carrierCode: codice, shippingMethod: 'Standard' }
  // Un contratto via fornitore che non dice il corriere: il suo nome puo' contenere quello del
  // fornitore in forme che il filtro non toglie (es. "DVA"), quindi verso Amazon e' "Corriere".
  return { carrierCode: 'Other', carrierName: !viaFornitore && nome ? nome : 'Corriere', shippingMethod: 'Standard' }
}
