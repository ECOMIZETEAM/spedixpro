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

// Elenco COMPLETO delle 107 province italiane attuali: sigla + nome esteso.
// Usato nei menu a tendina (mostra il NOME, salva la SIGLA — così il calcolo
// zone/tariffe e la Nuova Spedizione continuano a lavorare sulle sigle).
// Ordinato per nome. Include SU (Sud Sardegna); esclude le province abolite
// (CI, VS, OG, OT) che restano gestite solo in lettura da siglaProvincia/ZONE_MAP.
export const PROVINCE_IT: { sigla: string; nome: string }[] = [
  { sigla: 'AG', nome: 'Agrigento' }, { sigla: 'AL', nome: 'Alessandria' }, { sigla: 'AN', nome: 'Ancona' },
  { sigla: 'AO', nome: 'Aosta' }, { sigla: 'AR', nome: 'Arezzo' }, { sigla: 'AP', nome: 'Ascoli Piceno' },
  { sigla: 'AT', nome: 'Asti' }, { sigla: 'AV', nome: 'Avellino' }, { sigla: 'BA', nome: 'Bari' },
  { sigla: 'BT', nome: 'Barletta-Andria-Trani' }, { sigla: 'BL', nome: 'Belluno' }, { sigla: 'BN', nome: 'Benevento' },
  { sigla: 'BG', nome: 'Bergamo' }, { sigla: 'BI', nome: 'Biella' }, { sigla: 'BO', nome: 'Bologna' },
  { sigla: 'BZ', nome: 'Bolzano' }, { sigla: 'BS', nome: 'Brescia' }, { sigla: 'BR', nome: 'Brindisi' },
  { sigla: 'CA', nome: 'Cagliari' }, { sigla: 'CL', nome: 'Caltanissetta' }, { sigla: 'CB', nome: 'Campobasso' },
  { sigla: 'CE', nome: 'Caserta' }, { sigla: 'CT', nome: 'Catania' }, { sigla: 'CZ', nome: 'Catanzaro' },
  { sigla: 'CH', nome: 'Chieti' }, { sigla: 'CO', nome: 'Como' }, { sigla: 'CS', nome: 'Cosenza' },
  { sigla: 'CR', nome: 'Cremona' }, { sigla: 'KR', nome: 'Crotone' }, { sigla: 'CN', nome: 'Cuneo' },
  { sigla: 'EN', nome: 'Enna' }, { sigla: 'FM', nome: 'Fermo' }, { sigla: 'FE', nome: 'Ferrara' },
  { sigla: 'FI', nome: 'Firenze' }, { sigla: 'FG', nome: 'Foggia' }, { sigla: 'FC', nome: 'Forlì-Cesena' },
  { sigla: 'FR', nome: 'Frosinone' }, { sigla: 'GE', nome: 'Genova' }, { sigla: 'GO', nome: 'Gorizia' },
  { sigla: 'GR', nome: 'Grosseto' }, { sigla: 'IM', nome: 'Imperia' }, { sigla: 'IS', nome: 'Isernia' },
  { sigla: 'AQ', nome: "L'Aquila" }, { sigla: 'SP', nome: 'La Spezia' }, { sigla: 'LT', nome: 'Latina' },
  { sigla: 'LE', nome: 'Lecce' }, { sigla: 'LC', nome: 'Lecco' }, { sigla: 'LI', nome: 'Livorno' },
  { sigla: 'LO', nome: 'Lodi' }, { sigla: 'LU', nome: 'Lucca' }, { sigla: 'MC', nome: 'Macerata' },
  { sigla: 'MN', nome: 'Mantova' }, { sigla: 'MS', nome: 'Massa-Carrara' }, { sigla: 'MT', nome: 'Matera' },
  { sigla: 'ME', nome: 'Messina' }, { sigla: 'MI', nome: 'Milano' }, { sigla: 'MO', nome: 'Modena' },
  { sigla: 'MB', nome: 'Monza e della Brianza' }, { sigla: 'NA', nome: 'Napoli' }, { sigla: 'NO', nome: 'Novara' },
  { sigla: 'NU', nome: 'Nuoro' }, { sigla: 'OR', nome: 'Oristano' }, { sigla: 'PD', nome: 'Padova' },
  { sigla: 'PA', nome: 'Palermo' }, { sigla: 'PR', nome: 'Parma' }, { sigla: 'PV', nome: 'Pavia' },
  { sigla: 'PG', nome: 'Perugia' }, { sigla: 'PU', nome: 'Pesaro e Urbino' }, { sigla: 'PE', nome: 'Pescara' },
  { sigla: 'PC', nome: 'Piacenza' }, { sigla: 'PI', nome: 'Pisa' }, { sigla: 'PT', nome: 'Pistoia' },
  { sigla: 'PN', nome: 'Pordenone' }, { sigla: 'PZ', nome: 'Potenza' }, { sigla: 'PO', nome: 'Prato' },
  { sigla: 'RG', nome: 'Ragusa' }, { sigla: 'RA', nome: 'Ravenna' }, { sigla: 'RC', nome: 'Reggio Calabria' },
  { sigla: 'RE', nome: 'Reggio Emilia' }, { sigla: 'RI', nome: 'Rieti' }, { sigla: 'RN', nome: 'Rimini' },
  { sigla: 'RM', nome: 'Roma' }, { sigla: 'RO', nome: 'Rovigo' }, { sigla: 'SA', nome: 'Salerno' },
  { sigla: 'SS', nome: 'Sassari' }, { sigla: 'SV', nome: 'Savona' }, { sigla: 'SI', nome: 'Siena' },
  { sigla: 'SR', nome: 'Siracusa' }, { sigla: 'SO', nome: 'Sondrio' }, { sigla: 'SU', nome: 'Sud Sardegna' },
  { sigla: 'TA', nome: 'Taranto' }, { sigla: 'TE', nome: 'Teramo' }, { sigla: 'TR', nome: 'Terni' },
  { sigla: 'TO', nome: 'Torino' }, { sigla: 'TP', nome: 'Trapani' }, { sigla: 'TN', nome: 'Trento' },
  { sigla: 'TV', nome: 'Treviso' }, { sigla: 'TS', nome: 'Trieste' }, { sigla: 'UD', nome: 'Udine' },
  { sigla: 'VA', nome: 'Varese' }, { sigla: 'VE', nome: 'Venezia' }, { sigla: 'VB', nome: 'Verbano-Cusio-Ossola' },
  { sigla: 'VC', nome: 'Vercelli' }, { sigla: 'VR', nome: 'Verona' }, { sigla: 'VV', nome: 'Vibo Valentia' },
  { sigla: 'VI', nome: 'Vicenza' }, { sigla: 'VT', nome: 'Viterbo' },
]
