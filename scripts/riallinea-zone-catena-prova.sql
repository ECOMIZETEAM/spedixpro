-- PROVA A VUOTO del riallineamento zone (26/11/2026): lo stesso blocco di scripts/riallinea-zone-catena.sql (registro
-- compreso), ma alla fine si ferma con un errore voluto che riporta i numeri. Nel SQL Editor un blocco è tutto o niente:
-- l'errore annulla ogni modifica, quindi non resta NIENTE. Va lanciata dopo il punto 1 di riallinea-zone-catena.sql (la
-- tabella di salvataggio deve esistere, e resta vuota).
-- NON MODIFICARE A MANO: si rigenera dal file principale.

do $$
declare
  r record; fz record; z record;
  v_keeper uuid; v_n int; v_prima bigint; v_dopo bigint; v_fuori int; v_aut jsonb;
  v_righe int := 0; v_create int := 0; v_inpiu int := 0; v_inpiu_tenute int := 0; v_doppie int := 0; v_riscritte int := 0;
  v_fasce int := 0; v_archivio int := 0; v_fuel int := 0;
  v_toccata boolean; v_elenco jsonb := '[]'::jsonb; v_tenute jsonb := '[]'::jsonb;
begin
  set local lock_timeout = '5s';
  if to_regclass('public.zone_riallineamento_20261126') is null then
    raise exception 'manca la tabella di salvataggio: lanciare prima il punto 1';
  end if;

  -- I prezzi archiviati per zona, letti una volta (gli archivi non hanno un indice sulla zona).
  create temp table _arch on commit drop as
    select a.riga->>'zona_id' as zona_id, count(*)::int as n
      from (select riga from public.listini_clienti_archivio union all select riga from public.listini_corrieri_archivio) a
     where a.riga ? 'zona_id' group by 1;
  create index on _arch (zona_id);

  -- Contratti comprati che la salita dei puntatori non raggiunge (giro chiuso o più di 12 salti): si contano.
  with recursive pr(id, prof) as (
    select c.id, 0 from public.corrieri c where c.staccato_il is null and c.fornitore_corriere_id is null
    union all
    select g.id, pr.prof + 1 from public.corrieri g join pr on g.fornitore_corriere_id = pr.id where g.staccato_il is null and pr.prof < 12)
  select count(*) into v_fuori from public.corrieri c
   where c.staccato_il is null and c.fornitore_corriere_id is not null and c.id not in (select id from pr);

  for r in
    with recursive pr(id, prof) as (
      select c.id, 0 from public.corrieri c where c.staccato_il is null and c.fornitore_corriere_id is null
      union all
      select g.id, pr.prof + 1 from public.corrieri g join pr on g.fornitore_corriere_id = pr.id
       where g.staccato_il is null and pr.prof < 12)
    select c.id, c.fornitore_corriere_id as f_id, c.master_id, c.nome_contratto, pr.prof
      from pr join public.corrieri c on c.id = pr.id
     where pr.prof > 0 and c.proprio is not true
     order by pr.prof, c.id
  loop
    v_toccata := false;
    -- Le zone del contratto si bloccano: nessuno ci attacca o ci toglie prezzi mentre si lavora.
    perform 1 from public.zone where corriere_id = r.id for update;
    select (select count(*) from public.listini_corrieri_fasce x join public.zone zz on zz.id = x.zona_id where zz.corriere_id = r.id)
         + (select count(*) from public.listini_clienti_fasce x join public.zone zz on zz.id = x.zona_id where zz.corriere_id = r.id)
         + coalesce((select sum(a.n) from _arch a join public.zone zz on zz.id::text = a.zona_id where zz.corriere_id = r.id), 0)
      into v_prima;

    -- Il fornitore ha una zona sola per chiave: è il detentore, o è già stato riallineato in questo stesso giro.
    if exists (select 1 from public.zone f where f.corriere_id = r.f_id
               group by lower(btrim(f.nome)), f.multicollo, f.su_mittente having count(*) > 1) then
      raise exception 'il fornitore % del contratto % ha due zone uguali: non tocco niente', r.f_id, r.id;
    end if;

    -- 1. Zone che il fornitore non ha.
    for z in select zz.*, (select count(*) from public.zone_cap zc where zc.zona_id = zz.id) as ncap
               from public.zone zz where zz.corriere_id = r.id
                and not exists (select 1 from public.zone f where f.corriere_id = r.f_id and lower(btrim(f.nome)) = lower(btrim(zz.nome))
                                   and f.multicollo = zz.multicollo and f.su_mittente = zz.su_mittente)
    loop
      if z.ncap > 0 then
        -- Con CAP: oggi esclude il corriere su quei CAP. Non si tocca; decide Lorenzo.
        v_inpiu_tenute := v_inpiu_tenute + 1;
        v_tenute := v_tenute || jsonb_build_object('corriere', r.id, 'contratto', r.nome_contratto, 'zona', z.nome, 'cap', z.ncap);
        continue;
      end if;
      if exists (select 1 from public.listini_corrieri_fasce x where x.zona_id = z.id)
         or exists (select 1 from public.listini_clienti_fasce x where x.zona_id = z.id)
         or exists (select 1 from _arch a where a.zona_id = z.id::text) then
        raise exception 'la zona vuota "%" del contratto % ha prezzi (vivi o archiviati) ma il fornitore non ce l''ha: non tocco niente', z.nome, r.id;
      end if;
      select coalesce(jsonb_agg(a.id), '[]'::jsonb) into v_aut from public.autisti a where a.zona_id = z.id;
      insert into public.zone_riallineamento_20261126 (corriere_id, zona_id, motivo, zona, cap)
      values (r.id, z.id, 'tolta: vuota, il fornitore non ce l''ha', to_jsonb(z) - 'ncap' || jsonb_build_object('autisti', v_aut), '[]'::jsonb);
      update public.autisti set zona_id = null where zona_id = z.id;
      delete from public.zone where id = z.id;
      v_inpiu := v_inpiu + 1; v_toccata := true;
    end loop;

    -- 2. Le zone del fornitore, una per una.
    for fz in select f.* from public.zone f where f.corriere_id = r.f_id order by f.created_at, f.id loop
      v_keeper := null;
      for z in select zz.*,
                      (select count(*) from public.listini_corrieri_fasce x where x.zona_id = zz.id)
                    + (select count(*) from public.listini_clienti_fasce x where x.zona_id = zz.id)
                    + coalesce((select a.n from _arch a where a.zona_id = zz.id::text), 0) as prezzi
                 from public.zone zz
                where zz.corriere_id = r.id and lower(btrim(zz.nome)) = lower(btrim(fz.nome))
                  and zz.multicollo = fz.multicollo and zz.su_mittente = fz.su_mittente
                order by prezzi desc, (zz.nome = fz.nome) desc, zz.created_at, zz.id
      loop
        if v_keeper is null then v_keeper := z.id; continue; end if;
        -- Doppione: tutto quello che ha passa alla copia tenuta. Due prezzi vivi per la stessa zona nello stesso
        -- listino non si fondono a caso: ci si ferma.
        if exists (select 1 from public.listini_corrieri_fasce a join public.listini_corrieri_fasce b on b.listino_id = a.listino_id
                    where a.zona_id = z.id and b.zona_id = v_keeper)
           or exists (select 1 from public.listini_clienti_fasce a join public.listini_clienti_fasce b on b.listino_id = a.listino_id
                    where a.zona_id = z.id and b.zona_id = v_keeper) then
          raise exception 'le due copie della zona "%" del contratto % hanno prezzi nello stesso listino: non tocco niente', z.nome, r.id;
        end if;
        select coalesce(jsonb_agg(a.id), '[]'::jsonb) into v_aut from public.autisti a where a.zona_id = z.id;
        insert into public.zone_riallineamento_20261126 (corriere_id, zona_id, motivo, zona, cap)
        values (r.id, z.id, 'tolta: doppione di ' || v_keeper, to_jsonb(z) - 'prezzi' || jsonb_build_object('autisti', v_aut),
                coalesce((select jsonb_agg(to_jsonb(zc)) from public.zone_cap zc where zc.zona_id = z.id), '[]'::jsonb));
        update public.listini_corrieri_fasce set zona_id = v_keeper where zona_id = z.id;
        get diagnostics v_n = row_count; v_fasce := v_fasce + v_n;
        update public.listini_clienti_fasce set zona_id = v_keeper where zona_id = z.id;
        get diagnostics v_n = row_count; v_fasce := v_fasce + v_n;
        update public.listini_clienti_archivio set riga = jsonb_set(riga, '{zona_id}', to_jsonb(v_keeper::text)) where riga->>'zona_id' = z.id::text;
        get diagnostics v_n = row_count; v_archivio := v_archivio + v_n;
        update public.listini_corrieri_archivio set riga = jsonb_set(riga, '{zona_id}', to_jsonb(v_keeper::text)) where riga->>'zona_id' = z.id::text;
        get diagnostics v_n = row_count; v_archivio := v_archivio + v_n;
        update _arch set zona_id = v_keeper::text where zona_id = z.id::text;
        update public.aumenti_listino_righe set zona_id = v_keeper where zona_id = z.id;
        update public.ottimizza_margini_log set zona_id = v_keeper where zona_id = z.id;
        update public.autisti set zona_id = v_keeper where zona_id = z.id;
        if exists (select 1 from public.listini_corrieri_fasce x where x.zona_id = z.id)
           or exists (select 1 from public.listini_clienti_fasce x where x.zona_id = z.id) then
          raise exception 'il doppione "%" del contratto % ha ancora prezzi dopo lo spostamento: non tocco niente', z.nome, r.id;
        end if;
        delete from public.zone where id = z.id;
        v_doppie := v_doppie + 1; v_toccata := true;
      end loop;

      if v_keeper is null then
        -- Manca: nasce coi CAP del fornitore, senza prezzi.
        insert into public.zone (master_id, corriere_id, nome, descrizione, con_fuel, su_mittente, multicollo)
        values (r.master_id, r.id, fz.nome, fz.descrizione, fz.con_fuel, fz.su_mittente, fz.multicollo)
        returning id into v_keeper;
        insert into public.zone_cap (zona_id, paese, provincia, cap, citta)
        select v_keeper, zc.paese, zc.provincia, zc.cap, zc.citta from public.zone_cap zc where zc.zona_id = fz.id;
        insert into public.zone_riallineamento_20261126 (corriere_id, zona_id, motivo, zona, cap)
        select r.id, v_keeper, 'creata come il fornitore ' || fz.id, to_jsonb(zz), '[]'::jsonb from public.zone zz where zz.id = v_keeper;
        v_create := v_create + 1; v_toccata := true;
      else
        if exists (select zc.paese, zc.provincia, zc.cap, zc.citta from public.zone_cap zc where zc.zona_id = v_keeper
                   except all
                   select zc.paese, zc.provincia, zc.cap, zc.citta from public.zone_cap zc where zc.zona_id = fz.id)
           or exists (select zc.paese, zc.provincia, zc.cap, zc.citta from public.zone_cap zc where zc.zona_id = fz.id
                   except all
                   select zc.paese, zc.provincia, zc.cap, zc.citta from public.zone_cap zc where zc.zona_id = v_keeper) then
          insert into public.zone_riallineamento_20261126 (corriere_id, zona_id, motivo, zona, cap)
          select r.id, v_keeper, 'CAP riscritti come il fornitore ' || fz.id, to_jsonb(zz),
                 coalesce((select jsonb_agg(to_jsonb(zc)) from public.zone_cap zc where zc.zona_id = v_keeper), '[]'::jsonb)
            from public.zone zz where zz.id = v_keeper;
          delete from public.zone_cap where zona_id = v_keeper;
          insert into public.zone_cap (zona_id, paese, provincia, cap, citta)
          select v_keeper, zc.paese, zc.provincia, zc.cap, zc.citta from public.zone_cap zc where zc.zona_id = fz.id;
          v_riscritte := v_riscritte + 1; v_toccata := true;
        end if;
        update public.zone set con_fuel = fz.con_fuel where id = v_keeper and con_fuel is distinct from fz.con_fuel;
        get diagnostics v_n = row_count; v_fuel := v_fuel + v_n;
      end if;
    end loop;

    -- Nessun prezzo del contratto si perde: i doppioni li hanno passati alla copia tenuta, le zone tolte non ne avevano.
    select (select count(*) from public.listini_corrieri_fasce x join public.zone zz on zz.id = x.zona_id where zz.corriere_id = r.id)
         + (select count(*) from public.listini_clienti_fasce x join public.zone zz on zz.id = x.zona_id where zz.corriere_id = r.id)
         + coalesce((select sum(a.n) from _arch a join public.zone zz on zz.id::text = a.zona_id where zz.corriere_id = r.id), 0)
      into v_dopo;
    if v_dopo <> v_prima then
      raise exception 'contratto %: prezzi prima % e dopo %: non tocco niente', r.id, v_prima, v_dopo;
    end if;

    if v_toccata then
      v_righe := v_righe + 1;
      v_elenco := v_elenco || jsonb_build_object('corriere', r.id, 'contratto', r.nome_contratto, 'fornitore', r.f_id);
    end if;
  end loop;

  -- Misurati il 26/11: 41 contratti. Molti di più vuol dire che qualcosa è cambiato da allora: si guarda prima.
  if v_righe > 45 then
    raise exception 'contratti da riallineare: % (attesi 41): non tocco niente', v_righe;
  end if;

  insert into public.audit_log (at, attore, azione, tabella, record_id, modifiche)
  values (now(), 'riallineamento zone 26/11', 'riallinea_zone', 'zone', null,
          jsonb_build_object('contratti', v_righe, 'zone_create', v_create, 'zone_vuote_tolte', v_inpiu, 'zone_in_piu_con_cap_lasciate', v_inpiu_tenute,
                             'doppioni_tolti', v_doppie, 'zone_cap_riscritte', v_riscritte, 'fasce_spostate', v_fasce,
                             'archivio_spostate', v_archivio, 'fuel_allineati', v_fuel, 'contratti_fuori_catena', v_fuori,
                             'elenco', v_elenco, 'lasciate', v_tenute));
  raise exception 'PROVA A VUOTO, NIENTE SALVATO. Contratti %, zone create %, vuote tolte %, in più con CAP lasciate %, doppioni tolti %, zone con CAP riscritti %, fasce spostate %, archiviate spostate %, Fuel %, fuori catena %',
    v_righe, v_create, v_inpiu, v_inpiu_tenute, v_doppie, v_riscritte, v_fasce, v_archivio, v_fuel, v_fuori;
end $$;
