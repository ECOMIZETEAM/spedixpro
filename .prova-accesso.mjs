import { readFileSync, writeFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
const e = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(r=>r.includes('=')&&!r.trim().startsWith('#')).map(r=>[r.slice(0,r.indexOf('=')).trim(), r.slice(r.indexOf('=')+1).trim()]))
const SB = e.NEXT_PUBLIC_SUPABASE_URL, ANON = e.NEXT_PUBLIC_SUPABASE_ANON_KEY
const db = createClient(SB, e.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} })
const MASTER = '0bfa96db-0564-4d90-8f22-989db001f8ad'   // Ecomize LL
const EMAIL = 'prova.circuito.interno@moovexpress.com'
const PWD = 'Prova' + Math.floor(Math.random()*1e9) + '!Aa'

// pulizia di eventuali residui
const { data: vecchi } = await db.auth.admin.listUsers({ page:1, perPage:1000 })
for (const u of (vecchi?.users||[])) if (u.email === EMAIL) { await db.from('utenti').delete().eq('id', u.id); await db.auth.admin.deleteUser(u.id) }

const { data: creato, error } = await db.auth.admin.createUser({ email: EMAIL, password: PWD, email_confirm: true })
if (error) { console.error('creazione fallita:', error.message); process.exit(1) }
const uid = creato.user.id
const { error: e2 } = await db.from('utenti').insert({ id: uid, ruolo:'admin', master_id: MASTER, nome:'Prova Circuito Interno', attivo:true })
if (e2) { console.error('utenti:', e2.message); process.exit(1) }

// accesso vero, come farebbe il browser
const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
  method:'POST', headers:{ apikey: ANON, 'Content-Type':'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PWD }),
})
const sess = await r.json()
if (!sess?.access_token) { console.error('accesso fallito:', JSON.stringify(sess).slice(0,300)); process.exit(1) }

// cookie nel formato di @supabase/ssr
const ref = new URL(SB).hostname.split('.')[0]
const payload = 'base64-' + Buffer.from(JSON.stringify({
  access_token: sess.access_token, refresh_token: sess.refresh_token, expires_in: sess.expires_in,
  expires_at: sess.expires_at, token_type: sess.token_type, user: sess.user,
})).toString('base64')
const pezzi = []
for (let i=0;i<payload.length;i+=3180) pezzi.push(payload.slice(i,i+3180))
const cookie = pezzi.length===1 ? `sb-${ref}-auth-token=${payload}` : pezzi.map((p,i)=>`sb-${ref}-auth-token.${i}=${p}`).join('; ')
writeFileSync('.cookie-prova', cookie)
writeFileSync('.utente-prova', JSON.stringify({ uid, EMAIL, MASTER }))
console.log(`utente creato: ${EMAIL}\ncookie in ${pezzi.length} pezzi, ${payload.length} caratteri`)
