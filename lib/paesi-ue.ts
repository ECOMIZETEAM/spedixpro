// Elenco UNICO dei paesi UE (ISO-2), per distinguere l'estero UE (nessuna dogana) dall'extra-UE
// (sdoganamento). Tenuto in un solo posto: la regola "serve la dogana?" non va sparsa nei form.
// NB: dogana = fuori dal territorio doganale UE. CH/NO/GB sono extra-UE. San Marino (SM) e Città del
// Vaticano (VA) sono fuori UE ma con regimi speciali: qui li trattiamo come extra-UE (dogana) per
// prudenza — meglio un avviso in più che un pacco fermo.
export const PAESI_UE = new Set<string>([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
])

// true se il paese è FUORI dall'UE (quindi la spedizione passa dalla dogana). IT/UE → false.
export function isExtraUe(paese?: string | null): boolean {
  const p = String(paese || '').trim().toUpperCase()
  return !!p && !PAESI_UE.has(p)
}
