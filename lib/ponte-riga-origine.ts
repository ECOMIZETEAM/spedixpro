import { modalitaCodDaRichiesta } from '@/lib/contrassegno-modalita'

// LA RIGA DEL CLIENTE DI UN CONDIVISO CREATO DAL PORTALE, spostata qui da app/api/spedizioni/crea senza cambiarla
// (fase 3 di PONTE-UNICO.md). La usano la creazione, come prima, e il ponte unico, che la scrive nella stessa
// transazione delle gambe dei venditori. `ris` e' la risposta del primo venditore: numero, prezzo, modalita' del
// contrassegno, la sua riga e la sua etichetta.
export function rigaTestaCondivisa(p: {
  masterId: string; clienteId: string | null; corriereRecord: any; numeroFinale: string; body: any; packages: any[]
  pesoReale: number; pesoVolCalc: number; pesoFattCalc: number; pkg: any; ris: any; etichettaUrl: string | null
  costoCorrente: number; costoCliente: number; serviziAccessori: any; _vuoleRitiro: boolean; _pomeriggio: boolean
}) {
  const {
    masterId, clienteId, corriereRecord, numeroFinale, body, packages, pesoReale, pesoVolCalc, pesoFattCalc, pkg, ris,
    etichettaUrl, costoCorrente, costoCliente, serviziAccessori, _vuoleRitiro, _pomeriggio,
  } = p
  const colliDettaglio = (body.colliDettaglio || packages.map((p: any) => ({ lunghezza: p.length, larghezza: p.width, altezza: p.height })))
    .map((c: any, i: number) => ({
      numero: i + 1,
      lunghezza: c.lunghezza || packages[i]?.length || null,
      larghezza: c.larghezza || packages[i]?.width || null,
      altezza: c.altezza || packages[i]?.height || null,
      peso: packages[i]?.weight || null,
      etichetta_url: etichettaUrl,   // una LDV, un PDF per l'intera spedizione
    }))

  const rigaTesta = {
    master_id: masterId, cliente_id: clienteId, corriere_id: corriereRecord.id,
    numero: numeroFinale,
    mitt_nome: body.shipFrom.name, mitt_indirizzo: body.shipFrom.street1, mitt_citta: body.shipFrom.city,
    mitt_provincia: body.shipFrom.state, mitt_cap: body.shipFrom.postalCode, mitt_paese: 'IT',
    mitt_email: body.shipFrom.email || null, mitt_telefono: body.shipFrom.phone || null,
    dest_nome: body.shipTo.name, dest_indirizzo: body.shipTo.street1, dest_citta: body.shipTo.city,
    dest_provincia: body.shipTo.state, dest_cap: body.shipTo.postalCode, dest_paese: body.shipTo.country || 'IT',
    dest_email: body.shipTo.email || null, dest_telefono: body.shipTo.phone || null,
    colli: packages.length, peso_reale: pesoReale,
    peso_volume: pesoVolCalc || null, peso_fatturato: pesoFattCalc || null,
    lunghezza: pkg?.length || null, larghezza: pkg?.width || null, altezza: pkg?.height || null,
    // La modalita' che il venditore ha davvero mandato al corriere (null se non e' un contratto Poste).
    contrassegno: body.codValue || 0, contrassegno_modalita: modalitaCodDaRichiesta(ris.codMode), assicurazione: body.insuranceValue || 0,
    tracking_number: numeroFinale,
    etichetta_url: etichettaUrl,
    colli_dettaglio: colliDettaglio,
    raw_response: { _moovexpress: true, tracking: numeroFinale, venditore_spedizione_id: ris.id || null, label_url: ris.label_url || null },
    stato: 'in_lavorazione',
    costo_spedizione: costoCorrente, costo_totale: costoCliente,
    servizi_accessori: serviziAccessori,
    richiedi_ritiro: _vuoleRitiro || false,
    data_ritiro: _vuoleRitiro ? String(body.dataRitiro) : null,
    intervallo_ritiro: _vuoleRitiro ? (_pomeriggio ? '14:00-18:00' : '09:00-13:00') : null,
    note: body.notes || null, contenuto: body.contenuto || null,
    rif_ordine: body.rifOrdine || null, rif_destinatario: body.rifDestinatario || null,
  }
  return rigaTesta
}
