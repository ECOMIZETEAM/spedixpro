import Script from 'next/script'

export const metadata = { title: 'MoovExpress · Shopify' }

// App embedded: carica App Bridge (CDN, con la api key pubblica). App Bridge
// espone il global `shopify` usato per ottenere il session token.
export default function ShopifyLayout({ children }: { children: React.ReactNode }) {
  const apiKey = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY
  return (
    <>
      <Script
        src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
        data-api-key={apiKey}
        strategy="afterInteractive"
      />
      {children}
    </>
  )
}
