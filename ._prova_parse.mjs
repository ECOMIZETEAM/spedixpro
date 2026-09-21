import fs from 'node:fs'
import Papa from 'papaparse'
const src = fs.readFileSync('app/api/ordini/importa/route.ts','utf8')
const nh = src.match(/function normHeader\(s: string\) \{[\s\S]*?\n\}/)[0].replace(': string','')
const normHeader = new Function(`${nh}; return normHeader`)()
// BLOCCO PRESO DAL CODICE VERO (da "const opzioni" alla fine del recupero righe virgolettate)
let blocco = src.match(/ {6}const opzioni = \{[\s\S]*?\n {6}\}\n {4}\}/)[0]
blocco = blocco.replace(/ as const/g, '').replace(/ as any/g, '').replace(/<Record<string, string>>/g, '')
   .replace(/\n {4}\}$/, '')   // via la graffa dell'else del ramo xlsx
const esegui = new Function('text','Papa','normHeader','console', `
  let rows = []; let intestazioni = null;
  const nl = text.indexOf('\\n');
  const eTsv = text.slice(0, nl >= 0 ? nl : text.length).includes('\\t');
  ${blocco}
  return { rows, intestazioni }
`)
const ALIAS = {}
for (const c of ['destinatario','indirizzo','cap','localita','provincia','telefono','order_id']) {
  const m = src.match(new RegExp('^\\s*' + c + ':\\s*\\[([^\\]]*)\\]', 'm'))
  ALIAS[c] = m[1].split(',').map(s => s.trim().replace(/^'|'$/g,''))
}
for (const f of process.argv.slice(2)) {
  const { rows, intestazioni } = esegui(fs.readFileSync(f,'utf8'), Papa, normHeader, console)
  const headers = new Set(intestazioni?.length ? intestazioni : Object.keys(rows[0]||{}))
  const mappa = Object.fromEntries(Object.entries(ALIAS).map(([c,a]) => [c, a.find(x => headers.has(x)) || null]))
  const mancanti = ['destinatario','indirizzo','cap','localita'].filter(c => !mappa[c])
  const g = (r,c) => mappa[c] ? String(r[mappa[c]] ?? '').trim() : ''
  console.log(`\n=== ${f.split('/').pop()}`)
  console.log('  righe:', rows.length, '| colonne:', headers.size, '| mancanti:', mancanti.length ? mancanti.join(',') : 'nessuna')
  if (rows[0]) console.log('  1ª riga →', [g(rows[0],'destinatario'), g(rows[0],'indirizzo'), g(rows[0],'cap'), g(rows[0],'localita'), g(rows[0],'provincia'), g(rows[0],'telefono')].join(' | '))
  if (rows[1]) console.log('  2ª riga →', [g(rows[1],'destinatario'), g(rows[1],'indirizzo'), g(rows[1],'cap'), g(rows[1],'localita'), g(rows[1],'provincia'), g(rows[1],'telefono')].join(' | '))
}
