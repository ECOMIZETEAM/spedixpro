export const metadata = {
  title: 'Privacy Policy — MoovExpress',
  description: 'Informativa sul trattamento dei dati personali di MoovExpress.',
}

// OGNI FRASE DI QUESTA PAGINA DEV'ESSERE VERA. La leggono i revisori di Amazon (Selling Partner API) e
// di Shopify, e la confrontano con le risposte sulla sicurezza: tempi di conservazione, fornitori,
// luoghi del trattamento. Se cambia una regola di conservazione (app/api/privacy/purge-pii) o un
// fornitore, va cambiata anche qui.
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
  const mail = <a href="mailto:info@moovexpress.com" style={{ color: '#f97316' }}>info@moovexpress.com</a>

  return (
    <div style={{ background: '#fff', minHeight: '100vh' }}>
      <div style={box}>
        <h1 style={h1}>Privacy Policy</h1>
        <div style={small}>MoovExpress — Ultimo aggiornamento: 20 ottobre 2026</div>

        <h2 style={h2}>1. Titolare del trattamento</h2>
        <p style={p}>
          Il titolare del trattamento dei dati è <strong>E.M EXPRESS LTD</strong>, società di diritto inglese
          registrata presso la Companies House di Cardiff con numero <strong>16889294</strong>, con sede legale in
          71-75 Shelton Street, London WC2H 9JQ, Regno Unito. Per qualsiasi richiesta relativa alla privacy: {mail}.
        </p>
        <p style={p}>
          MoovExpress è il servizio gestito da E.M EXPRESS LTD. Per i dati dei destinatari delle spedizioni,
          MoovExpress li tratta per conto del commerciante che li inserisce o li importa, al solo scopo di
          eseguire le sue spedizioni.
        </p>

        <h2 style={h2}>2. Cosa fa MoovExpress</h2>
        <p style={p}>
          MoovExpress è una piattaforma di gestione delle spedizioni per commercianti e rivenditori. Permette di
          creare spedizioni con i corrieri, stampare le etichette e seguire il tracking. Gli ordini si possono
          inserire a mano, caricare da file (CSV/Excel), inviare via API oppure importare dai canali di vendita
          collegati: Shopify, WooCommerce, PrestaShop, eBay e Amazon. Per Amazon, importando il report degli
          ordini scaricato da Seller Central oppure con il collegamento diretto alle API di Amazon (Selling
          Partner API), che il venditore autorizza dal proprio account.
        </p>

        <h2 style={h2}>3. Dati che trattiamo</h2>
        <ul>
          <li style={li}><strong>Commercianti (account):</strong> nome dei referenti, ragione sociale, partita IVA, indirizzi, email, telefono, dati di fatturazione e dei pagamenti delle ricariche.</li>
          <li style={li}><strong>Destinatari delle spedizioni</strong>, dagli ordini o inseriti dal commerciante: nome, indirizzo, CAP, città, provincia, paese, telefono ed email quando disponibili, istruzioni di consegna.</li>
          <li style={li}><strong>Ordini:</strong> numero d'ordine, articoli e SKU, quantità, peso, importo, eventuale contrassegno, stato di evasione.</li>
          <li style={li}><strong>Sicurezza:</strong> accessi al portale e registro degli accessi ai dati personali (senza i dati personali stessi).</li>
        </ul>
        <p style={p}>
          Non chiediamo né trattiamo dati dei destinatari diversi da quelli necessari alla spedizione.
        </p>

        <h2 style={h2}>4. Perché li trattiamo e su quale base</h2>
        <p style={p}>
          Per fornire il servizio richiesto dal commerciante: importare gli ordini, calcolare le tariffe, creare le
          spedizioni e le etichette, seguire il tracking, inviare al destinatario le comunicazioni di servizio sulla
          consegna, confermare la spedizione al canale di vendita e fatturare il servizio. La base giuridica è il
          contratto con il commerciante e gli obblighi di legge (fiscali e contabili); per la sicurezza del servizio,
          il legittimo interesse a proteggerlo. I dati <strong>non</strong> vengono venduti, non sono usati per
          pubblicità o profilazione e non sono ceduti a terzi per finalità di marketing.
        </p>

        <h2 style={h2}>5. Con chi li condividiamo</h2>
        <ul>
          <li style={li}><strong>Corrieri e intermediari di spedizione</strong> scelti per la singola spedizione: solo i dati necessari al ritiro e alla consegna.</li>
          <li style={li}><strong>Canali di vendita collegati</strong> (per esempio Amazon, Shopify, eBay): il numero di tracking e il corriere, per segnare l'ordine come spedito.</li>
          <li style={li}><strong>Fornitori dell'infrastruttura</strong>, che trattano i dati per nostro conto come responsabili del trattamento: hosting e database (server a Londra, Regno Unito), invio di email e SMS di servizio, pagamenti delle ricariche.</li>
        </ul>
        <p style={p}>
          Il servizio e il database funzionano nel Regno Unito, riconosciuto dalla Commissione europea come paese
          con un livello di protezione adeguato (decisione del 28 giugno 2021, art. 45 GDPR). Se un fornitore tratta
          dati fuori dallo Spazio Economico Europeo e dal Regno Unito, il trasferimento avviene con le garanzie
          previste dal GDPR (decisioni di adeguatezza o clausole contrattuali standard).
        </p>

        <h2 style={h2}>6. Come li proteggiamo</h2>
        <ul>
          <li style={li}>Tutte le comunicazioni avvengono su HTTPS/TLS.</li>
          <li style={li}>Il database e i suoi backup sono cifrati (AES-256).</li>
          <li style={li}>Ogni utente vede solo i propri dati, grazie all'isolamento applicato dal database.</li>
          <li style={li}>Le chiavi e i token dei negozi collegati sono leggibili solo dal server; quelli di Amazon sono inoltre cifrati con una chiave conservata fuori dal database.</li>
          <li style={li}>Il personale accede con account personali e autenticazione a due fattori. Gli accessi ai dati personali sono registrati e il registro è conservato 13 mesi.</li>
          <li style={li}>In caso di violazione dei dati personali, la notifica al Garante avviene entro 72 ore; se riguarda dati ricevuti da Amazon, la notifica ad Amazon avviene entro 24 ore.</li>
        </ul>
        <p style={p}>
          Le misure e la procedura di risposta agli incidenti sono descritte nella pagina <a href="/security" style={{ color: '#f97316' }}>Sicurezza</a>.
        </p>

        <h2 style={h2}>7. Per quanto tempo li conserviamo</h2>
        <ul>
          <li style={li}><strong>Ordini Amazon:</strong> nome, indirizzo, telefono ed email del compratore vengono cancellati 30 giorni dopo l'importazione dell'ordine. Gli ordini da file mai spediti, dopo 30 giorni, vengono anche archiviati. Con il collegamento diretto vale la stessa regola in qualunque stato, e i dati si cancellano subito se il venditore scollega l'account o revoca l'autorizzazione.</li>
          <li style={li}><strong>Ordini Shopify spediti:</strong> i dati del destinatario vengono cancellati 31 giorni dopo l'importazione.</li>
          <li style={li}><strong>Ordini degli altri canali</strong> (WooCommerce, PrestaShop, eBay, file): per la durata del servizio, o fino alla richiesta di cancellazione del commerciante.</li>
          <li style={li}><strong>Spedizioni:</strong> sono documenti di trasporto e contabili e si conservano per gli obblighi di legge.</li>
          <li style={li}><strong>Account dei commercianti:</strong> per la durata del contratto e poi per gli obblighi fiscali e contabili.</li>
          <li style={li}><strong>Registro degli accessi:</strong> 13 mesi. <strong>Backup del database:</strong> 7 giorni.</li>
        </ul>

        <h2 style={h2}>8. Come li cancelliamo</h2>
        <p style={p}>
          La cancellazione automatica svuota i campi con i dati personali (nome, indirizzo, telefono, email e la
          copia dei dati ricevuti dal canale di vendita): resta solo ciò che non identifica nessuno, come numero
          d'ordine, articoli e importi. Quando un negozio viene scollegato, le sue credenziali di accesso si
          cancellano subito. Le richieste di cancellazione si possono inviare a {mail}.
        </p>

        <h2 style={h2}>9. Diritti dell'interessato</h2>
        <p style={p}>
          Gli interessati possono esercitare i diritti previsti dal GDPR (accesso, rettifica, cancellazione,
          limitazione, opposizione, portabilità) scrivendo a {mail}. Chi riceve una spedizione può rivolgersi anche
          al commerciante da cui ha acquistato. È sempre possibile proporre reclamo all'autorità di controllo
          (in Italia il Garante per la protezione dei dati personali; nel Regno Unito l'ICO).
        </p>

        <h2 style={h2}>10. Dati ricevuti da Amazon</h2>
        <p style={p}>
          I dati dei compratori Amazon (dal report degli ordini o dal collegamento diretto) servono solo a spedire
          quell'ordine e a confermarne la spedizione ad Amazon. Non li usiamo per marketing o profilazione, non li
          proponiamo come contatti nella rubrica degli indirizzi e non li condividiamo, se non con il corriere della
          spedizione. Si cancellano con le regole del punto 7, e ogni incidente che li riguarda viene notificato ad
          Amazon entro 24 ore.
        </p>

        <h2 style={h2}>11. Richieste dati e cancellazione (Shopify)</h2>
        <p style={p}>
          In conformità ai requisiti di Shopify, gestiamo le richieste relative ai dati dei clienti e alla
          cancellazione del negozio. Su richiesta di accesso o cancellazione inoltrata tramite Shopify o
          direttamente, forniamo o eliminiamo i dati pertinenti nei termini previsti. Alla disinstallazione
          dell'app, l'accesso al negozio viene revocato e i relativi dati vengono rimossi.
        </p>

        <h2 style={h2}>12. App MoovExpress per smartphone</h2>
        <p style={p}>
          L'app MoovExpress per iOS e Android apre lo stesso portale disponibile sul web e ne tratta gli stessi
          dati. In più, solo quando serve e dopo il permesso concesso sul dispositivo:
        </p>
        <ul>
          <li style={li}><strong>Fotocamera</strong>: per leggere il codice a barre dei pacchi e per fotografare documenti da allegare. Le immagini della lettura restano sul dispositivo; una foto viene inviata solo se la si allega.</li>
          <li style={li}><strong>Posizione</strong>: solo per gli autisti, nel momento in cui registrano l'esito di una consegna. Viene salvata insieme a quell'esito come prova del luogo della consegna. L'app non rileva la posizione in background.</li>
          <li style={li}><strong>File</strong>: etichette e documenti scaricati vengono salvati temporaneamente sul dispositivo per poterli condividere o stampare.</li>
        </ul>
        <p style={p}>
          L'app non contiene pubblicità, non traccia gli utenti su app e siti di terzi e non vende dati. I permessi
          si possono revocare in qualsiasi momento dalle impostazioni del telefono. Per chiedere la cancellazione
          dell'account e dei dati collegati è possibile scrivere a {mail}.
        </p>

        <h2 style={h2}>13. Modifiche</h2>
        <p style={p}>
          La presente informativa può essere aggiornata nel tempo. Le modifiche saranno pubblicate su questa
          pagina con la relativa data di aggiornamento.
        </p>

        <p style={{ ...small, marginTop: '32px' }}>
          Per contatti: E.M EXPRESS LTD · 71-75 Shelton Street, London WC2H 9JQ, United Kingdom ·
          Company number 16889294 · info@moovexpress.com
        </p>
      </div>
    </div>
  )
}
