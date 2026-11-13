// REGOLE DELLE PASSWORD (politica Amazon sui dati, 1.4.1): almeno 12 caratteri, con maiuscole,
// minuscole, numeri e simboli. Le stesse regole le applica Supabase (Autenticazione → requisiti della
// password) a ogni password che riceve, da qualunque porta: qui stanno per dirlo PRIMA, in italiano,
// invece di far arrivare all'utente l'errore inglese di Supabase. Nessun import: lo usano anche le pagine.

export const LUNGHEZZA_MINIMA_PASSWORD = 12
export const SIMBOLI_PASSWORD = '!@#?*'

export const REGOLE_PASSWORD_TESTO =
  `Almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri, con almeno una lettera maiuscola, una minuscola, un numero e un simbolo (per esempio ! ? * # @).`

// Cosa manca, detto per intero; null se la password va bene.
export function erroreRegolePassword(p: string): string | null {
  const manca: string[] = []
  if ((p || '').length < LUNGHEZZA_MINIMA_PASSWORD) manca.push(`almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri`)
  if (!/[A-Z]/.test(p || '')) manca.push('una lettera maiuscola')
  if (!/[a-z]/.test(p || '')) manca.push('una lettera minuscola')
  if (!/[0-9]/.test(p || '')) manca.push('un numero')
  // Simbolo = qualunque carattere che non sia lettera o numero, come lo intende Supabase.
  if (!/[^A-Za-z0-9]/.test(p || '')) manca.push('un simbolo (per esempio ! ? * # @)')
  return manca.length ? `La password deve avere ${manca.join(', ')}.` : null
}

// Gli errori di Supabase arrivano in inglese: quelli che si incontrano davvero, detti in italiano.
export function messaggioErrorePassword(errore: string | undefined | null): string {
  const m = String(errore || '').toLowerCase()
  if (m.includes('different from the old')) return 'La nuova password deve essere diversa da quella di adesso.'
  if (m.includes('pwned') || m.includes('known to be weak') || m.includes('leaked')) return 'Questa password compare negli elenchi di password rubate su internet: scegline un\'altra.'
  if (m.includes('should contain') || m.includes('at least') || m.includes('weak')) return 'La password non rispetta le regole. ' + REGOLE_PASSWORD_TESTO
  if (m.includes('reauthentication') || m.includes('session')) return 'Per sicurezza esci, rientra e riprova.'
  return errore || 'Errore durante il salvataggio'
}
