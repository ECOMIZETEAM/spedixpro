import { calcolaPrezzoListino, calcolaPrezzoCorriere } from '@/lib/pricing'
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
    contrassegno?: number
    assicurazione?: number
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

    // Ogni master (a QUALSIASI livello) paga il SUO Listino Corrieri per questo corriere:
    // è il costo che vede nella sua lista movimenti.
    let calcolato = false
    if (params.corriereNome) {
      const { data: mCorr }: any = await adminDb.from('corrieri')
        .select('id').eq('master_id', m.id).eq('nome_contratto', params.corriereNome).limit(1).maybeSingle()
      if (mCorr?.id) {
        const pesoReale = (params.packages || []).reduce((s: number, p: any) => s + (parseFloat(p?.weight) || 0), 0) || 1
        const pz = await calcolaPrezzoCorriere(adminDb, {
          corriereId: mCorr.id, masterId: m.id,
          provincia: params.provincia, cap: params.cap, paese: params.paese,
          pesoReale, packages: params.packages,
          contrassegno: params.contrassegno, assicurazione: params.assicurazione,
        })
        if (pz != null) { prezzo = pz; calcolato = true }
      }
    }
    // Fallback se il master non ha il listino corrieri per questo contratto:
    // il proprietario reale usa il costo reale dell'API; gli altri il listino assegnato dal padre.
    if (!calcolato) {
      if (isProprietario) {
        prezzo = Number(params.costoSpedizione || 0)
      } else {
        if (!m.parent_listino_id) {
          return { catena, errore: `Il master "${m.nome}" non ha un listino corrieri né un listino assegnato.` }
        }
        const ris = await calcolaPrezzoListino(adminDb, {
          listinoId: m.parent_listino_id, provincia: params.provincia,
          packages: params.packages, cap: params.cap, paese: params.paese,
        })
        if (!ris) return { catena, errore: `Nessuna tariffa nel listino del master "${m.nome}".` }
        prezzo = ris.prezzo
      }
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
    contrassegno?: number
    assicurazione?: number
  }
): Promise<{ ok: boolean; errore?: string; masterInsufficiente?: string }> {
  const { catena, errore } = await costruisciCatena(supabase, {
    masterDirettoId: params.masterDirettoId,
    corriereOwnerId: params.corriereOwnerId,
    costoSpedizione: params.costoSpedizione || 0,
    provincia: params.provincia,
    packages: params.packages,
    cap: params.cap,
    paese: params.paese,
    corriereNome: params.corriereNome,
    contrassegno: params.contrassegno,
    assicurazione: params.assicurazione,
  })
  if (errore) return { ok: false, errore }

  for (const liv of catena) {
    if (liv.tipoContratto === 'credito_scalare' && liv.prezzo > 0 && liv.credito < liv.prezzo) {
      // masterInsufficiente = chi è a secco: il chiamante decide se mostrarne il dettaglio
      // (solo al diretto interessato) o un generico "Credito insufficiente" ai livelli sotto.
      return {
        ok: false,
        errore: `Credito insufficiente: "${liv.nome}" ha € ${liv.credito.toFixed(2)} ma servono € ${liv.prezzo.toFixed(2)}.`,
        masterInsufficiente: liv.masterId,
      }
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
    contrassegno?: number
    assicurazione?: number
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
    contrassegno: params.contrassegno,
    assicurazione: params.assicurazione,
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
    contrassegno?: number
    assicurazione?: number
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
    contrassegno: params.contrassegno,
    assicurazione: params.assicurazione,
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
