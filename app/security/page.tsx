export const metadata = {
  title: 'Sicurezza e risposta agli incidenti — MoovExpress',
  description: 'Misure di sicurezza e procedura di risposta agli incidenti di MoovExpress.',
}

export default function SecurityPage() {
  const box: React.CSSProperties = {
    maxWidth: '800px', margin: '0 auto', padding: '48px 24px',
    fontFamily: '"Inter",-apple-system,sans-serif', color: '#1f2937', lineHeight: 1.65,
  }
  const h1: React.CSSProperties = { fontSize: '28px', fontWeight: 800, margin: '0 0 6px' }
  const h2: React.CSSProperties = { fontSize: '17px', fontWeight: 700, margin: '28px 0 8px', color: '#111827' }
  const p: React.CSSProperties = { fontSize: '14.5px', margin: '0 0 10px', color: '#374151' }
  const li: React.CSSProperties = { fontSize: '14.5px', margin: '0 0 6px', color: '#374151' }
  const small: React.CSSProperties = { fontSize: '13px', color: '#6b7280' }

  return (
    <div style={{ background: '#fff', minHeight: '100vh' }}>
      <div style={box}>
        <h1 style={h1}>Sicurezza e risposta agli incidenti</h1>
        <div style={small}>MoovExpress — Ultimo aggiornamento: 20 ottobre 2026</div>

        <h2 style={h2}>1. Titolare</h2>
        <p style={p}>
          Il servizio MoovExpress è gestito da <strong>E.M EXPRESS LTD</strong>, company number 16889294,
          71-75 Shelton Street, London WC2H 9JQ, Regno Unito.
          Contatto per sicurezza e privacy:{' '}
          <a href="mailto:info@moovexpress.com" style={{ color: '#f97316' }}>info@moovexpress.com</a>.
        </p>

        <h2 style={h2}>2. Misure di sicurezza</h2>
        <ul>
          <li style={li}><strong>Crittografia in transito:</strong> tutte le comunicazioni avvengono su HTTPS/TLS. Il traffico HTTP viene reindirizzato a HTTPS.</li>
          <li style={li}><strong>Crittografia a riposo:</strong> il database e i suoi backup sono cifrati dal fornitore dell'infrastruttura (Supabase/PostgreSQL, AES-256).</li>
          <li style={li}><strong>Backup:</strong> backup automatici giornalieri del database, cifrati, conservati per 7 giorni.</li>
          <li style={li}><strong>Controllo accessi:</strong> accesso ai dati limitato al personale strettamente necessario, con account personali e autenticazione a due fattori sui sistemi di amministrazione. Isolamento dei dati tra utenti tramite Row Level Security a livello di database.</li>
          <li style={li}><strong>Credenziali dei negozi collegati:</strong> le chiavi e i token che i commercianti ci affidano non sono leggibili dagli utenti del portale: li usa solo il server. Le credenziali del collegamento Amazon sono inoltre cifrate (AES-256-GCM) con una chiave conservata fuori dal database.</li>
          <li style={li}><strong>Registrazione accessi:</strong> gli accessi del personale agli account dei clienti e le consultazioni del tracking sono registrati e conservati per 13 mesi.</li>
        </ul>

        <h2 style={h2}>3. Minimizzazione e conservazione</h2>
        <p style={p}>
          Trattiamo esclusivamente i dati necessari a generare le spedizioni (destinatario, ordine, contenuto).
          Dagli ordini Amazon i dati personali del compratore vengono cancellati in automatico 30 giorni dopo
          l'importazione (quelli mai spediti vengono anche archiviati); dagli ordini Shopify spediti dopo 31 giorni.
          I compratori Amazon non vengono proposti come contatti nella rubrica. Quando un negozio viene scollegato le sue
          credenziali vengono cancellate subito; per Amazon si cancellano anche gli ordini non spediti e i dati del
          compratore di quelli spediti; per Shopify i dati si cancellano secondo le richieste inviate da Shopify.
          Le spedizioni restano registrate per gli obblighi fiscali e di legge.
        </p>

        <h2 style={h2}>4. Procedura di risposta agli incidenti</h2>
        <p style={p}>In caso di violazione o sospetta violazione dei dati personali applichiamo la seguente procedura:</p>
        <ul>
          <li style={li}><strong>1. Contenimento (immediato):</strong> isolare i sistemi coinvolti e revocare le credenziali o i token eventualmente compromessi.</li>
          <li style={li}><strong>2. Valutazione (entro 24 ore):</strong> identificare la natura dell'incidente, i dati e i soggetti coinvolti e il livello di rischio.</li>
          <li style={li}><strong>3. Notifica alle autorità (entro 72 ore):</strong> se la violazione comporta un rischio per i diritti degli interessati, notifica al Garante per la protezione dei dati personali ai sensi dell'art. 33 GDPR.</li>
          <li style={li}><strong>4. Comunicazione ai merchant:</strong> informare senza ingiustificato ritardo i merchant e, ove richiesto, gli interessati coinvolti. Se l'incidente riguarda dati ricevuti da Amazon, lo notifichiamo ad Amazon (security@amazon.com) entro 24 ore da quando ne veniamo a conoscenza.</li>
          <li style={li}><strong>5. Documentazione e rimedi:</strong> registrare causa, impatto e azioni correttive per prevenire il ripetersi dell'incidente.</li>
        </ul>

        <h2 style={h2}>5. Segnalazioni</h2>
        <p style={p}>
          Vulnerabilità o incidenti di sicurezza possono essere segnalati a{' '}
          <a href="mailto:info@moovexpress.com" style={{ color: '#f97316' }}>info@moovexpress.com</a>.
          Ci impegniamo a esaminare tempestivamente ogni segnalazione.
        </p>

        <p style={{ ...small, marginTop: '32px' }}>
          E.M EXPRESS LTD · 71-75 Shelton Street, London WC2H 9JQ, United Kingdom ·
          Company number 16889294 · info@moovexpress.com
        </p>
      </div>
    </div>
  )
}
