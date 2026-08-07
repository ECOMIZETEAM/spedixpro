# MoovExpress

Gestionale di spedizioni multi-cliente, **in produzione**: ~1.500 spedizioni al giorno, ~600
clienti, 25 master. Next.js (App Router) + Supabase, rilascio su Vercel.

Ogni modifica tocca pacchi veri e soldi veri di aziende terze. Non esiste un ambiente di prova:
quello che si rilascia va addosso a chi sta lavorando in quel momento.

## Prima di toccare prezzi, credito, addebiti o perimetro

**Leggi [REGOLE.md](REGOLE.md).** Dice quali sono le regole che valgono soldi e — soprattutto —
**dove sono scritte**: quali il database garantisce da solo, quali vivono in una funzione sola, e
quali sono ancora duplicate in più punti. Quest'ultimo elenco è il rischio noto.

Il criterio, in una riga: *una regola che decide chi paga cosa non va messa in ogni porta sperando
che nessuno se la dimentichi, va messa dove le porte passano tutte* — meglio ancora nel database,
dove nessuna rotta può aggirarla, nemmeno una che nascerà domani.

Le porte da cui nasce una spedizione sono più di quante sembri: portale master, portale cliente,
API pubblica `/api/v1`, import CSV, e cinque integrazioni con negozi online. Una guardia messa solo
nella creazione dal portale non copre le altre.

## Come si verifica

Che compili non vuol dire niente. Su prezzi e credito la verifica è **rieseguire il calcolo sui
dati veri di produzione, prima e dopo**, e confrontare — comprese le spedizioni che oggi passano,
per accertarsi di non averne bloccata nessuna per sbaglio.

Due trappole in cui si è già caduti, entrambe descritte in fondo a REGOLE.md:
- i **movimenti non raccontano il passato**: un lavoro pianificato ne riscrive le descrizioni;
- **contare le occorrenze di un nome nei file non dice se un controllo c'è**: le regole stanno nelle
  librerie condivise, e il file che le usa non nomina le impostazioni.

Prima di rilasciare, rileggi il diff. Lo stesso blocco di codice esiste spesso in quattro rami
(uno per corriere): è facile modificare quello sbagliato.

## Vincoli che non si negoziano

- **Le credenziali di produzione non si incollano in chat.** Vanno inserite dal pannello o messe in
  Vercel. Vale anche per quelle dei fornitori e per i frammenti.
- **I nomi dei fornitori tecnici** (SpediamoPro, Spedisci.online, EasyParcel/DVA) **non compaiono
  mai** a master, agenti o clienti. Unica eccezione: la riconciliazione dei costi di E&A
  MULTIEXPRESS.
- **Ogni tabella o funzione nuova**: RLS attiva, `revoke` esplicito da `anon` e `authenticated`
  (revocare "da public" non basta), poi verifica con gli advisors. Obiettivo: zero errori.
- **Lo storico non si cancella.** Spedizioni, ritiri, distinte e movimenti restano anche quando si
  cancella ciò che li ha generati.
- **Prima di cancellare, guarda cosa c'è attaccato** e dillo, con i numeri, prima di procedere.

## Lingua

Codice e commenti in italiano, come il resto del progetto. I commenti spiegano **perché**, non cosa:
il cosa si legge dal codice. Quando un commento racconta un guasto vero, quel guasto è la ragione
per cui la riga è scritta così — non toglierlo.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
