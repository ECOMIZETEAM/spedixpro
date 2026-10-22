-- UNA GIACENZA E' UN EVENTO DEL PACCO, NON DELLA RIGA (22/10/2026)
--
-- Un pacco condiviso ha piu' spedizioni (le gambe di chi lo vende e di chi lo compra, stesso
-- tracking_number, collegate da raw_response.venditore_spedizione_id). La giacenza la vede solo la gamba
-- del detentore, quella col corriere vero (LOGIXIA su SDA EXPRESS L, tipo 'poste'). Le gambe sopra la
-- scoprivano chiedendo al venditore lo STATO della sua spedizione: se era 'in_giacenza' si aprivano anche
-- loro. Ma lo stato avanza solo in avanti e 'non_consegnato' (5) sta sopra 'in_giacenza' (4): con una
-- mancata consegna prima della giacenza — quasi sempre — il venditore rispondeva 'non_consegnato' e le
-- gambe sopra non si aprivano mai. Il 22/10/2026 erano 20 pacchi aperti solo sulla gamba di LOGIXIA:
-- Wave e il master del cliente (spedizioni 2000, GTS, QUICK, Atlantik, Ecomize LL, VTS, MULTI) non li
-- vedevano nelle Giacenze, quindi nessuno poteva svincolarli.
--
-- La regola: quando una gamba entra in giacenza (giacenza_data da vuota a valorizzata), la stessa data
-- va alle gambe collegate (chi le vende e chi le compra) ancora senza data e non chiuse. Ognuna di quelle
-- fa scattare di nuovo questo trigger, cosi' la data percorre tutta la fila in entrambe le direzioni e si
-- ferma da sola (le gambe gia' datate non si toccano: ridatare riarmerebbe l'addebito).
--
-- L'addebito non raddoppia: trg_giacenza_da_addebitare mette in coda ogni gamba, ma l'apertura di un
-- pacco condiviso si addebita una volta sola (lib/giacenza-cascata.ts, addebitaAperturaGiacenza: segno su
-- tutte le gambe, le altre righe in coda si fermano). Se il pacco era gia' addebitato, le gambe portano
-- gia' il segno e non entrano nemmeno in coda.

create or replace function public.fn_giacenza_su_tutte_le_gambe()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  update public.spedizioni g
     set giacenza_data = NEW.giacenza_data
   where g.tracking_number = NEW.tracking_number
     and g.id <> NEW.id
     and g.giacenza_data is null
     and g.stato not in ('consegnata', 'reso_mittente', 'annullata')
     and (g.id::text = NEW.raw_response->>'venditore_spedizione_id'
          or g.raw_response->>'venditore_spedizione_id' = NEW.id::text);
  return null;
end;
$f$;

revoke all on function public.fn_giacenza_su_tutte_le_gambe() from public, anon, authenticated;

drop trigger if exists trg_giacenza_su_tutte_le_gambe on public.spedizioni;
create trigger trg_giacenza_su_tutte_le_gambe
  after update of giacenza_data on public.spedizioni
  for each row
  when (OLD.giacenza_data is null and NEW.giacenza_data is not null and NEW.tracking_number is not null)
  execute function public.fn_giacenza_su_tutte_le_gambe();
