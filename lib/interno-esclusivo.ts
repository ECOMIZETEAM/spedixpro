import { calcolaPrezzoListino } from '@/lib/pricing'

// INTERNO ESCLUSIVO (impostazione per-cliente `impostazioni.interno_esclusivo`).
//
// Quando è attivo e la destinazione è COPERTA dal circuito interno del master del cliente, per quella
// destinazione si può spedire SOLO col circuito interno: BRT/Poste/DVA/… non devono essere né mostrati
// (lo fa il motore tariffe) né usabili in creazione (lo fa questa guardia, la porta da cui passano tutte
// le spedizioni: portale master, portale cliente, API v1). "Coperta" = il corriere interno del master è
// ABILITATO per il cliente e ha una fascia a listino per quella destinazione (esattamente ciò che lo fa
// comparire tra le tariffe): se l'interno non copre quel comune, la regola non scatta e restano tutti.
//
// Ritorna true se la spedizione VIOLA la regola (interno esclusivo attivo, destinazione coperta
// dall'interno, ma il corriere scelto NON è l'interno) → il chiamante blocca. Solo Italia: il circuito
// interno è nazionale. Best-effort: su qualsiasi dubbio (niente cliente/listino/interno) NON blocca.
export async function internoEsclusivoViola(
  admin: any,
  params: {
    cliente: { master_id?: string | null; listino_cliente_id?: string | null; impostazioni?: any } | null
    corriereSceltoTipo?: string | null
    provincia: string
    cap: string
    citta?: string
    paese?: string
    packages: any[]
  }
): Promise<boolean> {
  const c = params.cliente
  if (!c || c.impostazioni?.interno_esclusivo !== true) return false
  // Sta già usando l'interno → nessuna violazione.
  if (String(params.corriereSceltoTipo || '').toLowerCase() === 'interno') return false
  // Il circuito interno è nazionale: sull'estero la regola non si applica.
  if (String(params.paese || 'IT').toUpperCase() !== 'IT') return false
  if (!c.listino_cliente_id || !c.master_id) return false

  // Corrieri interni del master del cliente (di norma uno).
  const { data: interni } = await admin.from('corrieri')
    .select('id').eq('master_id', c.master_id).eq('tipo', 'interno').eq('attivo', true)
  if (!interni?.length) return false

  // Interni DISABILITATI per QUESTO cliente (listini_clienti_corrieri.abilitato=false): non contano —
  // se il master ha spento l'interno al cliente, non lo si può obbligare a usarlo (bloccherebbe tutto).
  const { data: abil } = await admin.from('listini_clienti_corrieri')
    .select('corriere_id,abilitato').eq('listino_id', c.listino_cliente_id)
    .in('corriere_id', interni.map((x: any) => x.id))
  const disabil = new Set((abil || []).filter((a: any) => a.abilitato === false).map((a: any) => a.corriere_id))

  for (const it of interni) {
    if (disabil.has(it.id)) continue
    const ris = await calcolaPrezzoListino(admin, {
      listinoId: c.listino_cliente_id, corriereId: it.id,
      provincia: params.provincia, cap: params.cap, paese: 'IT', citta: params.citta, packages: params.packages,
    })
    if (ris) return true   // l'interno copre questa destinazione e si sta usando un altro corriere → viola
  }
  return false
}
