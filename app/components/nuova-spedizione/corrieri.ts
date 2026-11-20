import { OPZIONI_INCASSO_POSTE } from '@/lib/contrassegno-modalita'

// Le stesse regole dei due moduli di oggi (app/cliente/spedizioni/nuova e app/dashboard/spedizioni/nuova), qui una
// volta sola per la pagina nuova. I moduli di oggi restano come sono finché la pagina nuova non li sostituisce.

export interface Tariffa {
  carrierCode: string; contractCode: string; total_price: string; zona: string; peso_fatturato: string; peso_reale: number; peso_volume: string
  corriere_nome?: string; prezzo_spedizione?: string; weight_price?: string; costo_sponda?: string; costo_fuel?: string; fuel_pct?: number
  costo_contrassegno?: string; costo_assicurazione?: string; accessori_disponibili?: { nome: string; prezzo: number; perc: number }[]
  limiti_collo?: string; avviso_fuori_sagoma?: string; _corriere_id?: string; _corriere_tipo?: string; _brt_assegno?: boolean
  _spedisci_assegno?: boolean; _poste_assegno?: boolean; _spediamopro_quotation?: any; _deposito?: boolean; _consegna_punto?: string
  _email_obbligatoria?: boolean; _inpost_locker?: boolean; corriere_id?: string
}

// La stessa tariffa fra un preventivo e il successivo: il contratto e la zona. Serve a tenere il corriere scelto
// quando i prezzi si ricalcolano.
export function chiaveTariffa(t: Tariffa): string {
  return (t._corriere_id || `${t.carrierCode}/${t.contractCode}`) + '|' + t.zona
}

// Sigla di ripiego quando il contratto non ha un marchio riconosciuto. Qui arriva il TIPO del contratto, cioè il
// fornitore tecnico: stamparlo tale e quale lo mostrerebbe all'utente ('EASYPARCEL'). Ogni fornitore ha la sua sigla neutra.
export const codiceProv = (t?: string) => t === 'spediamopro' ? 'SP' : t === 'spedisci' ? 'SO' : t === 'easyparcel' ? 'V' : (t || '').toUpperCase()

export function iconaCorriere(nome: string): string | null {
  const n = (nome || '').toUpperCase()
  const regole: [string, string][] = [
    ['DELIVERY BUSINESS', 'poste_delivery_business'], ['POSTE', 'poste_delivery_business'],
    ['SDA', 'sda'], ['GLS', 'gls'], ['BRT', 'brt'], ['SPEDISCI', 'spedisci'], ['TNT', 'tnt'],
    ['DHL ECONNECT', 'dhl_econnect'], ['ECONNECT', 'dhl_econnect'], ['DHL', 'dhl'],
    ['FEDEX', 'fedex'], ['UPS', 'ups'], ['HERMES', 'hermes'], ['NEXIVE', 'nexive'],
    ['LICCARDI', 'liccardi'], ['SAILPOST', 'sailpost'], ['BDM', 'bdm'], ['NSSA', 'nssa'],
    ['HR PARCEL', 'hrp'], ['HRP', 'hrp'], ['PALLETWAYS', 'palletways'],
    ['CORREOS EXPRESS', 'correos_express'], ['CORREOS', 'correos'],
    ['INPOST', 'inpost'], ['SPRING', 'spring'], ['PAACK', 'paack'], ['SPEEDY', 'speedy'],
    ['AMAZON', 'amazon_shipping'], ['CTT', 'ctt_express'], ['AIPACK', 'aipack'], ['ALT', 'alt'],
    ['GTECH', 'gtechgroup'], ['SPEDIAMOPRO', 'spedisci'], ['SPEDIAMO', 'spedisci'], ['SPEDISCI', 'spedisci'],
  ]
  for (const [chiave, file] of regole) if (n.includes(chiave)) return `/corrieri/${file}.png`
  return null
}

// Come può pagare il contrassegno il destinatario: dipende dal CANALE del contratto scelto. GLS diretto ha contante e
// i due assegni (ServiziAccessori 01/02/03); DVA solo contante e assegno (la sua API ha due valori); Spedisci e BRT gli
// assegni solo se il contratto li ha; i contratti che finiscono su Poste le loro opzioni; gli altri solo contante.
export function opzioniIncasso(t: Tariffa | null): [string, string][] {
  if (!t) return [['C', 'CONTANTE']]
  if (t._corriere_tipo === 'gls') return [['C', 'CONTANTE'], ['AB', 'ASSEGNO BANCARIO'], ['AC', 'ASSEGNO CIRCOLARE']]
  if (t._corriere_tipo === 'V') return [['C', 'CONTANTE'], ['A', 'ASSEGNO']]
  if (t._corriere_tipo === 'SO' && t._spedisci_assegno) return [['C', 'CONTANTE'], ['AB', 'ASSEGNO BANCARIO'], ['AC', 'ASSEGNO CIRCOLARE']]
  if (t._corriere_tipo === 'brt' && t._brt_assegno) return [['C', 'CONTANTE'], ['BM', 'ASSEGNO BANCARIO']]
  if (t._poste_assegno) return OPZIONI_INCASSO_POSTE as [string, string][]
  return [['C', 'CONTANTE']]
}

// Il locker: un collo solo e niente contrassegno (stessa regola della creazione, lib/limiti-collo). Il preventivo lo
// propone lo stesso in certi casi; qui resta in elenco, spento, con il motivo scritto.
export function motivoSpento(t: Tariffa, nColli: number, contrassegno: boolean): string {
  if (!t._inpost_locker) return ''
  if (nColli > 1) return 'Il locker accetta un collo solo'
  if (contrassegno) return 'Il locker non accetta il contrassegno'
  return ''
}

export const euro = (n: number) => '€ ' + (Number.isFinite(n) ? n : 0).toFixed(2).replace('.', ',')
export const kg = (n: number) => String(Math.round((Number(n) || 0) * 1000) / 1000).replace('.', ',') + ' kg'
