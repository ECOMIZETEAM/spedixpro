-- REGOLE DELLE PASSWORD (politica Amazon sui dati, 1.4.1) — parte database.
--
-- COSA CHIEDE AMAZON, oltre ai 12 caratteri con maiuscole, minuscole, numeri e simboli (quelli li
-- controlla Supabase: Autenticazione → requisiti della password, acceso il 13/11/2026):
--   - niente riuso delle ultime 10 password;
--   - scadenza a 365 giorni;
--   - eta' minima di un giorno (non si cambia due volte in 24 ore: altrimenti dieci cambi di fila e
--     si torna alla password di prima);
--   - nessuna parte del nome dentro la password.
-- Supabase non ha niente di tutto questo. Qui sta la memoria (le impronte delle ultime 10 password e
-- la data dell'ultimo cambio); i controlli li fa la rotta /api/auth/password, l'unica da cui l'utente
-- sceglie la password, e l'accesso con password segna chi la deve cambiare.
--
-- PERCHE' UN TRIGGER SU auth.users. La password cambia da piu' porte: la rotta nostra, il reset del
-- master dalla scheda, la creazione dell'account, il link di recupero. Il trigger le vede tutte, anche
-- quelle che nasceranno: lo storico e la data dell'ultimo cambio sono sempre veri.
-- Si conserva l'IMPRONTA (bcrypt, la stessa che tiene Supabase), mai la password.
-- Il trigger non deve MAI far fallire Supabase: un errore qui fermerebbe accessi e cambi password per
-- tutti. Per questo ogni errore diventa un avviso nel log del database, e l'operazione prosegue.
--
-- PER GLI UTENTI DI OGGI la scadenza parte dal giorno in cui si applica questo script: nessuno si trova
-- la password scaduta al rilascio. Le password vecchie che non rispettano le regole (scelte prima del
-- 13/11/2026) si vedono solo al momento dell'accesso, perche' solo allora passa la password in chiaro:
-- vengono segnate subito, ma il cambio diventa obbligatorio dalla data in password_impostazioni
-- (vuota = non ancora). La data la decide Lorenzo.
--
-- Da incollare nell'editor SQL di Supabase, tutto insieme. Si torna indietro con le righe in fondo.

-- Il trigger su auth.users prende un lock che ferma per un attimo accessi e cambi password: se c'e' da
-- aspettare, meglio fallire e riprovare che mettere in coda gli accessi di tutti.
set lock_timeout = '3s';

-- 1. Le impronte delle ultime password, per utente. Le legge solo il database (funzioni qui sotto):
--    nessun permesso nemmeno alla chiave di servizio.
create table if not exists public.password_storico (
  id bigint generated always as identity primary key,
  utente_id uuid not null,
  impronta text not null,
  -- iniziale = gia' presente quando e' nato lo storico; creazione = account nuovo; cambio = da una porta
  -- qualunque (reset del master, link); utente = scelta dall'utente dalla rotta, e conta per l'eta' minima.
  origine text not null check (origine in ('iniziale', 'creazione', 'cambio', 'utente')),
  cambiata_il timestamptz not null default now()
);
create index if not exists idx_password_storico_utente on public.password_storico (utente_id, cambiata_il desc, id desc);
alter table public.password_storico enable row level security;
revoke all on public.password_storico from public, anon, authenticated, service_role;

-- 2. Chi deve cambiarla prima di continuare. Una riga per utente; sparisce da sola al cambio.
create table if not exists public.password_da_cambiare (
  utente_id uuid primary key,
  motivo text not null check (motivo in ('scaduta', 'regole')),
  dal timestamptz not null default now()
);
alter table public.password_da_cambiare enable row level security;
revoke all on public.password_da_cambiare from public, anon, authenticated, service_role;

-- 3. Da quando le password vecchie fuori regola vanno cambiate per forza. Una riga sola; vuota = non ancora.
create table if not exists public.password_impostazioni (
  id boolean primary key default true check (id),
  regole_obbligatorie_dal timestamptz,
  aggiornata_il timestamptz not null default now()
);
insert into public.password_impostazioni (id) values (true) on conflict (id) do nothing;
alter table public.password_impostazioni enable row level security;
revoke all on public.password_impostazioni from public, anon, authenticated, service_role;

-- 4. Il trigger: ogni impronta nuova va nello storico, che tiene le ultime 10.
create or replace function public.password_registra_cambio()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  begin
    insert into public.password_storico (utente_id, impronta, origine)
    values (new.id, new.encrypted_password, case when tg_op = 'INSERT' then 'creazione' else 'cambio' end);
    delete from public.password_storico s
     where s.utente_id = new.id
       and s.id not in (select s2.id from public.password_storico s2
                         where s2.utente_id = new.id
                         order by s2.cambiata_il desc, s2.id desc limit 10);
    -- Password nuova: la scadenza riparte, e quella fuori regola non c'e' piu'.
    delete from public.password_da_cambiare d where d.utente_id = new.id;
  exception when others then
    raise warning 'password_registra_cambio (%): %', new.id, sqlerrm;
  end;
  return null;
end
$function$;
revoke all on function public.password_registra_cambio() from public, anon, authenticated, service_role;

drop trigger if exists password_registra_creazione on auth.users;
create trigger password_registra_creazione
  after insert on auth.users
  for each row when (coalesce(new.encrypted_password, '') <> '')
  execute function public.password_registra_cambio();

-- "UPDATE OF encrypted_password" scatta anche quando la colonna e' riscritta uguale: la condizione
-- sul valore evita righe finte nello storico a ogni accesso.
drop trigger if exists password_registra_cambio on auth.users;
create trigger password_registra_cambio
  after update of encrypted_password on auth.users
  for each row when (coalesce(new.encrypted_password, '') <> '' and new.encrypted_password is distinct from old.encrypted_password)
  execute function public.password_registra_cambio();

-- 5. Gli utenti di oggi: la password attuale entra nello storico con la data di oggi.
insert into public.password_storico (utente_id, impronta, origine)
select u.id, u.encrypted_password, 'iniziale'
  from auth.users u
 where coalesce(u.encrypted_password, '') <> ''
   and not exists (select 1 from public.password_storico s where s.utente_id = u.id);

-- 6. Per la rotta del cambio (chiave di servizio): le ultime 10 impronte, la piu' recente per prima,
--    con origine e data (l'eta' minima guarda la prima riga). Se per un guasto del trigger l'impronta
--    attuale mancasse, si aggiunge in coda: il "non uguale a quella di adesso" vale sempre.
create or replace function public.password_storico_utente(p_utente uuid)
 returns table (impronta text, origine text, cambiata_il timestamptz)
 language sql
 stable security definer
 set search_path to ''
as $function$
  (select s.impronta, s.origine, s.cambiata_il
     from public.password_storico s
    where s.utente_id = p_utente
    order by s.cambiata_il desc, s.id desc
    limit 10)
  union all
  select u.encrypted_password, 'attuale', null::timestamptz
    from auth.users u
   where u.id = p_utente
     and coalesce(u.encrypted_password, '') <> ''
     and not exists (select 1 from public.password_storico s2
                      where s2.utente_id = u.id and s2.impronta = u.encrypted_password)
$function$;
revoke all on function public.password_storico_utente(uuid) from public, anon, authenticated;
grant execute on function public.password_storico_utente(uuid) to service_role;

-- 7. Dopo un cambio riuscito dalla rotta: quella password l'ha scelta l'utente (conta per l'eta' minima).
create or replace function public.password_scelta_da_utente(p_utente uuid)
 returns void
 language sql
 volatile security definer
 set search_path to ''
as $function$
  update public.password_storico s
     set origine = 'utente'
   where s.id = (select s2.id from public.password_storico s2
                  where s2.utente_id = p_utente
                    and s2.impronta = (select u.encrypted_password from auth.users u where u.id = p_utente)
                  order by s2.cambiata_il desc, s2.id desc
                  limit 1);
$function$;
revoke all on function public.password_scelta_da_utente(uuid) from public, anon, authenticated;
grant execute on function public.password_scelta_da_utente(uuid) to service_role;

-- 8. All'accesso con password (rotte di login, chiave di servizio): segna chi la deve cambiare.
--    p_fuori_regole lo calcola la rotta, che ha la password in chiaro; qui non arriva mai.
--    Restituisce il motivo se il cambio e' obbligatorio adesso, altrimenti null.
create or replace function public.password_controllo_accesso(p_utente uuid, p_fuori_regole boolean)
 returns text
 language plpgsql
 volatile security definer
 set search_path to ''
as $function$
declare
  v_ultimo timestamptz;
  v_obbligo timestamptz;
begin
  select max(s.cambiata_il) into v_ultimo from public.password_storico s where s.utente_id = p_utente;
  if v_ultimo is null then
    -- Account senza storico (non dovrebbe succedere): la password di adesso parte da oggi.
    insert into public.password_storico (utente_id, impronta, origine)
    select u.id, u.encrypted_password, 'iniziale' from auth.users u
     where u.id = p_utente and coalesce(u.encrypted_password, '') <> '';
    v_ultimo := now();
  end if;

  if v_ultimo < now() - interval '365 days' then
    insert into public.password_da_cambiare (utente_id, motivo) values (p_utente, 'scaduta')
    on conflict (utente_id) do update set motivo = 'scaduta';
  elsif p_fuori_regole then
    insert into public.password_da_cambiare (utente_id, motivo) values (p_utente, 'regole')
    on conflict (utente_id) do nothing;
  end if;

  select i.regole_obbligatorie_dal into v_obbligo from public.password_impostazioni i;
  return (select d.motivo from public.password_da_cambiare d
           where d.utente_id = p_utente
             and (d.motivo = 'scaduta' or (v_obbligo is not null and v_obbligo <= now())));
end
$function$;
revoke all on function public.password_controllo_accesso(uuid, boolean) from public, anon, authenticated;
grant execute on function public.password_controllo_accesso(uuid, boolean) to service_role;

-- 9. Il middleware a ogni pagina e a ogni API: la sessione puo' lavorare? Una domanda sola al database
--    per le due cose: 'codice' (manca la verifica in due passaggi), 'password_scaduta' /
--    'password_regole' (va scelta una password nuova), 'ok'.
--    Il cambio si chiede SOLO alle sessioni aperte con la password: "entra come", l'app Shopify e i link
--    per email aprono sessioni senza password (amr = otp), e chi entra cosi' non deve cambiare la
--    password di un altro.
create or replace function public.stato_sessione()
 returns text
 language sql
 stable security definer
 set search_path to ''
as $function$
  select case
    when not public.sessione_verificata() then 'codice'
    when coalesce(auth.jwt() -> 'amr', '[]'::jsonb) @> '[{"method": "password"}]'::jsonb then
      coalesce((select 'password_' || d.motivo
                  from public.password_da_cambiare d
                 where d.utente_id = auth.uid()
                   and (d.motivo = 'scaduta'
                        or coalesce((select i.regole_obbligatorie_dal <= now() from public.password_impostazioni i), false))),
               'ok')
    else 'ok'
  end
$function$;
revoke all on function public.stato_sessione() from public, anon;
grant execute on function public.stato_sessione() to authenticated, service_role;

reset lock_timeout;

-- PER TORNARE INDIETRO (il middleware, senza stato_sessione, torna da solo al controllo di prima):
--   drop trigger if exists password_registra_cambio on auth.users;
--   drop trigger if exists password_registra_creazione on auth.users;
--   drop function if exists public.stato_sessione();
