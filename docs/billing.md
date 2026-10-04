# Matura Plus — mjesečna pretplata

Cijena: 7,90 EUR mjesečno, porez uključen. Bez probnog razdoblja.
Stripe Checkout prima kartice; Customer Portal omogućuje račune, promjenu
kartice i otkazivanje na kraju razdoblja. `/plus` je javna ponuda, a `/profil`
sadrži upravljanje pretplatom. Točan skup pogodnosti može se kasnije promijeniti;
trenutačno aktivni Plus uklanja kvotu AI objašnjenja i otvara mature od 2015. do
2022. (uključujući interaktivne cjeline i lokalne NCVVO pakete). Ispiti od
2023. nadalje ostaju javni.

## Konfiguracija

U privatnom `.env` trebaju biti `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`,
`STRIPE_WEBHOOK_SECRET` i `PUBLIC_BASE_URL=https://matura.com.hr`.
Ključeve ne stavljati u repozitorij ni dokumentaciju. Produkcijski i testni
Stripe objekti/ključevi nisu zamjenjivi. API zahtjevi imaju fiksnu verziju
`2025-02-24.acacia`; webhook payload služi samo za identifikaciju kupca,
pa može koristiti drugu verziju.

Endpoint: `POST /api/stripe/webhook`. Podržani događaji:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Dodatni događaji se potvrđuju bez izmjene pristupa. Potpis mora biti valjan
(unutar pet minuta); podržano je više potpisa pri rotaciji ključa.
Greška Stripe API-ja vraća 500 webhooku radi ponovnog pokušaja.

## Podaci i pravila

`billing.js` drži vezu korisnika i Stripe Customer ID-a u tablici
`billing_accounts`, a obrađene događaje u `billing_webhook_events`.
Tablice nemaju kaskadni FK jer postojeći `persistStore()` prepisuje tablicu users.
Nikad se ne povezuje račun samo prema e-mailu iz naplate.

Za svaki relevantni događaj dohvaća se aktualna pretplata i posljednji plaćeni
račun za konfiguriranu cijenu. Pristup traje do kraja plaćenog retka računa,
ne do proizvoljnog broja dana. Ponovljeni ili zakašnjeli događaji ne produljuju
pristup. Neuspjela obnova ne dodaje novo razdoblje. Neposredno otkazivanje
ograničava pristup datumom završetka; otkazivanje obnove čuva plaćeno razdoblje.
Stari `users.premium_until` ostaje očuvan za godišnje kupce.

Kupnja se serijalizira, koristi Stripe idempotency ključeve i ponovno koristi
otvoren Checkout. Korisnik s postojećom pretplatom odlazi u portal. Identitet,
cijena, količina i povratni URL-ovi dolaze sa servera. POST zahtjevi traže prijavu
i isti Origin. Status se osvježava i u profilu, najviše jednom u pet sekundi.

Povrat novca sam po sebi ne otkazuje pretplatu i ova verzija ne donosi automatsku
odluku o ukidanju pristupa za refund/dispute. Ako treba ukinuti pristup nakon
povrata, administrator mora zasebno otkazati pretplatu u Stripeu.

## Provjera i puštanje

- `node --test tests/test_billing.js`
- `npm run check`
- `python3 -m py_compile scripts/fetch_ncvvo.py`
- Preglednik: `tests/billing-browser.cjs`, uz `BILLING_ORIGIN` izoliranog servera,
  `PLAYWRIGHT_MODULE` i po potrebi `CHROMIUM_PATH`. Billing odgovori se simuliraju;
  taj test ne provodi Stripe naplatu.

Za stvarni Stripe sandbox test koristiti odvojen server, bazu i testne ključeve;
provjeriti prvu naplatu, obnovu, odbijenu naplatu, otkazivanje i webhook dostavu.
Ne unositi testne kartice u produkcijski Checkout.

Nakon promjene servera: `systemctl --user restart maturko-http.service`.
Nakon deploya provjeriti `/plus`, `/profil`, da webhook odbija nevaljani potpis,
i da `/billing.js` i `/.env` nisu javni.
