# Taxi crawler server

Local crew smoke (synthetic traffic only):

```sh
AUTH_MODE=dev FAKE_MODEL=1 DB_PATH=/tmp/taxi-crawler-dev.db node server/index.js
node --test tests/server/*.test.js
```

Open `http://127.0.0.1:3000/api/me`; `GET /healthz` returns `ok`.
The thin-path milestone provides dev login, scripted tutor tools, text history, and persistent
floor receipts. It deliberately refuses live-model startup until the remaining guardrails land.
The guide and game pages come from the other crew packages.

Hosting contract: Node 24 LTS, one process, listen on `PORT` (default 3000).
`DB_PATH` defaults to `/home/data/taxi.db`; identity/receipts live in the separate
`/home/data/taxi.db.identity.sqlite` file. Both use SQLite DELETE journals, as required for the
App Service persistent share. Use an explicit writable local `DB_PATH` for development.
