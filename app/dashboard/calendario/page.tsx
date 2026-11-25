import { getPermessiUtente, haPermesso } from '@/lib/permessi'
import { gestisceLaRete } from '@/lib/ruoli'
import Calendario from '@/app/components/calendario/Calendario'

// Il calendario del portale master (titolare, admin, operatori, agenti). I ritiri compaiono solo a chi vede l'Elenco
// Ritiri e le giacenze solo a chi vede la pagina Giacenze: la stessa regola del menu (Layout, puoVedere). La rotta
// /api/calendario/automatici la rifà da sé, questa serve solo a non mostrare filtri vuoti.
export default async function PaginaCalendario() {
  const p = await getPermessiUtente()
  const autista = p?.ruolo === 'autista'
  return (
    <Calendario
      portale="master"
      vedeRitiri={!autista && haPermesso(p, 'admin.pickups.index')}
      vedeGiacenze={!autista && haPermesso(p, 'admin.stocks.index')}
      // gli inviti li manda lo staff (titolare, admin, operatore); la rotta lo ricontrolla da sé
      puoInvitare={!!p && gestisceLaRete(p)}
    />
  )
}
