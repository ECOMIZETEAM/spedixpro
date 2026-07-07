import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend } from 'k6/metrics'

// Load test READ-ONLY sul layer DB (PostgREST/RPC di Supabase) con un utente reale.
// Misura il vero collo di bottiglia (il database) isolato da Vercel.
// NON crea spedizioni: colpisce solo dashboard-RPC + elenco spedizioni (limit 200).

const SUPA_URL = __ENV.SUPA_URL
const ANON     = __ENV.SUPA_ANON
const EMAIL    = __ENV.EMAIL
const PASSWORD = __ENV.PASSWORD
const ROLE     = __ENV.ROLE || 'master'   // 'master' oppure 'cliente'

export const options = {
  // Rampa: sali fino a 500 utenti concorrenti per trovare il tetto del tier attuale.
  // Abbassa i target se vuoi un test più leggero.
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m',  target: 200 },
    { duration: '1m',  target: 500 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],   // 95% delle richieste sotto 1s
    http_req_failed:   ['rate<0.01'],     // meno dell'1% di errori
  },
}

const dashTrend = new Trend('dashboard_ms', true)
const listTrend = new Trend('elenco_spedizioni_ms', true)

export function setup() {
  const login = http.post(`${SUPA_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { apikey: ANON, 'Content-Type': 'application/json' } })
  const body = login.json()
  const token = body.access_token
  const uid = body.user && body.user.id
  if (!token) throw new Error('Login fallito: ' + login.body)

  const col = ROLE === 'cliente' ? 'cliente_id' : 'master_id'
  const u = http.get(`${SUPA_URL}/rest/v1/utenti?select=${col}&id=eq.${uid}`,
    { headers: { apikey: ANON, Authorization: `Bearer ${token}` } })
  const id = u.json()[0][col]
  console.log(`Autenticato come ${ROLE}, ${col}=${id}`)
  return { token, id }
}

export default function (data) {
  const h = { headers: { apikey: ANON, Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' } }

  // 1) Dashboard — la funzione DB ottimizzata (hot path #1)
  const fn    = ROLE === 'cliente' ? 'dashboard_contatori_cliente' : 'dashboard_contatori_master'
  const param = ROLE === 'cliente' ? { p_cliente: data.id } : { p_master: data.id }
  const r1 = http.post(`${SUPA_URL}/rest/v1/rpc/${fn}`, JSON.stringify(param), h)
  dashTrend.add(r1.timings.duration)
  check(r1, { 'dashboard 200': (r) => r.status === 200 })

  // 2) Elenco spedizioni (limit 200) — hot path #2
  const col = ROLE === 'cliente' ? 'cliente_id' : 'master_id'
  const r2 = http.get(`${SUPA_URL}/rest/v1/spedizioni?${col}=eq.${data.id}&order=created_at.desc&limit=200&select=id,numero,stato,created_at,tracking_number`, h)
  listTrend.add(r2.timings.duration)
  check(r2, { 'elenco 200': (r) => r.status === 200 })

  sleep(1)
}
