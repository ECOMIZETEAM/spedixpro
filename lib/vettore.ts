// VETTORE FISICO di un contratto (corriere): il corriere reale che ritira/consegna, distinto dal
// "tipo" (che e' l'INTEGRAZIONE: 'gls' diretto, 'brt' diretto, 'spedisci'/'spediamopro'/'easyparcel'
// provider). Serve a UNIRE in un'unica distinta i contratti dello STESSO vettore anche se passano da
// integrazioni diverse (es. GLS diretto + GLS via provider): fisicamente lo ritira lo stesso furgone.
//
// ATTENZIONE: i contratti GLS/BRT DIRETTI possono avere nomi che NON contengono "GLS"/"BRT"
// (es. "PF CE LIGHT" di Quick e' tipo='gls'): per quelli il vettore si deduce dal TIPO, non dal nome.
// Solo per i contratti via PROVIDER il vettore sta nel nome del contratto.
// Funzione PURA (nessuna dipendenza server): usabile sia lato client che lato API.
export function vettoreFisico(c: { tipo?: string | null; nome_contratto?: string | null }): string {
  const t = (c?.tipo || '').toLowerCase()
  if (t === 'gls') return 'GLS'
  if (t === 'brt') return 'BRT'
  const n = (c?.nome_contratto || '').toUpperCase()
  const regole: [RegExp, string][] = [
    [/GLS/, 'GLS'],
    [/\bBRT\b|BARTOLINI/, 'BRT'],
    [/DELIVERY BUSINESS|\bPDB\b|POSTE|CRONO/, 'POSTE'],
    [/\bSDA\b/, 'SDA'],
    [/\bUPS\b/, 'UPS'],
    [/DHL/, 'DHL'],
    [/\bTNT\b/, 'TNT'],
    [/FEDEX/, 'FEDEX'],
    [/INPOST/, 'INPOST'],
    [/NEXIVE/, 'NEXIVE'],
    [/HERMES|EVRI/, 'HERMES'],
    [/SAILPOST/, 'SAILPOST'],
    [/FERCAM/, 'FERCAM'],
  ]
  for (const [re, v] of regole) if (re.test(n)) return v
  // Fallback: prima parola del nome, o il tipo. Non deve mai unire cose diverse per sbaglio.
  return n.split(/\s+/)[0] || t.toUpperCase() || 'ALTRO'
}
