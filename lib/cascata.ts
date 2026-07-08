import { calcolaPrezzoListino } from '@/lib/pricing'
import { registraMovimentoMaster } from '@/lib/movimenti'
import { createAdminSupabase } from '@/lib/supabase-admin'

export type LivelloCatena = {
  masterId: string
  nome: string
  tipoContratto: string
  credito: number
  prezzo: number
  isProprietario: boolean
}

async function costruisciCatena(
  supabase: any,
  params: {
    masterDirettoId: string
    corriereOwnerId: string
    costoSpedizione: number
    provincia: string
    packages: any[]
    cap?: string
    paese?: string
    // Nome contratto del corriere: i sotto-master rivendono con COPIE dello stesso corriere.
    // Serve per (1) trovare il proprietario REALE del contratto e (2) prezzare il corriere giusto.
    corriereNome?: string
  }
): Promise<{ catena: LivelloCatena[]; errore?: string }> {
  const catena: LivelloCatena[] = []
  let currentId: string | null = params.masterDirettoId
  // RLS: la catena e' cross-tenant per natura -> client admin (auth verificata a monte)
  const adminDb = createAdminSupabase()

  // Proprietario REALE del contratto: il master più IN ALTO che possiede questo stesso corriere
  // (stesso nome_contratto). Chi spedisce usa una COPIA del corriere, ma il costo reale dell'API
  // lo paga il proprietario del contratto; i livelli sotto pagano il loro prezzo di rivendita.
  let ownerReale = params.corriereOwnerId
  if (params.corriereNome) {
    let cur: string | null = params.corriereOwnerId
    for (let i = 0; i < 20 && cur; i++) {
      const { data: mm }: any = await adminDb.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
      const parent: string | null = mm?.parent_master_id || null
      if (!parent) break
      const { data: pc } = await adminDb.from('corrieri')
        .select('id').eq('master_id', parent).eq('nome_contratto', params.corriereNome).limit(1).maybeSingle()
      if (pc?.id) { ownerReale = parent; cur = parent } else break
    }
  }

  for (let i = 0; i < 20 && currentId; i++) {
    const { data: m } = await adminDb
      .from('masters')
      .select('id,nome,tipo_contratto,credito,parent_master_id,parent_listino_id')
      .eq('id', currentId).single()
    if (!m) {
      return { catena, errore: 'Catena master non leggibile: impossibile verificare i livelli.' }
    }

    const isProprietario = m.id === ownerReale
    let prezzo = 0

    if (isProprietario) {
      // Il proprietario reale del contratto paga il costo reale dell'API.
      prezzo = Number(params.costoSpedizione || 0)
    } else {
      if (!m.parent_listino_id) {
        return { catena, errore: `Il master "${m.nome}" non ha un listino assegnato dal livello superiore.` }
      }
      // Prezzo che QUESTO master paga al livello sopra: dal listino che il padre gli ha assegnato,
      // per lo STESSO corriere (il corriere del padre con lo stesso nome contratto).
      let corriereIdPadre: string | null = null
      if (params.corriereNome && m.parent_master_id) {
        const { data: pc } = await adminDb.from('corrieri')
          .select('id').eq('master_id', m.parent_master_id).eq('nome_contratto', params.corriereNome).limit(1).maybeSingle()
        corriereIdPadre = pc?.id || null
      }
      const ris = await calcolaPrezzoListino(adminDb, {
        listinoId: m.parent_listino_id,
        corriereId: corriereIdPadre,
        provincia: params.provincia,
        packages: params.packages,
        cap: params.cap,
        paese: params.paese,
      })
      if (!ris) return { catena, errore: `Nessuna tariffa nel listino del master "${m.nome}".` }
      prezzo = ris.prezzo
    }

    catena.push({
      masterId: m.id, nome: m.nome,
      tipoContratto: m.tipo_contratto || 'credito_scalare',
      credito: Number(m.credito || 0),
      prezzo, isProprietario,
    })

    if (isProprietario) break
    currentId = m.parent_master_id
  }

  return { catena }
}

export async function verificaCreditoCatena(
  supabase: any,
  params: {
    masterDirettoId: string
    corriereOwnerId: string
    provincia: string
    packages: any[]
    costoSpedizione?: number
    cap?: string
    paese?: string
    corriereNome?: string
  }
): Promise<{ ok: boolean; errore?: string }> {
  const { catena, errore } = await costruisciCatena(supabase, {
    masterDirettoId: params.masterDirettoId,
    corriereOwnerId: params.corriereOwnerId,
    costoSpedizione: params.costoSpedizione || 0,
    provincia: params.provincia,
    packages: params.packages,
    cap: params.cap,
    paese: params.paese,
    corriereNome: params.corriereNome,
  })
  if (errore) return { ok: false, errore }

  for (const liv of catena) {
    if (liv.tipoContratto === 'credito_scalare' && liv.prezzo > 0 && liv.credito < liv.prezzo) {
      return { ok: false, errore: `Credito insufficiente nella catena: "${liv.nome}" ha € ${liv.credito.toFixed(2)} ma servono € ${liv.prezzo.toFixed(2)}.` }
    }
  }
  return { ok: true }
}

export async function addebitaCatena(
  supabase: any,
  params: {
    masterDirettoId: string
    corriereOwnerId: string
    costoSpedizione: number
    provincia: string
    packages: any[]
    numero: string
    destNome: string
    spedizioneId: string | null
    createdBy: string | null
    cap?: string
    paese?: string
    corriereNome?: string
  }
): Promise<void> {
  const adminMov = createAdminSupabase()
  const { catena } = await costruisciCatena(supabase, {
    masterDirettoId: params.masterDirettoId,
    corriereOwnerId: params.corriereOwnerId,
    costoSpedizione: params.costoSpedizione,
    provincia: params.provincia,
    packages: params.packages,
    cap: params.cap,
    paese: params.paese,
    corriereNome: params.corriereNome,
  })

  for (const liv of catena) {
    if (!(liv.prezzo > 0)) continue
    try {
      await registraMovimentoMaster(adminMov, {
        masterOwnerId: liv.masterId,
        masterTargetId: liv.masterId,
        tipo: 'spedizione',
        descrizione: `${params.numero} - ${params.destNome || ''}`.trim(),
        riferimento: params.numero,
        importo: -Math.abs(liv.prezzo),
        spedizioneId: params.spedizioneId,
        createdBy: params.createdBy,
      })
    } catch (e) {
      console.error(`Errore addebito cascata su master ${liv.masterId}:`, e)
    }
  }
}

export async function rimborsaCatena(
  supabase: any,
  params: {
    masterDirettoId: string
    corriereOwnerId: string
    costoSpedizione: number
    provincia: string
    packages: any[]
    numero: string
    destNome: string
    spedizioneId: string | null
    createdBy: string | null
    cap?: string
    paese?: string
    corriereNome?: string
  }
): Promise<void> {
  const adminMov = createAdminSupabase()
  const { catena } = await costruisciCatena(supabase, {
    masterDirettoId: params.masterDirettoId,
    corriereOwnerId: params.corriereOwnerId,
    costoSpedizione: params.costoSpedizione,
    provincia: params.provincia,
    packages: params.packages,
    cap: params.cap,
    paese: params.paese,
    corriereNome: params.corriereNome,
  })

  for (const liv of catena) {
    if (!(liv.prezzo > 0)) continue
    try {
      await registraMovimentoMaster(adminMov, {
        masterOwnerId: liv.masterId,
        masterTargetId: liv.masterId,
        tipo: 'rimborso',
        descrizione: `Rimborso ${params.numero} - ${params.destNome || ''}`.trim(),
        riferimento: params.numero,
        importo: Math.abs(liv.prezzo),
        spedizioneId: params.spedizioneId,
        createdBy: params.createdBy,
      })
    } catch (e) {
      console.error(`Errore rimborso cascata su master ${liv.masterId}:`, e)
    }
  }
}
