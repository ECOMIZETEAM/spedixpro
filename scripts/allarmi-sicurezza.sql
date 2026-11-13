-- ALLARMI DI SICUREZZA (politica Amazon sui dati, punto 2.6.2).
--
-- Amazon chiede allarmi su: chiamate non autorizzate ripetute, frequenze di richiesta e volumi di dati
-- letti fuori dal normale, accesso a record "esca"; e che ogni allarme venga esaminato e l'esito
-- scritto. Prima di questo script i registri c'erano (audit_accessi, accessi_falliti) ma nessuno li
-- guardava da solo: un cliente che si scaricava tutte le etichette di notte, o qualcuno che provava
-- password su cento account, sarebbe finito nel registro e basta.
--
-- Come lavora:
--   * allarmi_sicurezza e' il registro degli allarmi: una riga per fatto (la «chiave» impedisce di
--     segnalare due volte la stessa cosa), con lo spazio per l'esito dell'esame;
--   * le password sbagliate suonano SUBITO (trigger su accessi_falliti), perche' un accesso riuscito
--     cancella quelle righe e un controllo periodico potrebbe non vederle piu';
--   * tutto il resto lo guarda controllo_allarmi(), ogni 15 minuti (/api/controllo/allarmi), che
--     manda un'email solo quando c'e' qualcosa di nuovo;
--   * la Sentinella del mattino controlla che il giro degli allarmi sia vivo (controllo_giornaliero_3):
--     un allarme che smette di girare non suona.
--
-- SOGLIE: circa il triplo del massimo visto nei 14 giorni fino al 13/11/2026 (misurato sul registro
-- accessi), per non suonare il lunedi' mattina ma suonare davvero davanti a un'estrazione di dati.
-- Se il lavoro cresce (Black Friday) e un allarme suona per volumi veri, si alza la soglia qui.
--
-- Nessun dato personale nel registro degli allarmi: id di utenti e clienti, mai email o nomi dei
-- destinatari. L'unica eccezione e' l'indirizzo di un accesso bloccato, mascherato (lo***@gmail.com):
-- senza, non si saprebbe quale account e' sotto attacco quando l'indirizzo non e' di nessuno.
--
-- Da incollare nell'editor SQL di Supabase (un blocco solo).

-- 1. Il registro degli allarmi.
create table if not exists public.allarmi_sicurezza (
  id bigint generated always as identity primary key,
  chiave text not null unique,
  tipo text not null,
  descrizione text not null,
  utente_id uuid,
  cliente_id uuid,
  valore numeric,
  soglia numeric,
  creato_il timestamptz not null default now(),
  inviato_il timestamptz,
  esito text,
  esaminato_il timestamptz
);
create index if not exists idx_allarmi_sicurezza_creato on public.allarmi_sicurezza (creato_il desc);
alter table public.allarmi_sicurezza enable row level security;
revoke all on public.allarmi_sicurezza from public, anon, authenticated;
grant select, insert, update on public.allarmi_sicurezza to service_role;

-- 2. Le chiamate API rifiutate. Prima una chiave sbagliata riceveva 401 e non lasciava traccia: cento
-- chiavi provate a caso non si distinguevano dal silenzio. Mai la chiave, nemmeno un pezzo: solo il
-- motivo e, se la chiave esiste, il suo id.
create table if not exists public.chiamate_rifiutate (
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  porta text not null,
  motivo text not null,
  chiave_id uuid
);
create index if not exists idx_chiamate_rifiutate_quando on public.chiamate_rifiutate (quando desc);
alter table public.chiamate_rifiutate enable row level security;
revoke all on public.chiamate_rifiutate from public, anon, authenticated;
grant select, insert, delete on public.chiamate_rifiutate to service_role;

-- 3. Le esche: record che nessun lavoro vero tocca mai. Chi li tocca sta guardando dove non deve.
--    tipo 'utente' = id di un account, 'cliente' = id di un cliente, 'email' = indirizzo,
--    'chiave_api' = id di una chiave, 'spedizione' = numero di spedizione.
create table if not exists public.sicurezza_esche (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('utente', 'cliente', 'email', 'chiave_api', 'spedizione')),
  valore text not null,
  nota text,
  creata_il timestamptz not null default now(),
  unique (tipo, valore)
);
alter table public.sicurezza_esche enable row level security;
revoke all on public.sicurezza_esche from public, anon, authenticated;
grant select on public.sicurezza_esche to service_role;

-- 4. Quando ha girato l'ultima volta il controllo (lo legge la Sentinella). Tabella a parte e non una
-- colonna in sicurezza_impostazioni: aggiungere una colonna chiude la tabella per un attimo, e quella la
-- legge OGNI richiesta della piattaforma (sessione_verificata) — sarebbero secondi di portale fermo.
create table if not exists public.allarmi_giro (
  id boolean primary key default true check (id),
  ultimo timestamptz not null default now()
);
alter table public.allarmi_giro enable row level security;
revoke all on public.allarmi_giro from public, anon, authenticated;
grant select on public.allarmi_giro to service_role;

-- lo***@gmail.com: abbastanza per riconoscere l'account, non per leggerlo.
create or replace function public.email_mascherata(p_email text)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  select case when position('@' in coalesce(p_email, '')) > 1
    then left(p_email, least(2, position('@' in p_email) - 1)) || '***' || substring(p_email from position('@' in p_email))
    else '***' end
$function$;
revoke all on function public.email_mascherata(text) from public, anon, authenticated;
grant execute on function public.email_mascherata(text) to service_role;

-- 5. Password sbagliate: suonano subito.
create or replace function public.allarme_accessi_falliti()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_quarto bigint := floor(extract(epoch from now()) / 900);
  v_n int;
  v_account int;
  v_utente uuid;
begin
  -- Lo stesso account: al decimo tentativo l'accesso si ferma (lib/verifica-due-passaggi.ts) e le
  -- porte non scrivono piu' righe finche' non passa il quarto d'ora, quindi "= 10" suona una volta.
  select count(*) into v_n from public.accessi_falliti a
   where a.email = new.email and a.quando > now() - interval '15 minutes';
  if v_n = 10 then
    select u.id into v_utente from auth.users u where u.email = new.email limit 1;
    insert into public.allarmi_sicurezza (chiave, tipo, descrizione, utente_id, valore, soglia)
    values ('blocco:' || md5(new.email) || ':' || v_quarto, 'accesso_bloccato',
      'Accesso sospeso per 15 minuti dopo 10 password sbagliate di fila su ' || public.email_mascherata(new.email)
        || case when v_utente is null then ' (indirizzo che non corrisponde a nessun account)' else '' end,
      v_utente, v_n, 10)
    on conflict (chiave) do nothing;
  end if;

  -- Tanti account diversi in poco tempo: qualcuno prova una lista di credenziali rubate altrove.
  select count(distinct a.email) into v_account from public.accessi_falliti a
   where a.quando > now() - interval '15 minutes';
  if v_account >= 15 then
    insert into public.allarmi_sicurezza (chiave, tipo, descrizione, valore, soglia)
    values ('molti_account:' || v_quarto, 'tentativi_su_molti_account',
      'Password sbagliate su ' || v_account || ' account diversi in 15 minuti: possibile prova di credenziali rubate altrove',
      v_account, 15)
    on conflict (chiave) do nothing;
  end if;

  if exists (select 1 from public.sicurezza_esche e where e.tipo = 'email' and e.valore = new.email) then
    insert into public.allarmi_sicurezza (chiave, tipo, descrizione)
    values ('esca:accesso:' || new.id, 'esca', 'Tentativo di accesso con un indirizzo esca, che non e'' mai stato dato a nessuno')
    on conflict (chiave) do nothing;
  end if;
  return null;
end
$function$;
revoke all on function public.allarme_accessi_falliti() from public, anon, authenticated;

drop trigger if exists trg_allarme_accessi_falliti on public.accessi_falliti;
create trigger trg_allarme_accessi_falliti
  after insert on public.accessi_falliti
  for each row execute function public.allarme_accessi_falliti();

-- 6. Il giro ogni 15 minuti. Scrive gli allarmi nuovi e restituisce quelli non ancora spediti.
create or replace function public.controllo_allarmi()
 returns setof public.allarmi_sicurezza
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  -- Lo stesso fatto si segnala una volta per ora (o per giorno, dove scritto): chi continua per tre
  -- ore riceve tre email, non dodici.
  v_ora bigint := floor(extract(epoch from now()) / 3600);
  v_quarto bigint := floor(extract(epoch from now()) / 900);
begin
  -- A. Dati letti dal portale, per utente, nell'ultima ora. Massimo visto: 255 richieste.
  insert into public.allarmi_sicurezza (chiave, tipo, descrizione, utente_id, valore, soglia)
  select 'letture:' || t.utente_id || ':' || v_ora, 'letture_anomale',
         'Un utente ha letto dati ' || t.n || ' volte nell''ultima ora (normale: al massimo 255)',
         t.utente_id, t.n, 750
    from (select a.utente_id, count(*) n
            from public.audit_accessi a
           where a.created_at > now() - interval '1 hour' and a.utente_id is not null
             and a.azione in ('tracking_view', 'ordini_lista', 'ordini_importati_lista', 'etichetta_download', 'etichette_bulk')
           group by a.utente_id) t
   where t.n >= 750
  on conflict (chiave) do nothing;

  -- B. Etichette scaricate, per utente, nell'ultima ora (contando quelle dentro gli scarichi in blocco).
  --    Massimo visto: 5.880.
  insert into public.allarmi_sicurezza (chiave, tipo, descrizione, utente_id, valore, soglia)
  select 'etichette:' || t.utente_id || ':' || v_ora, 'etichette_anomale',
         'Un utente ha scaricato ' || t.n || ' etichette nell''ultima ora (normale: al massimo 5.880)',
         t.utente_id, t.n, 15000
    from (select a.utente_id,
                 sum(case when a.azione = 'etichetta_download' then 1
                          when a.dettaglio ~ '^\d{1,7}$' then a.dettaglio::int else 0 end) n
            from public.audit_accessi a
           where a.created_at > now() - interval '1 hour' and a.utente_id is not null
             and a.azione in ('etichetta_download', 'etichette_bulk')
           group by a.utente_id) t
   where t.n >= 15000
  on conflict (chiave) do nothing;

  -- C. Letture dalle API, per cliente, nell'ultima ora. Massimo visto: 1.059.
  insert into public.allarmi_sicurezza (chiave, tipo, descrizione, cliente_id, valore, soglia)
  select 'api:' || t.cliente || ':' || v_ora, 'api_anomala',
         'Un cliente ha letto spedizioni o etichette dalle API ' || t.n || ' volte nell''ultima ora (normale: al massimo 1.059)',
         t.cliente::uuid, t.n, 3000
    from (select substring(a.dettaglio from 'cliente ([0-9a-f-]{36})') cliente, count(*) n
            from public.audit_accessi a
           where a.created_at > now() - interval '1 hour' and a.azione in ('api_spedizione', 'api_etichetta')
           group by 1) t
   where t.n >= 3000 and t.cliente is not null
  on conflict (chiave) do nothing;

  -- D. Chiamate API rifiutate. Chiave che non esiste: tutte insieme, perche' non c'e' un "chi".
  insert into public.allarmi_sicurezza (chiave, tipo, descrizione, valore, soglia)
  select 'rifiutate:' || v_ora, 'chiamate_non_autorizzate',
         t.n || ' chiamate API con una chiave che non esiste negli ultimi 15 minuti: qualcuno prova chiavi a caso, o un gestionale ha una chiave sbagliata',
         t.n, 100
    from (select count(*) n from public.chiamate_rifiutate c
           where c.quando > now() - interval '15 minutes' and c.motivo = 'chiave_sconosciuta') t
   where t.n >= 100
  on conflict (chiave) do nothing;

  -- Chiave revocata o di un cliente spento: per chiave, una volta al giorno (di solito e' un gestionale
  -- rimasto acceso; se e' altro, lo dice l'esame).
  insert into public.allarmi_sicurezza (chiave, tipo, descrizione, cliente_id, valore, soglia)
  select 'revocata:' || t.chiave_id || ':' || current_date, 'chiamate_non_autorizzate',
         t.n || ' chiamate API negli ultimi 15 minuti con una chiave ' ||
           case t.motivo when 'chiave_revocata' then 'revocata' else 'di un cliente disattivato' end,
         k.cliente_id, t.n, 100
    from (select c.chiave_id, c.motivo, count(*) n from public.chiamate_rifiutate c
           where c.quando > now() - interval '15 minutes' and c.chiave_id is not null
             and c.motivo in ('chiave_revocata', 'cliente_disattivato')
           group by 1, 2) t
    left join public.api_keys k on k.id = t.chiave_id
   where t.n >= 100
  on conflict (chiave) do nothing;

  -- Freno di frequenza scattato (oltre 600 richieste al minuto su una chiave): ogni volta, una per ora.
  insert into public.allarmi_sicurezza (chiave, tipo, descrizione, cliente_id, valore)
  select 'frequenza:' || t.chiave_id || ':' || v_ora, 'frequenza_api',
         'Una chiave API ha superato le 600 richieste al minuto (' || t.n || ' volte nell''ultima ora): le chiamate in piu'' sono state respinte',
         k.cliente_id, t.n
    from (select c.chiave_id, count(*) n from public.chiamate_rifiutate c
           where c.quando > now() - interval '1 hour' and c.motivo = 'frequenza'
           group by 1) t
    left join public.api_keys k on k.id = t.chiave_id
  on conflict (chiave) do nothing;

  -- E. "Entra come" a raffica dalla stessa persona. Massimo visto: 9 in un'ora.
  insert into public.allarmi_sicurezza (chiave, tipo, descrizione, utente_id, valore, soglia)
  select 'entra_come:' || t.utente_id || ':' || v_ora, 'entra_come_anomalo',
         'Una persona e'' entrata negli account di altri ' || t.n || ' volte nell''ultima ora (normale: al massimo 9)',
         t.utente_id, t.n, 25
    from (select a.utente_id, count(*) n from public.audit_accessi a
           where a.created_at > now() - interval '1 hour' and a.azione like 'impersona\_%' and a.utente_id is not null
           group by 1) t
   where t.n >= 25
  on conflict (chiave) do nothing;

  -- F. Verifica in due passaggi azzerata a un cliente: ogni volta. E' la mossa che serve a chi vuole
  --    prendersi un account, quindi si guarda anche quando e' legittima.
  insert into public.allarmi_sicurezza (chiave, tipo, descrizione, utente_id, cliente_id)
  select 'azzera:' || a.id, 'verifica_azzerata',
         'Verifica in due passaggi azzerata a un cliente (' || coalesce(a.dettaglio, '') || '): controllare che l''abbia chiesto lui',
         a.utente_id, case when a.risorsa ~ '^[0-9a-f-]{36}$' then a.risorsa::uuid end
    from public.audit_accessi a
   where a.created_at > now() - interval '1 hour' and a.azione = 'azzera_verifica_cliente'
  on conflict (chiave) do nothing;

  -- G. Esche toccate.
  insert into public.allarmi_sicurezza (chiave, tipo, descrizione, utente_id)
  select 'esca:registro:' || a.id, 'esca',
         'Un record esca e'' stato letto (' || a.azione || '): nessun lavoro vero lo tocca mai',
         a.utente_id
    from public.audit_accessi a
    join public.sicurezza_esche e
      on (e.tipo = 'utente' and e.valore = a.utente_id::text)
      or (e.tipo in ('cliente', 'spedizione') and e.valore = a.risorsa)
      or (e.tipo = 'cliente' and a.dettaglio = 'cliente ' || e.valore)
   where a.created_at > now() - interval '1 hour'
  on conflict (chiave) do nothing;

  insert into public.allarmi_sicurezza (chiave, tipo, descrizione, utente_id)
  select 'esca:sessione:' || s.id, 'esca', 'Qualcuno e'' entrato nell''account esca', s.user_id
    from auth.sessions s
    join public.sicurezza_esche e on e.tipo = 'utente' and e.valore = s.user_id::text
   where s.created_at > now() - interval '1 hour'
  on conflict (chiave) do nothing;

  insert into public.allarmi_sicurezza (chiave, tipo, descrizione)
  select 'esca:api:' || k.id || ':' || v_ora, 'esca', 'La chiave API esca e'' stata usata'
    from public.api_keys k
    join public.sicurezza_esche e on e.tipo = 'chiave_api' and e.valore = k.id::text
   where k.last_used_at > now() - interval '1 hour'
  on conflict (chiave) do nothing;

  insert into public.allarmi_sicurezza (chiave, tipo, descrizione)
  select 'esca:api_rifiutata:' || c.chiave_id || ':' || v_ora, 'esca', 'La chiave API esca e'' stata provata'
    from public.chiamate_rifiutate c
    join public.sicurezza_esche e on e.tipo = 'chiave_api' and e.valore = c.chiave_id::text
   where c.quando > now() - interval '1 hour'
  on conflict (chiave) do nothing;

  -- H. La verifica in due passaggi deve restare accesa nel database (scripts/verifica-due-passaggi.sql).
  --    Spegnerla e' una riga: se succede senza che lo sappiamo, deve suonare. Una volta al giorno.
  if not exists (select 1 from pg_catalog.pg_roles r, unnest(r.rolconfig) c
                  where r.rolname = 'authenticator' and c = 'pgrst.db_pre_request=public.controllo_richiesta') then
    insert into public.allarmi_sicurezza (chiave, tipo, descrizione)
    values ('integrita:verifica:' || current_date, 'verifica_spenta',
      'Il controllo della verifica in due passaggi non e'' piu'' attivo nel database: le sessioni senza codice passano')
    on conflict (chiave) do nothing;
  end if;

  -- Pulizia: le chiamate rifiutate si tengono 13 mesi come il registro accessi; le password sbagliate
  -- servono solo al blocco (15 minuti) e all'allarme qui sopra, e il registro accessi tiene il resto.
  delete from public.chiamate_rifiutate where quando < now() - interval '13 months';
  delete from public.accessi_falliti where quando < now() - interval '30 days';

  insert into public.allarmi_giro (id, ultimo) values (true, now())
  on conflict (id) do update set ultimo = excluded.ultimo;

  return query select * from public.allarmi_sicurezza where inviato_il is null order by creato_il limit 50;
end
$function$;
revoke all on function public.controllo_allarmi() from public, anon, authenticated;
grant execute on function public.controllo_allarmi() to service_role;

-- 7. La riga della Sentinella: il giro degli allarmi e' vivo? La verifica e' accesa?
create or replace function public.controllo_giornaliero_3()
 returns table(area text, controllo text, valore numeric, atteso text, allarme boolean)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select 'sicurezza'::text, 'minuti dall''ultimo giro degli allarmi di sicurezza'::text,
         coalesce(round(extract(epoch from now() - max(g.ultimo)) / 60), 99999)::numeric,
         'sotto 30 (gira ogni 15)'::text,
         coalesce(max(g.ultimo) < now() - interval '30 minutes', true)
    from public.allarmi_giro g
  union all
  select 'sicurezza', 'allarmi di sicurezza nelle ultime 24h', count(*)::numeric, 'ognuno va esaminato', false
    from public.allarmi_sicurezza a where a.creato_il > now() - interval '24 hours'
  union all
  select 'sicurezza', 'allarmi di sicurezza non spediti per email da oltre un''ora', count(*)::numeric, 'zero', count(*) > 0
    from public.allarmi_sicurezza a where a.inviato_il is null and a.creato_il < now() - interval '1 hour'
  union all
  select 'sicurezza', 'controllo della verifica in due passaggi attivo nel database',
         (exists (select 1 from pg_catalog.pg_roles r, unnest(r.rolconfig) c
                   where r.rolname = 'authenticator' and c = 'pgrst.db_pre_request=public.controllo_richiesta'))::int::numeric,
         '1', not exists (select 1 from pg_catalog.pg_roles r, unnest(r.rolconfig) c
                   where r.rolname = 'authenticator' and c = 'pgrst.db_pre_request=public.controllo_richiesta')
  union all
  select 'sicurezza', 'account con la verifica in due passaggi attiva', count(distinct f.user_id)::numeric, 'cresce fino al 24/11', false
    from auth.mfa_factors f where f.status = 'verified'
$function$;
revoke all on function public.controllo_giornaliero_3() from public, anon, authenticated;
grant execute on function public.controllo_giornaliero_3() to service_role;

-- L'unione, per lanciarla a mano dall'editor SQL.
create or replace function public.controllo_giornaliero()
 returns table(area text, controllo text, valore numeric, atteso text, allarme boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select * from public.controllo_giornaliero_1()
  union all
  select * from public.controllo_giornaliero_2()
  union all
  select * from public.controllo_giornaliero_3()
$function$;
revoke all on function public.controllo_giornaliero() from public, anon, authenticated;
grant execute on function public.controllo_giornaliero() to service_role;
