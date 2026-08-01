import { readFileSync, writeFileSync } from 'fs'
const e = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(r=>r.includes('=')&&!r.trim().startsWith('#')).map(r=>[r.slice(0,r.indexOf('=')).trim(), r.slice(r.indexOf('=')+1).trim()]))
const SB = e.NEXT_PUBLIC_SUPABASE_URL, ANON = e.NEXT_PUBLIC_SUPABASE_ANON_KEY
const cred = JSON.parse(readFileSync('.aut.json','utf8'))
const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
  method:'POST', headers:{ apikey: ANON, 'Content-Type':'application/json' },
  body: JSON.stringify({ email: cred.email, password: cred.password }),
})
const s = await r.json()
if (!s?.access_token) { console.error('accesso autista fallito:', JSON.stringify(s).slice(0,200)); process.exit(1) }
const ref = new URL(SB).hostname.split('.')[0]
const p = 'base64-' + Buffer.from(JSON.stringify({ access_token:s.access_token, refresh_token:s.refresh_token, expires_in:s.expires_in, expires_at:s.expires_at, token_type:s.token_type, user:s.user })).toString('base64')
writeFileSync('.cookie-autista', `sb-${ref}-auth-token=${p}`)
console.log('autista dentro:', cred.email)
