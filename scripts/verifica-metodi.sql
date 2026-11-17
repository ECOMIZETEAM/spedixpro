-- VERIFICA IN DUE PASSAGGI: PIU' METODI A SCELTA E CODICI DI RISERVA — parte database.
--
-- PERCHE'. Scelta di Lorenzo del 17/11/2026: dopo la password ognuno usa UNO dei metodi che ha attivato
-- (almeno uno, volendo tutti): l'app sul telefono (nativa di Supabase) o il codice via mail (fatto dal
-- portale, lib/verifica-metodi.ts). In piu' 10 codici di riserva, da usare una volta sola se il telefono
-- o la mail non sono a portata. La passkey arrivera' dopo. L'SMS e' scartato per il costo.
--
-- DOVE STA LA REGOLA. Sempre in sessione_verificata(), che PostgREST esegue prima di ogni richiesta e il
-- middleware chiede davanti a tutte le /api (scripts/verifica-due-passaggi.sql). Le verifiche fatte dal
-- portale (mail, codice di riserva) registrano la SESSIONE in sessioni_verificate, come "entra come".
--
-- UN METODO NUOVO SI AGGIUNGE SOLO DA DENTRO. Supabase lascia attivare l'app a chiunque abbia la password,
-- finche' l'account non ha gia' un'app. Senza un controllo, chi ha rubato la password di un utente che usa
-- la mail si attivava l'app sul proprio telefono ed entrava senza passare dalla casella di posta. Quindi a
-- chi ha la mail l'app vale solo se il portale l'ha approvata (fattori_approvati): lo fa quando l'app
-- nasce in una sessione gia' verificata, o quando l'utente non aveva altri metodi.
--
-- Da incollare nell'editor SQL di Supabase PRIMA del rilascio dell'app: con le tabelle nuove vuote (e le
-- app di oggi approvate qui sotto) la funzione risponde esattamente come prima. In fondo come tornare indietro.

-- 1. Chi ha attivato la mail. Una riga per utente e metodo (oggi solo 'mail': l'app sta in auth.mfa_factors).
create table if not exists public.verifica_metodo (
  utente_id    uuid not null references auth.users(id) on delete cascade,
  metodo       text not null check (metodo in ('mail')),
  attivato_il  timestamptz not null default now(),
  primary key (utente_id, metodo)
);

-- 2. Le app riconosciute dal portale (vedi sopra).
create table if not exists public.fattori_approvati (
  factor_id    uuid primary key,
  utente_id    uuid not null references auth.users(id) on delete cascade,
  approvato_il timestamptz not null default now()
);

-- 3. I codici mandati via mail: solo l'impronta (sha256 con sale), legati alla sessione, 10 minuti, 5 tentativi.
create table if not exists public.verifica_mail_codici (
  id         uuid primary key default gen_random_uuid(),
  utente_id  uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  sale       text not null,
  impronta   text not null,
  creato_il  timestamptz not null default now(),
  scade_il   timestamptz not null,
  tentativi  int not null default 0,
  usato_il   timestamptz
);
create index if not exists verifica_mail_codici_utente on public.verifica_mail_codici (utente_id, creato_il desc);

-- 4. I codici di riserva: 10 per utente, una volta sola ciascuno, solo l'impronta.
create table if not exists public.codici_riserva (
  id         uuid primary key default gen_random_uuid(),
  utente_id  uuid not null references auth.users(id) on delete cascade,
  sale       text not null,
  impronta   text not null,
  creato_il  timestamptz not null default now(),
  usato_il   timestamptz
);
create index if not exists codici_riserva_utente on public.codici_riserva (utente_id);

-- 5. I codici di riserva sbagliati: dopo 10 in un'ora si aspetta (il codice di riserva non scade da solo).
create table if not exists public.verifica_tentativi (
  id        bigint generated always as identity primary key,
  utente_id uuid not null references auth.users(id) on delete cascade,
  tipo      text not null,
  quando    timestamptz not null default now()
);
create index if not exists verifica_tentativi_utente on public.verifica_tentativi (utente_id, quando desc);

-- 6. Le sessioni verificate dal portale (mail o codice di riserva), come sessioni_entra_come.
create table if not exists public.sessioni_verificate (
  session_id uuid primary key,
  utente_id  uuid not null references auth.users(id) on delete cascade,
  metodo     text not null check (metodo in ('mail', 'riserva')),
  creata_il  timestamptz not null default now(),
  scade_il   timestamptz not null
);

-- Tutte usate SOLO dal servizio interno: niente lettura ne' scrittura dal browser, permessi scritti qui
-- (sul ramo di prova le tabelle nuove nascevano senza permessi per service_role).
alter table public.verifica_metodo      enable row level security;
alter table public.fattori_approvati    enable row level security;
alter table public.verifica_mail_codici enable row level security;
alter table public.codici_riserva       enable row level security;
alter table public.verifica_tentativi   enable row level security;
alter table public.sessioni_verificate  enable row level security;
revoke all on public.verifica_metodo, public.fattori_approvati, public.verifica_mail_codici,
              public.codici_riserva, public.verifica_tentativi, public.sessioni_verificate
  from public, anon, authenticated;
grant select, insert, update, delete on public.verifica_metodo, public.fattori_approvati, public.verifica_mail_codici,
              public.codici_riserva, public.verifica_tentativi, public.sessioni_verificate
  to service_role;

-- 7. Le app attive oggi sono approvate: chi aggiungera' la mail continuera' a poter usare anche l'app.
insert into public.fattori_approvati (factor_id, utente_id)
select f.id, f.user_id from auth.mfa_factors f where f.status = 'verified'
on conflict (factor_id) do nothing;

-- 8. La sessione puo' lavorare?
create or replace function public.sessione_verificata()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select
    -- ha messo il codice dell'app; ma a chi ha la mail l'app vale solo se approvata dal portale (vedi in cima)
    (coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and not (exists (select 1 from public.verifica_metodo v where v.utente_id = auth.uid())
              and exists (select 1 from auth.mfa_factors f
                           where f.user_id = auth.uid() and f.status = 'verified'
                             and not exists (select 1 from public.fattori_approvati a where a.factor_id = f.id))))
    -- e' una sessione di "entra come", ancora valida
    or exists (select 1 from public.sessioni_entra_come s
                where s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
                  and s.utente_id = auth.uid() and s.scade_il > now())
    -- ha messo il codice via mail o un codice di riserva, in questa sessione
    or exists (select 1 from public.sessioni_verificate s
                where s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
                  and s.utente_id = auth.uid() and s.scade_il > now())
    -- non ha attivato nessun metodo e la verifica non e' ancora obbligatoria
    or (not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
        and not exists (select 1 from public.verifica_metodo v where v.utente_id = auth.uid())
        and coalesce((select i.mfa_obbligatoria_dal > now() from public.sicurezza_impostazioni i), true))
$function$;

-- TORNARE INDIETRO (la funzione com'era prima, poi le tabelle):
-- create or replace function public.sessione_verificata() returns boolean language sql stable security definer
--   set search_path to '' as $f$ select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
--   or exists (select 1 from public.sessioni_entra_come s where s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
--              and s.utente_id = auth.uid() and s.scade_il > now())
--   or (not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
--       and coalesce((select i.mfa_obbligatoria_dal > now() from public.sicurezza_impostazioni i), true)) $f$;
-- drop table public.sessioni_verificate, public.verifica_tentativi, public.codici_riserva,
--            public.verifica_mail_codici, public.fattori_approvati, public.verifica_metodo;
