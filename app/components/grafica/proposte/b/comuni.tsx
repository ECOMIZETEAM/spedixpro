'use client'
// Pezzi comuni della proposta B: la testa delle sezioni e i nomi delle province.
import type { ReactNode } from 'react'

export function Testa({ id, occhiello, titolo, frase, destra }: { id: string; occhiello: string; titolo: ReactNode; frase?: ReactNode; destra?: ReactNode }) {
  return (
    <div className="pb-testa">
      <div>
        <small className="pb-occhiello">{occhiello}</small>
        <h2 id={id}>{titolo}</h2>
        {frase && <p>{frase}</p>}
      </div>
      {destra}
    </div>
  )
}

// i nomi dei fornitori tecnici non devono mai arrivare a schermo (nemmeno dal ripiego di vettoreFisico, che usa la
// prima parola del contratto o il tipo d'integrazione)
export const TECNICI = /SPEDIAMO|SPEDISCI|EASYPARCEL|EASY PARCEL|\bDVA\b/i

export const virgola = (n: number, dec = 1) => (Math.round(n * 10 ** dec) / 10 ** dec).toString().replace('.', ',')

// le sigle delle province (comprese le quattro sarde soppresse, che negli indirizzi vecchi si trovano ancora)
export const PROVINCE: Record<string, string> = {
  AG: 'Agrigento', AL: 'Alessandria', AN: 'Ancona', AO: 'Aosta', AP: 'Ascoli Piceno', AQ: "L'Aquila", AR: 'Arezzo', AT: 'Asti',
  AV: 'Avellino', BA: 'Bari', BG: 'Bergamo', BI: 'Biella', BL: 'Belluno', BN: 'Benevento', BO: 'Bologna', BR: 'Brindisi',
  BS: 'Brescia', BT: 'Barletta-Andria-Trani', BZ: 'Bolzano', CA: 'Cagliari', CB: 'Campobasso', CE: 'Caserta', CH: 'Chieti',
  CL: 'Caltanissetta', CN: 'Cuneo', CO: 'Como', CR: 'Cremona', CS: 'Cosenza', CT: 'Catania', CZ: 'Catanzaro', EN: 'Enna',
  FC: 'Forlì-Cesena', FE: 'Ferrara', FG: 'Foggia', FI: 'Firenze', FM: 'Fermo', FR: 'Frosinone', GE: 'Genova', GO: 'Gorizia',
  GR: 'Grosseto', IM: 'Imperia', IS: 'Isernia', KR: 'Crotone', LC: 'Lecco', LE: 'Lecce', LI: 'Livorno', LO: 'Lodi', LT: 'Latina',
  LU: 'Lucca', MB: 'Monza e Brianza', MC: 'Macerata', ME: 'Messina', MI: 'Milano', MN: 'Mantova', MO: 'Modena', MS: 'Massa-Carrara',
  MT: 'Matera', NA: 'Napoli', NO: 'Novara', NU: 'Nuoro', OR: 'Oristano', PA: 'Palermo', PC: 'Piacenza', PD: 'Padova', PE: 'Pescara',
  PG: 'Perugia', PI: 'Pisa', PN: 'Pordenone', PO: 'Prato', PR: 'Parma', PT: 'Pistoia', PU: 'Pesaro e Urbino', PV: 'Pavia',
  PZ: 'Potenza', RA: 'Ravenna', RC: 'Reggio Calabria', RE: 'Reggio Emilia', RG: 'Ragusa', RI: 'Rieti', RM: 'Roma', RN: 'Rimini',
  RO: 'Rovigo', SA: 'Salerno', SI: 'Siena', SO: 'Sondrio', SP: 'La Spezia', SR: 'Siracusa', SS: 'Sassari', SU: 'Sud Sardegna',
  SV: 'Savona', TA: 'Taranto', TE: 'Teramo', TN: 'Trento', TO: 'Torino', TP: 'Trapani', TR: 'Terni', TS: 'Trieste', TV: 'Treviso',
  UD: 'Udine', VA: 'Varese', VB: 'Verbano-Cusio-Ossola', VC: 'Vercelli', VE: 'Venezia', VI: 'Vicenza', VR: 'Verona', VT: 'Viterbo',
  VV: 'Vibo Valentia', CI: 'Carbonia-Iglesias', OG: 'Ogliastra', OT: 'Olbia-Tempio', VS: 'Medio Campidano',
}
