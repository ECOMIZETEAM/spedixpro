import { createAdminSupabaseConMemoria } from '@/lib/supabase-admin'
import { calcolaRipesature } from '@/lib/ripesature-calcolo'
import { CAMPI_CARICA, primaDelMotore, ingressoMotore, decidiCarica } from '@/lib/network-carica'
import { daSistemareDaMotivo } from '@/lib/network-da-fare'

// ── QUANTO RECUPERI, PRIMA DI PREMERE «CARICA» ──
// Lorenzo, 16/11/2026: «quando arrivano, ci sia il valore che paga e il numero spedizioni, quelle che deve recuperare e
// il prezzo.. qualcosa che faccia subito capire». Fino a quel giorno il blocco in «Dal mio network» diceva solo
// «192 rettifiche · € 311,50»: quanto si sarebbe recuperato sotto si scopriva dopo «Carica», riga per riga. Ora appena
// una rettifica arriva (il livello di sopra la conferma) il portale fa lo stesso conto di «Carica» (lib/network-carica,
// decidiCarica: stessa regola) e lo scrive sulla riga, in rettifiche.perche.stima. «Carica» poi lo rifa' da capo: il
// listino del cliente nel frattempo puo' essere cambiato, ed e' quello del momento a fare la rettifica vera.
// Lo fanno il giro automatico (app/api/cron/stime-rettifiche, ogni 5 minuti) e l'apertura della pagina
// (app/api/network/stima), cosi' il numero c'e' anche se il master arriva prima del giro. Non muove soldi: e' una frase.
//   recupera  «Carica» creerebbe la rettifica per chi sta sotto: chiede = quanto (ripesatura + supplementi fissi)
//   uguale    sotto si paga uguale anche col collo rimisurato: resta al master, non c'e' niente da chiedere
//   ferma     non si puo' girare adesso (listino che non arriva al collo, misure mancanti…): motivo
//   propria   spedizione del master senza cliente: non c'e' nessuno sotto
export type StimaRicevuta = { il: string; esito: 'recupera' | 'uguale' | 'ferma' | 'propria'; chiede?: number; chi?: string | null; motivo?: string | null }

const a2 = (n: number) => Math.round(n * 100) / 100

// Le ricevute da decidere di un master senza stima, o con una stima piu' vecchia di `vecchiaOre` (il listino sotto puo'
// essere stato sistemato). Prima solo id e data della stima: le righe intere si leggono solo per quelle da rifare.
export async function righeDaStimare(admin: any, masterId: string, vecchiaOre = 24): Promise<{ senza: string[]; vecchie: string[] }> {
  const senza: string[] = [], vecchie: string[] = []
  const limite = Date.now() - vecchiaOre * 3600 * 1000
  for (let da = 0; ; da += 1000) {
    const { data, error } = await admin.from('rettifiche').select('id,stima_il:perche->stima->>il')
      .eq('target_master_id', masterId).neq('master_id', masterId).eq('confermata', true).is('propagazione', null)
      .order('id').range(da, da + 999)
    if (error) throw new Error('rettifiche da stimare: ' + error.message)
    for (const r of (data || []) as any[]) {
      if (!r.stima_il) senza.push(r.id)
      else if (Date.parse(r.stima_il) < limite) vecchie.push(r.id)
    }
    if (!data || data.length < 1000) break
  }
  return { senza, vecchie }
}

// Calcola e scrive la stima sulle righe indicate, a gruppi, finche' c'e' tempo (`finoA` = istante in ms). Torna quante.
export async function scriviStime(admin: any, ids: string[], finoA: number): Promise<number> {
  let fatte = 0
  const memo = createAdminSupabaseConMemoria()   // listini e zone una volta per giro, come «Carica»
  for (let i = 0; i < ids.length && Date.now() < finoA; i += 40) {
    const { data: righe, error } = await admin.from('rettifiche').select(CAMPI_CARICA + ',target_master_id,perche')
      .in('id', ids.slice(i, i + 40)).is('propagazione', null)
    if (error) throw new Error('rettifiche da stimare: ' + error.message)
    if (!righe?.length) continue
    // Le spedizioni del master stesso, senza cliente: sotto non c'e' nessuno (come in app/api/network/ricevuti).
    const spIds = [...new Set((righe as any[]).map(r => r.spedizione_id).filter(Boolean))]
    const proprie = new Set<string>()
    if (spIds.length) {
      const { data: ss } = await admin.from('spedizioni').select('id,cliente_id,master_id').in('id', spIds)
      for (const s of (ss || []) as any[]) if (s.cliente_id == null) proprie.add(s.id + '|' + s.master_id)
    }
    const il = new Date().toISOString()
    const stime = new Map<string, StimaRicevuta>()
    const daMotore: any[] = []
    for (const r of righe as any[]) {
      if (r.spedizione_id && proprie.has(r.spedizione_id + '|' + r.target_master_id)) { stime.set(r.id, { il, esito: 'propria' }); continue }
      const no = primaDelMotore(r)
      if (no) { stime.set(r.id, { il, esito: 'ferma', motivo: daSistemareDaMotivo(no).breve }); continue }
      daMotore.push(r)
    }
    const esiti = daMotore.length ? await calcolaRipesature(memo, daMotore.map(ingressoMotore)) : []
    daMotore.forEach((r, k) => {
      const d = decidiCarica(r, esiti[k], r.target_master_id)
      const chi = d.tipo === 'salta' ? d.extra.chi || null : String(d.liv.chi || '').trim() || null
      stime.set(r.id, d.tipo === 'figlia' ? { il, esito: 'recupera', chiede: a2(d.diffFiglia + d.fs), chi }
        : d.tipo === 'uguale' ? { il, esito: 'uguale', chi }
        : { il, esito: 'ferma', chi, motivo: daSistemareDaMotivo(d.perche, d.extra).breve })
    })
    // Riga per riga, e solo se e' ancora da decidere: un «Carica» arrivato nel frattempo ha la precedenza.
    for (const r of righe as any[]) {
      const s = stime.get(r.id); if (!s) continue
      const { error: e2 } = await admin.from('rettifiche').update({ perche: { ...(r.perche || {}), stima: s } }).eq('id', r.id).is('propagazione', null)
      if (e2) console.error('[STIMA] scrittura', r.numero_spedizione, e2.message); else fatte++
    }
  }
  return fatte
}
