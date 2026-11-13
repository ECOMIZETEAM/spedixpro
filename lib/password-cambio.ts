import bcrypt from 'bcryptjs'
import {
  ORE_TRA_DUE_CAMBI, PASSWORD_RICORDATE, erroreNomeInPassword, erroreRegolePassword, partiDelNome,
} from '@/lib/password-regole'

// CAMBIO PASSWORD E SCADENZA (politica Amazon sui dati, 1.4.1) — la parte che Supabase non fa.
// La memoria sta nel database (scripts/password-regole.sql): le impronte delle ultime 10 password, la
// data dell'ultimo cambio, chi la deve cambiare. Qui i controlli che hanno bisogno della password in
// chiaro, che al database non arriva mai: il confronto con le impronte si fa qui, non con una funzione
// SQL, perche' i parametri di una query possono finire nei log del database.
// I client Supabase arrivano come parametro, come in lib/verifica-due-passaggi.

// I metodi con cui e' nata la sessione (amr del token): 'password', 'otp' (link per email, "entra
// come", app Shopify), 'totp' (codice). Il token l'ha gia' verificato getUser(): qui si legge e basta.
export function metodiSessione(accessToken: string | undefined | null): string[] {
  try {
    const corpo = JSON.parse(Buffer.from(String(accessToken || '').split('.')[1] || '', 'base64url').toString('utf8'))
    return Array.isArray(corpo?.amr) ? corpo.amr.map((m: any) => String(m?.method || '')) : []
  } catch {
    return []
  }
}

// I controlli prima del cambio. null = si puo' cambiare; altrimenti il messaggio per l'utente.
// `daLink`: sessione aperta da un link per email (recupero, invito). Li' l'eta' minima non vale:
// chi ha dimenticato la password appena cambiata deve poterla rifare.
export async function controlliCambioPassword(admin: any, utente: { id: string; email?: string | null; nome?: string | null; cognome?: string | null }, password: string, daLink: boolean): Promise<string | null> {
  const regole = erroreRegolePassword(password)
  if (regole) return regole
  const nome = erroreNomeInPassword(password, partiDelNome(utente.nome, utente.cognome, utente.email))
  if (nome) return nome

  const { data: storico, error } = await admin.rpc('password_storico_utente', { p_utente: utente.id })
  if (error) {
    // Senza storico non si ferma il cambio: bloccherebbe anche chi ha dimenticato la password. Si dice
    // nel log.
    console.error('[PASSWORD] storico non letto, cambio senza controllo del riuso:', utente.id, error.message)
    return null
  }
  const righe = (storico || []) as { impronta: string; origine: string; cambiata_il: string | null }[]

  const ultima = righe[0]
  if (!daLink && ultima?.origine === 'utente' && ultima.cambiata_il) {
    const da = new Date(new Date(ultima.cambiata_il).getTime() + ORE_TRA_DUE_CAMBI * 3600_000)
    if (da.getTime() > Date.now()) {
      const quando = da.toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
      return `Hai già cambiato la password nelle ultime ${ORE_TRA_DUE_CAMBI} ore: la puoi cambiare di nuovo dal ${quando}. Se non la ricordi, esci e usa «Password dimenticata».`
    }
  }

  for (const r of righe) {
    // Un'impronta che non e' bcrypt (non ce ne sono, ma non deve far saltare il cambio) si salta.
    if (!/^\$2[aby]\$\d\d\$/.test(r.impronta || '')) continue
    if (await bcrypt.compare(password, r.impronta)) {
      return `Questa password l'hai già usata: scegline una diversa dalle ultime ${PASSWORD_RICORDATE}.`
    }
  }
  return null
}

// ALL'ACCESSO CON PASSWORD: l'unico momento in cui la password passa in chiaro dal server. Si segna chi
// la deve cambiare (scaduta, o vecchia e fuori regola); il cambio lo chiede poi il middleware, dopo il
// codice della verifica in due passaggi. Un guasto qui non deve mai impedire di entrare.
export async function controllaPasswordAlLogin(admin: any, utente: { id: string; email?: string | null; nome?: string | null; cognome?: string | null }, password: string): Promise<string | null> {
  try {
    const fuoriRegole = !!erroreRegolePassword(password) || !!erroreNomeInPassword(password, partiDelNome(utente.nome, utente.cognome, utente.email))
    const { data, error } = await admin.rpc('password_controllo_accesso', { p_utente: utente.id, p_fuori_regole: fuoriRegole })
    if (error) {
      // PGRST202: script non ancora applicato. Il resto si dice.
      if (error.code !== 'PGRST202') console.error('[PASSWORD] controllo all\'accesso non riuscito:', utente.id, error.message)
      return null
    }
    return (data as string | null) || null
  } catch (e: any) {
    console.error('[PASSWORD] controllo all\'accesso non riuscito:', utente.id, e?.message)
    return null
  }
}
