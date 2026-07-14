import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { piattaformaDa } from '../route'

export const dynamic = 'force-dynamic'

// Cella CSV: racchiude tra virgolette se contiene virgola/virgolette/a-capo.
function cell(v: any): string {
  const s = v == null ? '' : String(v)
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

// Corriere commerciale (mai il provider tecnico) -> codice vettore accettato da Amazon.
function carrierAmazon(nome: string): { code: string; name: string } {
  const n = (nome || '').toUpperCase()
  if (n.includes('BRT')) return { code: 'BRT', name: 'BRT' }
  if (n.includes('GLS')) return { code: 'GLS', name: 'GLS' }
  if (n.includes('POSTE')) return { code: 'Poste Italiane', name: 'Poste Italiane' }
  if (n.includes('SDA')) return { code: 'SDA', name: 'SDA' }
  if (n.includes('DHL')) return { code: 'DHL', name: 'DHL' }
  if (n.includes('UPS')) return { code: 'UPS', name: 'UPS' }
  if (n.includes('TNT')) return { code: 'TNT', name: 'TNT' }
  if (n.includes('FEDEX') || n.includes('FED EX')) return { code: 'FedEx', name: 'FedEx' }
  return { code: 'Other', name: nome || 'Corriere' }
}

// Genera il file tracking degli ordini importati DA FILE e spediti, per una piattaforma
// (e opzionalmente una data). Amazon: formato "Conferma spedizione" ricaricabile su Seller
// Central per marcare gli ordini come spediti. Shopify/altro: CSV ordine + tracking.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const url = new URL(req.url)
  const piatt = (url.searchParams.get('piattaforma') || 'amazon').toLowerCase()
  const data = url.searchParams.get('data') || ''   // YYYY-MM-DD opzionale

  const { data: righe } = await supabase
    .from('ordini_importati')
    .select('order_id, contenuto, colli, raw, spedizioni!inner(tracking_number, created_at, corrieri(nome_contratto))')
    .eq('cliente_id', utente.cliente_id)
    .eq('stato', 'spedito')
    .is('integrazione_id', null)
    .not('spedizione_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10000)

  // Filtro per piattaforma (dal raw) e data di spedizione
  const filtrate = (righe || []).filter((r: any) => {
    if (piattaformaDa(r.raw) !== piatt) return false
    if (data) { const d = (r.spedizioni?.created_at || '').slice(0, 10); if (d !== data) return false }
    return true
  })

  let intestazione: string
  let corpo: string[]

  if (piatt === 'amazon') {
    intestazione = ['order-id', 'order-item-id', 'quantity', 'ship-date', 'carrier-code', 'carrier-name', 'tracking-number', 'ship-method'].join(',')
    corpo = filtrate.map((r: any) => {
      const raw = r.raw || {}
      const sp = r.spedizioni || {}
      const car = carrierAmazon(sp.corrieri?.nome_contratto || '')
      const qty = raw.quantitypurchased || raw.quantity || r.colli || 1
      const shipDate = (sp.created_at || '').replace(/\.\d+/, '').replace(/Z$/, '')   // ISO senza millisecondi
      return [
        cell(raw.orderid || r.order_id),
        cell(raw.orderitemid || raw.order_item_id || ''),
        cell(qty),
        cell(shipDate),
        cell(car.code),
        cell(car.name),
        cell(sp.tracking_number || ''),
        cell('Standard'),
      ].join(',')
    })
  } else {
    // Shopify / altro: CSV generico ordine + tracking (utile come riferimento/fulfillment)
    intestazione = ['order', 'tracking-number', 'carrier', 'ship-date', 'content'].join(',')
    corpo = filtrate.map((r: any) => {
      const sp = r.spedizioni || {}
      return [
        cell(r.order_id),
        cell(sp.tracking_number || ''),
        cell(sp.corrieri?.nome_contratto || ''),
        cell((sp.created_at || '').slice(0, 10)),
        cell(r.contenuto || ''),
      ].join(',')
    })
  }

  const csv = '﻿' + [intestazione, ...corpo].join('\r\n')   // BOM per Excel/Amazon
  const nomeFile = `tracking-${piatt}${data ? '-' + data : ''}.csv`
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nomeFile}"`,
      'Cache-Control': 'no-store',
    },
  })
}
