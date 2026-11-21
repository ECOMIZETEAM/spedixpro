import { erroreCorrierePulito } from '@/lib/errore-corriere'
import { modalitaCodPoste, type ModalitaCod } from '@/lib/contrassegno-modalita'

// IL RAMO POSTE DI /api/v1/shipments (KSync), spostato qui senza cambiarlo (fase 3 di PONTE-UNICO.md).
// Lo usano la rotta, come prima, e il ponte unico dei condivisi, che compra la LDV nello stesso processo invece di
// arrivarci con due richieste HTTP in fila: una regola sola per tutte e due le strade.
//
// Il blocco e' quello della rotta riga per riga. Cambiano solo le uscite: dove la rotta rispondeva con errore(...)
// (che stornava la prenotazione) qui si restituisce { errore }, e lo storno lo fa chi chiama; i valori che la rotta
// assegnava alle sue variabili qui si restituiscono.
export type EsitoLdvPoste =
  | { errore: string }
  | { numero: string; costoCorrente: number; codModeUsata: ModalitaCod | null; etichettaUrl: string | null; raw: any }

// La modalita' del contrassegno che va a Poste (null senza contrassegno). Sta fuori da ldvPosteV1 perche' il
// ponte unico la deve conoscere prima di comprare la LDV: e' scritta nelle righe di ogni livello.
export function modalitaCodPosteV1(corriere: any, body: any): ModalitaCod | null {
  const settingsPo = (corriere as any)?.settings || {}
  return Number(body.codValue || 0) > 0 ? modalitaCodPoste(body.incassoModalita, settingsPo.modalita_pagamento_cod) : null
}

export async function ldvPosteV1(p: {
  corriere: any; cred: any; body: any; packages: any[]
  conPresso: (via: string, presso: string) => string; pressoFrom: string; pressoTo: string
}): Promise<EsitoLdvPoste> {
  const { corriere, cred, body, packages, conPresso, pressoFrom, pressoTo } = p
  let numero = '', costoCorrente = 0, etichettaUrl: string | null = null, raw: any = null
  let codModeUsata: ModalitaCod | null = null
  // POSTE Delivery Business diretto via KSync/ParcelPilot: diretto (costoCorrente=0). Il prodotto è nel
  // `product` (settings). Etichetta dal downloadURL. Niente annullo via API (come gli altri Poste).
  const settingsPo = (corriere as any)?.settings || {}
  // wsUtente/wsPassword: con questi la lettera si crea direttamente sul web service di KSync (lib/ksync).
  const credPo = { clientId: cred.clientId, secretId: cred.secretId, costCenterCode: cred.costCenterCode || settingsPo.cost_center_code, ambiente: (cred.ambiente === 'demo' ? 'demo' : 'prod') as 'prod' | 'demo', baseUrl: cred.baseUrl, scope: cred.scope, wsUtente: cred.wsUtente, wsPassword: cred.wsPassword, wsHost: cred.wsHost }
  const productPo = String(settingsPo.product || '').trim()
  if (!productPo) return { errore: 'Contratto non configurato correttamente' }
  try {
    const { creaKsync, etichettaKsync } = await import('@/lib/ksync')
    // Contanti, assegno bancario o circolare: lo sceglie chi spedisce (lib/contrassegno-modalita).
    codModeUsata = modalitaCodPosteV1(corriere, body)
    const risPo = await creaKsync(credPo, {
      product: productPo,
      clientReferenceId: (body.rifOrdine ? String(body.rifOrdine) : '').trim() || undefined,
      contenuto: body.contenuto ? String(body.contenuto) : undefined,
      note: body.notes ? String(body.notes) : undefined,
      mittente: { ragioneSociale: body.shipFrom.name, indirizzo: conPresso(body.shipFrom.street1 || '', pressoFrom), citta: body.shipFrom.city, cap: body.shipFrom.postalCode, provincia: body.shipFrom.state, paese: 'IT', telefono: body.shipFrom.phone || undefined, email: body.shipFrom.email || undefined },
      destinatario: { ragioneSociale: body.shipTo.name, indirizzo: conPresso(body.shipTo.street1 || '', pressoTo), citta: body.shipTo.city, cap: body.shipTo.postalCode, provincia: body.shipTo.state, paese: body.shipTo.country || 'IT', telefono: body.shipTo.phone || undefined, email: body.shipTo.email || undefined },
      colli: packages.map((p: any) => ({ altezza: parseFloat(p?.height) || undefined, larghezza: parseFloat(p?.width) || undefined, profondita: parseFloat(p?.length) || undefined, peso: parseFloat(p?.weight) || 1 })),
      contrassegno: body.codValue ? Number(body.codValue) : undefined,
      codiceContrassegno: settingsPo.codice_contrassegno ? String(settingsPo.codice_contrassegno) : undefined,
      modalitaPagamentoCod: codModeUsata || undefined,
      assicurata: body.insuranceValue ? Number(body.insuranceValue) : undefined,
      codiceAssicurazione: settingsPo.codice_assicurazione ? String(settingsPo.codice_assicurazione) : undefined,
    })
    numero = risPo.ldv
    costoCorrente = 0
    // KSync diretto manda l'etichetta nella risposta; col ponte si scarica dal downloadURL.
    try { const lab = risPo.pdf?.length ? { bytes: risPo.pdf } : await etichettaKsync(credPo, risPo.downloadUrl, 'pdf'); if (lab.bytes?.length) etichettaUrl = `data:application/pdf;base64,${lab.bytes.toString('base64')}` } catch (e) { console.error('[V1][POSTE] etichetta:', (e as any)?.message) }
    raw = { _ksync: true, ldv: numero, downloadUrl: risPo.downloadUrl, ambiente: credPo.ambiente, ...(risPo.raw?.diretto ? { diretto: true, uuid: risPo.raw.uuid } : {}) }
  } catch (e: any) {
    console.error('[V1][POSTE]', e?.message)
    return { errore: erroreCorrierePulito(e?.message) }
  }
  return { numero, costoCorrente, codModeUsata, etichettaUrl, raw }
}
