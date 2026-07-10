import { NextResponse } from 'next/server'

// GET /api/v1 — health/info dell'API pubblica. Non richiede autenticazione:
// serve alle piattaforme che "pingano" l'URL base (evita il 404 sul base URL).
export async function GET() {
  return NextResponse.json({
    name: 'MoovExpress API',
    version: '1.0.0',
    status: 'ok',
    docs: 'https://docs.moovexpress.com',
    auth: 'Authorization: Bearer <api_key>',
    verify: 'GET /api/v1/account',
  })
}
