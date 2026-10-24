-- IL RESO RESTA RESO (applicato il 24/10/2026, migrazione reso_non_torna_consegnata).
--
-- Un pacco rientrato chiude il viaggio di ritorno con "Consegnata (firma: ...)": e' la consegna AL
-- MITTENTE. Le quattro porte del tracking (giro automatico, tracking a richiesta, API v1, webhook
-- Spedisci) lo sanno gia' nel codice, ma al 24/10/2026 22 resi veri risultavano 'consegnata' (es. Wind
-- Rose 4UW1UHA029794: "in restituzione al mittente" il 26/09, reso addebitato lo stesso giorno, poi di
-- nuovo consegnata) e restavano fuori dalla percentuale resi. Qui vale per ogni porta, anche per gli
-- script esterni e per quelle che nasceranno (scelta di Lorenzo, 24/10/2026). Una correzione voluta a
-- mano passa da un altro stato. Il nome comincia per "aa" perche' i trigger BEFORE girano in ordine
-- alfabetico: deve passare prima degli altri, che altrimenti vedrebbero 'consegnata'.
set local lock_timeout = '5s';

create or replace function public.fn_reso_non_torna_consegnata() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if OLD.stato = 'reso_mittente' and NEW.stato = 'consegnata' then
    NEW.stato := OLD.stato;
  end if;
  return NEW;
end;
$$;
revoke all on function public.fn_reso_non_torna_consegnata() from public;
revoke all on function public.fn_reso_non_torna_consegnata() from anon;
revoke all on function public.fn_reso_non_torna_consegnata() from authenticated;

create or replace trigger trg_aa_reso_non_torna_consegnata before update of stato on public.spedizioni
  for each row execute function public.fn_reso_non_torna_consegnata();
