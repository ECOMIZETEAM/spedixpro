// Codice paese ISO alpha-2 (dest_paese, es. "IT") -> ISO 3166-1 NUMERICO, che e' l'`id` delle nazioni
// nel topojson world-atlas (public/geo/world-110m.json). Serve al globo per colorare la nazione giusta.
// Copre Europa completa + le principali destinazioni mondiali di una piattaforma di spedizioni IT.
// Chi non c'e' semplicemente non viene colorato (degrado accettabile).
export const PAESE_ISO_NUM: Record<string, number> = {
  IT: 380, DE: 276, FR: 250, ES: 724, GB: 826, UK: 826, CH: 756, AT: 40, BE: 56, NL: 528,
  PT: 620, IE: 372, SE: 752, DK: 208, FI: 246, NO: 578, PL: 616, CZ: 203, SK: 703, HU: 348,
  RO: 642, BG: 100, GR: 300, HR: 191, SI: 705, LU: 442, MT: 470, CY: 196, EE: 233, LV: 428,
  LT: 440, IS: 352, AL: 8, RS: 688, BA: 70, ME: 499, MK: 807, UA: 804, BY: 112, RU: 643,
  MD: 498, TR: 792, GE: 268, AM: 51, AZ: 31,
  // micro-stati: spesso assenti/uniti nel 110m — mappati comunque
  SM: 674, VA: 336, MC: 492, AD: 20, LI: 438,
  // resto del mondo (principali)
  US: 840, CA: 124, MX: 484, BR: 76, AR: 32, CL: 152, CO: 170, PE: 604,
  CN: 156, JP: 392, IN: 356, KR: 410, HK: 344, SG: 702, TW: 158, TH: 764, MY: 458, ID: 360,
  PH: 608, VN: 704, PK: 586, BD: 50, LK: 144, AE: 784, SA: 682, QA: 634, KW: 414, IL: 376,
  JO: 400, LB: 422, IR: 364, IQ: 368,
  AU: 36, NZ: 554,
  ZA: 710, EG: 818, MA: 504, TN: 788, DZ: 12, LY: 434, NG: 566, KE: 404, GH: 288, ET: 231,
  SN: 686, CI: 384, CM: 120, AO: 24,
}

// Nome italiano per il tooltip del globo (le nazioni piu' comuni; per le altre si usa il nome inglese
// che il topojson porta con se', o la sigla).
export const PAESE_NOME_IT: Record<string, string> = {
  IT: 'Italia', DE: 'Germania', FR: 'Francia', ES: 'Spagna', GB: 'Regno Unito', UK: 'Regno Unito',
  CH: 'Svizzera', AT: 'Austria', BE: 'Belgio', NL: 'Paesi Bassi', PT: 'Portogallo', IE: 'Irlanda',
  SE: 'Svezia', DK: 'Danimarca', FI: 'Finlandia', NO: 'Norvegia', PL: 'Polonia', CZ: 'Cechia',
  SK: 'Slovacchia', HU: 'Ungheria', RO: 'Romania', BG: 'Bulgaria', GR: 'Grecia', HR: 'Croazia',
  SI: 'Slovenia', LU: 'Lussemburgo', MT: 'Malta', CY: 'Cipro', EE: 'Estonia', LV: 'Lettonia',
  LT: 'Lituania', IS: 'Islanda', SM: 'San Marino', VA: 'Città del Vaticano', MC: 'Monaco',
  AD: 'Andorra', LI: 'Liechtenstein', US: 'Stati Uniti', CA: 'Canada', CN: 'Cina', JP: 'Giappone',
  AU: 'Australia', BR: 'Brasile', IN: 'India', TR: 'Turchia', RU: 'Russia', AE: 'Emirati Arabi',
}
