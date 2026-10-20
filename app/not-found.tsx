// PAGINA NON TROVATA, per qualunque indirizzo che l'app non serve.
//
// Senza questo file chi apriva un indirizzo inesistente vedeva la 404 nuda di Next.js («This page
// could not be found»), bianca e senza un modo per tornare indietro: e' successo per mesi con la voce
// «Impostazioni → Logo» del portale cliente, e per Shopify una 404 nell'app e' motivo di rifiuto
// («Web errors such as 404's ... are not acceptable», requisito 2.1.1).
//
// Questa pagina si disegna nel layout di radice, quindi SENZA il menu del portale: il link e' l'unica
// via d'uscita. Punta a «/» e non a una dashboard precisa perche' la strada giusta la sceglie gia' il
// middleware: chi e' dentro va alla dashboard del suo ruolo (cliente, master, autista), chi non lo e'
// trova il modulo di accesso, che accetta tutti i ruoli. Una seconda copia di quella regola qui
// finirebbe prima o poi per dire una cosa diversa.
export default function NotFound() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '16px', background: '#f5f5f5', fontFamily: 'var(--font-geist-sans),system-ui,sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '40px', width: '100%', maxWidth: '420px', boxSizing: 'border-box', boxShadow: '0 2px 16px rgba(0,0,0,.08)', textAlign: 'center' }}>
        <div style={{ fontSize: '40px', fontWeight: 800, color: '#f97316', lineHeight: 1 }}>404</div>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: '14px 0 8px' }}>Pagina non trovata</h1>
        <p style={{ fontSize: '13.5px', color: '#666', margin: '0 0 24px', lineHeight: 1.5 }}>
          L'indirizzo che hai aperto non esiste o non è più disponibile.
        </p>
        <a href="/" style={{ display: 'inline-block', background: '#f97316', color: '#fff', padding: '11px 22px', borderRadius: '6px', fontSize: '14px', fontWeight: 700, textDecoration: 'none' }}>
          Torna al portale
        </a>
      </div>
    </div>
  )
}
