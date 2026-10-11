# retro

A simple web application enabling users to run retros.

It runs as a single Cloudflare Worker: a Preact frontend served from Workers Assets, a small API, and one SQLite-backed Durable Object per room.

## Local development

Requirements: Node.js 22 or newer (CI uses Node.js 26) and npm.

```sh
npm ci
npm run dev
```

`npm run dev` starts Vite with the Cloudflare plugin, which runs the Worker, the Durable Object, and the frontend together at http://localhost:5173.
No Cloudflare account or login is needed for local development.
Room data lives in `.wrangler/state` and survives restarts; delete that directory to start fresh.

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm run typecheck` | Checks that `worker-configuration.d.ts` is current, then type-checks everything |
| `npm run types` | Regenerates `worker-configuration.d.ts` after changing `wrangler.jsonc` |
| `npm run lint` / `npm run format` | Biome check / Biome autofix |
| `npm test` | Unit tests (Vitest) |
| `npm run test:workers` | Worker and Durable Object integration tests in the Workers runtime |
| `npm run test:e2e` | Playwright tests against `vite dev` |
| `npm run check` | All of the above plus a production build; this is what CI runs |

Before the first E2E run, install the browser with `npx playwright install chromium`.
Playwright starts its own dev server on port 5179 with in-memory state, or reuses one already listening there; set `E2E_PORT` to use a different port.

Room creation is rate limited to 10 rooms per minute per IP, and the limit is enforced locally too.
The live E2E specs stay under it by sending a random `CF-Connecting-IP` header per test (see `test/e2e/fixtures.ts`), so use the `newUser` fixture for any new spec that creates rooms.

### AI suggestions

Group suggestions call Cloudflare Workers AI through the `AI` binding, selected by the `AI_SUGGESTIONS` variable:

- `on` calls the real model (the default in `wrangler.jsonc`, so deployed Workers use it).
- `fake` uses a deterministic local suggester. `npm run dev`, the Worker tests, and the E2E tests all use it, so they never spend Neurons or need a login.
- `off` hides the feature.

To try the real model locally, log in with `npx wrangler login` and run `AI_SUGGESTIONS=on npm run dev`.
The daily request cap counts `fake` requests too, so heavy local use can show "AI suggestions are used up for today"; it resets at 00:00 UTC, or delete `.wrangler/state`.

To compare candidate models on the fixture retros in `test/fixtures/suggestions`, run:

```sh
npx vitest run --config vitest.eval.config.ts
```

Set `EVAL_MODELS` and `EVAL_FIXTURES` to comma separated lists to narrow the run.
It calls the real model, needs a login, and spends Neurons from your daily allocation; a full run costs a few thousand.

## Deploy

The app deploys to a `workers.dev` subdomain on the Workers Free plan.

1. Log in once: `npx wrangler login`.
   If your account has never used Workers, open **Workers & Pages** in the Cloudflare dashboard first so it creates your `workers.dev` subdomain.
2. Build and deploy: `npm run deploy`.
   This runs `vite build`, which writes the Worker to `dist/retro` and the frontend to `dist/client` along with a redirect file in `.wrangler/deploy`, and then `wrangler deploy`, which follows that redirect.
   Always deploy through `npm run deploy`: a bare `wrangler deploy` uploads whatever the last build produced, or fails if there is none.
3. Wrangler prints the URL, `https://retro.<your-subdomain>.workers.dev`.
   The first deploy also applies the Durable Object migrations: `v1` creates the `RoomDurableObject` class and `v2` creates `AiBudget`.

To preview a deploy without uploading anything, run `npm run build && npx wrangler deploy --dry-run`.
To check a deploy end to end, open the URL in two browsers (or one normal and one private window), create a room in one, join it by code in the other, and walk it through to Done and export.

To change the Worker name or add a custom domain, edit `wrangler.jsonc` and run `npm run types`.

### Continuous deploy

Every push to `main` runs `npm run deploy` in CI once the `check` job passes.
Pull requests never deploy.
The job needs two repository secrets:

1. `CLOUDFLARE_API_TOKEN`: in the Cloudflare dashboard, open **My Profile > API Tokens > Create Token** and use the **Edit Cloudflare Workers** template.
2. `CLOUDFLARE_ACCOUNT_ID`: shown by `npx wrangler whoami` and on the **Workers & Pages** overview.

Add them with `gh secret set CLOUDFLARE_API_TOKEN` and `gh secret set CLOUDFLARE_ACCOUNT_ID`.

## Free plan notes

- Durable Objects on the Free plan must use the SQLite storage backend.
  `wrangler.jsonc` declares both classes under `new_sqlite_classes`; do not change that to `new_classes`, and never rename or delete a class without adding a migration.
- Usage is capped daily rather than billed.
  Worker requests, Durable Object requests, Durable Object duration, and SQLite storage all have free daily allowances; check the current numbers on the [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) pages.
  Once an allowance is exhausted, requests fail until it resets at 00:00 UTC.
- Each room is one Durable Object using the WebSocket Hibernation API, so idle rooms are evicted from memory and do not accrue duration.
  Incoming WebSocket messages are billed at 20 messages per request.
- Rooms delete themselves 7 days after creation through a Durable Object alarm, which keeps storage near zero.
- The room creation limit uses the Workers Rate Limiting binding (`CREATE_ROOM_LIMITER`, 10 per 60 seconds per IP).
  Cloudflare counts it per location, so it is approximate rather than global.
  `namespace_id` only has to be unique within your account; change it if `1001` is already taken.
- AI suggestions draw on the free Workers AI allocation of 10,000 Neurons per day.
  A singleton `AiBudget` Durable Object caps requests per UTC day (`AI.dailyRequestCap` in `src/shared/constants.ts`) so the worst case stays under 8,000 Neurons; on the Free plan, going over would only make requests fail.
  **On the Workers Paid plan, usage above the free allocation is billed**, so keep that cap in place, and recompute it whenever you change `AI.model`, `AI.maxInputChars`, or `AI.maxOutputTokens`.
  Set `AI_SUGGESTIONS` to `off` in `wrangler.jsonc` to turn the feature off.
  `AI_SUGGEST_LIMITER` uses `namespace_id` `1002`.
