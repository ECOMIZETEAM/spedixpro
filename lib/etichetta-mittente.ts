// MITTENTE DELLA SPEDIZIONE SULL'ETICHETTA, AL POSTO DELL'INTESTATARIO DEL CONTO.
// BRT e GLS diretti stampano nella casella mittente il titolare del conto del corriere (per Wave ship
// "WAVESHIP LLC EIN" / "Waveship Llc"), anche sui pacchi dei suoi clienti e dei clienti dei suoi
// sotto-master. Dove il detentore lo chiede, la casella si riscrive col mittente vero: lo decide
// settings.etichetta_mittente_spedizione sul contratto del DETENTORE (oggi solo i contratti di Wave).
// Le copie dei sotto-master non portano quella chiave, ma il conto del corriere è lo stesso: per questo
// si legge sempre dalla radice (contratto_id), mai dalla copia.
export async function stampaMittenteSpedizione(
  admin: any,
  corriere: { id: string; settings?: any },
): Promise<boolean> {
  const { data: cc } = await admin.from('corrieri').select('contratto_id').eq('id', corriere.id).maybeSingle()
  const radice = (cc as any)?.contratto_id || corriere.id
  const sett = radice === corriere.id && corriere.settings !== undefined
    ? corriere.settings
    : (await admin.from('corrieri').select('settings').eq('id', radice).maybeSingle()).data?.settings
  return (sett as any)?.etichetta_mittente_spedizione === true
}
