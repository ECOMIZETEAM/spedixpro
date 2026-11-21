-- PONTE UNICO, FASE 2: il registro dei confronti in ombra (lib/ponte-ombra, /api/cron/ponte-ombra).
-- Una riga per condiviso controllato: se il ponte unico, calcolato senza scrivere, e' venuto uguale a quello che la
-- staffetta ha scritto davvero. Solo identificativi e importi, nessun dato di chi spedisce o riceve.
-- La scrive e la legge solo il client di servizio: nessun accesso da anon o authenticated (RLS attiva, nessuna policy).
create table if not exists public.ponte_ombra (
  spedizione_origine_id uuid primary key,
  tracking text not null,
  contratto text not null,
  creata_il timestamptz not null,
  controllata_il timestamptz not null default now(),
  livelli smallint not null,
  esito text not null check (esito in ('uguale', 'diverso', 'errore')),
  differenze jsonb not null default '[]'::jsonb,
  ms_ombra integer,
  ms_fila integer,
  dettaglio jsonb
);
create index if not exists ponte_ombra_creata_il on public.ponte_ombra (creata_il);
create index if not exists ponte_ombra_non_uguali on public.ponte_ombra (creata_il) where esito <> 'uguale';

alter table public.ponte_ombra enable row level security;
revoke all on table public.ponte_ombra from anon, authenticated, public;

-- Verifica (deve tornare: rls true, e nessun privilegio per anon/authenticated)
select relrowsecurity as rls from pg_class where oid = 'public.ponte_ombra'::regclass;
select grantee, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'ponte_ombra' and grantee in ('anon', 'authenticated', 'PUBLIC');
