import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Diagnostica temporanea: dice SOLO se le env eBay sono presenti (nessun valore/segreto).
export async function GET() {
  const present = (v?: string) => !!v && v.trim().length > 0
  return NextResponse.json({
    EBAY_CLIENT_ID: present(process.env.EBAY_CLIENT_ID),
    EBAY_CLIENT_SECRET: present(process.env.EBAY_CLIENT_SECRET),
    EBAY_RU_NAME: present(process.env.EBAY_RU_NAME),
    EBAY_VERIFICATION_TOKEN: present(process.env.EBAY_VERIFICATION_TOKEN),
    EBAY_DELETION_ENDPOINT: present(process.env.EBAY_DELETION_ENDPOINT),
    // lunghezze per capire spazi/troncamenti, senza rivelare i valori
    len: {
      client_id: (process.env.EBAY_CLIENT_ID || '').length,
      ru_name: (process.env.EBAY_RU_NAME || '').length,
      client_secret: (process.env.EBAY_CLIENT_SECRET || '').length,
    },
  })
}
