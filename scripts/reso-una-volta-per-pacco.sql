-- UN RESO UNA VOLTA PER PACCO, PER CHI LO PAGA (richiesta di Lorenzo, 17/10/2026)
--
-- Gli indici uniq_mov_reso_cliente / uniq_mov_reso_master impediscono il doppio reso sulla stessa
-- SPEDIZIONE. Un pacco condiviso pero' ha piu' spedizioni (le gambe di chi lo vende e di chi lo compra,
-- stesso tracking_number): dall'8 al 14/10/2026 il reso di 27 pacchi SDA EXPRESS L e' stato addebitato una
-- volta sulla gamba originante e una volta sulla gamba di LOGIXIA, a Wave (ingrosso) e al conto proprio di
-- LOGIXIA: 54 righe, 224,12 EUR, poi stornate. Il codice e' corretto dal 14/10, ma la regola stava in un
-- punto solo dell'applicazione: qui sta nel database, dove nessuna strada la puo' aggirare.
--
-- La regola: un nuovo movimento di reso (importo <= 0, cioe' un addebito) viene rifiutato se lo STESSO
-- pagatore (lo stesso cliente, o lo stesso master col cliente vuoto) sullo STESSO conto ha gia' un reso
-- su un'ALTRA gamba con lo stesso tracking_number. Il rifiuto ha lo stesso codice del vincolo unico
-- (23505): fn_addebita_resi lo legge come "gia_addebitato" e va avanti con le altre righe, come gia' fa
-- per il doppio sulla stessa spedizione.
-- Il blocco consultivo sul tracking impedisce che due addebiti dello stesso pacco in transazioni
-- contemporanee passino tutti e due (ciascuno non vedrebbe l'altro non ancora salvato).
--
-- Verificato prima del rilascio (17/10): sullo storico avrebbe fermato esattamente le 54 righe doppie
-- dell'8-14/10 e nessun altro reso; in una transazione annullata, senza il trigger il doppio di Wave sulla
-- gamba di LOGIXIA passava (3,81 EUR), col trigger tre doppi (Wave, MULTI ingrosso, LOGIXIA proprio)
-- tornano "gia_addebitato" e un reso normale passa.
-- Il trigger scatta DOPO trg_conto_movimento (i BEFORE vanno in ordine di nome): il conto e' gia' deciso.

create or replace function public.fn_reso_una_volta_per_pacco()
returns trigger
language plpgsql
set search_path = public
as $f$
declare
  v_trk text;
begin
  if NEW.tipo is distinct from 'reso' or coalesce(NEW.importo, 0) > 0 or NEW.spedizione_id is null then
    return NEW;
  end if;
  select tracking_number into v_trk from spedizioni where id = NEW.spedizione_id;
  if v_trk is null or btrim(v_trk) = '' then
    return NEW;
  end if;
  perform pg_advisory_xact_lock(hashtext('reso_pacco:' || v_trk));
  if exists (
    select 1
      from spedizioni s
      join movimenti m on m.spedizione_id = s.id
     where s.tracking_number = v_trk
       and s.id <> NEW.spedizione_id
       and m.tipo = 'reso'
       and m.importo <= 0
       and m.conto is not distinct from NEW.conto
       and (case when NEW.cliente_id is not null then m.cliente_id = NEW.cliente_id
                 else m.cliente_id is null and m.master_target_id is not distinct from NEW.master_target_id end)
  ) then
    raise exception 'Reso del pacco % gia'' addebitato a questo pagatore su un''altra gamba', v_trk
      using errcode = '23505';
  end if;
  return NEW;
end;
$f$;

revoke all on function public.fn_reso_una_volta_per_pacco() from public;
revoke all on function public.fn_reso_una_volta_per_pacco() from anon;
revoke all on function public.fn_reso_una_volta_per_pacco() from authenticated;

create trigger trg_reso_una_volta_per_pacco
  before insert on public.movimenti
  for each row execute function public.fn_reso_una_volta_per_pacco();
