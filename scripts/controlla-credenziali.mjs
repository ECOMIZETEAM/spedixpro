// GUARDIA: nessuna query puo' chiedere `credenziali` con il token di un utente.
//
// La colonna `corrieri.credenziali` contiene le chiavi di accesso ai sistemi dei corrieri e non e'
// piu' leggibile dal ruolo `authenticated` (vedi scripts/rls-scritture-staff.sql). Conseguenza da
// ricordare: una query che la nomina usando il client dell'UTENTE non torna vuota — FALLISCE, e
// PostgREST fa fallire l'INTERA query, embed compresi.
//
// E' successo il 31/07/2026: /api/spedizioni/tariffe chiedeva `corrieri(...,credenziali,...)` col
// client dell'utente, la query andava in errore, il codice guardava solo `data` e mostrava al
// cliente "Listino vuoto — configura le fasce prezzi". Listini perfetti, cliente fermo.
//
// Questo controllo gira nella build: se qualcuno riscrive una lettura di `credenziali` senza
// client amministrativo, la build si ferma qui invece di rompersi in produzione.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RADICI = ['app', 'lib']
const CLIENT_AMMESSI = /createAdminSupabase\(\)|\badmin\b|\badminDb\b|\badminCrea\b|adminSupabase|_admChiusura|_adminChiusura|_dbChiusura|_admR/

function file(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    const st = statSync(p)
    if (st.isDirectory()) file(p, out)
    else if (/\.(ts|tsx)$/.test(n)) out.push(p)
  }
  return out
}

const problemi = []
for (const p of RADICI.flatMap(r => file(r))) {
  const righe = readFileSync(p, 'utf8').split('\n')
  righe.forEach((riga, i) => {
    if (!/credenziali/.test(riga)) return
    if (!/\.select\(|corrieri\(/.test(riga)) return        // solo le LETTURE
    if (/^\s*\/\//.test(riga)) return                       // commenti
    if (/integrazioni/.test(riga)) return                   // altra tabella, altri permessi
    // La riga stessa, o le 6 precedenti (la query e' spesso spezzata su piu' righe), deve
    // nominare un client amministrativo.
    const contesto = righe.slice(Math.max(0, i - 12), i + 1).join('\n')
    if (!CLIENT_AMMESSI.test(contesto)) problemi.push(`${p}:${i + 1}  ${riga.trim().slice(0, 120)}`)
  })
}

if (problemi.length) {
  console.error('\n[CREDENZIALI] queste letture NON usano il client amministrativo:\n')
  for (const x of problemi) console.error('  ' + x)
  console.error('\nCon il token di un utente la query FALLISCE per intero (permesso negato sulla colonna).')
  console.error('Usa createAdminSupabase() per leggere le credenziali del contratto.\n')
  process.exit(1)
}
console.log('[CREDENZIALI] ok: tutte le letture passano dal client amministrativo')
