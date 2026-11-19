/* CON QUALE CITTA' SI PREZZA UNA SPEDIZIONE.
 *
 * Le zone speciali (disagiate, isole) nel database sono scritte col nome UFFICIALE del comune. Se
 * la citta' della spedizione e' un'altra scrittura ("Aprigliano cs" per "Aprigliano"), la riga
 * speciale non aggancia e la destinazione cade sul jolly "Italia": venduta a prezzo di pianura,
 * pagata a prezzo di zona disagiata.
 *
 * Questa decisione stava scritta dentro la creazione del portale (app/api/spedizioni/crea) e, in
 * una copia sua, nell'API pubblica (app/api/v1/shipments: blocca sempre, non normalizza mai). Il
 * preventivo non la faceva: per lo stesso ordine prezzava con la citta' grezza, la creazione con
 * quella corretta. Caso vero del 13/10/2026, import da file, CAP 87051: calcolato 6,12 prima di
 * spedire, addebitato 13,65. Il cliente pagava un prezzo che nessuno gli aveva mostrato.
 *
 * Ora la decisione sta qui, e la chiamano la creazione del portale, l'API pubblica e l'anteprima
 * dei prezzi: chi la modifica cambia TUTTE E TRE, ed e' il punto — un prezzo mostrato e uno
 * addebitato che partono da due citta' diverse non possono coincidere.
 *
 * SI GUARDA IL CONTRATTO, NON UN ELENCO GLOBALE (4/11/2026). Fino a oggi "questo CAP ha una zona
 * speciale" lo diceva un elenco di tutti i CAP speciali di tutti i contratti, tenuto in memoria e
 * caricato a meta' (13/10/2026: 1.223 CAP su 1.868). Sui CAP rimasti fuori la citta' scritta male
 * passava senza controllo: 026104010032483, "CALAGONONE -DORGALI-" sul 08022, zona "LOCALITA
 * DISAGIATE" che nomina CALA GONONE, partita su BRT a 5,11 come destinazione normale. E sui CAP
 * dentro l'elenco si fermava anche chi spediva con un contratto che su quel CAP non ha niente di
 * speciale, dove la citta' non cambia il prezzo.
 * La domanda giusta e' quella che si fa il motore dei prezzi: PER IL CONTRATTO CON CUI SI SPEDISCE
 * (e per quelli da cui lo si compra, che prezzano il costo con la stessa citta'), su questo CAP ci
 * sono righe che valgono solo per un comune nominato, e la citta' scritta non e' nessuno di loro?
 * Se si', e la citta' non e' nemmeno un nome vero per quel CAP, la scrittura sbagliata cambierebbe
 * il prezzo: ci si ferma (o, dall'import, si corregge). Misurato sui 30 giorni fino al 4/11/2026:
 * 16 spedizioni in piu' fermate, fra cui quella di Cala Gonone e due col CAP di un'altra provincia
 * ("Ciampino" su 70020, "Pisticci Scalo" su 24030).
 *
 * LE FRAZIONI SCRITTE GIUSTE PASSANO, come prima. "Castelnuovo Vomano" e' una frazione vera del
 * 64020 anche se la zona disagiata nomina solo il comune, Castellalto: se il corriere la tratta da
 * disagiata va aggiunta alla zona, e lo si decide col preventivo del corriere, non indovinando qui.
 * Sulle frazioni di comuni disagiati che BRT ci ha quotato, il supplemento era zero. */
import { validaCittaCap, normalizzaCittaUfficiale, normCitta, localitaItalianaFuoriPaese } from '@/lib/valida-citta'
import { filtraCapCondiviso } from '@/lib/zone-match'
import { PAESI_MONDO } from '@/lib/paesi-elenco'
import { normalizzaPaese } from '@/lib/paesi'

// Indirizzo italiano col paese di un altro (regola e caso vero in lib/valida-citta.ts). Esportata
// perche' la usano anche chi non passa da cittaPerLaSpedizione: il preventivo del portale, cosi' il
// prezzo per la Romania non compare nemmeno, e l'API pubblica, che ha la sua creazione.
export function erroreIndirizzoItaliano(p: { cap: unknown; citta: unknown; paese?: unknown }): string | null {
  const paese = normalizzaPaese(p.paese)
  const loc = localitaItalianaFuoriPaese(String(p.cap ?? ''), String(p.citta ?? ''), paese)
  if (!loc) return null
  const nome = PAESI_MONDO.find(x => x.code === paese)?.nome || paese
  return `${String(p.cap).trim()} ${loc} è in Italia, ma come paese è scelto ${nome}: se il pacco va in Italia scegli Italia come paese, altrimenti correggi città e CAP.`
}

export type EsitoCitta =
  // `normalizzata` = la citta' e' stata SOSTITUITA col nome ufficiale; altrimenti e' quella ricevuta,
  // intatta (spazi compresi: non si ritocca cio' che non serve ritoccare).
  | { ok: true; citta: string; normalizzata: boolean }
  // `suggeriti` = i nomi giusti per quel CAP, per chi deve scrivere il proprio messaggio (l'API).
  | { ok: false; errore: string; suggeriti: string[] }

type RigaZona = { zona_id: string; paese: string | null; cap: string | null; citta: string | null }

const specifica = (r: RigaZona) => !!r.citta && r.citta !== '*'

// Per il contratto e per quelli a monte: i comuni nominati dalle righe a CAP esatto che la citta'
// scritta NON aggancia. Stessa regola del motore (filtraCapCondiviso in lib/zone-match.ts), contratto
// per contratto, perche' il motore applica i suoi criteri separatamente per ognuno.
// SOLO IL CAP ESATTO, NON LA PROVINCIA. Una riga "VE / * / BURANO" vale per tutta la provincia, e
// contarla avrebbe fermato ogni citta' storta del veneziano: rieseguendo sui 30 giorni fino al
// 4/11/2026 erano 10 fermi su 27, tutti inutili ("Scaltenigo di Mirano" sul 30035, "Oriago di Mira",
// "brondolo di chioggia"), perche' su quei CAP la citta' non cambia il prezzo.
async function comuniCheLaCittaNonAggancia(
  admin: any,
  p: { corriereId: string; cap: string; citta: string },
): Promise<string[]> {
  // La fila del contratto: lui e quelli da cui lo compra (corrieri.fornitore_corriere_id), fino al
  // detentore — la stessa che legge catena_contratto nel database. Qui con letture semplici e non con
  // la funzione, perche' l'anteprima passa un client di sola lettura che le funzioni non le chiama
  // (lib/db-memoria.ts). Una lettura fallita non deve far passare tutto: si guarda quello che si ha.
  const contratti: string[] = []
  for (let cur: string | null = p.corriereId; cur && !contratti.includes(cur) && contratti.length < 25;) {
    contratti.push(cur)
    const { data: c, error }: { data: any; error: any } = await admin.from('corrieri').select('id,fornitore_corriere_id').eq('id', cur).maybeSingle()
    if (error) { console.error('[CITTA] fila del contratto non leggibile oltre', cur, error.message); break }
    cur = c?.fornitore_corriere_id || null
  }

  const { data: zone, error: eZone } = await admin.from('zone').select('id,corriere_id').in('corriere_id', contratti)
  if (eZone) throw new Error('lettura delle zone del contratto: ' + (eZone.message || eZone.code))
  if (!zone?.length) return []
  const corrierePer = new Map<string, string>(zone.map((z: any) => [z.id, z.corriere_id]))

  const { data: righe, error: eRighe } = await admin.from('zone_cap')
    .select('zona_id,paese,cap,citta').in('zona_id', [...corrierePer.keys()]).eq('cap', p.cap)
  if (eRighe) throw new Error('lettura delle righe di zona: ' + (eRighe.message || eRighe.code))

  const perContratto = new Map<string, RigaZona[]>()
  for (const r of (righe || []) as RigaZona[]) {
    if ((r.paese || 'IT').toUpperCase() !== 'IT') continue
    const k = corrierePer.get(r.zona_id) as string
    if (!perContratto.has(k)) perContratto.set(k, [])
    perContratto.get(k)!.push(r)
  }

  const mancati = new Set<string>()
  for (const capEsatte of perContratto.values()) {
    if (!capEsatte.some(specifica)) continue
    // Le righe che nominano un comune valgono solo per lui: se dopo il filtro il CAP non e' piu'
    // rivendicato da nessuna riga, e' la citta' scritta ad averlo fatto cadere sul jolly.
    const restano = filtraCapCondiviso(capEsatte, p.cap, p.citta)
    if (!restano.some((r) => r.cap === p.cap)) for (const r of capEsatte) if (specifica(r)) mancati.add(r.citta as string)
  }
  return [...mancati]
}

export async function cittaPerLaSpedizione(p: {
  admin: any
  // Il contratto con cui si spedisce: e' sulle SUE zone (e su quelle a monte) che la citta' conta.
  corriereId: string
  cap: string | null | undefined
  citta: string | null | undefined
  paese?: string | null
  // IMPORT (file o negozio): la citta' non l'ha scritta a mano chi spedisce e non la puo'
  // "selezionare dall'elenco" → dove non c'e' ambiguita' la si corregge da soli.
  // Inserimento manuale: non si corregge mai, si chiede a chi scrive di sistemarla.
  daImport: boolean
}): Promise<EsitoCitta> {
  // Prima di tutto il paese: un indirizzo italiano non si prezza ne' si spedisce come estero.
  const fuoriPaese = erroreIndirizzoItaliano(p)
  if (fuoriPaese) return { ok: false, errore: fuoriPaese, suggeriti: [] }
  const vc = validaCittaCap(p.cap, p.citta, p.paese)
  // Una citta' che e' un nome vero per quel CAP (comune o frazione dell'archivio) non si tocca, e il
  // database non si legge nemmeno: e' il caso di quasi tutte le spedizioni.
  if (!vc.validabile || vc.ok) return { ok: true, citta: p.citta as string, normalizzata: false }

  const cap = String(p.cap).trim()
  const nonAgganciati = await comuniCheLaCittaNonAggancia(p.admin, { corriereId: p.corriereId, cap, citta: String(p.citta) })
  // Su questo contratto la citta' non cambia il prezzo: un nome storto qui non costa niente a nessuno.
  if (!nonAgganciati.length) return { ok: true, citta: p.citta as string, normalizzata: false }

  // Si NORMALIZZA al nome ufficiale quando il CAP e' di UN SOLO comune (senza ambiguita'). Se il CAP
  // e' condiviso e la citta' non combacia con nessuno, non si puo' decidere → ci si ferma.
  const norm = p.daImport ? normalizzaCittaUfficiale(p.cap, p.citta, p.paese) : null
  if (norm) return { ok: true, citta: norm, normalizzata: true }

  // I nomi da proporre: quelli dell'archivio per quel CAP, poi le localita' che la zona nomina e che
  // l'archivio non ha (senza, chi scrive "Cala Gonone" non saprebbe che e' la scrittura attesa).
  // Prima quelli che somigliano a cio' che e' stato scritto: a chi ha scritto "Serrapetrona caccamo"
  // serve vedere Serrapetrona, non i primi otto comuni del 62020 in ordine alfabetico.
  const visti = new Set<string>(), suggeriti: string[] = []
  for (const n of [...vc.noti, ...nonAgganciati]) {
    const k = normCitta(n)
    if (!k || visti.has(k)) continue
    visti.add(k); suggeriti.push(n)
  }
  const scritta = normCitta(String(p.citta))
  const vicinanza = (n: string) => {
    const k = normCitta(n)
    if (scritta.includes(k) || k.includes(scritta)) return 0
    return k.slice(0, 4) === scritta.slice(0, 4) ? 1 : 2
  }
  suggeriti.sort((a, b) => vicinanza(a) - vicinanza(b))
  const elenco = suggeriti.slice(0, 8).join(', ')
  return {
    ok: false,
    suggeriti,
    errore: `Città "${String(p.citta).trim()}" non riconosciuta per il CAP ${cap}. Selezionala dall'elenco o scrivila correttamente${elenco ? ` (per questo CAP: ${elenco})` : ''}. È una zona con tariffa speciale: un nome errato la farebbe prezzare come destinazione normale.`,
  }
}
