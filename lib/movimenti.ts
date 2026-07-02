export type TipoMovimento = 'ricarica' | 'spedizione' | 'rimborso' | 'reso' | 'rettifica'

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
  const { masterId, clienteId, tipo, descrizione } = params
  const importo = Number(params.importo)
  if (!isFinite(importo)) throw new Error('Importo movimento non valido')

  const { data: cli, error: cliErr } = await supabase
    .from('clienti').select('credito').eq('id', clienteId).single()
  if (cliErr || !cli) throw new Error('Cliente non trovato per il movimento')

  const saldoPrima = Number(cli.credito || 0)
  const saldoDopo = Math.round((saldoPrima + importo) * 100) / 100

  const { error: movErr } = await supabase.from('movimenti').insert({
    master_id: masterId,
    cliente_id: clienteId,
    tipo,
    descrizione,
    riferimento: params.riferimento ?? null,
    importo,
    saldo_dopo: saldoDopo,
    spedizione_id: params.spedizioneId ?? null,
    created_by: params.createdBy ?? null,
  })
  if (movErr) throw new Error('Errore inserimento movimento: ' + movErr.message)

  const { error: updErr } = await supabase
    .from('clienti').update({ credito: saldoDopo }).eq('id', clienteId)
  if (updErr) throw new Error('Errore aggiornamento credito: ' + updErr.message)

  return { saldo: saldoDopo }
}

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
  const { masterOwnerId, masterTargetId, tipo, descrizione } = params
  const importo = Number(params.importo)
  if (!isFinite(importo)) throw new Error('Importo movimento non valido')

  const { data: m, error: mErr } = await supabase
    .from('masters').select('credito').eq('id', masterTargetId).single()
  if (mErr || !m) throw new Error('Master non trovato per il movimento')

  const saldoPrima = Number(m.credito || 0)
  const saldoDopo = Math.round((saldoPrima + importo) * 100) / 100

  const { error: movErr } = await supabase.from('movimenti').insert({
    master_id: masterOwnerId,
    cliente_id: null,
    master_target_id: masterTargetId,
    tipo,
    descrizione,
    riferimento: params.riferimento ?? null,
    importo,
    saldo_dopo: saldoDopo,
    spedizione_id: params.spedizioneId ?? null,
    created_by: params.createdBy ?? null,
  })
  if (movErr) throw new Error('Errore inserimento movimento master: ' + movErr.message)

  const { error: updErr } = await supabase
    .from('masters').update({ credito: saldoDopo }).eq('id', masterTargetId)
  if (updErr) throw new Error('Errore aggiornamento credito master: ' + updErr.message)

  return { saldo: saldoDopo }
}
