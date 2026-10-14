/* QUALI TARIFFE SI POSSONO DAVVERO OFFRIRE A UN CLIENTE, dopo che il motore le ha calcolate.
 *
 * Due cancelli che stavano scritti dentro la rotta del preventivo (app/api/spedizioni/tariffe):
 *   - "non vendere cio' che non possiedi": il contratto deve essere del master del cliente o di un
 *     suo antenato nella catena;
 *   - i contratti "a un punto" (PuntoPoste, Ufficio Postale, Fermopoint, Locker): richiedono di
 *     SCEGLIERE un punto, cosa che esiste solo nella creazione manuale.
 *
 * Sono stati SPOSTATI qui perche' ora li chiama anche l'anteprima dei prezzi di import e ordini dei
 * negozi (lib/anteprima-prezzi.ts). Se restavano nella rotta, l'anteprima avrebbe dovuto
 * riscriverli: e il giorno che nasce un nuovo tipo di contratto a punto e lo si aggiunge in un
 * posto solo, l'altra porta — proprio quella che sceglie da sola "il prezzo piu' basso" — comincia
 * a mandare pacchi a un punto che nessuno ha scelto.
 *
 * UNA SOLA DIFFERENZA rispetto a com'erano nella rotta: annotaPuntoPoste ora SOLLEVA se non riesce
 * a leggere i contratti (prima proseguiva senza mettere nessun flag). Chi mostra l'elenco a una
 * persona puo' catturare l'errore e mostrare tutto, come fa la rotta del preventivo; chi sceglie da
 * solo no: senza flag un PuntoPoste passerebbe per consegna a domicilio. */
import { pudoConfigDaVettore, spediamoproPudoCourier } from '@/lib/punti-poste'

// Marca le tariffe dei contratti "PuntoPoste" (PDB-P2H/P2TAB/P2UP) coi flag _deposito (il mittente
// sceglie dove depositare: Ufficio Postale/Punto Poste) e _consegna_punto (tipologia RTZ/FMP del punto
// di consegna, o assente per P2H a casa). Così il form sa cosa mostrare. Il vettore sta nelle
// credenziali (service_role): lookup via admin. Nessun segreto esce (solo i flag).
export async function annotaPuntoPoste(admin: any, risultati: any[]) {
  const ids = [...new Set(risultati.map((r: any) => r._corriere_id).filter(Boolean))]
  if (!ids.length) return
  const { data: corr, error } = await admin.from('corrieri').select('id,tipo,credenziali,settings').in('id', ids)
  // Il client non solleva da solo quando la lettura fallisce: torna `error` e nessun dato. Senza
  // questo controllo si usciva di qui con zero flag, cioe' "nessun contratto e' a un punto".
  if (error) throw new Error('lettura contratti a un punto: ' + error.message)
  const perId = new Map<string, any>((corr || []).map((c: any) => [c.id, c]))
  for (const r of risultati) {
    const c = perId.get(r._corriere_id); if (!c) continue
    const cred = c.credenziali || {}
    if (c.tipo === 'inpost' && (c.settings as any)?.consegna === 'locker') {
      // InPost LOCKER: consegna a un LOCKER/PUDO (non a domicilio). Flag distinto dal PuntoPoste perché
      // usa il SUO selettore (InpostLockerPicker) e la SUA ricerca punti. Il Domicilio InPost (stesso
      // tipo, senza consegna=locker) resta consegna a casa e NON mostra alcun punto.
      r._inpost_locker = true
    } else if (c.tipo === 'spediamopro') {
      // SpediamoPro: SOLO consegna a un punto (deliveryPudo), nessun deposito. _consegna_punto = il
      // corriere per la ricerca punti (brt/inpost/sda). Serve al form per mostrare il selettore-punto.
      const courier = spediamoproPudoCourier(cred.service_id)
      if (courier) r._consegna_punto = courier
      // Qui il codice di ritiro arriva al destinatario per email: il form la chiede prima di comprare
      // (il server ricontrolla, vedi il ramo spediamopro di /api/spedizioni/crea).
      if (courier) r._email_obbligatoria = true
    } else {
      const cfg = pudoConfigDaVettore(cred.vettore)
      if (cfg.deposito) r._deposito = true
      if (cfg.consegnaTipologia) r._consegna_punto = cfg.consegnaTipologia
    }
  }
}

// true = contratto che consegna (o deposita) a un PUNTO: fuori dalle porte che scelgono da sole.
// Vale solo DOPO annotaPuntoPoste.
export const eTariffaAUnPunto = (x: any): boolean => !!(x?._deposito || x?._consegna_punto || x?._inpost_locker)

// CONTRATTI CON FASCE A TAGLIA (piccola / media / grande) = LOCKER, per un dato listino cliente.
//
// Il prezzo a taglia e' del locker: un pacco consegnato a casa si prezza a peso. Serve perche'
// l'impostazione che dice "e' un locker" (settings.consegna = 'locker') c'e' solo sul contratto del
// DETENTORE: sulle copie dei sotto-master quel campo e' vuoto (verificato il 13/10/2026: vuoto su
// 17 dei 19 contratti di questo tipo, tutte le copie; fra queste "InPost Locker" nel listino di 264
// clienti di un solo master). annotaPuntoPoste quelle copie non le riconosce: passano per consegna
// a domicilio, e una porta che sceglie da sola "il prezzo piu' basso" puo' assegnare un locker a un
// ordine per cui nessuno ha scelto il locker.
// La usano l'anteprima dei prezzi (per non offrirli) e la tendina "Spedisci con" delle stesse
// pagine (per non proporli): un criterio solo, altrimenti la tendina propone un contratto che poi
// l'anteprima non offre mai.
export async function contrattiConFasceATaglia(db: any, listinoId: string): Promise<Set<string>> {
  const { data, error } = await db.from('listini_clienti_fasce')
    .select('corriere_id').eq('listino_id', listinoId).in('tipo', ['piccola', 'media', 'grande'])
  // Se non si riesce a sapere, NON si prosegue: per chi sceglie da solo "nel dubbio lo offro"
  // vorrebbe dire spedire a un locker.
  if (error) throw new Error('lettura fasce a taglia: ' + error.message)
  return new Set<string>((data || []).map((r: any) => r.corriere_id).filter(Boolean))
}

// GATE "non vendere ciò che non possiedi": tiene SOLO i corrieri che il master può davvero usare
// (suoi o di un ANTENATO nella catena) — lo stesso criterio che applica la creazione. Un listino
// che punta a corrieri fuori catena (es. copiati da un'altra rete) non deve proporli in lista per
// poi vederseli rifiutare con "Corriere non disponibile per questo master".
export async function soloCorrieriInCatena(admin: any, risultati: any[], masterIdCliente: string | null | undefined): Promise<any[]> {
  const ids = [...new Set(risultati.map((r: any) => r._corriere_id).filter(Boolean))]
  if (!ids.length || !masterIdCliente) return risultati
  const { data: corr } = await admin.from('corrieri').select('id,master_id').in('id', ids)
  const masterDiCorr = new Map((corr || []).map((c: any) => [c.id, c.master_id]))
  const catena = new Set<string>()
  let cur: string | null = masterIdCliente
  for (let i = 0; i < 20 && cur; i++) {
    catena.add(cur)
    const { data: mm }: any = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    cur = mm?.parent_master_id || null
  }
  return risultati.filter((r: any) => {
    if (!r._corriere_id) return true            // senza id non si può verificare: si lascia (raro)
    const mid = masterDiCorr.get(r._corriere_id)
    return !!mid && catena.has(mid as string)
  })
}
