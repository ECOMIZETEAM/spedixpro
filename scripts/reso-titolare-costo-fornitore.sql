-- IL TITOLARE CHE HA GIA' PAGATO IL CORRIERE NON PAGA ANCHE IL SUO NOLO DI RESO (10/11/2026)
--
-- Chi detiene il contratto paga il reso al corriere. Il giro del conto (lib/conto-fornitore, ogni mattina)
-- glielo registra come movimento RESOFORN-<riga del conto>, scalando solo la differenza fra quanto chiede
-- il corriere e il nolo di reso che il titolare ha gia' pagato nella cascata. Funziona se il reso lo si
-- vede PRIMA (tracking): la cascata scrive la riga del titolare, poi il conto aggiunge il resto.
--
-- Nell'ordine inverso no. Se il corriere fattura il reso prima che il portale lo veda, il conto registra
-- il costo intero; quando poi il pacco passa a reso, la cascata scriveva ANCHE la riga del titolare su se
-- stesso: il titolare pagava il reso due volte. Succede ogni giorno coi BRT e gli UPS, di cui il fornitore
-- non manda gli eventi del ritorno: il 09 e il 10/11/2026 i 114 resi fatturati a MULTIEXPRESS e mai visti
-- dal tracking sono stati addebitati a mano proprio togliendo questa riga. Da oggi lo stesso giro del
-- conto mette a reso quei pacchi da solo, quindi l'ordine inverso diventa quello normale: la regola sta
-- qui, nella funzione da cui passano tutti gli addebiti di reso (tracking, svincolo giacenza, distinte
-- di reso, rimesse di rete), e non in una sola di quelle strade.
--
-- La regola: una riga di MASTER (cliente vuoto) non si scrive se quel master ha gia' un RESOFORN sullo
-- stesso pacco. Pacco, non spedizione: il costo il conto lo aggancia alla spedizione che ha il codice
-- del corriere, la cascata di un pacco condiviso scrive sulla gamba originante, quindi si guarda ogni
-- gamba con lo stesso tracking_number. L'esito e' 'costo_fornitore_gia_registrato': per chi chiama vale
-- come pagato (lib/giacenza-cascata), cosi' il pacco esce dalla coda e non viene ritentato.
-- Le righe dei clienti e degli altri master non cambiano.

create or replace function public.fn_addebita_resi(p_righe jsonb, p_created_by uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

    -- ── il titolare che ha gia' il costo del corriere su questo pacco (vedi in testa) ──
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
      select f.valore, f.perc into v_valore, v_perc from public.fn_reso_perc_cliente(v_cliente, v_corriere) f;
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
