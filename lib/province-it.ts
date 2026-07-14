// Conversione nome provincia italiana -> sigla a 2 lettere.
// Serve soprattutto all'import ordini: alcuni marketplace (Amazon in primis)
// esportano la provincia per esteso ("Milano", "Sassari", "Monza e Brianza")
// invece della sigla. Il calcolo tariffe/zone lavora sulla sigla, quindi senza
// conversione il match zona salta e alcuni corrieri vengono esclusi.

const MAPPA: Record<string, string> = {
  AGRIGENTO: 'AG', ALESSANDRIA: 'AL', ANCONA: 'AN', AOSTA: 'AO', 'VALLE D AOSTA': 'AO',
  AREZZO: 'AR', 'ASCOLI PICENO': 'AP', ASTI: 'AT', AVELLINO: 'AV', BARI: 'BA',
  'BARLETTA ANDRIA TRANI': 'BT', BELLUNO: 'BL', BENEVENTO: 'BN', BERGAMO: 'BG', BIELLA: 'BI',
  BOLOGNA: 'BO', BOLZANO: 'BZ', BOZEN: 'BZ', BRESCIA: 'BS', BRINDISI: 'BR', CAGLIARI: 'CA',
  CALTANISSETTA: 'CL', CAMPOBASSO: 'CB', CARBONIA: 'SU', IGLESIAS: 'SU', CASERTA: 'CE',
  CATANIA: 'CT', CATANZARO: 'CZ', CHIETI: 'CH', COMO: 'CO', COSENZA: 'CS', CREMONA: 'CR',
  CROTONE: 'KR', CUNEO: 'CN', ENNA: 'EN', FERMO: 'FM', FERRARA: 'FE', FIRENZE: 'FI',
  FOGGIA: 'FG', 'FORLI CESENA': 'FC', FORLI: 'FC', FROSINONE: 'FR', GENOVA: 'GE',
  GORIZIA: 'GO', GROSSETO: 'GR', IMPERIA: 'IM', ISERNIA: 'IS', 'L AQUILA': 'AQ', AQUILA: 'AQ',
  'LA SPEZIA': 'SP', LATINA: 'LT', LECCE: 'LE', LECCO: 'LC', LIVORNO: 'LI', LODI: 'LO',
  LUCCA: 'LU', MACERATA: 'MC', MANTOVA: 'MN', 'MASSA CARRARA': 'MS', MASSA: 'MS', MATERA: 'MT',
  MESSINA: 'ME', MILANO: 'MI', MODENA: 'MO', 'MONZA E BRIANZA': 'MB', 'MONZA E DELLA BRIANZA': 'MB',
  MONZA: 'MB', NAPOLI: 'NA', NOVARA: 'NO', NUORO: 'NU', ORISTANO: 'OR', PADOVA: 'PD',
  PALERMO: 'PA', PARMA: 'PR', PAVIA: 'PV', PERUGIA: 'PG', 'PESARO E URBINO': 'PU', PESARO: 'PU',
  PESCARA: 'PE', PIACENZA: 'PC', PISA: 'PI', PISTOIA: 'PT', PORDENONE: 'PN', POTENZA: 'PZ',
  PRATO: 'PO', RAGUSA: 'RG', RAVENNA: 'RA', 'REGGIO CALABRIA': 'RC', 'REGGIO DI CALABRIA': 'RC',
  'REGGIO EMILIA': 'RE', 'REGGIO NELL EMILIA': 'RE', RIETI: 'RI',
  RIMINI: 'RN', ROMA: 'RM', ROVIGO: 'RO', SALERNO: 'SA', 'SUD SARDEGNA': 'SU', SASSARI: 'SS',
  SAVONA: 'SV', SIENA: 'SI', SIRACUSA: 'SR', SONDRIO: 'SO', TARANTO: 'TA', TERAMO: 'TE',
  TERNI: 'TR', TORINO: 'TO', TRAPANI: 'TP', TRENTO: 'TN', TREVISO: 'TV', TRIESTE: 'TS',
  UDINE: 'UD', VARESE: 'VA', VENEZIA: 'VE', 'VERBANO CUSIO OSSOLA': 'VB', VERBANIA: 'VB',
  VERCELLI: 'VC', VERONA: 'VR', 'VIBO VALENTIA': 'VV', VICENZA: 'VI', VITERBO: 'VT',
}

// Normalizza per il lookup: MAIUSCOLO, senza accenti, apostrofi/trattini -> spazio, spazi compressi.
function norm(s: string): string {
  return (s || '')
    .toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // via gli accenti
    .toUpperCase()
    .replace(/['’`.\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Ritorna la sigla a 2 lettere della provincia.
 * - Se l'input è già una sigla valida a 2 lettere, la ritorna in maiuscolo.
 * - Se è un nome esteso noto, ritorna la sigla.
 * - Altrimenti ritorna l'input ripulito in maiuscolo (fallback prudente).
 */
export function siglaProvincia(input: string): string {
  const n = norm(input)
  if (!n) return ''
  if (n.length === 2) return n // già una sigla (es. "MI", "rm")
  if (MAPPA[n]) return MAPPA[n]
  const senzaPrefisso = n.replace(/^PROVINCIA (DI |DELLA |DELL )?/, '').trim()
  if (MAPPA[senzaPrefisso]) return MAPPA[senzaPrefisso]
  return input.toString().trim().toUpperCase()
}
