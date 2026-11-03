Backend setup (Node.js + Express + Mongoose)

Requires Node.js 22.12 or newer and MongoDB Atlas (transactions supported).
Run from back-end on a new checkout:
  npm install
  cp .env.example .env

In .env, replace username and <db_password> with Atlas database-user credentials.
URL-encode special characters in the username/password. MONGODB_DB_NAME selects
anything_but_fish; the URI has no database path. Allow the backend's IP in Atlas
Network Access. Generate JWT_SECRET with:
  node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
Paste the generated value into the private .env, never into a committed file.

Start the backend with npm run dev (watch mode), or npm start. The API listens on
PORT=8000 by default, after MongoDB connects and unique/TTL indexes are ready.
GET /api/health reports database connectivity. A missing configuration or failed
database connection stops startup. .env is loaded relative to src/server.js,
independent of the shell's working directory; hosting environment values win.
Keep actual credentials in back-end/.env. Frontend environment files contain
only Atlas placeholders and do not establish a database connection.

Start the frontend separately with npm run dev in front-end and open
http://localhost:5173. Vite proxies /api to http://127.0.0.1:8000. Keep
FRONTEND_ORIGIN equal to the browser's exact origin, including its port.

Frontend authentication API contract (all paths start with /api/auth):
POST /register        { email, password } -> 201 { message }
POST /login           { email, password } -> 200 { user: { id, email } }
GET  /me                                 -> 200 { user: { id, email } }
POST /logout          {}                  -> 204
POST /forgot-password { email }          -> 503 { detail } (unavailable)
POST /reset-password  { token, password } -> 200 { message }

Errors: { detail: "User-facing message" } with appropriate HTTP status.
/me returns 401 when there is no valid session. Login sets an HS256-signed JWT in
an HttpOnly cookie; the browser never stores it in localStorage. MongoDB sessions
hold a hash of the JWT's random session ID, making logout immediately revocable.
JWT issuer/audience/signature/expiry, MongoDB session expiry, and the user's auth
version are checked on /me. Logout clears the cookie and deletes its session.
The frontend sends cookies with credentials: include. Auth responses use no-store.

Requests with an Origin header must match FRONTEND_ORIGIN; POST requires JSON.
CORS allows credentials only for that origin. Register/login/recovery/reset share
a per-IP limit of 30 requests per 15 minutes. This limiter is process-local; use
a shared store before scaling to multiple server instances. Set TRUST_PROXY to
the exact number of trusted reverse proxies (0 for direct local connections).
In production set NODE_ENV=production, AUTH_COOKIE_SECURE=true, and an HTTPS
FRONTEND_ORIGIN. AUTH_COOKIE_SAME_SITE=lax fits same-site hosting. If frontend/API
are on different sites, use none with secure cookies and account for browsers
that restrict third-party cookies. Prefer serving /api from the frontend origin.

users stores normalized, unique email addresses, salted scrypt password hashes,
authVersion, and timestamps. Email/password types and lengths are validated on
the server (new passwords: 8-128 characters). Login and /me return only string id
and email. Passwords, hashes, and token hashes are never returned to the browser.

There is no email delivery integration or verification-code step. Password
recovery is currently unavailable: the frontend shows a notice without a send
form, and forgot-password returns the same 503 response for every valid email.
The API does not generate or deliver new reset tokens.
Previously issued reset links remain valid until their tokens expire. The reset
endpoint still requires a hashed token record in passwordResetTokens; an email
address alone never authorizes changing a password. Reset atomically consumes
the unexpired token, changes the password hash, increments authVersion, and
deletes all sessions in a MongoDB transaction. Token expiry is checked on requests
even before TTL cleanup runs.

Tests:
  npm test
Mocha/Chai/Supertest integration tests use TEST_MONGODB_URI, falling back to .env's
MONGODB_URI. They create a random abf_auth_test_* database on Atlas and delete only
that generated database after the run. Use a dedicated test cluster/account when
available; the account must have permission to create/drop the test database.
Reset-token fixtures are inserted only in the isolated test database.
c8 enforces at least 80% line/function
and 70% branch coverage for auth code (the server entrypoint is excluded).

Game data structure review (game persistence is not implemented)

Current sources:
- src/content/story/ancient-gold-coin.json in front-end contains one chapter with
  id, title, a characters map, and 19 pages (14 dialogue and 5 archive pages).
  Dialogue pages contain id/template/background/speaker/content; archive pages
  contain id/template/blocks. Game.jsx currently renders only the dialogue pages.
- src/content/plots.js contains preview categories with entries shaped as
  { id, title, collected, total, description[] }. Counts are hard-coded, not
  player progress, and descriptions are visible without unlock checks.
- Collections.jsx embeds three display records { id, image, title, description }.
  IDs such as photo-1 are artwork/UI identifiers, not canonical item IDs.
- ChooseCharacter.jsx defines cislo independently of the chapter's speaker keys
  (a, b, miner, etc.). These records do not yet share a character catalog.
- SaveLoad, Inventory, and Settings are navigation placeholders. CharacterChat
  has a draft textarea but no submission, message history, or memory persistence.
- Auth forms call the implemented /api/auth/* routes and expect
  { user: { id, email } } from login and /me.

Implemented auth collections:
- users: _id, normalized email (unique), passwordHash, authVersion, createdAt,
  updatedAt. passwordHash/authVersion are excluded from normal model projections.
- sessions: userId, tokenHash (unique), expiresAt (TTL), createdAt.
- passwordResetTokens: userId (unique), tokenHash (unique), expiresAt (TTL),
  createdAt, updatedAt. Tokens are single-use.

Proposed game data, based on the current screens (not implemented):
- playerProgress: userId, slotId, chapterId, pageId, choices, version, updatedAt;
  unique (userId, slotId). Save stable page IDs, not numbered /game URLs, since
  inserting dialogue changes those numbers. Validate page/chapter references.
- inventory: userId, itemId, quantity, acquiredAt; unique (userId, itemId).
  Item submissions must validate ownership and apply rewards/progress together.
- archiveUnlocks: userId, categoryId, entryId, fragmentId, unlockedAt; unique
  (userId, categoryId, entryId, fragmentId). Derive collected counts from unlocks
  and totals from the content catalog instead of storing display counters.
- conversations: _id, userId, characterId, memorySummary, updatedAt; unique
  (userId, characterId). messages: conversationId, role, content, createdAt,
  indexed by (conversationId, createdAt, _id) for paginated history. Store messages
  separately so a conversation document does not grow without bound.

Content catalogs (chapters, characters, items, archive entries) need canonical IDs
and explicit references between them. Artwork paths remain frontend assets.
Static content can remain versioned JSON initially; dynamic player data belongs
in MongoDB. The API must return only unlocked archive fragments, derive userId
from authentication, and serialize MongoDB _id as the frontend's string id.

Auth uses Express, Mongoose, and JWT as required by instructions-2-back-end.md and
instructions-3-database.md. Next work: chapter progress/save-load, inventory and
unlocks, then chat persistence. Existing game routes remain open for frontend
development; future private game APIs must validate authentication server-side.
render.yaml currently deploys only a static frontend. Production also needs this
backend service plus /api routing or an explicit VITE_API_BASE_URL and matching
FRONTEND_ORIGIN/cookie configuration. The Vite proxy runs only in development.
