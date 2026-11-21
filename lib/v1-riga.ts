import type { ModalitaCod } from '@/lib/contrassegno-modalita'

// DUE PEZZI DI /api/v1/shipments SPOSTATI QUI SENZA CAMBIARLI (fase 3 di PONTE-UNICO.md): la richiesta che un
// livello manda al venditore sotto, e la riga che un livello scrive. Li usano la rotta, come prima, e il ponte
// unico dei condivisi, che deve scrivere per ogni livello esattamente la riga che la staffetta scrive oggi.
// Una regola sola per tutte e due le strade: se cambia qui, cambia per entrambe.

// Cosa un livello manda al venditore sotto (POST /api/v1/shipments del venditore). Il venditore la legge come
// JSON: i campi undefined non arrivano.
export function corpoPerIlVenditoreV1(p: {
  body: any; packages: any[]; conPresso: (via: string, presso: string) => string; pressoFrom: string; pressoTo: string
  _vuoleRitiro: boolean; _dataRitiro: string; _pomeriggio: boolean
}) {
  const { body, packages, conPresso, pressoFrom, pressoTo, _vuoleRitiro, _dataRitiro, _pomeriggio } = p
  return {
    packages: packages.map((p: any) => ({ weight: parseFloat(p?.weight) || 1, length: parseFloat(p?.length) || undefined, width: parseFloat(p?.width) || undefined, height: parseFloat(p?.height) || undefined })),
    shipFrom: { ...body.shipFrom, street1: conPresso(body.shipFrom.street1 || '', pressoFrom) },
    shipTo: { ...body.shipTo, street1: conPresso(body.shipTo.street1 || '', pressoTo) },
    codValue: body.codValue ? Number(body.codValue) : undefined,
    // Contanti o assegno: lo usa il contratto vero, che sta dal venditore (per SDA EXPRESS L, Poste).
    ...(Number(body.codValue || 0) > 0 && body.incassoModalita ? { incassoModalita: String(body.incassoModalita) } : {}),
    insuranceValue: body.insuranceValue ? Number(body.insuranceValue) : undefined,
    valoreMerce: body.valoreMerce ? Number(body.valoreMerce) : undefined,
    notes: body.notes ? String(body.notes) : undefined,
    contenuto: body.contenuto ? String(body.contenuto) : undefined,
    rifOrdine: (body.rifOrdine ? String(body.rifOrdine) : '').trim() || undefined,
    pickup: _vuoleRitiro ? { requested: true, date: _dataRitiro, time: _pomeriggio ? 'pomeriggio' : 'mattina' } : undefined,
    // Consegna a un punto: il contratto vero sta dal venditore, che controlla e usa questi campi.
    // Solo se arrivati: sulle spedizioni a domicilio la chiamata resta identica a prima.
    ...(body.deliveryPoint != null ? { deliveryPoint: body.deliveryPoint } : {}),
    ...(body.dropoffType ? { dropoffType: String(body.dropoffType) } : {}),
    ...(body.inpostPointId ? { inpostPointId: String(body.inpostPointId) } : {}),
  }
}

// La riga di spedizioni che un livello scrive, e il suo numero (unico per il conto d'ingrosso).
export function rigaV1(p: {
  cliente: any; ctx: { clienteId: string }; numero: string; masterId: string; corriere: any; body: any
  pressoFrom: string; pressoTo: string; puntoConsegna: any; packages: any[]; pesoReale: number; ris: any; pkg: any
  codModeUsata: ModalitaCod | null; etichettaUrl: string | null; colliDettaglio: any[] | null; raw: any
  costoCorrente: number; costoCliente: number; ritiroPrenotato: boolean; _dataRitiro: string; _pomeriggio: boolean
}) {
  const {
    cliente, ctx, numero, masterId, corriere, body, pressoFrom, pressoTo, puntoConsegna, packages, pesoReale, ris, pkg,
    codModeUsata, etichettaUrl, colliDettaglio, raw, costoCorrente, costoCliente, ritiroPrenotato, _dataRitiro, _pomeriggio,
  } = p
  const numeroDb = (cliente as any)?.ledger && numero ? `${numero}-${String(ctx.clienteId).slice(0, 8)}` : numero
  const riga = {
    master_id: masterId, cliente_id: ctx.clienteId, corriere_id: corriere.id, numero: numeroDb,
    mitt_nome: body.shipFrom.name, mitt_indirizzo: body.shipFrom.street1, mitt_presso: pressoFrom || null, mitt_citta: body.shipFrom.city,
    mitt_provincia: body.shipFrom.state, mitt_cap: body.shipFrom.postalCode, mitt_paese: 'IT',
    mitt_email: body.shipFrom.email || null, mitt_telefono: body.shipFrom.phone || null,
    // Consegna a un PUNTO sui contratti SpediamoPro: sulla scheda l'indirizzo e' quello del punto,
    // come nel portale (che su DVA invece tiene quello di casa: qui lo stesso).
    ...(puntoConsegna && corriere.tipo === 'spediamopro' ? {
      dest_nome: body.shipTo.name,
      dest_indirizzo: puntoConsegna.address ? [puntoConsegna.name, puntoConsegna.address].filter(Boolean).join(' - ').slice(0, 100) : body.shipTo.street1,
      dest_presso: pressoTo || null,
      dest_citta: puntoConsegna.city || body.shipTo.city,
      dest_provincia: puntoConsegna.province || body.shipTo.state,
      dest_cap: puntoConsegna.postalCode || body.shipTo.postalCode,
    } : {
      dest_nome: body.shipTo.name, dest_indirizzo: body.shipTo.street1, dest_presso: pressoTo || null, dest_citta: body.shipTo.city,
      dest_provincia: body.shipTo.state, dest_cap: body.shipTo.postalCode,
    }),
    dest_paese: body.shipTo.country || 'IT',
    dest_email: body.shipTo.email || null, dest_telefono: body.shipTo.phone || null,
    colli: packages.length, peso_reale: pesoReale,
    peso_volume: ris?.peso_volume || null, peso_fatturato: ris?.peso_fatturato || null,
    lunghezza: pkg?.length || null, larghezza: pkg?.width || null, altezza: pkg?.height || null,
    // IL RIFERIMENTO D'ORDINE SI SALVA. Arrivava nel body (`rifOrdine`), veniva passato al corriere e
    // usato dalla guardia anti-doppione, ma NON finiva nella riga: 21.846 spedizioni create via API
    // avevano `rif_ordine` a NULL. Due conseguenze vere: chi si integra non poteva riagganciare la
    // spedizione al proprio ordine (ne' qui ne' nel portale), e soprattutto la guardia
    // (lib/guardia-doppione) e l'indice uniq_sped_ordine_attivo_v2 confrontano proprio questa
    // colonna — con NULL non trovavano mai niente, quindi l'API era l'unica porta SENZA protezione
    // contro il doppio addebito dello stesso ordine (vedi CONTROLLORE-SUPREMO.md).
    rif_ordine: (body.rifOrdine ? String(body.rifOrdine).trim() : '') || null,
    contrassegno: body.codValue || 0, contrassegno_modalita: codModeUsata, assicurazione: body.insuranceValue || 0,
    tracking_number: numero, etichetta_url: etichettaUrl, colli_dettaglio: colliDettaglio, raw_response: raw, stato: 'in_lavorazione',
    costo_spedizione: costoCorrente, costo_totale: costoCliente, note: body.notes || null, contenuto: body.contenuto || null,
    // Il ritiro si segna sulla spedizione solo se e' stato prenotato: il portale mostra "Ritiro
    // richiesto" da questo campo, e un ritiro mai partito faceva credere al master che il corriere
    // sarebbe passato (TK-06400, 18/10/2026).
    richiedi_ritiro: ritiroPrenotato,
    data_ritiro: ritiroPrenotato ? _dataRitiro : null,
    intervallo_ritiro: ritiroPrenotato ? (_pomeriggio ? '14:00-18:00' : '09:00-13:00') : null,
    canale: 'api',
  }
  return { numeroDb, riga }
}

// TRE LETTURE DELLA RICHIESTA, spostate qui da lib/v1-livello senza cambiarle: dipendono solo dalla richiesta, e il
// ponte unico le usa per comporre la richiesta di ogni livello senza aspettare i controlli di quello sopra.

// "Presso" (c/o): seconda riga dell'indirizzo. Accetto `presso` e, come alias, `street2`
// (così chi arriva da altre piattaforme non deve cambiare payload). Su Spedisci finisce in
// street2; su SpediamoPro non esiste un campo dedicato -> viene accodato all'indirizzo.
export function pressoDelCorpo(body: any) {
  const pressoFrom = String(body.shipFrom?.presso || body.shipFrom?.street2 || '').trim()
  const pressoTo = String(body.shipTo?.presso || body.shipTo?.street2 || '').trim()
  const conPresso = (via: string, presso: string) => (presso ? `${via} c/o ${presso}`.trim() : via)
  return { pressoFrom, pressoTo, conPresso }
}

export function colliDelCorpo(body: any): any[] {
  const packages = Array.isArray(body.packages) && body.packages.length
    ? body.packages
    : [{ weight: Number(body.weight) || 1, length: 20, width: 15, height: 10 }]
  return packages
}

// IL RITIRO CHIESTO DA CHI INTEGRA.
// Si accettano due forme perche' l'API pubblica parla inglese ma i client italiani mandano gia'
// i nomi del portale: meglio leggere tutte e due che rispondere 200 OK ignorando la richiesta.
export function ritiroDelCorpo(body: any) {
  const _vuoleRitiro = (body.pickup?.requested === true || body.richiediRitiro === true)
    && !!(body.pickup?.date || body.dataRitiro)
  const _dataRitiro = String(body.pickup?.date || body.dataRitiro || '')
  const _pomeriggio = String(body.pickup?.time || body.orarioRitiro || '').toLowerCase().startsWith('pom')
  return { _vuoleRitiro, _dataRitiro, _pomeriggio }
}

// I PARAMETRI DEGLI ADDEBITI DI UN LIVELLO, spostati qui dalla rotta senza cambiarli. Su un ponte (il livello a sua
// volta compra) solo i livelli d'albero: il resto l'ha addebitato il venditore sotto. Sul contratto vero la cascata
// col costo del corriere. La rotta li passa ad addebitaTreeCondivisione / addebitaCatena; il ponte unico a
// movimentiAlbero / movimentiCatena, e scrive gli stessi movimenti nella sua transazione.
export function parametriAlberoV1(p: { masterId: string; corriere: any; body: any; packages: any[]; numero: string; spedizioneId: string | null }) {
  const { masterId, corriere, body, packages, numero } = p
  return {
        masterOriginante: masterId, nomeContratto: corriere.nome_contratto,
        dest: { cap: body.shipTo.postalCode, provincia: body.shipTo.state, citta: body.shipTo.city, paese: body.shipTo.country || 'IT' },
        packages,
        contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0),
        mittCap: (body.shipFrom.postalCode || '').toString().trim(), mittProvincia: (body.shipFrom.state || '').toUpperCase().trim(), mittPaese: 'IT',
        numero, destNome: body.shipTo?.name || '', spedizioneId: p.spedizioneId, createdBy: null,
  }
}

export function parametriCatenaV1(p: { masterId: string; corriere: any; body: any; packages: any[]; costoCorrente: number; numero: string; spedizioneId: string | null }) {
  const { masterId, corriere, body, packages, costoCorrente, numero } = p
  return { masterDirettoId: masterId, corriereOwnerId: corriere.master_id, costoSpedizione: costoCorrente, provincia: body.shipTo.state, packages, cap: body.shipTo.postalCode, paese: body.shipTo.country || 'IT', citta: body.shipTo.city, corriereNome: corriere.nome_contratto, contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0), mittCap: (body.shipFrom.postalCode || '').toString().trim(), mittProvincia: (body.shipFrom.state || '').toUpperCase().trim(), mittPaese: 'IT', numero, destNome: body.shipTo?.name || '', spedizioneId: p.spedizioneId, createdBy: null }
}
