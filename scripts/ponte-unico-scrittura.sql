-- PONTE UNICO, FASE 3: la scrittura unica dei condivisi (PONTE-UNICO.md, «Fase 3»).
--
-- Oggi un condiviso SDA EXPRESS L passa da tre richieste HTTP in fila (portale -> Wave -> LOGIXIA), e ognuna
-- scrive la sua riga e i suoi addebiti per conto suo. Se una muore a meta' restano gambe senza la riga del
-- cliente. Qui le stesse scritture diventano una transazione sola:
--
--   ponte_prenota  prima della LDV: annota il lavoro "in corso" e prenota il credito di ogni conto d'ingrosso
--                  della fila, tutto o niente (stessa funzione e stessa capienza di oggi).
--   ponte_ldv      appena il corriere ha dato la LDV: la si annota, cosi' un processo che muore dopo non la perde.
--   ponte_scrivi   le righe (cliente e gambe) e i movimenti, nello stesso ordine della staffetta e con le stesse
--                  funzioni (conferma_prenotazione_spedizione, registra_movimento_cliente/master): gli automatismi
--                  del database (contatori, commissione, conto del movimento...) scattano come adesso.
--                  O tutto o niente. Con p_prova fa tutto, rilegge cosa ha scritto e annulla: e' il confronto in
--                  ombra con quello che la staffetta ha scritto davvero.
--   ponte_storna   il corriere ha rifiutato: si stornano le prenotazioni della fila.
--
-- Il piano (righe e operazioni) lo prepara il codice (lib/ponte-unico) con le stesse funzioni della staffetta:
-- qui non si calcola nessun prezzo, si esegue.
--
-- Sicurezza: tabella con RLS e nessun accesso da anon/authenticated; funzioni SECURITY INVOKER eseguibili solo
-- dal client di servizio, con il controllo del ruolo dentro come le funzioni di movimento esistenti.

-- ── Il registro del lavoro in corso ────────────────────────────────────────────────────────────────────────
-- Una riga per condiviso creato col ponte unico, scritta PRIMA di comprare la LDV. Se il processo muore fra la
-- LDV e la scrittura, un giro automatico la trova qui e scrive il piano: il credito e' gia' prenotato. Oggi, nello
-- stesso caso, nascono le gambe orfane. Niente etichetta (la si riprende dal corriere), niente dati in piu' di
-- quelli che finiscono comunque nelle righe.
create table if not exists public.ponte_in_corso (
  id uuid primary key,                 -- l'id della riga del cliente, deciso prima di comprare la LDV
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  stato text not null check (stato in ('in_corso', 'ldv', 'scritta', 'stornata', 'da_verificare')),
  contratto text not null,
  master_id uuid not null,
  ldv text,
  ldv_dati jsonb,                      -- come riprendere l'etichetta (indirizzo del corriere, ambiente): niente PDF
  piano jsonb not null,                -- le scritture, senza numero ne' etichetta (si completano con la LDV)
  prenotazioni text[] not null default '{}',
  errore text
);
create index if not exists ponte_in_corso_aperti on public.ponte_in_corso (creato_il) where stato in ('in_corso', 'ldv', 'da_verificare');

alter table public.ponte_in_corso enable row level security;
revoke all on table public.ponte_in_corso from anon, authenticated, public;

-- ── Il controllo del ruolo, uguale a quello delle funzioni di movimento ────────────────────────────────────
create or replace function public.ponte_solo_servizio()
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_claims text := current_setting('request.jwt.claims', true);
begin
  if not (v_claims is null or v_claims = '' or coalesce(nullif(v_claims, '')::jsonb ->> 'role', '') = 'service_role') then
    raise exception 'Non autorizzato' using errcode = '42501';
  end if;
end $$;

-- ── 1. Prenotazione della fila, tutta o niente ─────────────────────────────────────────────────────────────
-- p_prenota: [{ livello, master_id, cliente_id, descrizione, importo, riferimento }] nell'ordine della fila.
-- Se un conto d'ingrosso non ha credito: errore PP002 'CREDITO_INSUFFICIENTE:<livello>' e non resta scritto
-- niente, nemmeno il registro.
create or replace function public.ponte_prenota(p_id uuid, p_contratto text, p_master_id uuid, p_piano jsonb, p_prenota jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_p jsonb; v_refs text[] := '{}';
begin
  perform public.ponte_solo_servizio();
  insert into public.ponte_in_corso (id, stato, contratto, master_id, piano)
  values (p_id, 'in_corso', p_contratto, p_master_id, p_piano);
  for v_p in select * from jsonb_array_elements(coalesce(p_prenota, '[]'::jsonb)) loop
    begin
      perform public.registra_movimento_cliente(
        (v_p->>'master_id')::uuid, (v_p->>'cliente_id')::uuid, 'spedizione', v_p->>'descrizione',
        (v_p->>'importo')::numeric, v_p->>'riferimento', null::uuid, null::uuid, true);
    exception when others then
      if sqlerrm like '%CREDITO_INSUFFICIENTE%' then
        raise exception 'CREDITO_INSUFFICIENTE:%', v_p->>'livello' using errcode = 'PP002';
      end if;
      raise;
    end;
    v_refs := v_refs || (v_p->>'riferimento');
  end loop;
  update public.ponte_in_corso set prenotazioni = v_refs where id = p_id;
  return jsonb_build_object('prenotazioni', to_jsonb(v_refs));
end $$;

-- ── 2. La LDV c'e' ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.ponte_ldv(p_id uuid, p_ldv text, p_dati jsonb)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  perform public.ponte_solo_servizio();
  update public.ponte_in_corso set stato = 'ldv', ldv = p_ldv, ldv_dati = p_dati, aggiornato_il = now()
   where id = p_id and stato = 'in_corso';
end $$;

-- ── 3. Il corriere ha rifiutato: si stornano le prenotazioni della fila ────────────────────────────────────
create or replace function public.ponte_storna(p_id uuid, p_errore text)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_ref text; v_stato text;
begin
  perform public.ponte_solo_servizio();
  select stato into v_stato from public.ponte_in_corso where id = p_id for update;
  if v_stato is null or v_stato <> 'in_corso' then return; end if;   -- gia' chiuso, o la LDV c'e': non si storna
  for v_ref in select unnest(prenotazioni) from public.ponte_in_corso where id = p_id loop
    perform public.storna_prenotazione_spedizione(v_ref);
  end loop;
  update public.ponte_in_corso set stato = 'stornata', errore = left(p_errore, 500), aggiornato_il = now() where id = p_id;
end $$;

-- ── 4. La scrittura unica ──────────────────────────────────────────────────────────────────────────────────
-- p_piano: { id: <riga del cliente>, ops: [...] } con le operazioni nell'ordine della staffetta:
--   { op: 'spedizione', riga: {...} }                                   una riga di spedizioni, id compreso
--   { op: 'conferma', riferimento, spedizione_id, descrizione, importo_finale, riferimento_finale,
--     master_id, cliente_id }                                           la prenotazione diventa l'addebito
--   { op: 'cliente', tipo, master_id, cliente_id, descrizione, importo, riferimento, spedizione_id, created_by }
--   { op: 'master', tipo, owner, target, descrizione, importo, riferimento, spedizione_id, created_by }
--   { op: 'prenota', ... come ponte_prenota }                           solo in prova: la prenotazione vera
--                                                                       e' gia' stata fatta prima della LDV
-- Ripetibile: se la riga del cliente esiste gia', non si riscrive niente.
-- p_prova: tutto come davvero, poi si rilegge cosa e' stato scritto e si annulla. Per non urtare le righe vere
-- dello stesso pacco, in prova `numero` e `rif_ordine` prendono il suffisso '~ombra' (sono gli unici con un
-- indice unico che le righe vere occupano gia').
create or replace function public.ponte_scrivi(p_piano jsonb, p_prova boolean default false)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_id uuid := (p_piano->>'id')::uuid;
  v_op jsonb; v_riga jsonb; v_cols text; v_ids uuid[] := '{}'; v_saldo numeric; v_letto jsonb; v_estraneo text;
begin
  perform public.ponte_solo_servizio();
  if v_id is null then raise exception 'PONTE: piano senza id'; end if;
  -- Quanto si aspetta una riga occupata da un'altra scrittura. La prova cede presto (200 ms): non deve mai essere lei
  -- a far annullare una scrittura vera (il database sceglie chi annullare in un blocco incrociato dopo 1 secondo).
  -- La scrittura vera aspetta di piu', poi riprova o lascia al recupero.
  perform set_config('lock_timeout', case when p_prova then '200ms' else '3s' end, true);
  if not p_prova and exists (select 1 from public.spedizioni where id = v_id) then
    update public.ponte_in_corso set stato = 'scritta', piano = '{}'::jsonb, aggiornato_il = now() where id = v_id and stato <> 'scritta';
    return jsonb_build_object('gia_scritta', true);
  end if;

  begin
    for v_op in select * from jsonb_array_elements(p_piano->'ops') loop
      case v_op->>'op'
      when 'spedizione' then
        v_riga := v_op->'riga';
        select k into v_estraneo from jsonb_object_keys(v_riga) k
         where not exists (select 1 from pg_attribute a where a.attrelid = 'public.spedizioni'::regclass
                             and a.attname = k and a.attnum > 0 and not a.attisdropped) limit 1;
        if v_estraneo is not null then raise exception 'PONTE: campo sconosciuto %', v_estraneo; end if;
        if p_prova then
          v_riga := v_riga || jsonb_build_object('numero', (v_riga->>'numero') || '~ombra')
            || case when coalesce(v_riga->>'rif_ordine', '') <> '' then jsonb_build_object('rif_ordine', (v_riga->>'rif_ordine') || '~ombra') else '{}'::jsonb end;
        end if;
        select string_agg(quote_ident(k), ',') into v_cols from jsonb_object_keys(v_riga) k;
        execute format('insert into public.spedizioni (%1$s) select %1$s from jsonb_populate_record(null::public.spedizioni, $1)', v_cols)
          using v_riga;
        v_ids := v_ids || (v_riga->>'id')::uuid;
      when 'conferma' then
        v_saldo := public.conferma_prenotazione_spedizione(v_op->>'riferimento', (v_op->>'spedizione_id')::uuid,
          v_op->>'descrizione', (v_op->>'importo_finale')::numeric, v_op->>'riferimento_finale');
        -- Prenotazione sparita (liberata dal giro delle scadute): la spedizione esiste e va pagata adesso. Oggi
        -- la staffetta in questo caso non addebitava niente.
        if v_saldo is null then
          perform public.registra_movimento_cliente((v_op->>'master_id')::uuid, (v_op->>'cliente_id')::uuid, 'spedizione',
            v_op->>'descrizione', -abs((v_op->>'importo_finale')::numeric), v_op->>'riferimento_finale',
            (v_op->>'spedizione_id')::uuid, null::uuid, false);
        end if;
      when 'cliente' then
        perform public.registra_movimento_cliente((v_op->>'master_id')::uuid, (v_op->>'cliente_id')::uuid, v_op->>'tipo',
          v_op->>'descrizione', (v_op->>'importo')::numeric, v_op->>'riferimento', (v_op->>'spedizione_id')::uuid,
          (v_op->>'created_by')::uuid, false);
      when 'master' then
        perform public.registra_movimento_master((v_op->>'owner')::uuid, (v_op->>'target')::uuid, v_op->>'tipo',
          v_op->>'descrizione', (v_op->>'importo')::numeric, v_op->>'riferimento', (v_op->>'spedizione_id')::uuid,
          (v_op->>'created_by')::uuid);
      when 'prenota' then
        -- Solo in prova, e senza la verifica di capienza: la prova rifa' una spedizione gia' pagata, e nel frattempo il
        -- credito puo' essere sceso. Qui si guarda cosa viene scritto; la capienza la verifica ponte_prenota, davvero.
        if not p_prova then raise exception 'PONTE: prenota solo in prova'; end if;
        perform public.registra_movimento_cliente((v_op->>'master_id')::uuid, (v_op->>'cliente_id')::uuid, 'spedizione',
          v_op->>'descrizione', (v_op->>'importo')::numeric, v_op->>'riferimento', null::uuid, (v_op->>'created_by')::uuid, false);
      else
        raise exception 'PONTE: operazione sconosciuta %', v_op->>'op';
      end case;
    end loop;

    if p_prova then
      -- Cosa e' stato scritto, righe e movimenti (compresi quelli degli automatismi). L'etichetta solo come
      -- impronta: pesa circa 300 KB a riga.
      select jsonb_build_object(
        'righe', coalesce((select jsonb_agg((to_jsonb(s) - 'etichetta_url') || jsonb_build_object(
                    'etichetta_md5', md5(s.etichetta_url), 'etichetta_lunghezza', length(s.etichetta_url)))
                  from public.spedizioni s where s.id = any(v_ids)), '[]'::jsonb),
        'movimenti', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at, m.id)
                  from public.movimenti m where m.spedizione_id = any(v_ids)), '[]'::jsonb))
        into v_letto;
      raise exception 'PONTE_PROVA' using errcode = 'PP001';
    end if;
    -- Scritta: il piano non serve piu' (le righe e i movimenti sono lo storico) e ne conteneva una copia degli indirizzi.
    update public.ponte_in_corso set stato = 'scritta', piano = '{}'::jsonb, aggiornato_il = now() where id = v_id;
  exception when sqlstate 'PP001' then
    return v_letto;   -- tutto annullato: in prova non resta scritto niente
  end;
  return jsonb_build_object('scritta', true, 'righe', to_jsonb(v_ids));
end $$;

-- Solo il client di servizio.
revoke all on function public.ponte_solo_servizio() from public, anon, authenticated;
revoke all on function public.ponte_prenota(uuid, text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.ponte_ldv(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.ponte_storna(uuid, text) from public, anon, authenticated;
revoke all on function public.ponte_scrivi(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.ponte_solo_servizio() to service_role;
grant execute on function public.ponte_prenota(uuid, text, uuid, jsonb, jsonb) to service_role;
grant execute on function public.ponte_ldv(uuid, text, jsonb) to service_role;
grant execute on function public.ponte_storna(uuid, text) to service_role;
grant execute on function public.ponte_scrivi(jsonb, boolean) to service_role;

-- ── 5. Per il confronto in ombra: l'impronta delle etichette vere di un pacco ──────────────────────────────
-- L'etichetta pesa circa 300 KB a riga: il confronto non la scarica, ne legge lunghezza e impronta qui.
create or replace function public.ponte_etichette(p_tracking text)
returns table (id uuid, lunghezza integer, impronta text)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  perform public.ponte_solo_servizio();
  return query select s.id, length(s.etichetta_url), md5(s.etichetta_url) from public.spedizioni s where s.tracking_number = p_tracking;
end $$;
revoke all on function public.ponte_etichette(text) from public, anon, authenticated;
grant execute on function public.ponte_etichette(text) to service_role;

-- Verifica (deve tornare: rls true; nessun privilegio per anon/authenticated sulla tabella; le sei funzioni
-- eseguibili solo da service_role e postgres).
select relrowsecurity as rls from pg_class where oid = 'public.ponte_in_corso'::regclass;
select grantee, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'ponte_in_corso' and grantee in ('anon', 'authenticated', 'PUBLIC');
select p.proname, array(select r.rolname from pg_roles r where has_function_privilege(r.oid, p.oid, 'EXECUTE')
         and r.rolname in ('anon', 'authenticated', 'service_role', 'postgres')) as eseguibile_da
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('ponte_solo_servizio', 'ponte_prenota', 'ponte_ldv', 'ponte_storna', 'ponte_scrivi', 'ponte_etichette');
