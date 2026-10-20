// GUARDIA: ogni voce dei menu del portale deve aprire una pagina che esiste.
//
// La voce «Impostazioni → Logo» del portale cliente ha puntato per mesi (dal 2/07/2026) a
// /cliente/impostazioni/logo, una pagina mai esistita: chi la cliccava vedeva la 404 nuda di
// Next.js. Per Shopify una 404 nell'app è motivo di rifiuto («Web errors such as 404's ... are not
// acceptable», requisito 2.1.1), e nel menu del master c'erano altre due voci nella stessa
// condizione. Nessuno se ne accorge finché qualcuno non clicca: per questo il controllo sta nella
// build, come quello sugli scope Shopify, e non nella memoria di chi aggiunge una voce.
//
// Il menu si legge come codice (albero sintattico di TypeScript), non con un'espressione regolare:
// una voce che ha un sottomenu è un interruttore, non un link, e il suo href non si visita mai.
// Quello che la guardia non sa leggere ferma la build («href non leggibile») invece di passare in
// silenzio: una guardia che lascia passare le forme che non conosce non protegge niente.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..')
const APP = join(RADICE, 'app')

// I file che disegnano i menu dei portali: barra laterale e menu del profilo, cliente e master.
const MENU = [
  'app/cliente/ClienteNav.tsx',
  'app/cliente/ClienteShell.tsx',
  'app/components/Layout.tsx',
  'app/components/MenuProfilo.tsx',
]

// VOCI CHE PUNTANO A UNA PAGINA NON ANCORA COSTRUITA, PER DECISIONE ESPLICITA.
// Valgono per quella voce, in quel file, e basta. Quando la pagina nasce, o la voce sparisce, la
// guardia chiede di togliere la riga: questo elenco non deve diventare il posto dove parcheggiare
// le 404.
const DA_COSTRUIRE = [
  // Pagina da costruire, Lorenzo 20/10: la nuova fattura, collegabile a Fatture in Cloud e simili.
  // Finché manca, chi apre la voce trova la 404 del portale (app/not-found.tsx) con la via d'uscita.
  { file: 'app/components/Layout.tsx', href: '/dashboard/fatture/nuova', perche: 'pagina da costruire, Lorenzo 20/10' },
]

const cartelle = (dir) => existsSync(dir) ? readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()) : []
const FOGLIE = ['page.tsx', 'page.ts', 'page.jsx', 'page.js', 'route.ts', 'route.js']

// Un indirizzo esiste se l'albero di app/ lo serve: segmenti uguali, gruppi (x) trasparenti,
// [x] per un segmento qualunque, [...x] e [[...x]] per tutto il resto.
function esiste(segmenti, dir = APP) {
  const figli = cartelle(dir)
  for (const g of figli.filter((n) => /^\(.+\)$/.test(n))) if (esiste(segmenti, join(dir, g))) return true
  if (segmenti.length === 0) return FOGLIE.some((f) => existsSync(join(dir, f)))
  const [primo, ...resto] = segmenti
  if (primo !== '*' && figli.includes(primo) && esiste(resto, join(dir, primo))) return true
  for (const d of figli.filter((n) => /^\[[^.\]]+\]$/.test(n))) if (esiste(resto, join(dir, d))) return true
  return figli.some((n) => /^\[\[?\.\.\./.test(n))
}

// Il valore di un href: un testo fisso, oppure un testo fisso con dentro parti calcolate, che valgono
// come un segmento qualunque ('*'): '/cliente/ordini/' + p e `/cliente/ordini/${p}` diventano
// /cliente/ordini/*. Il resto torna null.
function valore(nodo) {
  if (ts.isParenthesizedExpression(nodo)) return valore(nodo.expression)
  if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) return nodo.text
  if (ts.isTemplateExpression(nodo)) return nodo.head.text + nodo.templateSpans.map((s) => '*' + s.literal.text).join('')
  if (ts.isBinaryExpression(nodo) && nodo.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const sx = valore(nodo.left)
    if (sx === null) return null
    const dx = valore(nodo.right)
    return sx + (dx === null ? '*' : dx)
  }
  return null
}

// Il nome di una proprietà o di un attributo, comunque sia scritto: href, 'href', "href".
const nome = (n) => n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) || ts.isNoSubstitutionTemplateLiteral(n.name)) ? n.name.text : null

const problemi = []
const rimandate = []
const eccezioniUsate = new Set()
let controllate = 0
for (const rel of MENU) {
  const testo = readFileSync(join(RADICE, rel), 'utf8')
  const sf = ts.createSourceFile(rel, testo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const segnala = (nodo, href) => {
    const riga = sf.getLineAndCharacterOfPosition(nodo.getStart()).line + 1
    const illeggibile = () => problemi.push(`${rel}:${riga}  href non leggibile: scrivilo come testo fisso`)
    // Una parte calcolata in testa (`${base}/x`) non dice dove porta: non e' un indirizzo esterno.
    if (href === null || href.startsWith('*')) return illeggibile()
    if (!href.startsWith('/')) return                       // esterni (https://…, mailto:) e '#'
    const segmenti = href.split(/[?#]/)[0].split('/').filter(Boolean)
    // Una parte calcolata a meta' segmento (/x/a${b}) non si confronta con le cartelle di app/.
    if (segmenti.some((s) => s.includes('*') && s !== '*')) return illeggibile()
    controllate++
    const eccezione = DA_COSTRUIRE.find((e) => e.file === rel && e.href === href)
    if (eccezione) {
      eccezioniUsate.add(eccezione)
      if (esiste(segmenti)) problemi.push(`${rel}:${riga}  ${href}: la pagina ora esiste, togli la sua riga da DA_COSTRUIRE in scripts/controlla-link-menu.mjs`)
      else rimandate.push(`${rel}:${riga}  ${href} (${eccezione.perche})`)
      return
    }
    if (!esiste(segmenti)) problemi.push(`${rel}:${riga}  ${href}`)
  }
  const visita = (nodo) => {
    if (ts.isObjectLiteralExpression(nodo)) {
      const voce = (n) => nodo.properties.find((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && nome(p) === n)
      const href = voce('href'), sub = voce('sub')
      const interruttore = sub && ts.isPropertyAssignment(sub) && ts.isArrayLiteralExpression(sub.initializer) && sub.initializer.elements.length > 0
      // { label, href }: il valore sta altrove, quindi non si sa dove porta.
      if (href && !interruttore) segnala(href, ts.isPropertyAssignment(href) ? valore(href.initializer) : null)
    }
    if (ts.isJsxAttribute(nodo) && nome(nodo) === 'href' && nodo.initializer) {
      const ini = nodo.initializer
      if (ts.isStringLiteral(ini)) segnala(nodo, ini.text)
      else if (ts.isJsxExpression(ini) && ini.expression) {
        const e = ini.expression
        // href={item.href}, href={s.href}: e' la voce di un elenco, gia' controllata come oggetto qui sopra.
        if (!ts.isPropertyAccessExpression(e)) {
          if (ts.isConditionalExpression(e)) { segnala(nodo, valore(e.whenTrue)); segnala(nodo, valore(e.whenFalse)) }
          else segnala(nodo, valore(e))
        }
      }
    }
    ts.forEachChild(nodo, visita)
  }
  visita(sf)
}
for (const e of DA_COSTRUIRE) {
  if (!eccezioniUsate.has(e)) problemi.push(`${e.file}  ${e.href}: nessuna voce di menu la usa piu', togli la sua riga da DA_COSTRUIRE in scripts/controlla-link-menu.mjs`)
}

if (problemi.length) {
  console.error('\n[LINK MENU] queste voci di menu non portano a una pagina che esiste, o non si sa dove portano:\n')
  for (const x of problemi) console.error('  ' + x)
  console.error('\nTogli la voce, crea la pagina o scrivi l\'indirizzo come testo fisso: chi clicca una voce rotta vede una 404\n(per Shopify è motivo di rifiuto).\n')
  process.exit(1)
}
console.log(`[LINK MENU] ok — ${controllate} voci, tutte con la loro pagina` + (rimandate.length ? ` tranne ${rimandate.length} da costruire per decisione esplicita:` : ''))
for (const x of rimandate) console.log('  ' + x)
