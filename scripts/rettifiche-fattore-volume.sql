-- IL DIVISORE DI CHI PAGA, SULLA RIGA DI RETTIFICA (04/11/2026).
--
-- Una rettifica scende lungo la catena e ogni livello paga col SUO listino, che puo' dividere il volume
-- per un numero diverso dal contratto sopra. 282343J028496 (SDA EXPRESS L, 64,5x62,5x37,5 cm): il
-- contratto divide per 6000 e fa 25,2 kg, il listino del cliente di Ecomize per 5000 e fa 30,23 kg, cioe'
-- la fascia 50 che ha pagato. Sulla riga c'era scritto 25,2 e sulla scheda e' rimasto 25,2 kg con 16,20 €:
-- a leggerla sembrava la fascia 30. Sulle catene condivise succede anche ai master: QUICK in fondo paga a
-- 5000, MULTI e Wave sopra di lei a 6000, e le loro righe prendevano i chili di QUICK.
--
-- Il motore che fa i soldi sa con che divisore ha prezzato ogni livello: lo scrive qui, e la Conferma lo
-- usa per i chili della descrizione. Vuota sulle righe nate prima: la Conferma fa come prima (cliente col
-- suo listino, master col contratto della spedizione). Le righe vecchie non si toccano (Lorenzo, 04/11).
--
-- Solo una colonna in piu' su una tabella che ha gia' RLS e i suoi permessi: nessuna policy nuova, nessun
-- permesso nuovo. Va applicata PRIMA del rilascio del codice, che la scrive.

alter table public.rettifiche add column if not exists fattore_volume numeric;

comment on column public.rettifiche.fattore_volume is
  'Divisore volumetrico con cui e'' stato prezzato chi paga questa riga (listino del cliente o del master). Null sulle righe nate prima del 04/11/2026.';
