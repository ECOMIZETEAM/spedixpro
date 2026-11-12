-- CHECK RICARICHE: righe nascoste e righe aggiunte a mano (Lorenzo, 12/11/2026).
--
-- Ecomize Solution vuole ripartire da zero nel Check Ricariche (2.063 righe dal 19/08, 1.496 «in attesa»
-- mai toccate) e rimettere a mano le ricariche vecchie che aspetta ancora. Lorenzo ha scelto di NASCONDERLE,
-- non cancellarle: 533 di quelle righe sono abbinate ai bonifici dell'estratto di ottobre (on delete
-- cascade su abbinamenti_bonifici) e cancellandole il lavoro fatto su ottobre sparirebbe.
--
-- Una riga nascosta esce dal Check Ricariche e dal pallino rosso, e l'estratto conto non la cerca piu' in
-- banca; resta solo dove e' gia' abbinata a un bonifico. Per rimetterla basta azzerare nascosta_il.
-- Una riga a mano e' solo registro: non c'e' un movimento dietro, il credito non si tocca.

-- Colonne e indice: applicati il 12/11/2026 (ramo prova, poi produzione).
alter table public.ricariche_check
  add column if not exists nascosta_il timestamptz,
  add column if not exists nascosta_da uuid,
  add column if not exists a_mano boolean not null default false;

-- Il Check Ricariche legge solo le righe visibili del master, le piu' recenti per prime.
create index if not exists ricariche_check_visibili_idx
  on public.ricariche_check (master_id, ricaricato_il desc) where nascosta_il is null;

-- ── DA ESEGUIRE DOPO IL RILASCIO DEL CODICE ──────────────────────────────────────────────────────────
-- Nasconde tutte le righe di Ecomize Solution esistenti in quel momento (scelta di Lorenzo: tutte, anche
-- quelle dall'11/11). Le ricariche fatte dopo entrano da sole come sempre.
--
-- update public.ricariche_check set nascosta_il = now()
--  where master_id = '75b08143-26c8-4903-8091-cd03fbd635ed' and nascosta_il is null;
