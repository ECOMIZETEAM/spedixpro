import { createServerSupabase } from '@/lib/supabase'

// Default permessi per ruolo (usati se il master non ha ancora salvato nulla in master_permessi).
// true = permesso attivo. Admin/master hanno sempre tutto (non serve elencarli).
export const PERMESSI_DEFAULT: Record<string, Record<string, boolean>> = {
  operatore: {
    'admin.shippings.index': true, 'admin.shippings.create': true, 'admin.shippings.edit': true, 'admin.shippings.delete': true, 'admin.shippings.cancelled.index': true,
    'admin.stocks.index': true, 'admin.stocks.edit': true, 'admin.stocks.update': true,
    'admin.cod.index': true, 'admin.cod.update': true, 'admin.cod.excel': true, 'admin.cod.bulk_update': true, 'admin.codlists.index': true, 'admin.codlists.uploadfile': true,
    'admin.shippings.weight_corrections.index': true, 'admin.shippings.weight_corrections.uploadfile': true, 'admin.shippings.weight_corrections.confirm': true, 'admin.shippings.weight_corrections.delete': true,
    'admin.pickups.index': true,
    'admin.shippinglists.create': true, 'admin.shippinglists.index': true, 'admin.shippinglists.confirm': true, 'admin.shippinglists.print': true,
    'admin.renderlist.scan': true, 'admin.renderlist.index': true,
    'admin.pricelists.create': false, 'admin.pricelists.index': true, 'admin.pricelists.edit': true, 'admin.pricelists.delete': false, 'admin.pricelists.vector': false, 'admin.pricelists.zones.index': true, 'admin.pricelists.zones.create': true, 'admin.pricelists.zones.edit': true,
    'admin.clients.create': false, 'admin.clients.index': true, 'admin.clients.view': true, 'admin.clients.edit': false, 'admin.clients.options': false, 'admin.clients.credit': true,
    'admin.drivers.index': true, 'admin.drivers.create': true, 'admin.drivers.resetpassword': false, 'admin.drivers.delete': false, 'admin.drivers.collections': true, 'admin.drivers.pickuplists': true, 'admin.drivers.deliveries': true, 'admin.drivers.fleetmap': false,
    'admin.consumables.create': true, 'admin.consumables.index': true,
    'admin.invoice.create': true, 'admin.invoice.index': true,
    'admin.reports.shippings': true, 'admin.reports.stocks': true, 'admin.reports.shippinglists': true, 'admin.reports.cod': true, 'admin.reports.pickups': true, 'admin.reports.priceupdates': true, 'admin.reports.consumables': true, 'admin.reports.invoices': true, 'admin.reports.rendershippings': true, 'admin.reports.sms.clients': true, 'admin.reports.sms.admin': false,
    'admin.notification': false,
    'admin.interno.deliveries.out': true, 'admin.interno.deliveries.in': true, 'admin.interno.inbound.scan': true, 'admin.interno.outbound.scan': true, 'admin.interno.cod.sent': true, 'admin.interno.cod.received': true, 'admin.interno.codlists.index': true, 'admin.interno.codlists.generate': true, 'admin.interno.codlists.excelexport': true, 'admin.interno.stocks': true,
  },
  agente: {
    'admin.shippings.index': true, 'admin.shippings.create': true, 'admin.shippings.edit': true, 'admin.shippings.delete': true, 'admin.shippings.cancelled.index': true,
    'admin.stocks.index': true, 'admin.stocks.edit': true, 'admin.stocks.update': true,
    'admin.cod.index': true, 'admin.cod.update': true, 'admin.cod.excel': true, 'admin.cod.bulk_update': true, 'admin.codlists.index': true, 'admin.codlists.uploadfile': true,
    'admin.shippings.weight_corrections.index': false, 'admin.shippings.weight_corrections.uploadfile': false, 'admin.shippings.weight_corrections.confirm': false, 'admin.shippings.weight_corrections.delete': false,
    'admin.pickups.index': false,
    'admin.shippinglists.create': true, 'admin.shippinglists.index': true, 'admin.shippinglists.confirm': true, 'admin.shippinglists.print': true,
    'admin.renderlist.scan': false, 'admin.renderlist.index': false,
    'admin.pricelists.create': true, 'admin.pricelists.index': false, 'admin.pricelists.edit': false, 'admin.pricelists.delete': false, 'admin.pricelists.vector': false, 'admin.pricelists.zones.index': false, 'admin.pricelists.zones.create': false, 'admin.pricelists.zones.edit': false,
    'admin.clients.create': true, 'admin.clients.index': true, 'admin.clients.view': false, 'admin.clients.edit': false, 'admin.clients.options': false, 'admin.clients.credit': false,
    'admin.drivers.index': false, 'admin.drivers.create': false, 'admin.drivers.resetpassword': false, 'admin.drivers.delete': false, 'admin.drivers.collections': false, 'admin.drivers.pickuplists': false, 'admin.drivers.deliveries': false, 'admin.drivers.fleetmap': false,
    'admin.consumables.create': false, 'admin.consumables.index': false,
    'admin.invoice.create': false, 'admin.invoice.index': true,
    'admin.reports.shippings': false, 'admin.reports.stocks': false, 'admin.reports.shippinglists': false, 'admin.reports.cod': false, 'admin.reports.pickups': false, 'admin.reports.priceupdates': false, 'admin.reports.consumables': false, 'admin.reports.invoices': false, 'admin.reports.rendershippings': false, 'admin.reports.sms.clients': false, 'admin.reports.sms.admin': false,
    'admin.notification': false,
    'admin.interno.deliveries.out': false, 'admin.interno.deliveries.in': false, 'admin.interno.inbound.scan': false, 'admin.interno.outbound.scan': false, 'admin.interno.cod.sent': false, 'admin.interno.cod.received': false, 'admin.interno.codlists.index': false, 'admin.interno.codlists.generate': false, 'admin.interno.codlists.excelexport': false, 'admin.interno.stocks': false,
  },
}

export type PermessiUtente = {
  ruolo: string
  masterId: string | null
  nome: string
  isFull: boolean            // admin/master: tutto permesso
  gestioneRete: boolean      // può gestire la propria rete di sotto-master (menu/pagine/API Master)
  permessi: Record<string, boolean>
}

export async function getPermessiUtente(): Promise<PermessiUtente | null> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  if (!u) return null
  const ruolo = (u.ruolo || '').toLowerCase()
  const nome = ((u.nome || '') + ' ' + (u.cognome || '')).trim()
  const isFull = ruolo === 'admin' || ruolo === 'master'

  // Gestione rete/sotto-master: consentita solo ai master col flag gestione_rete.
  let gestioneRete = false
  if (u.master_id) {
    const { data: m } = await supabase.from('masters').select('gestione_rete').eq('id', u.master_id).maybeSingle()
    gestioneRete = !!(m && (m as any).gestione_rete)
  }

  if (isFull) {
    return { ruolo, masterId: u.master_id || null, nome, isFull: true, gestioneRete, permessi: {} }
  }
  let permessi: Record<string, boolean> = { ...(PERMESSI_DEFAULT[ruolo] || {}) }
  if (u.master_id) {
    const { data: mp } = await supabase.from('master_permessi').select('permessi').eq('master_id', u.master_id).maybeSingle()
    const salvati = (mp && (mp as any).permessi && (mp as any).permessi[ruolo]) || null
    if (salvati && typeof salvati === 'object') {
      permessi = { ...permessi, ...salvati }
    }
  }
  return { ruolo, masterId: u.master_id || null, nome, isFull: false, gestioneRete, permessi }
}

// Helper server-side per proteggere pagine/API della gestione rete.
export async function puoGestireRete(): Promise<boolean> {
  const p = await getPermessiUtente()
  return !!p?.gestioneRete
}

export function haPermesso(p: PermessiUtente | null, chiave: string): boolean {
  if (!p) return false
  if (p.isFull) return true
  return p.permessi[chiave] === true
}