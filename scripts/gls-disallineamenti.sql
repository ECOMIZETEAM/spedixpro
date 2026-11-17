-- SPEDIZIONI CHE IL PORTALE E GLS RACCONTANO IN MODO DIVERSO (17/11/2026).
--
-- Il controllo notturno (/api/cron/gls-riconciliazione) confronta il registro di ogni conto GLS con le
-- nostre spedizioni e scrive qui quelle che non tornano:
--   cancellata_su_gls : sul portale e' valida (e pagata), su GLS non esiste piu';
--   viva_su_gls       : sul portale e' annullata (e rimborsata), su GLS e' ancora attiva.
-- Le vede SOLO il master che detiene il contratto GLS (Wave per il suo conto), in Spedizioni Cancellate.
-- Niente rimborsi ne' annulli automatici: decide il master (Lorenzo, 17/11).
--
-- Il 17/11 erano 11 su circa 4.800 spedizioni di un mese: 10 della prima specie (il guasto del secondo
-- pacco allo stesso destinatario, corretto il 16/11) e NI665682165 della seconda.
--
-- Si legge e si scrive solo dal server con il client di servizio: nessun permesso ad anon/authenticated.

create table if not exists public.gls_disallineamenti (
  spedizione_id   uuid primary key references public.spedizioni(id) on delete cascade,
  master_id       uuid not null references public.masters(id),     -- chi detiene il contratto: chi la vede
  tipo            text not null check (tipo in ('cancellata_su_gls', 'viva_su_gls')),
  stato_gls       text,                                            -- 'CHIUSA.' / 'IN ATTESA DI CHIUSURA.'; null se su GLS non c'e'
  rilevata_il     timestamptz not null default now(),
  controllata_il  timestamptz not null default now(),              -- ultimo giro che l'ha trovata ancora cosi'
  risolta_il      timestamptz,
  risolta_come    text check (risolta_come in ('riallineata', 'verificata')),
  risolta_da      uuid                                             -- utente che l'ha segnata verificata
);

-- La pagina chiede "le mie ancora aperte": poche righe, sempre per master.
create index if not exists gls_disallineamenti_master_aperte
  on public.gls_disallineamenti (master_id) where risolta_il is null;
-- Serve alla chiave verso masters (controlli su update/delete di un master).
create index if not exists gls_disallineamenti_master
  on public.gls_disallineamenti (master_id);

alter table public.gls_disallineamenti enable row level security;
revoke all on public.gls_disallineamenti from public, anon, authenticated;
grant select, insert, update, delete on public.gls_disallineamenti to service_role;

-- Verifica: deve tornare rls = true e nessun permesso per anon/authenticated.
select c.relrowsecurity as rls,
       (select string_agg(distinct grantee || ':' || privilege_type, ', ')
          from information_schema.role_table_grants g
         where g.table_schema = 'public' and g.table_name = 'gls_disallineamenti'
           and grantee in ('anon', 'authenticated')) as permessi_utenti
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'gls_disallineamenti';
