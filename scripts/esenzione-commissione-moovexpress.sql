-- ESENZIONE DALLA COMMISSIONE MOOVEXPRESS (0,05) PER I FORNITORI DI CONTRATTI ALLA RETE.
--
-- Perché: chi FORNISCE un contratto alla rete (es. LOGIXIA, che condivide Poste Triangolazioni) è
-- il lato offerta, non un consumatore della piattaforma. La piattaforma guadagna sul margine della
-- catena di rivendita, non facendogli pagare la fee per spedizione. Quindi LOGIXIA è esente.
--
-- Come: un FLAG sul master, mai il nome dentro la logica (regola "generalità per flag, mai su
-- master_id/nome"). Domani si esenta un altro fornitore con una riga di UPDATE, senza toccare codice.
-- Il flag è un campo di sistema: lo scrive solo la piattaforma, come abbonamento_esente.

alter table public.masters
  add column if not exists esente_commissione_moovexpress boolean not null default false;

comment on column public.masters.esente_commissione_moovexpress is
  'Se true, le spedizioni su contratto PROPRIO di questo master NON pagano la commissione MoovExpress (0,05). Per i fornitori che condividono i loro contratti alla rete (es. LOGIXIA). Lo imposta solo la piattaforma (vedi fn_master_campi_di_sistema).';

-- I grant su masters sono per-colonna: senza questo un `select *` di authenticated si romperebbe
-- (vedi incidente corrieri "colonna fuori dal grant rompe la lista"). La SCRITTURA resta vietata ai
-- ruoli utente dalla guardia fn_master_campi_di_sistema qui sotto.
grant select, insert, update, references (esente_commissione_moovexpress)
  on public.masters to authenticated;

-- La guardia dei campi di sistema: aggiungo il flag all'elenco dei campi che solo la piattaforma
-- può cambiare (stesso trattamento di abbonamento_esente / is_super_master).
create or replace function public.fn_master_campi_di_sistema()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  ruolo_token text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  campo text;
begin
  if ruolo_token not in ('authenticated', 'anon')
     and current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  campo := case
    when new.is_super_master  is distinct from old.is_super_master  then 'is_super_master'
    when new.parent_master_id is distinct from old.parent_master_id then 'parent_master_id'
    when new.gestione_rete    is distinct from old.gestione_rete    then 'gestione_rete'
    when new.vede_rete_completa is distinct from old.vede_rete_completa then 'vede_rete_completa'
    when new.integrazioni_riservate is distinct from old.integrazioni_riservate then 'integrazioni_riservate'
    when new.tipo_contratto   is distinct from old.tipo_contratto   then 'tipo_contratto'
    when new.abbonamento_esente is distinct from old.abbonamento_esente then 'abbonamento_esente'
    when new.abbonamento_esente_fino_a is distinct from old.abbonamento_esente_fino_a then 'abbonamento_esente_fino_a'
    when new.esente_commissione_moovexpress is distinct from old.esente_commissione_moovexpress then 'esente_commissione_moovexpress'
    when new.piani_visibili   is distinct from old.piani_visibili   then 'piani_visibili'
    when new.abbonamento_piano  is distinct from old.abbonamento_piano  then 'abbonamento_piano'
    when new.abbonamento_limite is distinct from old.abbonamento_limite then 'abbonamento_limite'
    when new.abbonamento_prezzo is distinct from old.abbonamento_prezzo then 'abbonamento_prezzo'
    when new.abbonamento_piano_programmato is distinct from old.abbonamento_piano_programmato then 'abbonamento_piano_programmato'
    when new.abbonamento_programmato_dal   is distinct from old.abbonamento_programmato_dal   then 'abbonamento_programmato_dal'
    when new.abbonamento_attivato_il is distinct from old.abbonamento_attivato_il then 'abbonamento_attivato_il'
    when new.abbonamento_mese  is distinct from old.abbonamento_mese  then 'abbonamento_mese'
    when new.stripe_subscription_id is distinct from old.stripe_subscription_id then 'stripe_subscription_id'
    when new.stripe_customer_id is distinct from old.stripe_customer_id then 'stripe_customer_id'
    when new.stripe_stato      is distinct from old.stripe_stato      then 'stripe_stato'
  end;

  if campo is not null then
    raise exception 'Questo campo lo gestisce solo la piattaforma (campo %)', campo
      using errcode = '42501';
  end if;
  return new;
end $function$;

-- La fee MoovExpress salta se il master è esente. Unica aggiunta: v_esente + il return anticipato.
-- Tutto il resto (proprio? conto_di=proprio? demo?) resta identico.
create or replace function public.fn_fee_moovexpress_proprio()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_master uuid; v_proprio boolean; v_demo boolean; v_esente boolean; v_saldo numeric;
begin
  begin
    select c.master_id, c.proprio into v_master, v_proprio
    from public.corrieri c where c.id = new.corriere_id;
    if not coalesce(v_proprio, false) then return new; end if;
    if public.fn_conto_di(v_master, new.id) is distinct from 'proprio' then return new; end if;
    select coalesce(demo, false), coalesce(esente_commissione_moovexpress, false)
      into v_demo, v_esente
      from public.masters where id = v_master;
    if coalesce(v_demo, false) then return new; end if;
    -- Fornitore di contratti alla rete (es. LOGIXIA): è esente dalla fee MoovExpress.
    if coalesce(v_esente, false) then return new; end if;

    update public.masters
       set commissioni_moovexpress = round((coalesce(commissioni_moovexpress, 0) - 0.05)::numeric, 2)
     where id = v_master
     returning commissioni_moovexpress into v_saldo;

    insert into public.movimenti
      (master_id, cliente_id, master_target_id, tipo, descrizione, riferimento, importo, saldo_dopo, spedizione_id)
    values
      (v_master, null, v_master, 'commissione', 'Commissione MoovExpress (contratto proprio)', new.numero, -0.05, v_saldo, new.id);
  exception when others then
    raise warning '[FEE-MOOVEXPRESS] commissione non registrata per spedizione % : %', new.id, sqlerrm;
  end;
  return new;
end $function$;
