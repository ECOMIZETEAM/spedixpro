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
        <div style={small}>MoovExpress — Ultimo aggiornamento: 7 luglio 2026</div>

        <h2 style={h2}>1. Titolare</h2>
        <p style={p}>
          Il servizio MoovExpress è gestito da <strong>E&amp;A MULTIEXPRESS</strong>, P.IVA 04795080615,
          Via Alcide De Gasperi 90, Santa Maria Capua Vetere (CE), Italia.
          Contatto per sicurezza e privacy:{' '}
          <a href="mailto:ecomizelogistics@gmail.com" style={{ color: '#f97316' }}>ecomizelogistics@gmail.com</a>.
        </p>

        <h2 style={h2}>2. Misure di sicurezza</h2>
        <ul>
          <li style={li}><strong>Crittografia in transito:</strong> tutte le comunicazioni avvengono su HTTPS/TLS. Il traffico HTTP viene reindirizzato a HTTPS.</li>
          <li style={li}><strong>Crittografia a riposo:</strong> i dati e i relativi backup sono archiviati su database cifrato (Supabase/PostgreSQL).</li>
          <li style={li}><strong>Backup:</strong> backup automatici e point-in-time recovery gestiti dall'infrastruttura, anch'essi cifrati.</li>
          <li style={li}><strong>Controllo accessi:</strong> accesso ai dati limitato al personale strettamente necessario. Isolamento dei dati tra utenti tramite Row Level Security a livello di database.</li>
          <li style={li}><strong>Autenticazione:</strong> credenziali dello staff protette da password complesse; i token di accesso ai negozi sono a scadenza e rinnovati automaticamente.</li>
          <li style={li}><strong>Registrazione accessi:</strong> gli accessi e le operazioni sono tracciati dai log dell'infrastruttura (applicazione e database).</li>
        </ul>

        <h2 style={h2}>3. Minimizzazione e conservazione</h2>
        <p style={p}>
          Trattiamo esclusivamente i dati necessari a generare le spedizioni (destinatario, ordine, contenuto).
          I dati sono conservati per il tempo necessario al servizio e agli obblighi di legge. Alla disinstallazione
          dell'app o su richiesta di cancellazione, i token di accesso vengono revocati e i dati collegati al negozio
          vengono eliminati.
        </p>

        <h2 style={h2}>4. Separazione ambienti</h2>
        <p style={p}>
          Le attività di test vengono svolte con negozi di prova (development store) separati dai dati dei merchant
          reali, così da non mescolare dati di test e di produzione.
        </p>

        <h2 style={h2}>5. Procedura di risposta agli incidenti</h2>
        <p style={p}>In caso di violazione o sospetta violazione dei dati personali applichiamo la seguente procedura:</p>
        <ul>
          <li style={li}><strong>1. Contenimento (immediato):</strong> isolare i sistemi coinvolti e revocare le credenziali o i token eventualmente compromessi.</li>
          <li style={li}><strong>2. Valutazione (entro 24 ore):</strong> identificare la natura dell'incidente, i dati e i soggetti coinvolti e il livello di rischio.</li>
          <li style={li}><strong>3. Notifica alle autorità (entro 72 ore):</strong> se la violazione comporta un rischio per i diritti degli interessati, notifica al Garante per la protezione dei dati personali ai sensi dell'art. 33 GDPR.</li>
          <li style={li}><strong>4. Comunicazione ai merchant:</strong> informare senza ingiustificato ritardo i merchant e, ove richiesto, gli interessati coinvolti.</li>
          <li style={li}><strong>5. Documentazione e rimedi:</strong> registrare causa, impatto e azioni correttive per prevenire il ripetersi dell'incidente.</li>
        </ul>

        <h2 style={h2}>6. Segnalazioni</h2>
        <p style={p}>
          Vulnerabilità o incidenti di sicurezza possono essere segnalati a{' '}
          <a href="mailto:ecomizelogistics@gmail.com" style={{ color: '#f97316' }}>ecomizelogistics@gmail.com</a>.
          Ci impegniamo a esaminare tempestivamente ogni segnalazione.
        </p>

        <p style={{ ...small, marginTop: '32px' }}>
          E&amp;A MULTIEXPRESS · Via Alcide De Gasperi 90, Santa Maria Capua Vetere (CE) ·
          P.IVA 04795080615 · ecomizelogistics@gmail.com
        </p>
      </div>
    </div>
  )
}
