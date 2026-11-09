// ANNULLO DEI PACCHI GLS DIRETTI A PIU' GAMBE (contratto GLS condiviso fra reti, es. i GLS di Wave venduti a
// MULTIEXPRESS e QUICK). La LDV vera sta sulla gamba `tipo='gls'` del detentore; il cliente che spedisce ha
// una gamba-ponte (`tipo='moovexpress'`) con lo stesso tracking.
//
// Senza questa libreria la richiesta del cliente aspettava 48 ore e poi tornava indietro con "va gestito
// dall'assistenza", cliente addebitato; intanto la gamba GLS restava attiva e la chiusura di sera la
// trasmetteva a GLS. Il GLS diretto dal portale invece si annulla SUBITO (app/api/spedizioni/elimina): prima
// della chiusura la spedizione non e' ancora trasmessa e si toglie da GLS in sicurezza. Qui la stessa regola
// sul pacco intero: DeleteSped sulla gamba GLS, poi tutte le gambe annullate e stornate. Dopo la chiusura
// (distinta confermata) GLS consegna il pacco: non si annulla, e nessuno viene rimborsato.
//
// Un posto solo per tre porte: il portale (spedizioni/elimina), l'API (v1/shipments/[id] DELETE) e il giro
// delle 48 ore (annullamenti-cron) per le richieste rimaste in attesa.

import { risolviGambeSpedizione, type GambaSpedizione } from '@/lib/condivisione-catena'
import { annullaSpedizioneSulCorriere, annullaGambePacco } from '@/lib/annullaSpedizione'

// Le gambe del pacco, ma solo se e' davvero condiviso (piu' di una gamba) e la LDV vera e' GLS diretta.
// Una GLS di un solo livello resta sul percorso di sempre.
export async function gambePaccoGls(admin: any, tracking: string | null | undefined): Promise<GambaSpedizione[] | null> {
  if (!tracking) return null
  const gambe = await risolviGambeSpedizione(admin, String(tracking))
  return gambe.length > 1 && gambe.some(g => g.tipo === 'gls') ? gambe : null
}

export async function annullaPaccoGls(
  admin: any, gambe: GambaSpedizione[], rich: { da?: string | null },
): Promise<{ ok: true; gambe: number } | { ok: false; motivo: string }> {
  const gambaGls = gambe.find(g => g.tipo === 'gls')
  if (!gambaGls) return { ok: false, motivo: 'gamba GLS non trovata' }
  const { data: sped } = await admin.from('spedizioni')
    .select('id,corriere_id,raw_response,tracking_number,numero,distinta_id,stato').eq('id', gambaGls.spedizioneId).maybeSingle()
  if (!sped) return { ok: false, motivo: 'gamba GLS non trovata' }
  // "Trasmessa a GLS" = la sua distinta e' confermata_vettore (il flag vive sulla distinta): come il portale.
  if (sped.distinta_id) {
    const { data: dist } = await admin.from('distinte').select('confermata_vettore').eq('id', sped.distinta_id).maybeSingle()
    if (dist?.confermata_vettore) {
      return { ok: false, motivo: 'Spedizione GLS già trasmessa al corriere (distinta confermata): non è più annullabile in automatico. Va gestita direttamente col corriere.' }
    }
  }
  // DeleteSped con le credenziali della gamba GLS (lib/annullaSpedizione, ramo GLS).
  const esito = await annullaSpedizioneSulCorriere(admin, sped)
  if (!esito.ok) return { ok: false, motivo: esito.reason || 'GLS non ha confermato l\'annullo' }
  const r = await annullaGambePacco(admin, gambe, { richiestoAt: new Date().toISOString(), da: rich.da || null })
  return { ok: true, gambe: r.gambe }
}
