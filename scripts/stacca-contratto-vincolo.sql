-- UN SOLO CONTRATTO ATTIVO PER NOME, PER MASTER (26/11/2026) — da lanciare DOPO il rilascio del codice "Stacca".
--
-- Fino a oggi "una riga per nome" era scritta solo nel codice, e non bastava: GTS EXPRESS aveva tre "GLS CASERTA"
-- e VTS EXPRESS due "Express Partenopeo" (i tre doppioni senza storico eliminati il 26/11 con l'ok di Lorenzo), e
-- con due righe omonime le ricerche per nome sceglievano a caso la catena dei costi. Da quando un master può
-- staccarsi da un fornitore (scripts/stacca-contratto.sql) le righe omonime possono essere due, ma una sola ATTIVA:
-- quella staccata resta per i pacchi già partiti. Qui la regola la tiene il database, per ogni porta che crea
-- contratti, anche una che nascerà domani.
--
-- Il confronto è quello di lib/contratto-per-nome.ts: spazi ai lati tolti e minuscole.
-- APPLICATO il 26/11/2026 dal SQL Editor, verificato valido. Senza CONCURRENTLY: incollato insieme alla verifica qui
-- sotto, il SQL Editor rispondeva "25001 CREATE INDEX CONCURRENTLY cannot run inside a transaction block". Su ~1.000
-- righe l'indice normale si costruisce in millisecondi, il blocco delle scritture non si vede. Se fallisce per un
-- doppione comparso nel frattempo non resta niente a metà: si sistema il doppione e si rilancia.
create unique index if not exists corrieri_un_attivo_per_nome
  on public.corrieri (master_id, lower(btrim(nome_contratto)))
  where staccato_il is null;

-- Da guardare: valido = true.
select c.relname indice, i.indisvalid valido
  from pg_index i join pg_class c on c.oid = i.indexrelid
 where c.relname = 'corrieri_un_attivo_per_nome';
