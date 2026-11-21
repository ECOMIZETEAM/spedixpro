-- PONTE UNICO, FASE 3, correzione del 21/11 a ponte_scrivi (scripts/ponte-unico-scrittura.sql e' gia' aggiornato).
-- 1. Attesa massima di una riga occupata: 200 ms in prova, 3 s davvero. Cosi' in un incrocio (deadlock) cede sempre la
--    prova, mai una scrittura vera: il database sceglie chi annullare solo dopo 1 secondo di attesa.
-- 2. A scrittura riuscita il piano nel registro si svuota: righe e movimenti sono lo storico, il piano ne era una copia
--    (indirizzi compresi).
-- Stessi permessi di prima (create or replace li conserva); li si ribadisce comunque.

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

revoke all on function public.ponte_scrivi(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.ponte_scrivi(jsonb, boolean) to service_role;

-- Verifica: eseguibile solo da service_role e postgres.
select p.proname, array(select r.rolname from pg_roles r where has_function_privilege(r.oid, p.oid, 'EXECUTE')
         and r.rolname in ('anon', 'authenticated', 'service_role', 'postgres')) as eseguibile_da
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'ponte_scrivi';
