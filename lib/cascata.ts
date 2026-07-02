import { calcolaPrezzoListino } from '@/lib/pricing'
import { registraMovimentoMaster } from '@/lib/movimenti'

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
  }
): Promise<{ catena: LivelloCatena[]; errore?: string }> {
  const catena: LivelloCatena[] = []
  let currentId: string | null = params.masterDirettoId

  for (let i = 0; i < 20 && currentId; i++) {
    const { data: m } = await supabase
      .from('masters')
      .select('id,nome,tipo_contratto,credito,parent_master_id,parent_listino_id')
      .eq('id', currentId).single()
    if (!m) break

    const isProprietario = m.id === params.corriereOwnerId
    let prezzo = 0

    if (isProprietario) {
      prezzo = Number(params.costoSpedizione || 0)
    } else {
      if (!m.parent_listino_id) {
        return { catena, errore: `Il master "${m.nome}" non ha un listino assegnato dal livello superiore.` }
      }
      const ris = await calcolaPrezzoListino(supabase, {
        listinoId: m.parent_listino_id,
        provincia: params.provincia,
        packages: params.packages,
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
  }
): Promise<{ ok: boolean; errore?: string }> {
  const { catena, errore } = await costruisciCatena(supabase, {
    masterDirettoId: params.masterDirettoId,
    corriereOwnerId: params.corriereOwnerId,
    costoSpedizione: params.costoSpedizione || 0,
    provincia: params.provincia,
    packages: params.packages,
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
  }
): Promise<void> {
  const { catena } = await costruisciCatena(supabase, {
    masterDirettoId: params.masterDirettoId,
    corriereOwnerId: params.corriereOwnerId,
    costoSpedizione: params.costoSpedizione,
    provincia: params.provincia,
    packages: params.packages,
  })

  for (const liv of catena) {
    if (!(liv.prezzo > 0)) continue
    try {
      await registraMovimentoMaster(supabase, {
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
