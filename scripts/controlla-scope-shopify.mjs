// Gli scope OAuth di Shopify stanno per forza in due posti: shopify.app.toml (quello che Shopify
// pubblica, approva e mostra al negoziante) e la costante che finisce nel parametro `scope`
// dell'authorize URL. Non c'e' modo di far derivare l'uno dall'altro — il toml lo legge Shopify, non
// noi — quindi l'unica difesa e' che la build si rifiuti di partire se divergono.
//
// Cosa succede quando divergono, ed e' successo: si chiedono al negoziante permessi diversi da
// quelli approvati; Shopify concede quelli che vuole lui e il negozio resta collegato ma cieco sui
// fulfillment order — nessuna evasione arriva piu' allo store, e da fuori sembra tutto a posto.
import { readFileSync } from 'node:fs'

const toml = readFileSync(new URL('../shopify.app.toml', import.meta.url), 'utf8')
const lib = readFileSync(new URL('../lib/shopify.ts', import.meta.url), 'utf8')

const daToml = (toml.match(/^\s*scopes\s*=\s*"([^"]*)"/m) || [])[1]
const daLib = (lib.match(/export const SHOPIFY_SCOPES\s*=\s*'([^']*)'/) || [])[1]

if (!daToml || !daLib) {
  console.error('[SCOPE SHOPIFY] non trovo la lista degli scope in shopify.app.toml o in lib/shopify.ts')
  process.exit(1)
}
const norm = (s) => s.split(',').map((x) => x.trim()).filter(Boolean).sort().join(',')
if (norm(daToml) !== norm(daLib)) {
  console.error('[SCOPE SHOPIFY] le due liste NON coincidono:')
  console.error('  shopify.app.toml : ' + daToml)
  console.error('  lib/shopify.ts   : ' + daLib)
  console.error('Allineale (e ricordati di rifare `shopify app deploy` se hai cambiato il toml).')
  process.exit(1)
}
console.log('[SCOPE SHOPIFY] ok — ' + daLib)
