// "VIETA CANCELLAZIONE LDV": interruttore che il master accende sul singolo cliente (Impostazioni
// cliente). Se e' acceso, il cliente NON cancella le sue spedizioni: lo comunica al master, che le
// cancella lui dal suo portale.
//
// Sta QUI, non dentro una rotta, perche' le porte da cui un CLIENTE fa partire una cancellazione sono
// due: il portale (/api/spedizioni/elimina) e la API partner (/api/v1/shipments/[id] DELETE, dove la
// chiave agisce PER CONTO del cliente). Una guardia messa solo nel portale sarebbe aggirabile con una
// chiamata API — e domani le porte potrebbero essere tre.
//
// A monte ci pensa il database: il cliente non puo' spegnersi il flag da solo, glielo impedisce il
// trigger trg_flag_master_non_dal_cliente su `clienti` (le regole per riga gli lascerebbero la sua).
//
// Il MASTER non e' toccato da questa regola: il blocco vale per chi spedisce, non per chi gestisce.

export const MSG_CANCELLAZIONE_VIETATA =
  'Il tuo master ha disattivato la cancellazione delle spedizioni: comunicagli quale annullare e la cancella lui.'

/** true = questo cliente NON puo' cancellare. `admin` e' un client service-role gia' aperto da chi chiama. */
export async function clienteNonPuoCancellare(admin: any, clienteId: string | null | undefined): Promise<boolean> {
  if (!clienteId) return false
  const { data } = await admin.from('clienti').select('vieta_cancellazione').eq('id', clienteId).maybeSingle()
  return (data as any)?.vieta_cancellazione === true
}
