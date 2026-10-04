# Deployment & Operational Specification
# Centralized File Upload & Google Drive Synchronization Application

## Local Development (no configuration needed)

You need Node.js 20+ and Docker. `.env` is optional.

```bash
npm install
npm run dev:local   # starts PostgreSQL in Docker, creates tables + admin, starts the app
```

Or step by step:

```bash
npm run db:local    # docker compose up -d --wait db  (PostgreSQL on localhost:5432)
npm run db:init     # create tables, seed admin@clouddrive.local / AdminPassword2026!
npm run dev         # http://localhost:3000
```

When `DATABASE_URL` is unset, the server and scripts connect to
`postgresql://DB_USER:DB_PASSWORD@DB_HOST:DB_PORT/DB_NAME`. The defaults are `postgres` / `postgres` / `localhost` / `5432` / `file_upload_db`,
the same database `npm run db:local` starts (both read `DB_*` from `.env` when present).
Set `DATABASE_URL` only to use another PostgreSQL server. If the database cannot be reached, the server
prints the address it tried and these commands, then exits.

`npm run db:push` uses the same resolved `DATABASE_URL`. To stop the local database, run `docker compose stop db`.
`docker compose down -v` also deletes its data.

---

## 1. Runtime Environment Specifications

- **Platform**: Node.js 20+ runtime in sandboxed Cloud Run container environment.
- **Port Ingress**: Port `3000` bound to host `0.0.0.0` (Hardcoded platform constraint).
- **Backend Architecture**: Single bundled Express server outputting to `dist/server.cjs` via `esbuild`.
- **Frontend SPA**: Static React bundle built via Vite into `dist/` and served via Express static middleware in production.

---

## 2. Production Build & Start Commands

```json
{
  "scripts": {
    "dev": "tsx server.ts",
    "build": "vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
    "start": "node dist/server.cjs"
  }
}
```

---

## 3. Environment Variables Configuration

| Variable | Description | Sensitivity |
| :--- | :--- | :--- |
| `PORT` | Container HTTP Port (Must be `3000`) | System Public |
| `DATABASE_URL` | PostgreSQL connection string (`postgresql://...`). Optional locally: built from `DB_*` when unset | Secret |
| `SESSION_SECRET` | Secret key for signing user session tokens | Secret |
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth 2.0 Client ID | Non-sensitive Server config |
| `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth 2.0 Client Secret | Secret |
| `GOOGLE_REDIRECT_URI` | Authorized OAuth redirect callback URL | Server config |
| `APP_URL` | Public application base URL | System / Config |
| `STORAGE_DIR` | Absolute or relative path to local storage buffer (`./storage/uploads`) | Config |
| `MAX_FILE_SIZE_MB` | Maximum allowed file upload size (default `100`) | Config |
