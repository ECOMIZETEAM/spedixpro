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
    // Nome contratto del corriere usato: serve per trovare, su OGNI master della catena,
    // il suo corriere equivalente e addebitare dal SUO listino corrieri.
    corriereNome?: string
    contrassegno?: number
    assicurazione?: number
  }
): Promise<{ catena: LivelloCatena[]; errore?: string }> {
  const catena: LivelloCatena[] = []
  let currentId: string | null = params.masterDirettoId
  // RLS: la catena e' cross-tenant per natura -> client admin (auth verificata a monte)
  const adminDb = createAdminSupabase()

  for (let i = 0; i < 20 && currentId; i++) {
    const { data: m } = await adminDb
      .from('masters')
      .select('id,nome,tipo_contratto,credito,parent_master_id,parent_listino_id')
      .eq('id', currentId).single()
    if (!m) {
      return { catena, errore: 'Catena master non leggibile: impossibile verificare i livelli.' }
    }

    const isProprietario = m.id === params.corriereOwnerId
    let prezzo = 0

    if (isProprietario) {
      // Il proprietario del corriere paga il costo reale dell'API.
      prezzo = Number(params.costoSpedizione || 0)
    } else {
      // Addebito dal LISTINO CORRIERI del master stesso (il suo costo, contrassegno e
      // assicurazione inclusi), coerente con quello che paga per le sue spedizioni proprie.
      let calcolato = false
      if (params.corriereNome) {
        // Il corriere equivalente di QUESTO master (stesso nome contratto).
        const { data: mCorr } = await adminDb.from('corrieri')
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
      // Fallback (il master non ha un listino corrieri per questo contratto): comportamento
      // precedente, dal listino CLIENTI che il padre gli ha assegnato (parent_listino_id).
      if (!calcolato) {
        if (!m.parent_listino_id) {
          return { catena, errore: `Il master "${m.nome}" non ha un listino corrieri né un listino assegnato dal livello superiore.` }
        }
        const ris = await calcolaPrezzoListino(adminDb, {
          listinoId: m.parent_listino_id,
          provincia: params.provincia,
          packages: params.packages,
          cap: params.cap,
          paese: params.paese,
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
    contrassegno: params.contrassegno,
    assicurazione: params.assicurazione,
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
