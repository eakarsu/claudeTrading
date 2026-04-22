# E2E smoke tests

Playwright tests that exercise the critical login → dashboard → settings flow
against a running instance of the app.

## Install

```bash
cd e2e
npm install
npx playwright install --with-deps chromium
```

## Run locally

Start the app in another terminal (either `npm run dev` in `client/` + `server/`,
or `docker compose up` from the repo root), then:

```bash
BASE_URL=http://localhost:3001 npm test
```

Override the demo credentials with `E2E_EMAIL` / `E2E_PASSWORD` if you
reseeded the DB with different values.

## CI

The GitHub Actions workflow builds the Docker image; you can layer a second
job that runs this test suite against the built image — start the container,
wait for `/api/health`, then run `npm test` in this directory.
