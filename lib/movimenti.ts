// Helper unico per registrare un movimento di credito e aggiornare il saldo del cliente.
// Usato sia dai movimenti manuali (ricarica/reso/rettifica) sia, in seguito,
// dalla creazione/annullo spedizioni.
//
// importo con segno: + accredito (ricarica, rimborso), - addebito (spedizione).

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

  // Saldo attuale del cliente
  const { data: cli, error: cliErr } = await supabase
    .from('clienti').select('credito').eq('id', clienteId).single()
  if (cliErr || !cli) throw new Error('Cliente non trovato per il movimento')

  const saldoPrima = Number(cli.credito || 0)
  const saldoDopo = Math.round((saldoPrima + importo) * 100) / 100

  // 1) Inserisci il movimento (registro storico immutabile)
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

  // 2) Aggiorna il credito del cliente
  const { error: updErr } = await supabase
    .from('clienti').update({ credito: saldoDopo }).eq('id', clienteId)
  if (updErr) throw new Error('Errore aggiornamento credito: ' + updErr.message)

  return { saldo: saldoDopo }
}
