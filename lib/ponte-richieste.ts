// IL REGISTRO DELLE RICHIESTE DEL PONTE, lato venditore (tabella ponte_richieste).
//
// Quando il compratore non riceve la risposta (il venditore ci mette troppo, muore con un 504, la rete cade),
// non sa se la spedizione e' nata. Prima la dava per non nata: il credito tornava al cliente e la LDV restava
// addebitata alle gambe sotto (19 LDV SDA EXPRESS L dal 2 al 9/11/2026). Ora ogni richiesta del ponte porta un
// codice (lib/moovexpress, PONTE_HDR_RICHIESTA), e qui il venditore scrive com'e' finita, cosi' il compratore
// glielo puo' chiedere (GET /api/v1/shipments?richiesta=<codice>).
//
// 'fatta' si scrive solo a risposta pronta, dopo gli addebiti: se il venditore muore a meta' la richiesta resta
// 'in_corso' e il compratore non la adotta. Una gamba nata senza la spedizione sopra la chiude la sentinella
// (lib/ponte-orfane).
// Tutto best-effort: se il registro non si scrive la spedizione va avanti come prima. Al compratore la
// richiesta risulta 'assente', e la tratta come incerta, non come non creata.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type RegistroPonte = { codice: string | null; aperta: boolean }

export function codiceRichiestaValido(v: string | null | undefined): string | null {
  const c = String(v || '').trim()
  return UUID.test(c) ? c.toLowerCase() : null
}

// Apre la richiesta. 'doppia' = lo stesso codice e' gia' arrivato: la seconda non deve creare un'altra spedizione.
export async function apriRichiestaPonte(admin: any, codice: string, clienteId: string): Promise<'aperta' | 'doppia' | 'errore'> {
  const { error } = await admin.from('ponte_richieste').insert({ codice, cliente_id: clienteId, stato: 'in_corso' })
  if (!error) return 'aperta'
  if (String((error as any).code) === '23505') return 'doppia'
  console.error('[PONTE][REGISTRO] apertura', codice, error.message)
  return 'errore'
}

// Chiude la richiesta con la risposta che sta per partire. Con 200 e numero = 'fatta' (la risposta si tiene
// intera: e' quella che il compratore adotta), altrimenti 'fallita' con il messaggio.
export async function chiudiRichiestaPonte(admin: any, codice: string, res: Response): Promise<void> {
  try {
    const j: any = await res.clone().json().catch(() => ({}))
    const fatta = res.status === 200 && !!j?.tracking
    const { error } = await admin.from('ponte_richieste').update({
      stato: fatta ? 'fatta' : 'fallita',
      spedizione_id: fatta && j.id ? j.id : null,
      risposta: fatta ? j : { status: res.status, error: j?.error || null },
      chiusa_il: new Date().toISOString(),
    }).eq('codice', codice).eq('stato', 'in_corso')
    if (error) console.error('[PONTE][REGISTRO] chiusura', codice, error.message)
  } catch (e: any) { console.error('[PONTE][REGISTRO] chiusura', codice, e?.message) }
}

// Com'e' finita una richiesta, solo per il cliente che l'ha fatta (la chiave del collegamento).
export async function leggiRichiestaPonte(admin: any, codice: string, clienteId: string): Promise<{ stato: string; risposta: any } | null> {
  const { data, error } = await admin.from('ponte_richieste').select('stato,risposta')
    .eq('codice', codice).eq('cliente_id', clienteId).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? { stato: data.stato, risposta: data.stato === 'in_corso' ? null : data.risposta } : null
}
