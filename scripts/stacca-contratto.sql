-- STACCARE UN CONTRATTO E RICOMPRARLO ALTROVE (26/11/2026) — la parte del database.
--
-- Richiesta di Lorenzo (25-26/11): ogni master ha UN fornitore per contratto, ma se trova di meglio deve poter
-- STACCARSI e comprare lo stesso contratto da un altro. Lo fa lui dal portale (pulsante "Stacca"). Lo storico
-- resta tutto: i pacchi già partiti continuano a ricevere resi, rettifiche, giacenze e contrassegni lungo la
-- catena di ALLORA, e il fornitore di prima continua ad addebitarli. Il primo sarà Atlantik (GLS).
--
-- Cosa vuol dire "staccato". La riga del contratto resta (spedizioni, ritiri e distinte ci puntano, e i prezzi
-- dopo la partenza si leggono da lì), ma da quel momento:
--   - non si riaccende: né col "Riattiva" del portale né con una risincronizzazione del fornitore;
--   - non riceve spedizioni nuove, da nessuna porta (portale, API, import, negozi, etichette di reso);
--   - non fa da modello quando nasce una copia per un sotto-master;
--   - non blocca più il nome: il master può comprare lo stesso contratto da un altro fornitore.
-- Per questo è una colonna a sé e non un segno dentro `settings`: i settings si riscrivono da tre punti del
-- portale e un trigger li copia ai sotto-master.
--
-- IL SQL EDITOR ESEGUE LE ISTRUZIONI UNA PER UNA (lezione del 26/11): ognuna qui sotto sta in piedi da sola,
-- e l'unica che riscrive una funzione esistente controlla l'impronta nello stesso blocco in cui la cambia.
-- Non cambia niente di quello che succede oggi: finché nessuno preme "Stacca" non c'è nessuna riga staccata.

-- ── 1. Le colonne ────────────────────────────────────────────────────────────────────────────────
alter table public.corrieri add column if not exists staccato_il timestamptz;
alter table public.corrieri add column if not exists staccato_da uuid;
-- Il portale legge i contratti con permessi per colonna: la data del distacco la vede, chi l'ha fatto no.
grant select (staccato_il) on public.corrieri to authenticated;

-- ── 2. La guardia sulla riga: staccato resta staccato, e spento ─────────────────────────────────
-- Il portale ha il permesso di scrittura sull'intera tabella (le regole stanno nelle RLS e nei trigger), quindi
-- la colonna nuova la potrebbe scrivere: qui si ferma. Staccare si fa solo da fn_stacca_contratto.
-- `attivo` su una riga staccata si forza a false invece di dare errore: una risincronizzazione del fornitore
-- che prova a riaccendere un ponte non deve far fallire gli altri contratti dello stesso collegamento.
create or replace function public.fn_corrieri_staccato_guardia() returns trigger
language plpgsql set search_path = public as $$
declare v_portale boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'INSERT' then
    if v_portale then new.staccato_il := null; new.staccato_da := null; end if;
    if new.staccato_il is not null then new.attivo := false; end if;
    return new;
  end if;
  if v_portale and (new.staccato_il is distinct from old.staccato_il or new.staccato_da is distinct from old.staccato_da) then
    raise exception 'Un contratto si stacca solo dal pulsante "Stacca".' using errcode = '42501';
  end if;
  if old.staccato_il is not null and new.staccato_il is null then
    raise exception 'Un contratto staccato resta staccato (corriere %).', new.id using errcode = '42501';
  end if;
  if new.staccato_il is not null and new.attivo is distinct from false then
    new.attivo := false;
  end if;
  return new;
end $$;
revoke all on function public.fn_corrieri_staccato_guardia() from public, anon, authenticated;
drop trigger if exists trg_corrieri_staccato_guardia on public.corrieri;
create trigger trg_corrieri_staccato_guardia before insert or update on public.corrieri
  for each row execute function public.fn_corrieri_staccato_guardia();

-- ── 3. Nessuna spedizione nuova su un contratto staccato, da nessuna porta ───────────────────────
-- Oggi le spedizioni nascono da due rotte (creazione del portale e API v1) e ognuna già rifiuta un contratto
-- spento. Qui la regola sta dove passano tutte, anche una porta che nascerà domani.
create or replace function public.fn_spedizione_non_su_staccato() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.corriere_id is not null
     and exists (select 1 from public.corrieri c where c.id = new.corriere_id and c.staccato_il is not null) then
    raise exception 'Questo contratto è stato staccato: non si usa per spedizioni nuove (corriere %).', new.corriere_id
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.fn_spedizione_non_su_staccato() from public, anon, authenticated;
drop trigger if exists trg_spedizione_non_su_staccato on public.spedizioni;
create trigger trg_spedizione_non_su_staccato before insert on public.spedizioni
  for each row execute function public.fn_spedizione_non_su_staccato();

-- ── 4. Una copia nuova non si aggancia a una riga staccata ───────────────────────────────────────
-- Quando il codice crea la copia di un contratto per un sotto-master senza dire da quale riga del padre compra,
-- fn_corrieri_catena_contratto la cerca per nome e prende la più vecchia: con una riga staccata e una nuova
-- omonima nel padre prenderebbe quella staccata, e tutti i pacchi del sotto-master seguirebbero il fornitore di
-- prima. Si aggiunge una condizione alla ricerca. Il resto della funzione resta identico: si controlla
-- l'impronta di oggi e che il pezzo cambiato sia esattamente uno.
do $$
declare v_def text; v_nuova text;
  v_vecchio text := E'           and (p.tipo = ''moovexpress'') = (new.tipo = ''moovexpress'')\n         order by (p.credenziali = new.credenziali) desc, p.created_at\n';
  v_nuovo text := E'           and (p.tipo = ''moovexpress'') = (new.tipo = ''moovexpress'')\n           and p.staccato_il is null   -- 26/11/2026: mai da una riga staccata\n         order by (p.credenziali = new.credenziali) desc, p.created_at\n';
begin
  v_def := pg_get_functiondef('public.fn_corrieri_catena_contratto()'::regprocedure);
  if v_def like '%p.staccato_il is null%' then
    raise notice 'fn_corrieri_catena_contratto ha già la condizione: niente da fare';
    return;
  end if;
  if md5(v_def) <> 'd7689aca8dba566e9e380258d06d6ace' then
    raise exception 'fn_corrieri_catena_contratto è cambiata dal 26/11: non la tocco. Rileggerla e rifare lo script.';
  end if;
  if (length(v_def) - length(replace(v_def, v_vecchio, ''))) / length(v_vecchio) <> 1 then
    raise exception 'il pezzo da cambiare non c''è una volta sola: non tocco niente';
  end if;
  v_nuova := replace(v_def, v_vecchio, v_nuovo);
  execute v_nuova;
end $$;

-- ── 5. Staccare: una funzione sola, chiamata dal pulsante ────────────────────────────────────────
-- Le regole stanno qui e non nella rotta, così valgono da qualunque parte arrivi la richiesta:
--   - si stacca solo un contratto COMPRATO (con un fornitore); i contratti propri restano del master;
--   - non si stacca se qualcuno lo compra ancora da questa riga (sotto-master o compratori via codice): il loro
--     contratto resterebbe acceso su una riga che non spedisce più. Prima si staccano loro;
--   - la chiave del collegamento NON si tocca: sta sulla riga del fornitore e serve a tracking ed etichette dei
--     pacchi già partiti (revocarla, come fanno "Revoca" e "Disabilita", li ferma).
-- Rilanciarla su un contratto già staccato non fa niente.
create or replace function public.fn_stacca_contratto(p_corriere_id uuid, p_utente uuid, p_attore text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_valle int;
begin
  select id, master_id, nome_contratto, proprio, fornitore_corriere_id, collegamento_id, attivo, staccato_il
    into r from public.corrieri where id = p_corriere_id for update;
  if not found then
    raise exception 'Contratto inesistente.' using errcode = 'P0002';
  end if;
  if r.staccato_il is not null then
    return jsonb_build_object('esito', 'gia_staccato', 'staccato_il', r.staccato_il);
  end if;
  if r.fornitore_corriere_id is null or r.proprio then
    raise exception 'Si stacca solo un contratto comprato da un altro master: questo è tuo.' using errcode = '22023';
  end if;
  select count(*) into v_valle from public.corrieri g where g.fornitore_corriere_id = r.id and g.staccato_il is null;
  if v_valle > 0 then
    raise exception 'Questo contratto lo comprano ancora da te (% contratti di sotto-master o compratori): prima si staccano loro.', v_valle
      using errcode = '22023';
  end if;
  update public.corrieri set staccato_il = now(), staccato_da = p_utente, attivo = false where id = r.id;
  insert into public.audit_log (at, attore_uid, attore, azione, tabella, record_id, modifiche)
  values (now(), p_utente, p_attore, 'stacca_contratto', 'corrieri', r.id::text,
          jsonb_build_object('master_id', r.master_id, 'nome_contratto', r.nome_contratto, 'fornitore_corriere_id', r.fornitore_corriere_id,
                             'collegamento_id', r.collegamento_id, 'era_attivo', r.attivo));
  return jsonb_build_object('esito', 'staccato', 'staccato_il', now());
end $$;
revoke all on function public.fn_stacca_contratto(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fn_stacca_contratto(uuid, uuid, text) to service_role;

-- ── 6. Da guardare dopo il lancio (sola lettura) ─────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'corrieri' and column_name in ('staccato_il', 'staccato_da')) colonne,
  (select count(*) from pg_trigger where tgname in ('trg_corrieri_staccato_guardia', 'trg_spedizione_non_su_staccato')) trigger,
  (pg_get_functiondef('public.fn_corrieri_catena_contratto()'::regprocedure) like '%p.staccato_il is null%') copie_mai_da_staccate,
  (select count(*) from pg_proc where proname = 'fn_stacca_contratto') funzione_stacca;
