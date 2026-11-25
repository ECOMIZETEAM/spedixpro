-- LA PERCENTUALE DEL RESO DEL CLIENTE DALLO STESSO LISTINO DEL SUO NOLO (25/11/2026).
--
-- Va DOPO scripts/archivio-prezzi-clienti.sql, e subito PRIMA del rilascio del codice "si paga sempre".
--
-- Il reso del cliente = fisso + percentuale × nolo. Il nolo lo calcola il codice (lib/reso-prezzi.ts),
-- la percentuale la legge qui il database. Fino a oggi la percentuale veniva SEMPRE dal listino che il
-- cliente ha adesso, e se il contratto era stato tolto valeva il predefinito (0 € + 100%). Ora il codice
-- prezza il nolo anche quando il contratto e' stato tolto (prezzi archiviati) o quando il cliente ha
-- cambiato listino (quello con cui il pacco e' partito), e dice da quale listino l'ha preso
-- (`listino_id` nella riga). La percentuale si legge dallo stesso listino: nolo e percentuale non
-- possono venire da due listini diversi.
-- Se quel listino non ha piu' nessuna fascia del contratto, la riga del reso si cerca anche fra le righe
-- archiviate. Se nemmeno li' c'e', vale il predefinito di sempre.
--
-- fn_addebita_resi cambia in UNA riga (passa `listino_id`). Lo script si ferma se la funzione nel
-- database non e' piu' quella letta il 25/11 (impronta md5): qualcuno l'ha cambiata nel frattempo, e
-- sovrascriverla cancellerebbe il suo lavoro.

begin;

do $$
begin
  if md5(pg_get_functiondef('public.fn_addebita_resi(jsonb,uuid)'::regprocedure)) <> 'edba32c0de31227280abc4f45b10e03a' then
    raise exception 'fn_addebita_resi e'' cambiata dal 25/11: non la sovrascrivo. Rileggerla e rifare lo script.';
  end if;
end $$;
-- Il testo di prima, per controllare in fondo che sia cambiata SOLO la riga della percentuale.
create temp table _addebita_resi_prima on commit drop as
  select pg_get_functiondef('public.fn_addebita_resi(jsonb,uuid)'::regprocedure) d;

drop function if exists public.fn_reso_perc_cliente(uuid, uuid);

create function public.fn_reso_perc_cliente(p_cliente_id uuid, p_corriere_id uuid, p_listino_id uuid default null)
returns table(valore numeric, perc numeric)
language sql stable security definer set search_path = public as $$
  with l as (
    select coalesce(p_listino_id, c.listino_cliente_id) id from public.clienti c where c.id = p_cliente_id
  ), vive as (
    select s.valore, s.descrizione, s.id::text ordine
      from public.listini_clienti_supplementi s, l
     where s.listino_id = l.id and s.tipo = 'giacenza' and s.corriere_id = p_corriere_id
       and lower(s.nome) like '%reso%' and lower(s.nome) not like '%nuovo%'
  ), archiviate as (
    -- solo se il contratto non e' piu' nel listino (nessuna fascia viva): stessa condizione del codice
    select (a.riga->>'valore')::numeric valore, a.riga->>'descrizione' descrizione, a.riga->>'id' ordine
      from public.listini_clienti_archivio a, l
     where a.tabella = 'listini_clienti_supplementi' and a.listino_id = l.id and a.corriere_id = p_corriere_id
       and a.riga->>'tipo' = 'giacenza'
       and lower(coalesce(a.riga->>'nome', '')) like '%reso%' and lower(coalesce(a.riga->>'nome', '')) not like '%nuovo%'
       and not exists (select 1 from public.listini_clienti_fasce f where f.listino_id = l.id and f.corriere_id = p_corriere_id)
  ), scelta as (
    (select * from vive order by ordine limit 1)
    union all
    (select * from archiviate where not exists (select 1 from vive) order by ordine limit 1)
  )
  select coalesce(s.valore, 0)::numeric,
         coalesce(nullif(btrim(coalesce(s.descrizione, '')), '')::jsonb ->> 'perc', '100')::numeric
    from l left join scelta s on true
   limit 1;
$$;
revoke all on function public.fn_reso_perc_cliente(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_reso_perc_cliente(uuid, uuid, uuid) to service_role;

-- fn_addebita_resi: identica a quella in produzione il 25/11/2026 (md5 edba32c0…), tranne la chiamata
-- a fn_reso_perc_cliente, che ora passa il listino del nolo.
CREATE OR REPLACE FUNCTION public.fn_addebita_resi(p_righe jsonb, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r            jsonb;
  v_sped       record;
  v_valore     numeric;
  v_perc       numeric;
  v_trovata    boolean;
  v_importo    numeric;
  v_nolo       numeric;
  v_pagato     numeric;
  v_cliente    uuid;
  v_target     uuid;
  v_owner      uuid;
  v_corriere   uuid;
  v_esiti      jsonb := '[]'::jsonb;
  v_claims     text;
begin
  v_claims := current_setting('request.jwt.claims', true);
  if v_claims is not null and v_claims <> ''
     and coalesce(v_claims::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Non autorizzato' using errcode = '42501';
  end if;

  if p_righe is null or jsonb_typeof(p_righe) <> 'array' then
    return v_esiti;
  end if;

  for r in select * from jsonb_array_elements(p_righe)
  loop
    v_cliente  := nullif(r ->> 'cliente_id', '')::uuid;
    v_target   := nullif(r ->> 'master_target_id', '')::uuid;
    v_owner    := nullif(r ->> 'master_owner_id', '')::uuid;
    v_corriere := nullif(r ->> 'corriere_id', '')::uuid;
    v_nolo     := coalesce(nullif(r ->> 'nolo', '')::numeric, 0);
    v_pagato   := abs(coalesce(nullif(r ->> 'pagato', '')::numeric, 0));

    select id, numero, tracking_number, giacenza_reso_addebitato
      into v_sped
      from public.spedizioni
     where id = nullif(r ->> 'spedizione_id', '')::uuid
     for update;

    if not found then
      v_esiti := v_esiti || jsonb_build_object('spedizione_id', r ->> 'spedizione_id', 'esito', 'inesistente');
      continue;
    end if;

    if coalesce(v_sped.giacenza_reso_addebitato, false) and coalesce((r ->> 'da_giacenza')::boolean, false) is not true then
      v_esiti := v_esiti || jsonb_build_object('spedizione_id', v_sped.id, 'esito', 'gia_addebitato');
      continue;
    end if;

    -- ── il titolare che ha gia' il costo del corriere su questo pacco ──
    if v_cliente is null and v_target is not null and exists (
      select 1
        from public.spedizioni g
        join public.movimenti m on m.spedizione_id = g.id
       where (g.id = v_sped.id or (nullif(btrim(v_sped.tracking_number), '') is not null and g.tracking_number = v_sped.tracking_number))
         and m.master_target_id = v_target
         and m.riferimento like 'RESOFORN-%'
    ) then
      v_esiti := v_esiti || jsonb_build_object('spedizione_id', v_sped.id, 'esito', 'costo_fornitore_gia_registrato',
        'master_target_id', v_target);
      continue;
    end if;

    -- ── il prezzo, dal listino di chi paga ──
    v_trovata := false;
    if v_cliente is not null then
      -- 25/11/2026: la percentuale dallo stesso listino da cui il codice ha preso il nolo (listino_id).
      select f.valore, f.perc into v_valore, v_perc
        from public.fn_reso_perc_cliente(v_cliente, v_corriere, nullif(r ->> 'listino_id', '')::uuid) f;
      if not found then v_valore := 0; v_perc := 100; end if;   -- il cliente ha sempre un predefinito
      v_trovata := true;
    elsif v_corriere is not null then
      select f.valore, f.perc into v_valore, v_perc from public.fn_reso_perc_master(v_corriere) f;
      v_trovata := found;
    end if;

    if not v_trovata then
      v_importo := round(v_pagato, 2);                    -- riga non configurata: quanto aveva pagato
    elsif coalesce(v_perc, 0) > 0 and coalesce(v_nolo, 0) <= 0 then
      -- Percentuale configurata ma nolo non calcolabile: NON vale zero. Si ripiega su quanto aveva
      -- pagato l'andata, che e' la stessa cosa che si fa quando la riga non c'e'.
      v_importo := round(coalesce(v_valore, 0) + coalesce(v_perc, 0) / 100 * v_pagato, 2);
    else
      v_importo := round(coalesce(v_valore, 0) + coalesce(v_perc, 0) / 100 * v_nolo, 2);
    end if;

    -- Reso a ZERO: di norma percentuale 0 = reso gratis, ma legittimo. NON si salta in silenzio: si
    -- scrive comunque un movimento a -0, cosi' ogni reso lascia sempre una riga nel registro e non
    -- sparisce mai dal conto (un reso gratis va segnato come uscita -0 EUR, non come nulla). Fa
    -- eccezione solo il livello MASTER senza regola e senza nulla che aveva pagato: li' un reso non
    -- esiste proprio, e una riga a zero sarebbe rumore.
    v_importo := coalesce(v_importo, 0);
    if v_importo <= 0 and v_cliente is null and not v_trovata then
      v_esiti := v_esiti || jsonb_build_object('spedizione_id', v_sped.id, 'esito', 'zero', 'importo', 0);
      continue;
    end if;
    if v_importo < 0 then v_importo := 0; end if;         -- il ritorno non e' mai un accredito

    begin
      if v_cliente is not null then
        perform public.registra_movimento_cliente(
          v_owner, v_cliente, 'reso', 'Reso ' || coalesce(v_sped.numero, ''),
          -v_importo, v_sped.numero, v_sped.id, p_created_by, false);
      else
        perform public.registra_movimento_master(
          v_owner, v_target, 'reso', 'Reso ' || coalesce(v_sped.numero, ''),
          -v_importo, v_sped.numero, v_sped.id, p_created_by);
      end if;
      v_esiti := v_esiti || jsonb_build_object(
        'spedizione_id', v_sped.id, 'esito', 'addebitato', 'importo', v_importo,
        'cliente_id', v_cliente, 'master_target_id', v_target);
    exception when unique_violation then
      v_esiti := v_esiti || jsonb_build_object('spedizione_id', v_sped.id, 'esito', 'gia_addebitato');
    end;
  end loop;

  return v_esiti;
end;
$function$;

-- La copia qui sopra e' stata scritta a mano: se differisce da quella di prima in un solo carattere oltre
-- alla riga voluta, si annulla tutto.
do $$
declare v_prima text; v_attesa text; v_ora text;
begin
  select d into v_prima from _addebita_resi_prima;
  v_attesa := replace(v_prima,
    E'      select f.valore, f.perc into v_valore, v_perc from public.fn_reso_perc_cliente(v_cliente, v_corriere) f;\n',
    E'      -- 25/11/2026: la percentuale dallo stesso listino da cui il codice ha preso il nolo (listino_id).\n'
    || E'      select f.valore, f.perc into v_valore, v_perc\n'
    || E'        from public.fn_reso_perc_cliente(v_cliente, v_corriere, nullif(r ->> ''listino_id'', '''')::uuid) f;\n');
  v_ora := pg_get_functiondef('public.fn_addebita_resi(jsonb,uuid)'::regprocedure);
  if v_attesa = v_prima then
    raise exception 'la riga da cambiare non c''e'' nella funzione di prima: annullo';
  end if;
  if v_ora <> v_attesa then
    raise exception 'fn_addebita_resi nuova diversa da quella di prima oltre la riga voluta: annullo';
  end if;
end $$;

commit;
