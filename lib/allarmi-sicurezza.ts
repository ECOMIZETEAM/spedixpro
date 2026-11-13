// ALLARMI DI SICUREZZA: quello che serve sia all'email (/api/controllo/allarmi) sia alla pagina
// (/dashboard/sicurezza). Le regole stanno nel database (scripts/allarmi-sicurezza.sql); qui solo testi
// per chi legge e i nomi da mettere accanto agli id. Nessun import lato server: i client arrivano come
// parametro, e la pagina importa i testi.

// Il nome breve, per l'elenco.
export const NOME_ALLARME: Record<string, string> = {
  accesso_bloccato: 'Accesso bloccato',
  tentativi_su_molti_account: 'Password provate su molti account',
  letture_anomale: 'Letture fuori misura',
  etichette_anomale: 'Etichette scaricate fuori misura',
  api_anomala: 'API: letture fuori misura',
  frequenza_api: 'API: limite di frequenza superato',
  chiamate_non_autorizzate: 'API: chiamate non autorizzate',
  entra_come_anomalo: '«Entra come» a raffica',
  verifica_azzerata: 'Verifica in due passaggi azzerata',
  esca: 'Esca toccata',
  verifica_spenta: 'Verifica in due passaggi spenta',
}

export const COSA_FARE_ALLARME: Record<string, string> = {
  accesso_bloccato: "Se l'account è di un cliente, sentilo: se non era lui a sbagliare, va cambiata la password. Il blocco si toglie da solo dopo 15 minuti.",
  tentativi_su_molti_account: "Qualcuno prova password rubate su altri siti. Guarda nel registro accessi se uno di questi account è poi entrato davvero.",
  letture_anomale: "Senti chi c'è dietro: un lavoro vero (cambio gestionale, inventario) o qualcuno che si porta via i dati? Se non ne sa niente: cambio password e azzeramento della verifica in due passaggi.",
  etichette_anomale: "Senti chi c'è dietro: un lavoro vero (cambio gestionale, inventario) o qualcuno che si porta via i dati? Se non ne sa niente: cambio password e azzeramento della verifica in due passaggi.",
  api_anomala: "Senti il cliente: se non è un suo programma, la chiave va revocata dal suo portale (Impostazioni → Chiavi API).",
  frequenza_api: "Le chiamate in più sono già state respinte. Senti il cliente: se non è un suo programma, la chiave va revocata.",
  chiamate_non_autorizzate: "Se è un gestionale rimasto con una chiave vecchia, va avvisato il cliente. Se le chiavi sono tutte diverse e continua, qualcuno sta provando chiavi a caso.",
  entra_come_anomalo: "Chiedi alla persona il motivo: entrare negli account degli altri serve all'assistenza, a raffica no.",
  verifica_azzerata: "Controlla che il cliente l'abbia chiesto davvero (telefono cambiato o perso). Se non l'ha chiesto, è il primo passo per prendersi un account.",
  esca: "Nessun lavoro vero tocca un'esca: va trattato come incidente (piano di risposta agli incidenti; se ci sono di mezzo dati Amazon, avviso ad Amazon entro 24 ore).",
  verifica_spenta: "Se non è stato spento apposta, va riacceso subito: scripts/verifica-due-passaggi.sql.",
}

export type Nomi = { utente: (id: string) => string; cliente: (id: string) => string; clienteDi: (id: string) => string | null }

// Nomi leggibili per utenti e clienti: nel registro degli allarmi restano solo gli id.
// Utente: "Nome Cognome, cliente Ragione Sociale" oppure "Nome Cognome, admin di Master".
export async function nomiPerId(admin: any, idUtenti: string[], idClienti: string[]): Promise<Nomi> {
  const uU = [...new Set(idUtenti.filter(Boolean))]
  const { data: utenti } = uU.length
    ? await admin.from('utenti').select('id, nome, cognome, ruolo, cliente_id, master_id').in('id', uU)
    : { data: [] as any[] }
  const uC = [...new Set([...idClienti, ...(utenti || []).map((u: any) => u.cliente_id)].filter(Boolean))]
  const uM = [...new Set((utenti || []).map((u: any) => u.master_id).filter(Boolean))]
  const [{ data: clienti }, { data: masters }] = await Promise.all([
    uC.length ? admin.from('clienti').select('id, ragione_sociale').in('id', uC) : Promise.resolve({ data: [] as any[] }),
    uM.length ? admin.from('masters').select('id, nome').in('id', uM) : Promise.resolve({ data: [] as any[] }),
  ])
  const nomeCliente = new Map<string, string>((clienti || []).map((c: any) => [c.id, c.ragione_sociale]))
  const nomeMaster = new Map<string, string>((masters || []).map((m: any) => [m.id, m.nome]))
  const perUtente = new Map<string, any>((utenti || []).map((u: any) => [u.id, u]))
  return {
    utente: (id: string) => {
      const u = perUtente.get(id)
      if (!u) return id ? `utente ${id}` : ''
      const persona = [u.nome, u.cognome].filter(Boolean).join(' ')
      const dove = u.cliente_id ? `cliente ${nomeCliente.get(u.cliente_id) || ''}` : `${u.ruolo || 'staff'} di ${nomeMaster.get(u.master_id) || 'un master'}`
      return [persona, dove].filter(Boolean).join(', ')
    },
    cliente: (id: string) => (id ? `cliente ${nomeCliente.get(id) || id}` : ''),
    clienteDi: (id: string) => perUtente.get(id)?.cliente_id || null,
  }
}

// "Chi" di un allarme: l'utente, e il cliente se e' un altro.
export function chiAllarme(a: any, nomi: Nomi): string {
  const parti: string[] = []
  if (a.utente_id) parti.push(nomi.utente(a.utente_id))
  if (a.cliente_id && a.cliente_id !== (a.utente_id ? nomi.clienteDi(a.utente_id) : null)) parti.push(nomi.cliente(a.cliente_id))
  return parti.join(' · ')
}
