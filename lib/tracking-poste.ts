// Mapping/parse del tracking POSTE (usato sia dal ripiego pubblico bonifica-poste sia dal backfill
// OneTracking dell'harvester tracking). Un posto solo: la regola che decide lo stato non va duplicata.
import { testoIndicaReso } from '@/lib/spedisci'

// Frase Poste → stato interno. Ordine importante: 'mancata/non consegnata' prima di 'consegnata',
// e la regola RESO è quella blindata (testoIndicaReso), per non prendere per reso una consegna.
export function mappaStatoPoste(testo: string): string | null {
  const t = (testo || '').toLowerCase()
  if (!t) return null
  if (t.includes('non consegnat') || t.includes('mancata') || t.includes('tentativo di consegna')) return 'non_consegnato'
  if (t.includes('consegnat')) return 'consegnata'
  if (t.includes('giacenz')) return 'in_giacenza'
  if (testoIndicaReso(t)) return 'reso_mittente'
  if (t.includes('in consegna')) return 'in_consegna'
  if (t.includes('transito') || t.includes('arrivat') || t.includes('partit') || t.includes('smistament') || t.includes('in lavorazione')) return 'in_transito'
  if (t.includes('presa in carico') || t.includes('preso in caric') || t.includes('accettat') || t.includes('spedit')) return 'spedita'
  return null
}

// "27/07/2026 15:45" (ora italiana) → ISO con l'offset giusto (legale/solare).
export function parseDataPoste(s: string): string {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/)
  if (!m) return new Date().toISOString()
  const mese = Number(m[2])
  const off = (mese >= 4 && mese <= 10) ? '+02:00' : '+01:00'
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00${off}`
}

export interface EventoTracking { stato: string | null; descrizione: string; luogo: string | null; data_evento: string }

// Array `tracking` del full-tracking OneTracking → eventi normalizzati per tracking_events.
export function eventiDaFullTracking(tracking: any[]): EventoTracking[] {
  return (Array.isArray(tracking) ? tracking : []).map((e: any) => {
    const txt = [e?.stato, e?.descrCodice, e?.descStatoSintesi, e?.note].filter(Boolean).join(' ')
    return {
      stato: mappaStatoPoste(txt),
      descrizione: String(e?.descrCodice || e?.stato || '').slice(0, 300),
      luogo: (String(e?.filialeResp || '').replace(/^-$/, '').trim().slice(0, 200)) || null,
      data_evento: parseDataPoste(e?.data),
    }
  }).filter((e) => e.descrizione)
}
