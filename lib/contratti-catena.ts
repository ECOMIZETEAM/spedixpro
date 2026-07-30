// SOSPENSIONE DI UN CONTRATTO LUNGO LA CATENA.
//
// Ogni master ha una PROPRIA riga in `corrieri` per ciascun contratto: quando un contratto viene
// propagato a un sotto-master ne nasce una copia con lo stesso `nome_contratto`. Il legame fra
// padre e figlio e' quindi il NOME del contratto, non un identificativo (e' cosi' anche in
// lib/cascata.ts, che risale la catena cercando per nome_contratto).
//
// Conseguenza del modello: mettere in pausa un contratto (`attivo = false`) fermava SOLO chi lo
// metteva in pausa. I sotto-master e i loro clienti continuavano a vederlo, a quotarlo e a
// spedirci, comprese le chiamate via API. Ma un master non puo' vendere un servizio che il livello
// sopra ha sospeso: la merce non partirebbe.
//
// Qui si risale la catena e si raccolgono i nomi dei contratti sospesi SOPRA un dato master.
// Serve SOLO a restringere (mai ad ampliare) cio' che un master puo' usare.
//
// Nota sul client: si usa il service role perche' l'RLS sui corrieri
// (master_id IN mia_rete_master()) impedisce di leggere le righe dei master superiori. E' un uso
// legittimo perche' non si espone nulla: si legge solo nome_contratto + attivo degli ANTENATI di
// chi chiama, e il risultato puo' unicamente togliere contratti.
export async function contrattiSospesiSopra(masterId: string | null | undefined): Promise<Set<string>> {
  const sospesi = new Set<string>()
  if (!masterId) return sospesi
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()

  // Risalita: dal padre fino alla radice. Il limite di 20 giri e' una rete di sicurezza contro
  // eventuali cicli nei dati (un master che finisse per essere antenato di se stesso).
  let corrente: string | null = masterId
  const visti = new Set<string>([masterId])
  for (let i = 0; i < 20; i++) {
    const { data: m } = await admin.from('masters').select('parent_master_id').eq('id', corrente).maybeSingle()
    const padre: string | null = (m as any)?.parent_master_id || null
    if (!padre || visti.has(padre)) break
    visti.add(padre)
    const { data: corr } = await admin.from('corrieri')
      .select('nome_contratto,attivo').eq('master_id', padre).eq('attivo', false)
    for (const c of corr || []) {
      const nome = String((c as any).nome_contratto || '').trim()
      if (nome) sospesi.add(nome.toLowerCase())
    }
    corrente = padre
  }
  return sospesi
}

// true se questo contratto e' fuori uso per colpa di un livello superiore.
export function sospesoDallaCatena(nomeContratto: string | null | undefined, sospesi: Set<string>): boolean {
  if (!sospesi.size) return false
  return sospesi.has(String(nomeContratto || '').trim().toLowerCase())
}
