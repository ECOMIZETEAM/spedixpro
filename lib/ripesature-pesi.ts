import type { Ripesatura } from '@/lib/ripesature'

// ── FILE DEI SOLI PESI: IL PESO E' DELLA SPEDIZIONE, NON DEL COLLO ──
//
// Il file (GLS di MULTI, Velox) da' un peso solo per lettera di vettura. Se la spedizione ha piu' colli
// quel peso si divide sui colli DICHIARATI, in proporzione al peso di ognuno (in parti uguali se il
// dettaglio non c'e'): il totale resta quello del file, e chi propaga sotto ritrova i suoi colli.
// Misurato il 15/10/2026 sui 109 multicollo del file GLS: prezzo identico a un collo unico su tutti e
// 109 — i contratti GLS prezzano sul totale — quindi la divisione non sposta un euro, tiene solo i colli.
//
// La gamba e' la STESSA che sceglie il motore (la partenza, altrimenti la prima). I pesi si leggono
// campo per campo: colli_dettaglio intero porta dentro le etichette in PDF (vedi ripesature-xl).
export async function colliDalPesoTotale(admin: any, nuove: Ripesatura[]): Promise<void> {
  const pesi = nuove.filter(r => r.formato === 'pesi')
  if (!pesi.length) return
  const N = 30
  const campi = ['tracking_number', 'numero', 'colli', ...Array.from({ length: N }, (_, i) => `p${i}:colli_dettaglio->${i}->peso`)].join(',')
  const gambe = new Map<string, any[]>()
  const ldv = Array.from(new Set(pesi.map(r => r.ldv)))
  for (let i = 0; i < ldv.length; i += 150) {
    const { data } = await admin.from('spedizioni').select(campi).in('tracking_number', ldv.slice(i, i + 150))
    for (const s of (data || []) as any[]) gambe.set(s.tracking_number, [...(gambe.get(s.tracking_number) || []), s])
  }
  for (const r of pesi) {
    const ls = gambe.get(r.ldv) || []
    const g = ls.find(x => x.numero === x.tracking_number) || ls[0]
    const n = Math.max(1, Number(g?.colli) || 1)
    if (n === 1) continue
    const totale = r.colli.reduce((a, c) => a + (Number(c.peso) || 0), 0)
    const dichiarati = Array.from({ length: n }, (_, i) => (i < N ? Number(g['p' + i]) || 0 : 0))
    const somma = dichiarati.reduce((a, b) => a + b, 0)
    const completi = somma > 0 && dichiarati.every(d => d > 0)
    r.colli = dichiarati.map(d => ({ peso: completi ? totale * d / somma : totale / n, lunghezza: 0, larghezza: 0, altezza: 0 }))
  }
}
