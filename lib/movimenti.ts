export type TipoMovimento = 'ricarica' | 'spedizione' | 'rimborso' | 'reso' | 'rettifica'

// Registra un movimento sul CREDITO di un cliente in modo ATOMICO (RPC lato DB:
// UPDATE credito = credito + importo con RETURNING + INSERT movimento in un'unica
// transazione). Elimina il lost-update e rende saldo_dopo sempre coerente anche
// sotto forte concorrenza (migliaia di spedizioni simultanee).
export async function registraMovimento(
  supabase: any,
  params: {
    masterId: string
    clienteId: string
    tipo: TipoMovimento
    descrizione: string
    importo: number
    riferimento?: string | null
    spedizioneId?: string | null
    createdBy?: string | null
  }
): Promise<{ saldo: number }> {
  const importo = Number(params.importo)
  if (!isFinite(importo)) throw new Error('Importo movimento non valido')

  const { data, error } = await supabase.rpc('registra_movimento_cliente', {
    p_master_id: params.masterId,
    p_cliente_id: params.clienteId,
    p_tipo: params.tipo,
    p_descrizione: params.descrizione,
    p_importo: importo,
    p_riferimento: params.riferimento ?? null,
    p_spedizione_id: params.spedizioneId ?? null,
    p_created_by: params.createdBy ?? null,
  })
  if (error) throw new Error('Errore movimento: ' + error.message)
  return { saldo: Number(data) }
}

// Idem per il CREDITO di un master (usato dalla fatturazione a cascata verso i master padre).
export async function registraMovimentoMaster(
  supabase: any,
  params: {
    masterOwnerId: string
    masterTargetId: string
    tipo: TipoMovimento
    descrizione: string
    importo: number
    riferimento?: string | null
    spedizioneId?: string | null
    createdBy?: string | null
  }
): Promise<{ saldo: number }> {
  const importo = Number(params.importo)
  if (!isFinite(importo)) throw new Error('Importo movimento non valido')

  const { data, error } = await supabase.rpc('registra_movimento_master', {
    p_master_owner_id: params.masterOwnerId,
    p_master_target_id: params.masterTargetId,
    p_tipo: params.tipo,
    p_descrizione: params.descrizione,
    p_importo: importo,
    p_riferimento: params.riferimento ?? null,
    p_spedizione_id: params.spedizioneId ?? null,
    p_created_by: params.createdBy ?? null,
  })
  if (error) throw new Error('Errore movimento master: ' + error.message)
  return { saldo: Number(data) }
}
