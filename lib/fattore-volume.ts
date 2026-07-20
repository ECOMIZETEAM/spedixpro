// Fattore volume "ereditato" per un corriere: il valore "proprio" del master
// (riga listini_corrieri con quel master+corriere). Da usare quando si aggancia il corriere a un
// listino (link listini_corrieri_corrieri) invece di lasciare il default 5000 — altrimenti un nuovo
// contratto nasce col fattore sbagliato e va corretto "a tentativi" risalvando.
export async function fattoreEreditato(supabase: any, listinoId: string, corriereId: string): Promise<number | null> {
  const { data: lc } = await supabase.from('listini_corrieri').select('master_id').eq('id', listinoId).maybeSingle()
  if (!lc?.master_id) return null
  const { data: pr } = await supabase.from('listini_corrieri')
    .select('fattore_volume').eq('master_id', lc.master_id).eq('corriere_id', corriereId)
    .not('fattore_volume', 'is', null).limit(1).maybeSingle()
  const fv = pr?.fattore_volume != null ? Number(pr.fattore_volume) : null
  return fv && fv > 0 ? fv : null
}
