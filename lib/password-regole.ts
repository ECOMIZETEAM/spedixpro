// REGOLE DELLE PASSWORD (politica Amazon sui dati, 1.4.1): almeno 12 caratteri, con maiuscole,
// minuscole, numeri e simboli. Le stesse regole le applica Supabase (Autenticazione → requisiti della
// password) a ogni password che riceve, da qualunque porta: qui stanno per dirlo PRIMA, in italiano,
// invece di far arrivare all'utente l'errore inglese di Supabase. Nessun import: lo usano anche le pagine.
// Il resto della 1.4.1 (niente nome, niente riuso, eta' minima, scadenza) Supabase non lo fa: lo fanno
// la rotta /api/auth/password e scripts/password-regole.sql.

export const LUNGHEZZA_MINIMA_PASSWORD = 12
export const SIMBOLI_PASSWORD = '!@#?*'
export const PASSWORD_RICORDATE = 10
export const SCADENZA_PASSWORD_GIORNI = 365
export const ORE_TRA_DUE_CAMBI = 24
// Oltre, bcrypt (Supabase) ignora il resto: due password diverse dopo il 72° carattere varrebbero uguali.
export const LUNGHEZZA_MASSIMA_PASSWORD = 72

export const REGOLE_PASSWORD_TESTO =
  `Almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri, con almeno una lettera maiuscola, una minuscola, un numero e un simbolo (per esempio ! ? * # @).`

export const REGOLE_PASSWORD_DURATA =
  `Non può contenere il tuo nome e non può essere una delle ultime ${PASSWORD_RICORDATE} che hai usato. Scade dopo 12 mesi e si cambia al massimo una volta al giorno.`

// Perche' all'accesso si chiede una password nuova (motivo da stato_sessione / password_da_cambiare).
export const MOTIVO_CAMBIO_PASSWORD: Record<string, string> = {
  scaduta: 'La tua password ha più di 12 mesi: per continuare scegline una nuova.',
  regole: 'La tua password non rispetta le regole di sicurezza: per continuare scegline una nuova.',
}

// Cosa manca, detto per intero; null se la password va bene.
export function erroreRegolePassword(p: string): string | null {
  const manca: string[] = []
  if ((p || '').length < LUNGHEZZA_MINIMA_PASSWORD) manca.push(`almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri`)
  if (!/[A-Z]/.test(p || '')) manca.push('una lettera maiuscola')
  if (!/[a-z]/.test(p || '')) manca.push('una lettera minuscola')
  if (!/[0-9]/.test(p || '')) manca.push('un numero')
  // Simbolo = qualunque carattere che non sia lettera o numero, come lo intende Supabase.
  if (!/[^A-Za-z0-9]/.test(p || '')) manca.push('un simbolo (per esempio ! ? * # @)')
  if ((p || '').length > LUNGHEZZA_MASSIMA_PASSWORD) return `La password può avere al massimo ${LUNGHEZZA_MASSIMA_PASSWORD} caratteri.`
  return manca.length ? `La password deve avere ${manca.join(', ')}.` : null
}

// NIENTE NOME NELLA PASSWORD. Le parti del nome e del cognome, e quelle dell'indirizzo email prima
// della @ (di solito sono il nome), da 3 lettere in su; senza accenti e senza maiuscole, perche'
// "Rossì2025!" e "rossi" sono la stessa cosa per chi prova a indovinare. Le forme societarie no: molti
// account dei clienti hanno come nome la ragione sociale, e "srl" non e' un nome.
const FORME_SOCIETARIE = new Set(['srl', 'srls', 'spa', 'snc', 'sas', 'sapa', 'scarl', 'coop', 'soc', 'societa', 'ditta'])
function senzaAccenti(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}
export function partiDelNome(nome?: string | null, cognome?: string | null, email?: string | null): string[] {
  const parti = new Set<string>()
  for (const s of [nome, cognome]) {
    for (const t of senzaAccenti(s || '').split(/[^a-z0-9]+/)) if (t.length >= 3 && !FORME_SOCIETARIE.has(t)) parti.add(t)
  }
  for (const t of senzaAccenti((email || '').split('@')[0]).split(/[^a-z0-9]+/)) if (t.length >= 4) parti.add(t)
  return [...parti]
}
export function erroreNomeInPassword(p: string, parti: string[]): string | null {
  const n = senzaAccenti(p)
  const trovata = parti.find(t => n.includes(t))
  return trovata ? `La password non può contenere il tuo nome o il tuo indirizzo email («${trovata}»).` : null
}

// Gli errori di Supabase arrivano in inglese: quelli che si incontrano davvero, detti in italiano.
export function messaggioErrorePassword(errore: string | undefined | null): string {
  const m = String(errore || '').toLowerCase()
  if (m.includes('different from the old')) return 'La nuova password deve essere diversa da quella di adesso.'
  if (m.includes('longer than')) return `La password può avere al massimo ${LUNGHEZZA_MASSIMA_PASSWORD} caratteri.`
  if (m.includes('pwned') || m.includes('known to be weak') || m.includes('leaked')) return 'Questa password compare negli elenchi di password rubate su internet: scegline un\'altra.'
  if (m.includes('should contain') || m.includes('at least') || m.includes('weak')) return 'La password non rispetta le regole. ' + REGOLE_PASSWORD_TESTO
  if (m.includes('reauthentication') || m.includes('session')) return 'Per sicurezza esci, rientra e riprova.'
  return errore || 'Errore durante il salvataggio'
}
