# Rilascio CONDIVISIONE — creazione (runbook)

*Scritto per chi esegue il rilascio (Lorenzo + sessione che committa). Tutto verificato prima/dopo sui dati
veri; niente è ancora in produzione. Project Supabase: zxwykadbgvnllnnegnuh.*

## Cosa contiene questo rilascio (la CREAZIONE, soldi corretti)
Una spedizione creata su un contratto condiviso (corriere `tipo='moovexpress'`) ora addebita, incassa il
credito, spedisce e si traccia **giusta**, e la fuga di credenziali è chiusa. Verificato su 5 banchi (tutti verdi)
e revisionato in avversariale. Volume reale oggi: 2 spedizioni (pre-lancio) → rischio sul traffico vivo ~nullo.

## Cosa NON contiene (follow-up, nessuno muove soldi in modo sbagliato nel frattempo)
- **Report ⑤** (margine del rivenditore dal ledger): è una VISTA, coinvolge ≥4 RPC e un'altra sessione ci lavora
  ora → si fa COORDINATO, dopo. I movimenti (i soldi) restano giusti; solo il margine a schermo sulle spedizioni
  condivise si allinea dopo.
- **Propagazione piena post-creazione** (reso/ripesatura/giacenza/COD gamba-per-gamba): feature successiva.
  Nel frattempo quegli eventi sul condiviso NON sbagliano i soldi (annullo blindato; gli altri si fermano/per-conto).
- **Riconciliazione 8 righe del vecchio test** (~20 €) e **bonifica 4 chiavi colate**: scritture di PULIZIA, da
  fare DOPO il deploy (vedi §5). Non bloccano la prova.

## 0) Pre-flight (già verde adesso)
- `npx tsc --noEmit` → 51 errori, tutti PRE-ESISTENTI; 0 nei file toccati.
- 5 banchi verdi: `run-resolver-shadow` `run-gambe-shadow` `run-dispatch-key-shadow` `run-gating-shadow` `run-condivisione-cod-verify`.
- `git status` pulito: solo i file sotto.

## 1) Deploy del CODICE (prima della migrazione)
Committare SOLO i file di prodotto (NON i `run-*.mts`, che sono banchi di prova):
```
# modificati
app/api/condivisioni/[id]/accetta/route.ts
app/api/spedizioni/crea/route.ts
app/api/v1/shipments/route.ts
app/api/tracking/aggiorna/route.ts
app/api/v1/tracking/[tracking]/route.ts
lib/annullaSpedizione.ts
lib/cascata.ts
lib/copia-listino-submaster.ts
lib/propaga-credenziali.ts
# nuovi
lib/condivisione-catena.ts
scripts/regola-contratto-proprio-condivisione.sql   # (migrazione, applicata al passo 2)
CONDIVISIONE-MODELLO.md CONDIVISIONE-CHECKLIST.md CONDIVISIONE-RILASCIO.md
```
`git pull` prima (collega al lavoro). Push → **attendere Vercel READY** (repo privato può bloccare il deploy:
se BLOCKED, sbloccare prima di procedere — un deploy non andato lascerebbe codice e DB disallineati).

## 2) Migrazione del flag "detentore" (DOPO che il deploy è READY)
Applicare `scripts/regola-contratto-proprio-condivisione.sql` (ridefinisce la funzione-trigger; NON cambia
ancora i flag). Poi, nella STESSA sessione SQL, la rete di sicurezza + il ricalcolo:
```sql
create temp table proprio_prima as select id, proprio from public.corrieri;
select public.fn_ricalcola_corrieri_proprio();   -- applica la regola nuova
-- VERIFICA: devono cambiare ESATTAMENTE 2 righe
select m.nome, c.tipo, c.nome_contratto, p.proprio as prima, c.proprio as dopo
from public.corrieri c join proprio_prima p on p.id=c.id join public.masters m on m.id=c.master_id
where c.proprio is distinct from p.proprio;
-- ATTESO (ESATTAMENTE questi 2, niente altro):
--   MULTIEXPRESS  moovexpress  Poste Delivery Business Triangolazioni  true  -> false
--   LOGIXIA SRLS  poste        Poste Delivery Business Triangolazioni  false -> true
drop table proprio_prima;
```
Se la verifica mostra anche UNA riga in più → **FERMARSi** e rivedere (impronta "prima" dei non-moovexpress era:
730 corrieri, 85 proprio=true, md5 `7cfb245f6b2eaa1aba82efe7a5796202`; dopo: 86 proprio=true = +LOGIXIA, i
moovexpress proprio=true passano 1→0).

## 3) Verifica post-deploy (sui fatti)
- Una spedizione su corriere NORMALE (gls/poste/spedisci/brt/fedex…) si crea come prima (nessuna regressione):
  controllare i suoi movimenti = identici a ieri.
- **Prova condivisione (Lorenzo): creare una spedizione da un cliente di Ecomize LL.** Attesi i movimenti della
  catena: EcoLL −x→EcoSol (credito) · EcoSol −y→MULTI (credito) · MULTI→Wave (ledger) · Wave→LOGIXIA (ledger) ·
  LOGIXIA→Poste (credito_proprio) · 1 sola commissione MoovExpress (sull'owner). Nessun addebito su credito_proprio
  dei ponti; nessun doppio.

## 4) Rollback (se qualcosa non torna)
- Codice: `git revert` del commit → redeploy (Vercel READY).
- Flag: ripristinare la vecchia definizione di `fn_ricalcola_corrieri_proprio` (quella SENZA i 2 filtri `tipo`,
  nel git history) e rilanciare `select public.fn_ricalcola_corrieri_proprio();` → i 2 nodi tornano com'erano.
- Nessun movimento è stato scritto dalla migrazione: il rollback non lascia strascichi contabili.

## 5) Follow-up DOPO il deploy confermato (scritture di pulizia, col tuo ok, in quest'ordine)
1. **Riconciliazione** delle 8 righe del test 282224J028331: storno APPEND-ONLY, colonna per colonna, che LEGGE
   il conto/tipo originale e scrive l'inverso ESATTO (le righe `conto='proprio'` NON si stornano con
   registra_movimento_master). Stornare SOLO le righe sbagliate dei RIVENDITORI (Wave/EcoLL su credito_proprio +
   le loro commissioni); LOGIXIA (owner) e i ledger giusti restano. Dry-run su snapshot prima.
2. **Bonifica** delle 4 chiavi colate (EcoSol/M&R Sprint/sdl/Ecomize LL): azzerare la api_key del loro ponte
   (ora inerte: il dispatch la re-sorgenta dal detentore-codice). Sicura solo DOPO che il codice re-sourcing è live.
3. **Report ⑤**: coordinato con la sessione che lavora su calderone/Statistiche. Vista, non muove soldi.

## Coordinamento
Un'altra sessione sta modificando le RPC del report (calderone_dettaglio_v2, profitto_dettaglio_v1,
guadagno_*). Questo rilascio NON le tocca. Il report del margine rivenditore (⑤) si fa con loro, dopo.
