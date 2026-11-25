import type { SupabaseClient } from '@supabase/supabase-js'
import { GIORNI_RICARICHE_DA_STORNARE, euro, type RicaricaDaStornare } from '@/lib/movimento-manuale'

// LO STORNO DI UNA RICARICA E LA SUA RIGA NEL CHECK RICARICHE (Lorenzo, 25/11/2026).
//
// Il Check Ricariche non conosce il movimento che ha fatto nascere la riga: la riga si scrive subito dopo il
// movimento (app/api/movimenti/crea, tracciaRicarica), con lo stesso master, lo stesso destinatario e lo stesso
// importo. Si ritrova cosi', cercandola a pochi minuti dal movimento.

export type RigaCheck = {
  id: string, importo: number, note: string | null, created_at: string,
  bonifico_effettuato_il: string | null, bonifico_arrivato_il: string | null, nascosta_il: string | null,
}

const MARGINE_MS = 2 * 60 * 1000

export async function rigaCheckDellaRicarica(admin: SupabaseClient, d: { masterId: string, targetId: string, importo: number, quando: string }): Promise<RigaCheck | null> {
  const t = new Date(d.quando).getTime()
  const { data, error } = await admin.from('ricariche_check')
    .select('id,importo,note,created_at,bonifico_effettuato_il,bonifico_arrivato_il,nascosta_il')
    .eq('master_id', d.masterId).eq('target_id', d.targetId).eq('importo', d.importo)
    .gte('created_at', new Date(t - MARGINE_MS).toISOString()).lte('created_at', new Date(t + MARGINE_MS).toISOString())
    .limit(10)
  if (error) throw new Error(error.message)
  const righe = (data || []) as RigaCheck[]
  righe.sort((a, b) => Math.abs(new Date(a.created_at).getTime() - t) - Math.abs(new Date(b.created_at).getTime() - t))
  return righe[0] || null
}

export function statoCheck(r: RigaCheck | null): string {
  if (!r) return 'non è nel Check Ricariche'
  if (r.nascosta_il) return 'già tolta dal Check Ricariche'
  if (r.bonifico_arrivato_il) return 'bonifico arrivato'
  if (r.bonifico_effettuato_il) return 'bonifico fatto, da confermare'
  return 'in attesa di bonifico'
}

// Le ultime ricariche fatte da questo master a questo destinatario (cliente o sotto-master). La lettura e' sempre
// ristretta ai movimenti scritti dal master di chi chiede: un destinatario sbagliato non mostra niente di altri.
export async function ricaricheDaStornare(admin: SupabaseClient, d: { masterId: string, clienteId?: string, sottoMasterId?: string }): Promise<(RicaricaDaStornare & { check: string })[]> {
  const dal = new Date(Date.now() - GIORNI_RICARICHE_DA_STORNARE * 86400000).toISOString()
  let q = admin.from('movimenti').select('id,created_at,importo,voce,descrizione')
    .eq('master_id', d.masterId).eq('tipo', 'ricarica').gt('importo', 0).is('spedizione_id', null)
    .or('voce.is.null,voce.in.(ricarica,fattura)').gte('created_at', dal)
  q = d.clienteId ? q.eq('cliente_id', d.clienteId) : q.eq('master_target_id', d.sottoMasterId!).is('cliente_id', null)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(5)
  if (error) throw new Error(error.message)
  const targetId = (d.clienteId || d.sottoMasterId)!
  return Promise.all(((data || []) as { id: string, created_at: string, importo: number, voce: string | null, descrizione: string | null }[]).map(async (m) => {
    const riga = await rigaCheckDellaRicarica(admin, { masterId: d.masterId, targetId, importo: Number(m.importo), quando: m.created_at })
    return { id: m.id, quando: m.created_at, importo: Number(m.importo), voce: m.voce, descrizione: m.descrizione, check: statoCheck(riga) }
  }))
}

// Dopo lo storno: la riga della ricarica esce dal Check Ricariche se il bonifico non e' arrivato (nascosta, non
// cancellata: resta con la nota), oppure si riduce se lo storno ne toglie solo una parte (500 € caricati invece di
// 50). Un bonifico gia' arrivato non si tocca: i soldi ci sono, la nota dice che la ricarica e' stata stornata.
// Best-effort come tracciaRicarica: lo storno e' gia' scritto e non deve fallire per il Check.
export async function chiudiRigaDellaRicarica(admin: SupabaseClient, d: {
  masterId: string, targetId: string, ricarica: { importo: number, quando: string }, storno: number, descrizione: string, userId: string,
}): Promise<string> {
  try {
    const riga = await rigaCheckDellaRicarica(admin, { masterId: d.masterId, targetId: d.targetId, importo: d.ricarica.importo, quando: d.ricarica.quando })
    if (!riga || riga.nascosta_il) return 'nessuna'
    const quando = new Date().toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
    const conNota = (n: string) => (riga.note ? `${riga.note} · ${n}` : n).slice(0, 500)
    const tolto = Math.abs(d.storno)
    let cambio: Record<string, unknown>
    let esito: string
    if (riga.bonifico_arrivato_il) {
      cambio = { note: conNota(`Stornata il ${quando} (${d.descrizione}): il bonifico risultava già arrivato`) }
      esito = 'nota'
    } else if (tolto >= Number(riga.importo) - 0.005) {
      cambio = { nascosta_il: new Date().toISOString(), nascosta_da: d.userId, note: conNota(`Stornata il ${quando}: ${d.descrizione}`) }
      esito = 'tolta'
    } else {
      const resta = Math.round((Number(riga.importo) - tolto) * 100) / 100
      cambio = { importo: resta, note: conNota(`Ridotta da ${euro(Number(riga.importo))} € a ${euro(resta)} € con lo storno del ${quando}`) }
      esito = 'ridotta'
    }
    // La riga si cambia solo se e' ancora com'era quando l'ho letta: un doppio invio non la riduce due volte.
    const { data, error } = await admin.from('ricariche_check').update(cambio)
      .eq('id', riga.id).eq('master_id', d.masterId).eq('importo', riga.importo).is('nascosta_il', null).select('id')
    if (error) throw new Error(error.message)
    return data && data.length ? esito : 'nessuna'
  } catch (e) {
    console.error('[ricariche-check] storno non riportato sul Check', e)
    return 'errore'
  }
}
