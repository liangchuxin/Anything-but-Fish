# Game preview with MSW

Run `npm run dev` from `front-end`. MSW starts in the browser and intercepts the
six game GET endpoints and three write operations below. Pages continue using
the regular fetch API layer. No separate mock server or MongoDB is needed.

Authentication requests are not mocked. Registration, login, and session checks
still require the real auth backend. All visitors start with the same fixed demo
profile, regardless of login. Settings and saves can change in mock memory during
the current browser page lifecycle; navigation preserves them, but refresh resets
them. These changes are not stored in a database or tied to a real account.

| GET endpoint | Response |
| --- | --- |
| `/api/game/plots` | `{ categories: [{ id, title, entries: [{ id, title, total, collected, description: string[] }] }] }` |
| `/api/game/collections` | `{ items: [{ id, title, description }] }` |
| `/api/game/characters` | `{ characters: [{ name, displayName }] }` |
| `/api/game/inventory` | `{ capacity: 20, items: [{ id, name, type, count, description, icon }] }` |
| `/api/game/settings` | `{ settings: { soundVolume, ambientVolume, language } }` |
| `/api/game/saves` | `{ slots: [{ id, save: null \| { chapterTitle, page, savedAt } }] }` |

| Write endpoint | Request body | Response |
| --- | --- | --- |
| `PATCH /api/game/settings` | `{ soundVolume, ambientVolume, language }` | `{ settings: { soundVolume, ambientVolume, language } }` |
| `PUT /api/game/saves/:id` | `{ chapterTitle, page }` | `{ slots }` with the updated save and timestamp |
| `POST /api/game/saves/:id/load` | None | `{ page, chapterTitle }` |

Settings requires all three fields: integer volumes from 0 to 100 and language
`en` or `zh`. Defaults are 70, 50, and `en`. Inventory icons use `coin`, `key`,
`notebook`, `tape`, or `photograph`; inventory has no write operation. Saves use
three slots (`slot-1` through `slot-3`), a nonempty chapter title, a positive
integer page, and an ISO `savedAt` timestamp. Loading an empty slot returns 409;
an unknown slot returns 404.

Game's backpack, gear, and fishhook open Inventory, Settings, and Save/Load.
Chat's backpack also opens an Inventory overlay. Settings values read back after
Apply settings, but volume values are not connected to audio tracks. Language
changes only the Settings labels, not global story text. Inventory browsing and
temporary save/load are implemented; item collection/submission, chat submission,
and p5 interactions are not.

Content catalogs and preview progress live separately in `fixtures/`. Keep them
out of page components: progress determines which entries appear and their
collected counts. Artwork mappings stay in the frontend. The original story JSON
and illustrations are static authored content released with the app, independent
of player progress.

## Configuration

- `VITE_ENABLE_MOCKS`: `false` forces mocks off; `true` explicitly enables them.
  Without an override, development and demo mode enable mocks, and a normal
  production build disables them.
- `VITE_MOCK_SCENARIO`: `demo` (default), `empty`, or `error`.
- `VITE_MOCK_DELAY_MS`: response delay in milliseconds, default `250`.

`demo` starts with the fixed preview records, five inventory items, default
settings, and two occupied save slots plus one empty slot. `empty` keeps archive
categories with empty entry lists, returns empty collections, characters, and
inventory (capacity stays 20), and starts all three save slots empty. Settings
still uses its defaults. `error` returns 503 for all mocked operations so the UI
can show error and retry controls. The delay lets you inspect loading states.

Run these from `front-end`, restarting Vite when changing options:

```sh
VITE_MOCK_SCENARIO=empty npm run dev
VITE_MOCK_SCENARIO=error npm run dev
VITE_MOCK_DELAY_MS=1000 npm run dev
VITE_ENABLE_MOCKS=false npm run dev
```

Vite reads these options at startup or build time. They are public browser
configuration; do not place credentials in them.
`VITE_API_BASE_URL` defaults to `/api`. MSW matches the listed game endpoints
against this configured base URL, including an absolute base, without a wildcard
handler. Keep the relative default for local preview.

## Builds and checks

`npm run test:api` runs the API response and MSW handler tests without starting
services. `npm run build` uses mocks off by default. `npm run build:demo` runs
`vite build --mode demo` and includes MSW for a static course preview; the Render
configuration uses this command.

The demo build intentionally contains preview fixtures and cannot represent real
accounts or persistent progress. Authentication still needs its own backend and
API routing. With mocks disabled, real game endpoints are needed too; failed
requests show errors instead of silently switching to demo records. Vite's API
proxy only runs during development.
