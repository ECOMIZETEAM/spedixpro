-- CONTROLLO NOTTURNO GLS: terzo caso, i COLLI DIVERSI (17/11/2026).
--
-- Quando GLS attaccava il secondo pacco alla spedizione aperta per lo stesso destinatario, sul suo
-- registro la spedizione diventava di 2 colli mentre il pacco vero era uno. GLS aspetta il collo che
-- non arriva e la spedizione si ferma: NI665570288 (DOLCE LUNA) ferma a Roma dall'11/11, NI665581717 a
-- Teramo dal 12/11. Il 17/11, su 35 giorni, 15 spedizioni avevano i colli diversi fra portale e GLS.
-- Si aggiunge il caso, con i due numeri da mostrare al master.

alter table public.gls_disallineamenti drop constraint if exists gls_disallineamenti_tipo_check;
alter table public.gls_disallineamenti add constraint gls_disallineamenti_tipo_check
  check (tipo in ('cancellata_su_gls', 'viva_su_gls', 'colli_diversi'));
alter table public.gls_disallineamenti
  add column if not exists colli_portale integer,
  add column if not exists colli_gls integer;

-- Verifica: il vincolo con i tre casi e le due colonne nuove.
select (select pg_get_constraintdef(oid) from pg_constraint
         where conrelid = 'public.gls_disallineamenti'::regclass and conname = 'gls_disallineamenti_tipo_check') as tipi,
       (select string_agg(column_name, ', ') from information_schema.columns
         where table_schema = 'public' and table_name = 'gls_disallineamenti' and column_name like 'colli%') as colonne;
