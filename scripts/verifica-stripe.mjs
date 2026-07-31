// VERIFICA DELLA CONFIGURAZIONE DEL PAGAMENTO CON CARTA.
//
// Legge la chiave da .env.local (che git ignora: la chiave non entra mai nel repository) e
// racconta com'e' messo l'account: modalita', listino creato, aliquota IVA, webhook registrato
// con i suoi eventi, abbonamenti in corso.
//
// E' di sola LETTURA: non crea, non modifica, non incassa niente. Si puo' eseguire anche
// sull'account vero senza rischi.
//
//   node scripts/verifica-stripe.mjs
import { readFileSync } from 'fs'
import Stripe from 'stripe'

const PIANI = ['enterprise_5k','enterprise_10k','enterprise_20k','enterprise_50k',
               'enterprise_80k','enterprise_100k','enterprise_120k','enterprise_150k']

function env() {
  try {
    return Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n')
      .filter(r => r.includes('=') && !r.trim().startsWith('#'))
      .map(r => [r.slice(0, r.indexOf('=')).trim(), r.slice(r.indexOf('=') + 1).trim()]))
  } catch { return {} }
}

const e = { ...env(), ...process.env }
const chiave = e.STRIPE_SECRET_KEY
if (!chiave) {
  console.log('❌ STRIPE_SECRET_KEY non trovata in .env.local — mettila li e riprova.')
  process.exit(1)
}
const s = new Stripe(chiave)
const vivo = chiave.startsWith('sk_live') || chiave.startsWith('rk_live')

console.log(`\n═══ MODALITA': ${vivo ? '⚠️  REALE (soldi veri)' : '🧪 PROVA'} ═══\n`)

try {
  const acct = await s.accounts.retrieve()
  console.log(`Account   : ${acct.business_profile?.name || acct.settings?.dashboard?.display_name || acct.id}`)
  console.log(`Paese     : ${acct.country}   Pagamenti attivi: ${acct.charges_enabled ? 'sì' : 'NO — completa l\'attivazione'}`)
} catch (err) {
  console.log(`Account   : non leggibile con questa chiave (${err.message})`)
}

console.log('\n── Listino sul circuito ──')
let creati = 0
for (const p of PIANI) {
  const l = await s.prices.list({ lookup_keys: [`moov_${p}`], active: true, limit: 1 })
  const pr = l.data[0]
  if (!pr) { console.log(`  ${p.padEnd(18)} non ancora creato (nasce alla prima attivazione)`); continue }
  creati++
  const iva = pr.tax_behavior === 'inclusive' ? 'prezzo finito' : pr.tax_behavior === 'exclusive' ? '⚠️ QUALCOSA SI AGGIUNGE AL PREZZO' : '⚠️ non specificato'
  console.log(`  ${p.padEnd(18)} € ${(pr.unit_amount / 100).toFixed(2)} / ${pr.recurring?.interval}   ${iva}`)
}
if (!creati) console.log('  (nessun prezzo ancora: si creano da soli alla prima attivazione di un piano)')

console.log('\n── Aliquota IVA ──')
const tr = await s.taxRates.list({ active: true, limit: 100 })
const ita = tr.data.filter(t => t.country === 'IT')
if (!ita.length) console.log('  nessuna — corretto: la societa\' che fattura e\' estera, si applica l\'inversione contabile')
for (const t of ita) console.log(`  ${t.percentage}% ${t.inclusive ? 'compresa nel prezzo' : 'da aggiungere al prezzo'} — ${t.display_name}`)

console.log('\n── Webhook registrati ──')
const ATTESI = ['checkout.session.completed','customer.subscription.created','customer.subscription.updated',
                'customer.subscription.deleted','invoice.paid','invoice.payment_failed',
                'invoice.payment_action_required']
const wh = await s.webhookEndpoints.list({ limit: 20 })
if (!wh.data.length) console.log('  ❌ nessuno — il piano non si attiverebbe mai dopo il pagamento')
for (const w of wh.data) {
  console.log(`  ${w.url}   [${w.status}]`)
  const mancanti = ATTESI.filter(x => !w.enabled_events.includes(x) && !w.enabled_events.includes('*'))
  console.log(mancanti.length ? `     ⚠️  eventi mancanti: ${mancanti.join(', ')}` : '     ✓ tutti gli eventi necessari')
}

console.log('\n── Abbonamenti in corso ──')
const subs = await s.subscriptions.list({ limit: 20, expand: ['data.customer'] })
if (!subs.data.length) console.log('  nessuno')
for (const sub of subs.data) {
  const c = typeof sub.customer === 'object' ? sub.customer : null
  const imp = sub.items.data[0]
  console.log(`  ${(c?.name || c?.email || sub.customer).toString().padEnd(28)} ${imp?.price?.lookup_key || imp?.price?.id}  € ${((imp?.price?.unit_amount || 0) / 100).toFixed(2)}  [${sub.status}]`)
}

console.log('\n── Ultime fatture ──')
const inv = await s.invoices.list({ limit: 5 })
if (!inv.data.length) console.log('  nessuna')
for (const i of inv.data) {
  console.log(`  ${new Date(i.created * 1000).toLocaleDateString('it-IT')}  € ${((i.amount_paid || 0) / 100).toFixed(2)}  ${i.status}  ${i.id}`)
}
console.log('')
