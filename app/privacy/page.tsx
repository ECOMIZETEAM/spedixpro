export const metadata = {
  title: 'Privacy Policy — SpedixPro',
  description: 'Informativa sul trattamento dei dati personali di SpedixPro.',
}

export default function PrivacyPage() {
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
        <h1 style={h1}>Privacy Policy</h1>
        <div style={small}>SpedixPro — Ultimo aggiornamento: 1 luglio 2026</div>

        <h2 style={h2}>1. Titolare del trattamento</h2>
        <p style={p}>
          Il titolare del trattamento dei dati è <strong>E&amp;A MULTIEXPRESS</strong>, P.IVA 04795080615,
          con sede in Via Alcide De Gasperi 90, Santa Maria Capua Vetere (CE), Italia.
          Per qualsiasi richiesta relativa alla privacy è possibile scrivere a{' '}
          <a href="mailto:ecomizelogistics@gmail.com" style={{ color: '#f97316' }}>ecomizelogistics@gmail.com</a>.
        </p>

        <h2 style={h2}>2. Cosa fa SpedixPro</h2>
        <p style={p}>
          SpedixPro è una piattaforma di gestione delle spedizioni. Consente ai propri utenti (i "commercianti")
          di collegare i propri canali di vendita — tra cui negozi Shopify — per importare gli ordini e generare
          le relative spedizioni con i corrieri.
        </p>

        <h2 style={h2}>3. Dati che trattiamo</h2>
        <p style={p}>Quando un commerciante collega il proprio negozio, SpedixPro accede in lettura ai dati degli ordini necessari a generare le spedizioni, in particolare:</p>
        <ul>
          <li style={li}>Dati del destinatario dell'ordine: nome, indirizzo di spedizione, CAP, città, provincia, paese, telefono ed email (quando disponibili).</li>
          <li style={li}>Dettagli dell'ordine: numero ordine, articoli e relativi SKU, quantità, peso, importo, eventuale contrassegno.</li>
          <li style={li}>Stato di evasione dell'ordine (da spedire, spedito, ecc.).</li>
        </ul>
        <p style={p}>
          SpedixPro <strong>non</strong> richiede né tratta dati anagrafici dei clienti del negozio al di fuori
          delle informazioni contenute nell'ordine e necessarie alla spedizione.
        </p>

        <h2 style={h2}>4. Finalità e base giuridica</h2>
        <p style={p}>
          I dati sono trattati esclusivamente per fornire il servizio richiesto dal commerciante: importazione
          degli ordini, calcolo delle tariffe, creazione delle spedizioni e generazione delle etichette. La base
          giuridica è l'esecuzione del contratto/servizio con il commerciante. I dati non vengono venduti né
          ceduti a terzi per finalità di marketing.
        </p>

        <h2 style={h2}>5. Comunicazione a terzi</h2>
        <p style={p}>
          Per completare le spedizioni, i dati strettamente necessari (destinatario, indirizzo, contenuto) sono
          trasmessi ai corrieri e/o agli aggregatori di spedizione selezionati dal commerciante. Ci avvaliamo
          inoltre di fornitori di infrastruttura tecnologica (hosting e database) che trattano i dati per nostro
          conto come responsabili del trattamento.
        </p>

        <h2 style={h2}>6. Conservazione</h2>
        <p style={p}>
          I dati degli ordini e delle spedizioni sono conservati per il tempo necessario alla gestione del
          servizio e agli obblighi di legge. Alla disinstallazione dell'app o su richiesta, i token di accesso al
          negozio vengono revocati e i dati collegati vengono cancellati secondo le procedure descritte al punto 8.
        </p>

        <h2 style={h2}>7. Diritti dell'interessato</h2>
        <p style={p}>
          Gli interessati possono esercitare i diritti previsti dal GDPR (accesso, rettifica, cancellazione,
          limitazione, opposizione, portabilità) scrivendo a{' '}
          <a href="mailto:ecomizelogistics@gmail.com" style={{ color: '#f97316' }}>ecomizelogistics@gmail.com</a>.
        </p>

        <h2 style={h2}>8. Richieste dati e cancellazione (Shopify)</h2>
        <p style={p}>
          In conformità ai requisiti di Shopify, gestiamo le richieste relative ai dati dei clienti e alla
          cancellazione del negozio. Su richiesta di accesso o cancellazione inoltrata tramite Shopify o
          direttamente, forniamo o eliminiamo i dati pertinenti nei termini previsti. Alla disinstallazione
          dell'app, l'accesso al negozio viene revocato e i relativi dati vengono rimossi.
        </p>

        <h2 style={h2}>9. Modifiche</h2>
        <p style={p}>
          La presente informativa può essere aggiornata nel tempo. Le modifiche saranno pubblicate su questa
          pagina con la relativa data di aggiornamento.
        </p>

        <p style={{ ...small, marginTop: '32px' }}>
          Per contatti: E&amp;A MULTIEXPRESS · Via Alcide De Gasperi 90, Santa Maria Capua Vetere (CE) ·
          P.IVA 04795080615 · ecomizelogistics@gmail.com
        </p>
      </div>
    </div>
  )
}
