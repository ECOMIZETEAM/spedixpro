/* I SUPPLEMENTI DEL CORRIERE: fuori misura, incompatibile, fuori sagoma, non sovrapponibile, fuori dimensione.
 *
 * Non sono servizi. Un servizio (contrassegno, assicurazione, Priority, 10:30) ha un codice che va al
 * corriere in creazione, e il prezzo si sa prima di partire. Questi no: nessuno li sceglie, li mette il
 * corriere in fattura DOPO, quando misura il pacco (BRT li scrive con una sigla: "F" fuori misura, "i" colli
 * incompatibili con lo smistamento automatico, come buste e sacchi).
 * Per questo stanno nella sezione Giacenze del listino — dove ci sono già le voci che arrivano dopo — ma
 * con un tipo loro: le righe 'giacenza' le leggono lo svincolo, il reso e il Check Sotto Costo come
 * operazioni di giacenza, e un "Fuori misura" letto lì diventerebbe un'operazione che non esiste.
 *
 * Un listino che non ha il prezzo di una voce non la addebita: niente prezzo = Niente (Lorenzo, 28/10).
 * Niente database qui: la usano gli editor nel browser e le rotte sul server. */

export const TIPO_SUPPLEMENTO_CORRIERE = 'supplemento_corriere'

export const VOCI_SUPPLEMENTO_CORRIERE = ['Fuori misura', 'Incompatibile', 'Fuori sagoma', 'Non sovrapponibile', 'Fuori dimensione'] as const

// Per ora solo la famiglia di BRT EXPRESS W di Wave (Lorenzo, 29/10): il detentore e le sue copie ai
// sotto-master, riconosciute dal contratto_id. Allargarla vuol dire aggiungere qui il detentore.
const CONTRATTI_CON_SUPPLEMENTI = new Set(['653f5891-d537-40ce-b1fe-40e878254ee5'])

export const famigliaConSupplementi = (contrattoId: string | null | undefined) => !!contrattoId && CONTRATTI_CON_SUPPLEMENTI.has(contrattoId)

// Il contratto_id non è leggibile dalla sessione dell'utente (grant per colonna su corrieri): lo legge il
// server col client di servizio.
export async function corriereConSupplementi(admin: any, corriereId: string | null | undefined): Promise<boolean> {
  if (!corriereId) return false
  const { data } = await admin.from('corrieri').select('id,contratto_id').eq('id', corriereId).maybeSingle()
  return famigliaConSupplementi(data?.contratto_id || data?.id)
}

export type VoceSupplemento = { nome: string; prezzo: number }

// Le quattro voci sempre nello stesso ordine, col prezzo salvato se c'è. Con righe doppie vince la
// prima che arriva: chi legge per addebitare le chiede ordinate per id, come per le giacenze.
export function vociSupplementoDa(righe: any[]): VoceSupplemento[] {
  const prezzi = new Map<string, number>()
  for (const r of (righe || []).filter(r => r?.tipo === TIPO_SUPPLEMENTO_CORRIERE)) {
    const k = String(r.nome || '').toLowerCase().trim()
    if (!prezzi.has(k)) prezzi.set(k, Number(r.valore) || 0)
  }
  return VOCI_SUPPLEMENTO_CORRIERE.map(nome => ({ nome, prezzo: prezzi.get(nome.toLowerCase()) || 0 }))
}

// Le righe da salvare: solo le voci col prezzo. Vuota o zero = Niente, e una riga a zero non serve a
// nessuno (direbbe "gratis" dove il senso è "non si addebita").
export function righeSupplementoCorriere(voci: VoceSupplemento[] | undefined, base: Record<string, any>) {
  const nomiValidi = new Set<string>(VOCI_SUPPLEMENTO_CORRIERE)
  return (voci || [])
    .filter(v => nomiValidi.has(v?.nome) && Number(v.prezzo) > 0)
    .map(v => ({ ...base, tipo: TIPO_SUPPLEMENTO_CORRIERE, nome: v.nome, valore: Math.round(Number(v.prezzo) * 100) / 100, tipo_calcolo: 'fisso' }))
}

// Il prezzo di ogni voce nel listino, per nome minuscolo: lo usa il controllo della fattura.
export function prezziSupplementoDa(righe: any[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const v of vociSupplementoDa(righe)) if (v.prezzo > 0) out.set(v.nome.toLowerCase(), v.prezzo)
  return out
}
