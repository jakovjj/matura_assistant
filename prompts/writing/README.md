# System promptovi za pisane zadatke

Ove datoteke server učitava pri pokretanju i šalje modelu kao `system` poruke:

- `english-essay-system.txt`: esej iz Engleskoga jezika, A razina
- `croatian-summary-system.txt`: sažetak iz Hrvatskoga jezika
- `croatian-school-essay-system.txt`: školski esej iz Hrvatskoga jezika

Konkretni službeni zadatak i tekst pristupnika ne nalaze se u ovim datotekama. Server ih za
svako ocjenjivanje šalje u zasebnoj `user` poruci.

Server učitava promptove pri pokretanju, pa nakon izmjene treba ponovno pokrenuti Node server.
Folder nije javno dostupan kroz statički server.

Hrvatske rubrike sažete su iz:

`https://www.ncvvo.hr/wp-content/uploads/2025/09/HRV-2026.pdf`

Engleska rubrika sažeta je iz:

`https://www.ncvvo.hr/wp-content/uploads/2025/09/ENG-2026.pdf`
