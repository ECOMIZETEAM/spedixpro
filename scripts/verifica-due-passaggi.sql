-- VERIFICA IN DUE PASSAGGI (password + codice dall'app sul telefono) — parte database.
--
-- PERCHE'. Amazon (Data Protection Policy, 1.4.1) chiede la verifica in due passaggi per TUTTI gli
-- account che vedono i suoi dati; il 04/11/2026 nessuno dei 2.232 utenti l'aveva. Scelta di Lorenzo
-- del 04/11: obbligatoria per tutti, da una data che decide lui (sicurezza_impostazioni qui sotto):
-- fino a quella data chi la attiva la deve usare, chi non l'ha attivata entra come prima.
--
-- DOVE STA LA REGOLA. Non nelle 108 tabelle una per una: in UN controllo che PostgREST esegue prima
-- di ogni richiesta (db_pre_request). Cosi' vale per tabelle, viste e funzioni chiamate dal browser
-- o dal server con la sessione dell'utente, e per quelle che nasceranno. Chi ha solo la password non
-- legge niente nemmeno chiamando Supabase direttamente con la chiave pubblica.
-- Le rotte che lavorano con la chiave di servizio non passano di qui: per loro il controllo sta nel
-- middleware dell'app, davanti a tutte le /api con una sessione.
--
-- "ENTRA COME". L'admin o il master che entra nell'account di un cliente apre una sessione a nome del
-- cliente, che non puo' avere il suo codice. La rotta di "entra come" (che si raggiunge solo con una
-- sessione verificata) registra quella sessione in sessioni_entra_come, per otto ore.
--
-- Da incollare nell'editor SQL di Supabase. Si torna indietro con le due righe in fondo.

-- 1. Da quando e' obbligatoria per tutti. Una riga sola; vuota = non ancora obbligatoria.
create table if not exists public.sicurezza_impostazioni (
  id boolean primary key default true check (id),
  mfa_obbligatoria_dal timestamptz,
  aggiornata_il timestamptz not null default now()
);
insert into public.sicurezza_impostazioni (id) values (true) on conflict (id) do nothing;
alter table public.sicurezza_impostazioni enable row level security;
revoke all on public.sicurezza_impostazioni from public, anon, authenticated;

-- 2. Sessioni aperte da "entra come".
create table if not exists public.sessioni_entra_come (
  session_id uuid primary key,
  utente_id uuid not null,
  da_utente_id uuid not null,
  creata_il timestamptz not null default now(),
  scade_il timestamptz not null
);
alter table public.sessioni_entra_come enable row level security;
revoke all on public.sessioni_entra_come from public, anon, authenticated;

-- 3. Tentativi di accesso sbagliati: dopo 10 in 15 minuti l'indirizzo si ferma (DPP 1.2.2).
--    Solo l'indirizzo e l'ora, niente password ne' altro.
create table if not exists public.accessi_falliti (
  id bigint generated always as identity primary key,
  email text not null,
  quando timestamptz not null default now()
);
create index if not exists idx_accessi_falliti_email_quando on public.accessi_falliti (email, quando desc);
alter table public.accessi_falliti enable row level security;
revoke all on public.accessi_falliti from public, anon, authenticated;

-- Le tre tabelle le usa SOLO il servizio interno (accessi, "entra come", pagina del codice): i permessi
-- si scrivono qui, non si lasciano ai permessi di default. Sul ramo di prova il 12/11 le tabelle nuove
-- nascevano senza lettura e scrittura per service_role, e "entra come" falliva ("permission denied").
grant select on public.sicurezza_impostazioni to service_role;
grant select, insert, delete on public.sessioni_entra_come to service_role;
grant select, insert, delete on public.accessi_falliti to service_role;

-- 4. La sessione di chi fa la richiesta puo' leggere e scrivere?
create or replace function public.sessione_verificata()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select
    -- ha messo il codice
    coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    -- e' una sessione di "entra come", ancora valida
    or exists (select 1 from public.sessioni_entra_come s
                where s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
                  and s.utente_id = auth.uid() and s.scade_il > now())
    -- non l'ha attivata e non e' ancora obbligatoria
    or (not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
        and coalesce((select i.mfa_obbligatoria_dal > now() from public.sicurezza_impostazioni i), true))
$function$;
revoke all on function public.sessione_verificata() from public, anon;
grant execute on function public.sessione_verificata() to authenticated, service_role;

-- 5. Il controllo prima di ogni richiesta. Vale SOLO per il ruolo authenticated: la chiave di servizio
--    e le chiamate anonime passano come prima. Un errore qui fermerebbe tutte le richieste degli
--    utenti: la funzione e' corta apposta, e si toglie con le righe in fondo.
create or replace function public.controllo_richiesta()
 returns void
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  if coalesce(current_setting('request.jwt.claims', true), '') <> ''
     and (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'authenticated'
     and not public.sessione_verificata() then
    -- 403 e non 401: un 401 l'app lo leggerebbe come sessione scaduta.
    raise sqlstate 'PT403' using message = 'verifica_due_passaggi',
      detail = 'Per continuare serve il codice della verifica in due passaggi.';
  end if;
end
$function$;
-- PostgREST la esegue COL RUOLO DELLA RICHIESTA: senza execute per anon e authenticated fallirebbero
-- tutte le loro richieste. Non legge niente da restituire: alza un errore o non fa nulla.
revoke all on function public.controllo_richiesta() from public;
grant execute on function public.controllo_richiesta() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request to 'public.controllo_richiesta';
notify pgrst, 'reload config';

-- PER TORNARE INDIETRO (toglie il controllo, lascia tabelle e funzioni):
--   alter role authenticator reset pgrst.db_pre_request;
--   notify pgrst, 'reload config';
