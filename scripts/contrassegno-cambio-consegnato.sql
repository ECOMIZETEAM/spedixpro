-- UN CAMBIO (Exchange) CONSEGNATO E POI RESO NON PERDE IL CONTRASSEGNO (20/11/2026, ok di Lorenzo).
-- Applicato in produzione il 20/11/2026 come migrazione `contrassegno_cambio_consegnato_resta`.
--
-- Come funziona l'Exchange (Lorenzo, 20/11): il negozio manda l'etichetta del cambio al cliente finale, che la
-- stampa e la mette sul pacco da restituire; il corriere arriva col pacco nuovo, lo consegna (e incassa il
-- contrassegno) e si porta via quello con l'etichetta del cambio. Il pacco che rientra porta quindi la LDV del
-- cambio, ed e' su quella che il reso si registra (la scansione lo fa gia' cosi', e cosi' lo registra il corriere).
--
-- Il reso pero' annullava il contrassegno in attesa come per ogni pacco tornato indietro: il negozio non
-- riceveva soldi che il corriere aveva incassato consegnando il pacco nuovo (NN669426349 e NN669457747 di
-- M.C LOGISTICA, 7 EUR ciascuno, rimessi in attesa il 20/11). Se il cambio NON era stato consegnato (e'
-- tornato lui, come CE665191921 di QUICK) il contrassegno non e' mai stato incassato e si annulla come prima:
-- per questo conta lo stato di PRIMA del reso (consegnata).

create or replace function public.fn_contrassegno_chiudi_su_reso()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.stato in ('reso_mittente', 'annullata', 'annullamento_manuale')
     and coalesce(new.contrassegno, 0) > 0
     and coalesce(new.stato_contrassegno, 'in_attesa') = 'in_attesa'
     and new.distinta_contrassegno_id is null then
    -- il cambio consegnato: il contrassegno e' del pacco nuovo, che il destinatario ha pagato
    if new.stato = 'reso_mittente' and old.stato = 'consegnata'
       and jsonb_typeof(new.servizi_accessori) = 'array'
       and exists (select 1 from jsonb_array_elements(new.servizi_accessori) e
                   where coalesce(e->>'nome', e#>>'{}') ~* '(exchange|cambio)') then
      return new;
    end if;
    new.stato_contrassegno := 'annullato';
  end if;
  return new;
end;
$function$;
