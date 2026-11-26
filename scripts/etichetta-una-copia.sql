-- UNA LETTERA DI VETTURA, UN PDF: NON UNA COPIA IN OGNI COLLO.
--
-- Molte porte salvano l'etichetta della spedizione e poi ne mettono la stessa identica copia dentro ogni collo
-- (colli_dettaglio[i].etichetta_url): la riga del cliente dei condivisi (lib/ponte-riga-origine), il recupero
-- dell'etichetta del ponte, KSync, Dielle, Ecosmos, InPost, Spedisci, BRT, e i monocollo di quasi tutti. Il peso
-- cresce col quadrato dei colli: 282343J127568 (SDA EXPRESS L condiviso, 10 colli) aveva il PDF da 2,78 MB salvato
-- 11 volte, 30 MB in una riga; su 400 righe vere del 26/11/2026 pomeriggio i condivisi avevano 87 MB di copie nei
-- colli contro 43 kB senza. Di notte il giro che libera le righe ne faceva un file per collo su Storage, tutti
-- uguali (282343J118772: sped.pdf + collo-1..8.pdf da 1.676.144 byte identici).
--
-- La copia non serve a nessuno: le stampe scartano i doppioni dai byte, e senza etichette per collo usano quella
-- della spedizione (lib/etichette: leggiEtichettaGrezza, sorgentiGrezze). Si toglie qui e non nelle porte perche'
-- le porte che scrivono un'etichetta sono piu' di dieci, e quelle che nasceranno la copierebbero di nuovo.
--
-- Si tocca SOLO il caso "ogni collo ha esattamente il PDF della spedizione". Se anche un solo collo ha
-- un'etichetta sua (DVA, GLS diretto: un PDF per collo, e quello della spedizione e' a volte il primo collo) o
-- nessuna, la riga resta com'e': togliere solo i colli uguali lascerebbe il primo collo fuori dalla stampa in
-- blocco. Prova prima dell'attivazione (tabella temporanea con questa funzione, 400 righe vere): 0 righe cambiate
-- fuori da quel caso, 0 righe di quel caso lasciate com'erano, e nelle cambiate cambia solo etichetta_url dei colli.
-- Il giro DVA che riprende le etichette dei multicollo (tmp-recupero, recuperaMulticollo) conta i colli con
-- etichetta: sui DVA multicollo i colli hanno ciascuno la sua (0 su 67 uguali alla spedizione il 26/11), quindi
-- non lo tocca.

create or replace function public.fn_etichetta_una_copia()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.etichetta_url is null or left(new.etichetta_url, 5) <> 'data:'
     or jsonb_typeof(new.colli_dettaglio) is distinct from 'array'
     or jsonb_array_length(new.colli_dettaglio) = 0 then
    return new;
  end if;
  if exists (select 1 from jsonb_array_elements(new.colli_dettaglio) e
             where (e->>'etichetta_url') is distinct from new.etichetta_url) then
    return new;
  end if;
  new.colli_dettaglio := (select jsonb_agg(e || jsonb_build_object('etichetta_url', null) order by n)
                          from jsonb_array_elements(new.colli_dettaglio) with ordinality as x(e, n));
  return new;
end
$$;

revoke all on function public.fn_etichetta_una_copia() from public, anon, authenticated;

drop trigger if exists trg_etichetta_una_copia on public.spedizioni;
create trigger trg_etichetta_una_copia
  before insert or update of etichetta_url, colli_dettaglio on public.spedizioni
  for each row when (new.etichetta_url is not null and new.colli_dettaglio is not null)
  execute function public.fn_etichetta_una_copia();
