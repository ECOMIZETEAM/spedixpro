// IL RITIRO NELLE RISPOSTE DELL'API PUBBLICA (/api/v1).
//
// La creazione rispondeva ritiro:{richiesto:true} su QUALUNQUE contratto, ma il ritiro lo prenotava
// davvero solo sui contratti che lo portano dentro l'ordine (easyparcel, i "V"). Sugli altri non
// partiva niente: in 30 giorni 101 spedizioni con richiesto:true e nessuna prenotazione, 70 mai
// prenotate neanche dopo, pacchi rimasti dal mittente mentre chi integra credeva il contrario
// (19/10/2026). Le tre rotte (creazione, dettaglio, ritiri) leggono la regola da qui, cosi' non
// possono tornare a dire tre cose diverse.
//
// Chi integra parla solo con noi: nessun messaggio lo manda al portale o all'assistenza del corriere.

// Su quali contratti /api/v1/pickups sa prenotare un ritiro.
export function ritiroPrenotabileConPickups(tipo: string | null | undefined): boolean {
  return tipo === 'spediamopro' || tipo === 'spedisci'
}

// Cosa deve fare chi integra quando il ritiro chiesto alla creazione NON e' stato prenotato.
export function avvisoRitiroNonPrenotato(tipo: string | null | undefined): string {
  if (ritiroPrenotabileConPickups(tipo)) {
    return 'Su questo contratto il ritiro non si prenota insieme alla spedizione: richiedilo con POST /api/v1/pickups.'
  }
  return messaggioRitiroNonPrenotabileViaApi(tipo)
}

// Contratti su cui via API il ritiro non si prenota in nessun modo. Ponti di condivisione e Poste
// diretto si prenotano dalla sezione Ritiri del portale (che ha i rami che qui mancano); gli altri
// solo tramite l'assistenza.
export function messaggioRitiroNonPrenotabileViaApi(tipo: string | null | undefined): string {
  if (tipo === 'moovexpress' || tipo === 'poste') {
    return 'Su questo contratto il ritiro non si può prenotare via API: richiedilo dal portale (sezione Ritiri) oppure contatta l\'assistenza.'
  }
  return 'Su questo contratto il ritiro non si può prenotare via API: contatta l\'assistenza.'
}

// Il codice del corriere sui contratti "V" arriva quasi sempre DOPO la risposta di creazione
// (mediana ~15 minuti, lo scrive il giro del tracking): senza dirlo, codice:null sembrava un
// ritiro mancato.
export function avvisoCodiceInArrivo(spedizioneId: string | null | undefined): string {
  return `Ritiro prenotato. Il codice del corriere viene assegnato di solito entro pochi minuti: lo trovi in GET /api/v1/shipments/${spedizioneId || '{id}'}.`
}

export type RitiroApi = {
  richiesto: boolean
  data: string | null
  intervallo: string | null
  codice: string | null
  avviso?: string
}

// Il blocco `ritiro` come lo vede chi integra. `richiesto` vuol dire PRENOTATO, non "chiesto".
export function ritiroInRisposta(r: {
  prenotato: boolean
  data?: string | null
  intervallo?: string | null
  codice?: string | null
  tipo?: string | null
  spedizioneId?: string | null
}): RitiroApi {
  if (!r.prenotato) {
    return { richiesto: false, data: null, intervallo: null, codice: null, avviso: avvisoRitiroNonPrenotato(r.tipo) }
  }
  const codice = r.codice || null
  return {
    richiesto: true, data: r.data || null, intervallo: r.intervallo || null, codice,
    ...(codice ? {} : { avviso: avvisoCodiceInArrivo(r.spedizioneId) }),
  }
}
