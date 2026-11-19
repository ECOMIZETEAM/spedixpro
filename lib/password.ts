import { randomInt } from 'crypto'
import { SIMBOLI_PASSWORD, erroreRegolePassword } from '@/lib/password-regole'

// LE PASSWORD CHE GENERA LA PIATTAFORMA (nuovi clienti, master, staff, demo, registrazioni, preventivi,
// reset dalla scheda, primo accesso da "entra come"). Prima erano dieci copie diverse: nessuna garantiva
// maiuscola, minuscola, numero e simbolo insieme (con 14 caratteri scelti a caso il simbolo manca circa
// una volta su due) e tre non avevano simboli per niente. Con l'obbligo acceso su Supabase meta' delle
// creazioni di clienti sarebbe fallita. Qui un carattere per tipo e' garantito, e il caso viene da
// crypto, non da Math.random (prevedibile: mai per un segreto).
//
// Sotto i 12 caratteri Supabase rifiuta la password. E' gia' successo: con 10 caratteri l'accesso del
// cliente non si creava, l'errore non veniva letto e l'email con le credenziali partiva lo stesso.
//
// Niente lettere che si confondono (I l 1 O 0): queste password arrivano per email e si ricopiano.
const MAIUSCOLE = 'ABCDEFGHJKMNPQRSTUVWXYZ'
const MINUSCOLE = 'abcdefghjkmnpqrstuvwxyz'
const NUMERI = '23456789'
const TUTTI = MAIUSCOLE + MINUSCOLE + NUMERI + SIMBOLI_PASSWORD

export function generaPassword(lunghezza = 16): string {
  const n = Math.max(lunghezza, 12)
  const pesca = (s: string) => s[randomInt(s.length)]
  const caratteri = [pesca(MAIUSCOLE), pesca(MINUSCOLE), pesca(NUMERI), pesca(SIMBOLI_PASSWORD)]
  while (caratteri.length < n) caratteri.push(pesca(TUTTI))
  // Mescolati, perche' i quattro garantiti non stiano sempre in testa.
  for (let i = caratteri.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[caratteri[i], caratteri[j]] = [caratteri[j], caratteri[i]]
  }
  const password = caratteri.join('')
  // Non puo' succedere, ma se le regole cambiassero senza aggiornare qui, meglio saperlo subito.
  const errore = erroreRegolePassword(password)
  if (errore) throw new Error('generaPassword: ' + errore)
  return password
}
