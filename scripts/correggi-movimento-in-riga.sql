-- CORREZIONE DI UN MOVIMENTO SULLA SUA STESSA RIGA (30/10/2026, decisione di Lorenzo).
--
-- Un addebito sbagliato si correggeva con una partita compensativa: la riga sbagliata, lo storno, la riga
-- giusta. Sui 121 pacchi finiti per errore "in penale BRT" il 30/10 sarebbero state sei righe a pacco
-- nelle liste di master e clienti: «diventa una confusione enorme». Si corregge quindi la riga stessa.
--
-- Il blocco trg_no_edit_importo_movimento resta per tutti: era nato il 6/10 perche' un importo riscritto
-- sul posto non tornava piu' col suo storno e l'annullo rimborsava due volte. Questa funzione e' l'unica
-- seconda eccezione, e fa insieme tutto quello che una riscrittura deve fare per non rompere i conti:
--   1. si ferma se la riga ha gia' uno storno o un rimborso (il caso del 6/10) o se l'importo non e'
--      quello atteso (la riga e' cambiata nel frattempo);
--   2. blocca le righe del conto e poi il credito di chi paga, nello stesso ordine di
--      conferma_prenotazione_spedizione (prima la riga, poi il credito): le due non si incastrano.
--      Una lettura per tipo di conto, sugli indici: niente giri su tutta la tabella movimenti;
--   3. cambia importo e descrizione, sposta della differenza il saldo_dopo della riga e di tutte quelle
--      successive dello stesso conto, e il credito;
--   4. controlla prima e dopo che il saldo dell'ultima riga sia uguale al credito, altrimenti annulla;
--   5. scrive in audit_log i valori di prima: lo storico non si perde, solo non sta piu' nella lista.
-- Il conto e' quello che il movimento ha mosso: per un cliente clienti.credito; per un master
-- masters.credito o credito_proprio secondo movimenti.conto (come registra_movimento_master).

create or replace function public.fn_no_edit_importo_movimento()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if NEW.importo is distinct from OLD.importo then
    if OLD.riferimento like 'PRE:%' and OLD.tipo = 'spedizione' then
      return NEW;   -- eccezione: conferma_prenotazione_spedizione
    end if;
    if current_setting('moovexpress.correzione_in_riga', true) = 'si' then
      return NEW;   -- eccezione: correggi_movimento_in_riga, che sposta saldi e credito insieme all'importo
    end if;
    raise exception 'movimenti.importo append-only: riga % (% -> %). Usa una partita compensativa.',
      OLD.id, OLD.importo, NEW.importo using errcode = '42501';
  end if;
  return NEW;
end;
$function$;

create or replace function public.correggi_movimento_in_riga(
  p_movimento_id uuid, p_importo_atteso numeric, p_nuovo_importo numeric, p_nuova_descrizione text, p_motivo text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  m public.movimenti%rowtype;
  v_ids uuid[]; v_delta numeric; v_credito_prima numeric; v_credito_dopo numeric; v_ultimo numeric;
  v_stesso_istante int; v_cliente boolean; v_proprio boolean; v_giro int;
begin
  if p_motivo is null or length(trim(p_motivo)) < 5 then
    raise exception 'Serve il motivo della correzione';
  end if;
  select * into m from public.movimenti where id = p_movimento_id;
  if not found then raise exception 'Movimento % non trovato', p_movimento_id; end if;
  v_cliente := m.cliente_id is not null;
  if not v_cliente and m.master_target_id is null then
    raise exception 'Movimento %: non si sa di chi e'' il conto', m.id;
  end if;
  v_proprio := not v_cliente and coalesce(m.conto, 'rete') = 'proprio';

  -- 2. Prima le righe del conto (la riga e tutte le successive), poi il credito, poi di nuovo le righe:
  -- quelle scritte nel frattempo erano di chi aveva il credito in mano, ed e' gia' uscito. Un ramo per
  -- tipo di conto, perche' le letture vadano sugli indici (cliente_id / master_target_id + created_at).
  for v_giro in 1..2 loop
    if v_cliente then
      select array_agg(id) into v_ids from (
        select x.id from public.movimenti x
         where x.cliente_id = m.cliente_id and x.created_at >= m.created_at
         order by x.created_at, x.id for update) s;
    else
      select array_agg(id) into v_ids from (
        select x.id from public.movimenti x
         where x.master_target_id = m.master_target_id and x.cliente_id is null
           and coalesce(x.conto, 'rete') = coalesce(m.conto, 'rete') and x.created_at >= m.created_at
         order by x.created_at, x.id for update) s;
    end if;
    if v_giro = 1 then
      if v_cliente then
        select coalesce(credito, 0) into v_credito_prima from public.clienti where id = m.cliente_id for update;
      else
        select coalesce(case when v_proprio then credito_proprio else credito end, 0) into v_credito_prima
          from public.masters where id = m.master_target_id for update;
      end if;
    end if;
  end loop;

  -- 1. I controlli, sulla riga ormai bloccata.
  select * into m from public.movimenti where id = p_movimento_id;
  if round(m.importo, 2) <> round(p_importo_atteso, 2) then
    raise exception 'Movimento %: importo % e non % come atteso: non si corregge', m.id, m.importo, p_importo_atteso;
  end if;
  if coalesce(m.riferimento, '') like 'PRE:%' then
    raise exception 'Movimento %: e'' una prenotazione di credito, non si corregge qui', m.id;
  end if;
  if m.riferimento is not null and exists (select 1 from public.movimenti where riferimento = 'STORNO-' || m.riferimento) then
    raise exception 'Movimento %: ha gia'' uno storno (STORNO-%): non si corregge sulla riga', m.id, m.riferimento;
  end if;
  if m.spedizione_id is not null and exists (
      select 1 from public.movimenti x
       where x.spedizione_id = m.spedizione_id and x.tipo = 'rimborso'
         and x.cliente_id is not distinct from m.cliente_id
         and x.master_target_id is not distinct from m.master_target_id) then
    raise exception 'Movimento %: sulla spedizione c''e'' gia'' un rimborso a questo conto: non si corregge sulla riga', m.id;
  end if;
  -- Un'altra riga dello stesso conto nello stesso istante: l'ordine dei saldi non e' certo.
  select count(*) into v_stesso_istante from public.movimenti x
   where x.id = any(v_ids) and x.id <> m.id and x.created_at = m.created_at;
  if v_stesso_istante > 0 then
    raise exception 'Movimento %: altre % righe dello stesso conto nello stesso istante', m.id, v_stesso_istante;
  end if;

  -- 4. Il conto deve tornare gia' prima: non si sposta niente sopra un conto che non torna. L'ultima riga
  -- del conto e' per forza fra quelle dalla riga in poi.
  select x.saldo_dopo into v_ultimo from public.movimenti x
   where x.id = any(v_ids) order by x.created_at desc, x.id desc limit 1;
  if round(coalesce(v_ultimo, 0), 2) <> round(v_credito_prima, 2) then
    raise exception 'Conto di % gia'' disallineato prima della correzione: ultimo saldo % e credito %',
      coalesce(m.cliente_id, m.master_target_id), v_ultimo, v_credito_prima;
  end if;

  -- 3. La riga, le successive, il credito.
  v_delta := round(p_nuovo_importo - m.importo, 2);
  perform set_config('moovexpress.correzione_in_riga', 'si', true);
  update public.movimenti
     set importo = round(p_nuovo_importo, 2), descrizione = p_nuova_descrizione,
         saldo_dopo = round(saldo_dopo + v_delta, 2)
   where id = m.id;
  perform set_config('moovexpress.correzione_in_riga', '', true);

  update public.movimenti x set saldo_dopo = round(x.saldo_dopo + v_delta, 2)
   where x.id = any(v_ids) and x.id <> m.id;

  if v_cliente then
    update public.clienti set credito = round(coalesce(credito, 0) + v_delta, 2)
     where id = m.cliente_id returning credito into v_credito_dopo;
  elsif v_proprio then
    update public.masters set credito_proprio = round(coalesce(credito_proprio, 0) + v_delta, 2)
     where id = m.master_target_id returning credito_proprio into v_credito_dopo;
  else
    update public.masters set credito = round(coalesce(credito, 0) + v_delta, 2)
     where id = m.master_target_id returning credito into v_credito_dopo;
  end if;

  select x.saldo_dopo into v_ultimo from public.movimenti x
   where x.id = any(v_ids) order by x.created_at desc, x.id desc limit 1;
  if round(coalesce(v_ultimo, 0), 2) <> round(v_credito_dopo, 2) then
    raise exception 'Dopo la correzione il conto non torna: ultimo saldo % e credito %', v_ultimo, v_credito_dopo;
  end if;

  -- 5. Lo storico.
  insert into public.audit_log (attore, azione, tabella, record_id, modifiche)
  values ('correggi_movimento_in_riga', 'CORREZIONE', 'movimenti', m.id::text, jsonb_build_object(
    'motivo', p_motivo,
    'prima', jsonb_build_object('importo', m.importo, 'descrizione', m.descrizione, 'saldo_dopo', m.saldo_dopo),
    'dopo', jsonb_build_object('importo', round(p_nuovo_importo, 2), 'descrizione', p_nuova_descrizione,
                               'saldo_dopo', round(m.saldo_dopo + v_delta, 2)),
    'differenza', v_delta,
    'conto', case when v_cliente then 'cliente' when v_proprio then 'proprio' else 'rete' end,
    'di', coalesce(m.cliente_id, m.master_target_id),
    'credito_prima', v_credito_prima, 'credito_dopo', v_credito_dopo,
    'righe_successive_spostate', cardinality(v_ids) - 1));

  return jsonb_build_object('movimento', m.id, 'differenza', v_delta, 'credito_prima', v_credito_prima,
    'credito_dopo', v_credito_dopo, 'righe_successive_spostate', cardinality(v_ids) - 1);
end;
$function$;

revoke all on function public.correggi_movimento_in_riga(uuid, numeric, numeric, text, text) from public;
revoke all on function public.correggi_movimento_in_riga(uuid, numeric, numeric, text, text) from anon;
revoke all on function public.correggi_movimento_in_riga(uuid, numeric, numeric, text, text) from authenticated;
grant execute on function public.correggi_movimento_in_riga(uuid, numeric, numeric, text, text) to service_role;
