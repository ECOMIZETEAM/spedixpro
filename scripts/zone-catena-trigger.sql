-- ZONE LUNGO LA CATENA D'ACQUISTO, TENUTE DAL DATABASE (26/11/2026). Va DOPO scripts/riallinea-zone-catena.sql.
--
-- Decisione di Lorenzo (26/11): le zone di un contratto comprato sono quelle di chi lo vende. Fino a oggi a portarle
-- giù era il codice (lib/propaga-zona.ts, la copia dei listini ai sotto-master, la condivisione), per NOME e nel
-- sottoalbero; le correzioni fatte via SQL non scendevano affatto, e una zona cancellata dal venditore restava nelle
-- copie (32 zone vuote tolte il 26/11). Con il riallineamento del 26/11 le copie sono tornate uguali al fornitore: da
-- qui le tiene uguali il database, per qualunque porta arrivi la modifica, anche una che nascerà domani.
--
-- Come:
--   - una zona si riconosce da nome (spazi ai lati e maiuscole a parte), multicollo e partenza: le zone multicollo
--     possono chiamarsi come quelle normali. L'indice unico qui sotto impedisce due zone con la stessa chiave sullo
--     stesso contratto (il 26/11: zero);
--   - le copie di un contratto sono le righe che lo comprano (corrieri.fornitore_corriere_id), mai le STACCATE:
--     quelle restano con le zone di quando i loro pacchi sono partiti;
--   - CAP: quando cambiano quelli di una zona, ogni copia riceve solo la DIFFERENZA (aggiunge quello che manca,
--     toglie quello che avanza, contando i doppioni). La copia che cambia fa lo stesso con le sue copie: si scende
--     un livello alla volta;
--   - zona nuova → nasce anche nelle copie; nome, descrizione, fuel, multicollo e partenza → seguono (la copia si
--     trova con la chiave di PRIMA); zona cancellata → sparisce anche dalle copie. I loro prezzi su quella zona
--     finiscono nell'archivio da soli (trg_archivia_fasce_*), come quelli del venditore;
--   - contratto appena comprato (o che cambia fornitore) → riceve le zone del fornitore che non ha, e quelle che ha
--     si allineano nei CAP;
--   - le zone che un compratore ha IN PIÙ del fornitore non si toccano mai: oggi sono 7, tutte senza prezzo, e
--     tolgono il corriere su quei CAP (Venezia centro, isole minori, disagiate...). Decisione di Lorenzo, 26/11;
--   - se si cancella un CONTRATTO (o un master), le sue zone cadono per cascata: le copie degli altri NO. Il
--     trigger se ne accorge perché, quando gira, la riga del contratto non c'è già più.
--
-- Il SQL Editor esegue le istruzioni una alla volta: qui è tutto in UN blocco, quindi o entra tutto o niente.
-- PRIMA si lancia scripts/zone-catena-trigger-prova.sql (stesso blocco, che alla fine si annulla da solo).

do $blocco$
begin
  perform set_config('lock_timeout', '5s', true);

  -- ── 1. Una zona per chiave, per contratto ────────────────────────────────────────────────────────────────
  execute $x$
    create unique index if not exists zone_una_per_chiave
      on public.zone (corriere_id, lower(btrim(nome)), multicollo, su_mittente)
      where corriere_id is not null
  $x$;

  -- ── 2. Le funzioni ───────────────────────────────────────────────────────────────────────────────────────
  -- Le righe che comprano un contratto e non se ne sono staccate.
  execute $x$
    create or replace function public.fn_zone_figli(p_corriere uuid)
    returns table (id uuid, master_id uuid) language sql stable security definer set search_path = public as $f$
      select c.id, c.master_id from public.corrieri c
       where c.fornitore_corriere_id = p_corriere and c.staccato_il is null and c.id <> p_corriere
    $f$
  $x$;

  -- La zona di un contratto con quella chiave (al più una: indice zone_una_per_chiave).
  execute $x$
    create or replace function public.fn_zona_per_chiave(p_corriere uuid, p_nome text, p_multicollo boolean, p_su_mittente boolean)
    returns uuid language sql stable security definer set search_path = public as $f$
      select z.id from public.zone z
       where z.corriere_id = p_corriere and lower(btrim(z.nome)) = lower(btrim(p_nome))
         and z.multicollo = p_multicollo and z.su_mittente = p_su_mittente
       limit 1
    $f$
  $x$;

  -- I CAP della zona p_a diventano quelli della zona p_da, scrivendo solo la differenza. Una riga si confronta per
  -- paese, provincia, cap e città (un valore vuoto è diverso da uno mancante); le righe doppie contano una per una.
  execute $x$
    create or replace function public.fn_zone_cap_allinea(p_da uuid, p_a uuid)
    returns void language plpgsql security definer set search_path = public as $f$
    begin
      if p_da is null or p_a is null or p_da = p_a then return; end if;
      delete from public.zone_cap t
       using (
         select x.id
           from (select zc.id, k.k, row_number() over (partition by k.k order by zc.id) rn
                   from public.zone_cap zc
                   cross join lateral (select coalesce(zc.paese, chr(2)) || chr(1) || coalesce(zc.provincia, chr(2)) || chr(1)
                                           || coalesce(zc.cap, chr(2)) || chr(1) || coalesce(zc.citta, chr(2)) k) k
                  where zc.zona_id = p_a) x
           left join (select coalesce(o.paese, chr(2)) || chr(1) || coalesce(o.provincia, chr(2)) || chr(1)
                             || coalesce(o.cap, chr(2)) || chr(1) || coalesce(o.citta, chr(2)) k, count(*) n
                        from public.zone_cap o where o.zona_id = p_da group by 1) o on o.k = x.k
          where x.rn > coalesce(o.n, 0)) d
       where t.id = d.id;
      insert into public.zone_cap (zona_id, paese, provincia, cap, citta)
      select p_a, s.paese, s.provincia, s.cap, s.citta
        from (select paese, provincia, cap, citta from public.zone_cap where zona_id = p_da
              except all
              select paese, provincia, cap, citta from public.zone_cap where zona_id = p_a) s;
    end $f$
  $x$;

  -- Crea nel contratto p_corriere la copia della zona p_da, con i suoi CAP. La copia nasce col nome esatto del
  -- venditore: il nome conta (ripiego === 'Italia' nei prezzi, supplementi multicollo per nome).
  execute $x$
    create or replace function public.fn_zona_crea_copia(p_da uuid, p_corriere uuid, p_master uuid)
    returns uuid language plpgsql security definer set search_path = public as $f$
    declare v_id uuid;
    begin
      insert into public.zone (master_id, corriere_id, nome, descrizione, con_fuel, su_mittente, multicollo)
      select p_master, p_corriere, s.nome, s.descrizione, s.con_fuel, s.su_mittente, s.multicollo
        from public.zone s where s.id = p_da
      returning id into v_id;
      if v_id is not null then perform public.fn_zone_cap_allinea(p_da, v_id); end if;
      return v_id;
    end $f$
  $x$;

  -- Toglie dalle copie la zona con quella chiave (ogni copia tolta fa lo stesso con le sue).
  execute $x$
    create or replace function public.fn_zona_togli_copie(p_corriere uuid, p_nome text, p_multicollo boolean, p_su_mittente boolean)
    returns void language sql security definer set search_path = public as $f$
      delete from public.zone z
       using public.fn_zone_figli(p_corriere) f
       where z.corriere_id = f.id and lower(btrim(z.nome)) = lower(btrim(p_nome))
         and z.multicollo = p_multicollo and z.su_mittente = p_su_mittente
    $f$
  $x$;

  -- Porta i CAP di queste zone nelle loro copie (creando la copia se manca).
  execute $x$
    create or replace function public.fn_zone_cap_alle_copie(p_zone uuid[])
    returns void language plpgsql security definer set search_path = public as $f$
    declare v_z record; v_f record; v_copia uuid;
    begin
      for v_z in select z.id, z.corriere_id, z.nome, z.multicollo, z.su_mittente
                   from public.zone z where z.id = any(p_zone) and z.corriere_id is not null loop
        for v_f in select * from public.fn_zone_figli(v_z.corriere_id) loop
          v_copia := public.fn_zona_per_chiave(v_f.id, v_z.nome, v_z.multicollo, v_z.su_mittente);
          if v_copia is null then
            perform public.fn_zona_crea_copia(v_z.id, v_f.id, v_f.master_id);
          else
            perform public.fn_zone_cap_allinea(v_z.id, v_copia);
          end if;
        end loop;
      end loop;
    end $f$
  $x$;

  -- Un contratto si allinea al suo fornitore: riceve le zone che non ha, quelle che ha prendono i CAP, la
  -- descrizione e il fuel del fornitore. Il nome di una copia già esistente NON si riscrive (il 26/11 18 copie lo
  -- scrivono con maiuscole diverse: cambiarlo cambierebbe il ripiego === 'Italia', va deciso a parte). Le zone in
  -- più non si toccano. Ritorna quante zone ha creato.
  execute $x$
    create or replace function public.fn_zone_allinea_contratto(p_corriere uuid)
    returns integer language plpgsql security definer set search_path = public as $f$
    declare v_c record; v_z record; v_copia uuid; v_n integer := 0;
    begin
      select c.id, c.master_id, c.fornitore_corriere_id, c.staccato_il into v_c from public.corrieri c where c.id = p_corriere;
      if not found or v_c.fornitore_corriere_id is null or v_c.staccato_il is not null then return 0; end if;
      for v_z in select z.id, z.nome, z.descrizione, z.con_fuel, z.multicollo, z.su_mittente
                   from public.zone z where z.corriere_id = v_c.fornitore_corriere_id order by z.created_at, z.id loop
        v_copia := public.fn_zona_per_chiave(v_c.id, v_z.nome, v_z.multicollo, v_z.su_mittente);
        if v_copia is null then
          perform public.fn_zona_crea_copia(v_z.id, v_c.id, v_c.master_id);
          v_n := v_n + 1;
        else
          update public.zone set descrizione = v_z.descrizione, con_fuel = v_z.con_fuel
           where id = v_copia and (descrizione, con_fuel) is distinct from (v_z.descrizione, v_z.con_fuel);
          perform public.fn_zone_cap_allinea(v_z.id, v_copia);
        end if;
      end loop;
      return v_n;
    end $f$
  $x$;

  -- ── 3. Le funzioni dei trigger ───────────────────────────────────────────────────────────────────────────
  execute $x$
    create or replace function public.fn_zone_cap_trg_inserite()
    returns trigger language plpgsql security definer set search_path = public as $f$
    begin
      perform public.fn_zone_cap_alle_copie(array(select distinct n.zona_id from nuove n));
      return null;
    end $f$
  $x$;
  execute $x$
    create or replace function public.fn_zone_cap_trg_tolte()
    returns trigger language plpgsql security definer set search_path = public as $f$
    begin
      perform public.fn_zone_cap_alle_copie(array(select distinct v.zona_id from vecchie v));
      return null;
    end $f$
  $x$;
  execute $x$
    create or replace function public.fn_zone_cap_trg_cambiate()
    returns trigger language plpgsql security definer set search_path = public as $f$
    begin
      perform public.fn_zone_cap_alle_copie(array(select v.zona_id from vecchie v union select n.zona_id from nuove n));
      return null;
    end $f$
  $x$;

  execute $x$
    create or replace function public.fn_zone_trg_nuova()
    returns trigger language plpgsql security definer set search_path = public as $f$
    declare v_f record; v_copia uuid;
    begin
      if new.corriere_id is null then return null; end if;
      for v_f in select * from public.fn_zone_figli(new.corriere_id) loop
        v_copia := public.fn_zona_per_chiave(v_f.id, new.nome, new.multicollo, new.su_mittente);
        if v_copia is null then
          perform public.fn_zona_crea_copia(new.id, v_f.id, v_f.master_id);
        else
          -- Chi compra aveva già una zona sua con questa chiave (un'esclusione): da ora è la copia di quella del
          -- venditore. Descrizione e fuel si allineano subito; i CAP al primo cambio dei CAP del venditore.
          update public.zone set descrizione = new.descrizione, con_fuel = new.con_fuel
           where id = v_copia and (descrizione, con_fuel) is distinct from (new.descrizione, new.con_fuel);
        end if;
      end loop;
      return null;
    end $f$
  $x$;

  execute $x$
    create or replace function public.fn_zone_trg_modificata()
    returns trigger language plpgsql security definer set search_path = public as $f$
    declare v_f record; v_copia uuid;
    begin
      -- Zona spostata su un altro contratto: dalle copie del vecchio sparisce, in quelle del nuovo nasce coi CAP.
      if new.corriere_id is distinct from old.corriere_id then
        if old.corriere_id is not null then
          perform public.fn_zona_togli_copie(old.corriere_id, old.nome, old.multicollo, old.su_mittente);
        end if;
        if new.corriere_id is not null then
          for v_f in select * from public.fn_zone_figli(new.corriere_id) loop
            v_copia := public.fn_zona_per_chiave(v_f.id, new.nome, new.multicollo, new.su_mittente);
            if v_copia is null then
              perform public.fn_zona_crea_copia(new.id, v_f.id, v_f.master_id);
            else
              perform public.fn_zone_cap_allinea(new.id, v_copia);
            end if;
          end loop;
        end if;
        return null;
      end if;
      if new.corriere_id is null
         or (new.nome, new.descrizione, new.con_fuel, new.su_mittente, new.multicollo)
            is not distinct from (old.nome, old.descrizione, old.con_fuel, old.su_mittente, old.multicollo) then
        return null;
      end if;
      for v_f in select * from public.fn_zone_figli(new.corriere_id) loop
        -- La copia si cerca con la chiave di PRIMA: se cambiano nome, multicollo o partenza, quella nuova non c'è ancora.
        v_copia := coalesce(public.fn_zona_per_chiave(v_f.id, old.nome, old.multicollo, old.su_mittente),
                            public.fn_zona_per_chiave(v_f.id, new.nome, new.multicollo, new.su_mittente));
        if v_copia is null then
          perform public.fn_zona_crea_copia(new.id, v_f.id, v_f.master_id);
        else
          -- Il nome della copia si riscrive solo se cambia DAVVERO (non solo maiuscole o spazi): il 26/11 18 copie lo
          -- scrivono con maiuscole diverse dal venditore, e il nome esatto decide il ripiego === 'Italia' nei prezzi.
          -- Accendere il fuel sulla "Italia" del venditore non deve trasformare la "ITALIA" di un sotto-master.
          begin
            update public.zone
               set nome = case when lower(btrim(nome)) <> lower(btrim(new.nome)) then new.nome else nome end,
                   descrizione = new.descrizione, con_fuel = new.con_fuel,
                   su_mittente = new.su_mittente, multicollo = new.multicollo
             where id = v_copia
               and (lower(btrim(nome)), descrizione, con_fuel, su_mittente, multicollo)
                   is distinct from (lower(btrim(new.nome)), new.descrizione, new.con_fuel, new.su_mittente, new.multicollo);
          exception when unique_violation then
            -- Il conflitto è su un contratto di chi compra, non su quello di chi modifica: dirlo, o il venditore cerca
            -- un doppione che da lui non c'è.
            raise exception 'Un contratto che compra «%» ha già una zona sua che si chiama «%»: la modifica non si può portare alle copie. Scrivi all''assistenza.',
              (select nome_contratto from public.corrieri where id = new.corriere_id), new.nome
              using errcode = '23505';
          end;
        end if;
      end loop;
      return null;
    end $f$
  $x$;

  execute $x$
    create or replace function public.fn_zone_trg_tolta()
    returns trigger language plpgsql security definer set search_path = public as $f$
    begin
      if old.corriere_id is null then return null; end if;
      -- Contratto (o master) cancellato: le sue zone cadono per cascata, e qui la sua riga non c'è già più. Le copie
      -- sono contratti di altri master, con la loro storia: non si toccano.
      if not exists (select 1 from public.corrieri where id = old.corriere_id)
         or not exists (select 1 from public.masters where id = old.master_id) then
        return null;
      end if;
      perform public.fn_zona_togli_copie(old.corriere_id, old.nome, old.multicollo, old.su_mittente);
      return null;
    end $f$
  $x$;

  execute $x$
    create or replace function public.fn_corrieri_zone_dal_fornitore()
    returns trigger language plpgsql security definer set search_path = public as $f$
    begin
      if new.fornitore_corriere_id is null or new.staccato_il is not null then return null; end if;
      if tg_op = 'UPDATE' and new.fornitore_corriere_id is not distinct from old.fornitore_corriere_id then return null; end if;
      perform public.fn_zone_allinea_contratto(new.id);
      return null;
    end $f$
  $x$;

  -- Cosa c'è attaccato a una zona più giù nella catena, da dire al venditore PRIMA che la cancelli: quante copie,
  -- di quanti master, con quanti prezzi nei loro listini (andranno in archivio). Solo totali, mai chi.
  execute $x$
    create or replace function public.zona_copie_impatto(p_zona uuid)
    returns table (contratti integer, master integer, prezzi_vendita integer, prezzi_costo integer)
    language sql stable security definer set search_path = public as $f$
      with recursive giu as (
        select z.id, z.corriere_id, lower(btrim(z.nome)) n, z.multicollo m, z.su_mittente s, 0 liv
          from public.zone z where z.id = p_zona
        union all
        select c2.id, c2.corriere_id, g.n, g.m, g.s, g.liv + 1
          from giu g
          join public.corrieri c on c.fornitore_corriere_id = g.corriere_id and c.staccato_il is null and c.id <> g.corriere_id
          join public.zone c2 on c2.corriere_id = c.id and lower(btrim(c2.nome)) = g.n and c2.multicollo = g.m and c2.su_mittente = g.s
         where g.liv < 25
      ), copie as (select g.id, g.corriere_id from giu g where g.liv > 0)
      select (select count(*) from copie)::integer,
             (select count(distinct c.master_id) from copie k join public.corrieri c on c.id = k.corriere_id)::integer,
             (select count(*) from public.listini_clienti_fasce f where f.zona_id in (select id from copie))::integer,
             (select count(*) from public.listini_corrieri_fasce f where f.zona_id in (select id from copie))::integer
    $f$
  $x$;
  execute 'revoke all on function public.zona_copie_impatto(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.zona_copie_impatto(uuid) to service_role';

  -- Nessuna di queste si chiama da fuori: le usano solo i trigger (che girano come il proprietario).
  execute $x$
    revoke all on function public.fn_zone_figli(uuid), public.fn_zona_per_chiave(uuid, text, boolean, boolean),
      public.fn_zone_cap_allinea(uuid, uuid), public.fn_zona_crea_copia(uuid, uuid, uuid),
      public.fn_zona_togli_copie(uuid, text, boolean, boolean), public.fn_zone_cap_alle_copie(uuid[]),
      public.fn_zone_allinea_contratto(uuid), public.fn_zone_cap_trg_inserite(), public.fn_zone_cap_trg_tolte(),
      public.fn_zone_cap_trg_cambiate(), public.fn_zone_trg_nuova(), public.fn_zone_trg_modificata(),
      public.fn_zone_trg_tolta(), public.fn_corrieri_zone_dal_fornitore()
    from public, anon, authenticated
  $x$;

  -- ── 4. I trigger ─────────────────────────────────────────────────────────────────────────────────────────
  -- Sui CAP a livello di ISTRUZIONE: un import di 3.580 righe allinea ogni copia una volta sola, non 3.580.
  execute 'drop trigger if exists trg_zone_cap_copie_inserite on public.zone_cap';
  execute 'create trigger trg_zone_cap_copie_inserite after insert on public.zone_cap referencing new table as nuove
             for each statement execute function public.fn_zone_cap_trg_inserite()';
  execute 'drop trigger if exists trg_zone_cap_copie_tolte on public.zone_cap';
  execute 'create trigger trg_zone_cap_copie_tolte after delete on public.zone_cap referencing old table as vecchie
             for each statement execute function public.fn_zone_cap_trg_tolte()';
  execute 'drop trigger if exists trg_zone_cap_copie_cambiate on public.zone_cap';
  execute 'create trigger trg_zone_cap_copie_cambiate after update on public.zone_cap referencing old table as vecchie new table as nuove
             for each statement execute function public.fn_zone_cap_trg_cambiate()';
  execute 'drop trigger if exists trg_zone_copie_nuova on public.zone';
  execute 'create trigger trg_zone_copie_nuova after insert on public.zone for each row execute function public.fn_zone_trg_nuova()';
  execute 'drop trigger if exists trg_zone_copie_modificata on public.zone';
  execute 'create trigger trg_zone_copie_modificata after update on public.zone for each row execute function public.fn_zone_trg_modificata()';
  execute 'drop trigger if exists trg_zone_copie_tolta on public.zone';
  execute 'create trigger trg_zone_copie_tolta after delete on public.zone for each row execute function public.fn_zone_trg_tolta()';
  -- Sui contratti due trigger: uno per quelli nuovi, uno per il cambio di fornitore. Il secondo guarda il valore FINALE
  -- (when): il fornitore di un ponte lo cambia anche fn_corrieri_catena_contratto, quando la condivisione riscrive le
  -- credenziali, e un trigger "update of fornitore_corriere_id" in quel caso non scatterebbe (la colonna non è nella SET).
  execute 'drop trigger if exists trg_corrieri_zone_dal_fornitore on public.corrieri';
  execute 'create trigger trg_corrieri_zone_dal_fornitore after insert on public.corrieri
             for each row execute function public.fn_corrieri_zone_dal_fornitore()';
  execute 'drop trigger if exists trg_corrieri_zone_cambio_fornitore on public.corrieri';
  execute 'create trigger trg_corrieri_zone_cambio_fornitore after update on public.corrieri
             for each row when (old.fornitore_corriere_id is distinct from new.fornitore_corriere_id)
             execute function public.fn_corrieri_zone_dal_fornitore()';

  -- ── 5. Sentinella, parte 6 ───────────────────────────────────────────────────────────────────────────────
  -- Ogni mattina: nessuna copia diversa dal suo fornitore (zona mancante o CAP diversi), gli 8 trigger tutti al loro
  -- posto; e per informazione quante copie hanno zone in più (le esclusioni lasciate apposta: 6 contratti il 26/11).
  -- Le zone si confrontano con un'impronta dei CAP (somma degli hash e numero di righe), come la verifica del 26/11.
  execute $x$
    create or replace function public.controllo_giornaliero_6()
    returns table(area text, controllo text, valore numeric, atteso text, allarme boolean)
    language sql stable security definer set search_path to '' as $f$
      with zf as materialized (
        select z.corriere_id, lower(btrim(z.nome)) n, z.multicollo m, z.su_mittente s,
               coalesce(sum(hashtext(coalesce(zc.paese, chr(2)) || '|' || coalesce(zc.provincia, chr(2)) || '|'
                                     || coalesce(zc.cap, chr(2)) || '|' || coalesce(zc.citta, chr(2)))::bigint), 0) h,
               count(zc.id) k, bool_or(z.con_fuel) f
          from public.zone z left join public.zone_cap zc on zc.zona_id = z.id
         where z.corriere_id is not null
         group by 1, 2, 3, 4
      ), coppie as (
        select c.id figlio, c.fornitore_corriere_id padre from public.corrieri c
         where c.fornitore_corriere_id is not null and c.staccato_il is null
      )
      select 'zone'::text, 'contratti comprati con una zona del fornitore mancante, o con CAP o fuel diversi'::text,
             count(*)::numeric, 'zero'::text, count(*) > 0
        from coppie p
       where exists (select 1 from zf a where a.corriere_id = p.padre
                        and not exists (select 1 from zf b where b.corriere_id = p.figlio and b.n = a.n and b.m = a.m
                                           and b.s = a.s and b.h = a.h and b.k = a.k and b.f = a.f))
      union all
      select 'zone', 'contratti comprati con zone in più del fornitore (esclusioni del master)', count(*)::numeric,
             'informativo', false
        from coppie p
       where exists (select 1 from zf b where b.corriere_id = p.figlio
                        and not exists (select 1 from zf a where a.corriere_id = p.padre and b.n = a.n and b.m = a.m and b.s = a.s))
      union all
      -- Una zona in più CON prezzi non è un'esclusione: vende CAP che il fornitore prezza altrove (succede se un
      -- contratto cambia fornitore: le zone del vecchio restano). Il 26/11: zero.
      select 'zone', 'contratti comprati con zone in più del fornitore che hanno prezzi', count(distinct p.figlio)::numeric, 'zero', count(*) > 0
        from coppie p join public.zone b on b.corriere_id = p.figlio
       where not exists (select 1 from public.zone a where a.corriere_id = p.padre and lower(btrim(a.nome)) = lower(btrim(b.nome))
                            and a.multicollo = b.multicollo and a.su_mittente = b.su_mittente)
         and (exists (select 1 from public.listini_clienti_fasce f where f.zona_id = b.id)
              or exists (select 1 from public.listini_corrieri_fasce f where f.zona_id = b.id))
      union all
      -- Un contratto che compra da una riga che non c'è più non riceve più niente: va visto. Il 26/11: zero.
      select 'zone', 'contratti comprati da un contratto che non esiste più', count(*)::numeric, 'zero', count(*) > 0
        from coppie p where not exists (select 1 from public.corrieri f where f.id = p.padre)
      union all
      select 'zone', 'trigger che portano le zone alle copie (attesi 8)', count(*)::numeric, '8', count(*) <> 8
        from pg_catalog.pg_trigger t
       where t.tgname in ('trg_zone_cap_copie_inserite', 'trg_zone_cap_copie_tolte', 'trg_zone_cap_copie_cambiate',
                          'trg_zone_copie_nuova', 'trg_zone_copie_modificata', 'trg_zone_copie_tolta',
                          'trg_corrieri_zone_dal_fornitore', 'trg_corrieri_zone_cambio_fornitore')
         and t.tgenabled <> 'D'
    $f$
  $x$;
  execute 'revoke all on function public.controllo_giornaliero_6() from public, anon, authenticated';
  execute 'grant execute on function public.controllo_giornaliero_6() to service_role';

  -- L'unione delle parti (per lanciarla a mano dall'editor): la parte 6 entra solo se il pezzo da cambiare c'è una
  -- volta sola, così una versione cambiata nel frattempo non si sovrascrive.
  declare v_def text; v_pezzo text := E'  select * from public.controllo_giornaliero_5()\n';
  begin
    v_def := pg_get_functiondef('public.controllo_giornaliero()'::regprocedure);
    if v_def not like '%controllo_giornaliero_6%' then
      if (length(v_def) - length(replace(v_def, v_pezzo, ''))) / length(v_pezzo) <> 1 then
        raise exception 'controllo_giornaliero() non è quella del 26/11: non la tocco. Niente è stato installato.';
      end if;
      execute replace(v_def, v_pezzo, v_pezzo || E'  union all\n  select * from public.controllo_giornaliero_6()\n');
    end if;
  end;

  -- [PROVA QUI]
end $blocco$;

-- Da guardare dopo (sola lettura): 8 trigger, l'indice, e la parte 6 della sentinella (atteso: 0 diversi, 6 con
-- zone in più, 8 trigger, nessun allarme).
select (select count(*) from pg_trigger where tgname like 'trg_zone%copie%' or tgname in ('trg_corrieri_zone_dal_fornitore', 'trg_corrieri_zone_cambio_fornitore')) trigger,
       (select indisvalid from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = 'zone_una_per_chiave') indice_valido;
select * from public.controllo_giornaliero_6();
