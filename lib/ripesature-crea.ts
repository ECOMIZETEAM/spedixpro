import type { EsitoRipesatura } from '@/lib/ripesature-calcolo'

// CREA UNA RETTIFICA da una ripesatura gia' calcolata, per il master DETENTORE indicato.
//
// E' la stessa logica del ramo ripesature dell'upload file ([app/api/rettifiche/upload/route.ts]),
// ridotta a una spedizione sola, per il flusso CONTINUO (auto da OneTracking). Due guardie di soldi:
//  - SOLO RECUPERI: liv.differenza = dovuto - pagato; se <= 0 e' un rimborso, non si crea (vedi
//    [app/api/rettifiche/route.ts]).
//  - ANTI-DOPPIO PER SPEDIZIONE (non per rif_fornitore): cosi' una rettifica creata da OneTracking
//    non si duplica quando poi si carica il file ufficiale di E&A (id fornitore diversi). Un solo
//    rettifica per spedizione, confermata o in attesa.
export type EsitoCrea = { creata: boolean; rettificaId?: string; recupero?: number; motivo?: string }

export async function creaRettificaDaEsito(
  admin: any, masterId: string, esito: EsitoRipesatura
): Promise<EsitoCrea> {
  if (!esito.trovata || !esito.spedizioneId) return { creata: false, motivo: 'spedizione non trovata' }

  const cat = esito.catenaDalBasso || []
  const mio = cat.indexOf(masterId)
  // "non sono nella catena" (idx -1) o catena interrotta: non si scrive, altrimenti cadrebbe sul
  // cliente finale di un ramo che non e' mio (vedi la guardia gemella nell'upload).
  if (mio < 0 || esito.catenaCompleta === false) return { creata: false, motivo: 'fuori catena' }
  const figlio = mio > 0 ? cat[mio - 1] : null
  const liv = figlio
    ? esito.livelli.find(l => l.masterId === figlio)
    : esito.livelli.find(l => l.clienteId)
  if (!liv || liv.differenza == null) return { creata: false, motivo: 'livello non calcolabile' }
  // SOLO RECUPERI: liv.differenza = dovuto - pagato. <= 0 (rimborso o zero) non diventa una riga.
  if (liv.differenza < 0.01) return { creata: false, motivo: 'nessun recupero' }

  // Anti-doppio per SPEDIZIONE: gia' rettificata (confermata o in attesa) da qualunque strada.
  const { data: gia } = await admin.from('rettifiche')
    .select('id').eq('spedizione_id', esito.spedizioneId)
    .or('confermata.eq.true,stato.eq.da_rettificare').limit(1)
  if (gia && gia.length) return { creata: false, motivo: 'gia rettificata' }

  const { data: ins, error } = await admin.from('rettifiche').insert({
    master_id: masterId, file_id: null,
    spedizione_id: esito.spedizioneId, numero_spedizione: esito.ldv,
    cliente_id: figlio ? null : liv.clienteId,
    target_master_id: figlio,
    peso_iniziale: esito.pesoRealePrima, peso_volume_iniziale: esito.pesoVolumePrima,
    peso_reale: esito.pesoDopo, peso_volume_reale: esito.pesoVolumeDopo || 0,
    costo_iniziale: liv.pagato, costo_finale: liv.dovuto,
    differenza: -liv.differenza,          // colonna "quanto restituisco": un addebito e' negativo
    stato: 'da_rettificare',
    rif_fornitore: esito.idOrdine,        // = la LDV (anti-doppione secondario, indice unico DB)
    colli_ripesati: esito.colli_ripesati || null,
  }).select('id').single()

  // 23505 = l'indice unico rif_fornitore ha respinto: gia' fatta, non e' un errore.
  if (error) return { creata: false, motivo: error.code === '23505' ? 'gia rettificata' : ('errore: ' + error.message) }
  return { creata: true, rettificaId: ins?.id, recupero: Math.round(liv.differenza * 100) / 100 }
}
