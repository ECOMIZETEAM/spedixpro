import { vettoreFisico } from '@/lib/vettore'

// Prezzo che il MASTER addebita a chi gli chiede una POD (prova di consegna): un suo CLIENTE oppure,
// dal 04/11/2026, un MASTER che sta sotto di lui (decisione del committente: prima la POD chiesta da
// un master non la pagava nessuno — QUICK SRL a MULTIEXPRESS, 10 richieste in tre settimane).
// Regole in `pod_prezzi`, a PRIORITA' (dal piu' specifico al piu' generico), per chi chiede:
//   1) lui + contratto   2) lui + vettore   3) lui (tutti i corrieri)
//   4) contratto         5) vettore         6) predefinito
// "Lui" e' il cliente (`cliente_id`) o il master sotto (`sottomaster_id`); i livelli 4-6 sono le
// regole senza nessuno, che valgono per tutti. Le regole dei clienti e quelle dei master sono due
// listini separati (`destinatario`): un predefinito messo per i clienti non fa pagare i master.
//
// La chiave "contratto" e' `corriere_id`, cioe' un contratto DEL MASTER che incassa. Per il cliente
// combacia con quello della spedizione (il cliente spedisce sui contratti del suo master: verificato
// in prod). Per il master sotto no: la sua spedizione viaggia sulla SUA copia del contratto, che ha un
// id diverso ma lo stesso codice (`corrieri.contratto_id`, la fila di chi lo vende a chi): "SDA
// EXPRESS L" di QUICK e "SDA EXPRESS L" di MULTIEXPRESS. Quindi per il master il contratto si
// riconosce dal codice.
// Il VETTORE (23/09) e' quello FISICO — lib/vettore.ts — non la prima parola del nome: i contratti
// GLS/BRT diretti possono chiamarsi in tutt'altro modo (es. "PF CE LIGHT" di Quick e' GLS), e una
// regola "tutti i GLS" deve prenderli lo stesso. Copre anche i contratti che nasceranno domani.
// Nessuna regola applicabile => 0 (POD gratuita). Le regole disattivate non contano.
export async function risolviPrezzoPod(
  admin: any,
  p: { masterId: string; clienteId?: string | null; sottoMasterId?: string | null; corriereId?: string | null }
): Promise<number> {
  if (!p.masterId) return 0
  const perMaster = !!p.sottoMasterId
  const { data: regole, error } = await admin.from('pod_prezzi')
    .select('cliente_id,sottomaster_id,corriere_id,vettore,prezzo')
    .eq('master_id', p.masterId)
    .eq('destinatario', perMaster ? 'master' : 'cliente')
    .eq('attivo', true)
  // Un listino che non si legge NON vuol dire "gratuita": chi apre accetterebbe 0 €, la richiesta
  // verrebbe segnata come pagata e non si riaddebiterebbe piu'. Meglio fermarsi e far riprovare.
  if (error) throw new Error('Listino POD non leggibile: ' + error.message)
  if (!regole || !regole.length) return 0
  const campo = perMaster ? 'sottomaster_id' : 'cliente_id'
  const chi = (perMaster ? p.sottoMasterId : p.clienteId) || null
  const cor = p.corriereId || null

  // I contratti del master che incassa che valgono come "il contratto di questa spedizione".
  const contratti = new Set<string>(cor ? [cor] : [])
  if (perMaster && cor && regole.some((r: any) => r.corriere_id)) {
    const { data: c } = await admin.from('corrieri').select('contratto_id').eq('id', cor).maybeSingle()
    if (c?.contratto_id) {
      const { data: suoi } = await admin.from('corrieri').select('id')
        .eq('master_id', p.masterId).eq('contratto_id', c.contratto_id)
      for (const s of suoi || []) contratti.add(s.id)
    }
  }
  // Il vettore del contratto si legge SOLO se c'e' almeno una regola che lo usa: sulle reti che non
  // le usano questa funzione resta a una query sola (gira a ogni apertura di richiesta POD).
  let vet: string | null = null
  if (cor && regole.some((r: any) => r.vettore)) {
    const { data: c } = await admin.from('corrieri').select('tipo,nome_contratto').eq('id', cor).maybeSingle()
    if (c) vet = vettoreFisico(c as any)
  }
  // La prima regola che combacia, scendendo dalla piu' specifica, vince.
  const livelli: Array<(r: any) => boolean> = [
    r => !!chi && r[campo] === chi && !!r.corriere_id && contratti.has(r.corriere_id),
    r => !!chi && !!vet && r[campo] === chi && r.vettore === vet,
    r => !!chi && r[campo] === chi && r.corriere_id == null && r.vettore == null,
    r => r[campo] == null && !!r.corriere_id && contratti.has(r.corriere_id),
    r => !!vet && r[campo] == null && r.vettore === vet,
    r => r[campo] == null && r.corriere_id == null && r.vettore == null,
  ]
  for (const test of livelli) {
    const m = regole.find(test)
    if (m) return Number(m.prezzo) || 0
  }
  return 0
}

// Il master superiore VENDE il contratto di questa spedizione? Se no, la POD non gliela si chiede:
// e' un contratto del master sotto (o comprato da un altro), il superiore non ha il pacco ne' il
// rapporto col corriere, e un addebito finirebbe sul conto "proprio" del master sotto, che non e' un
// debito verso di lui. Decisione del committente, 04/11/2026 (es. QUICK su "BRT PF", contratto suo).
// Stesso contratto = stesso codice (`contratto_id`, la fila di chi lo vende a chi); senza codice, si
// ripiega sul nome, come fa l'inoltro dei ticket.
export async function superioreVendeContratto(admin: any, superioreId: string, corriereId: string | null): Promise<boolean> {
  if (!superioreId || !corriereId) return false
  const { data: c } = await admin.from('corrieri').select('contratto_id,nome_contratto').eq('id', corriereId).maybeSingle()
  if (!c) return false
  let q = admin.from('corrieri').select('id').eq('master_id', superioreId)
  q = c.contratto_id ? q.eq('contratto_id', c.contratto_id) : q.eq('nome_contratto', c.nome_contratto)
  const { data: suo } = await q.limit(1).maybeSingle()
  return !!suo
}
