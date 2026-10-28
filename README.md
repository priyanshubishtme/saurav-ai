# AccessZ

[![React](https://img.shields.io/badge/React-18-149eca?logo=react&logoColor=white)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646cff?logo=vite&logoColor=white)](https://vite.dev/)
[![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47a248?logo=mongodb&logoColor=white)](https://www.mongodb.com/)

AccessZ is a web accessibility auditing workspace for developers. It scans public web pages and sanitized HTML with a real Playwright-controlled Chromium browser and axe-core, then presents findings, evidence, and an AccessZ weighted rule indicator. A repair workflow can propose scoped changes to a user-controlled HTML artifact and rescan that artifact for verification.

Automated checks are useful evidence, not proof of full WCAG conformance. Human review is still required.

**Frontend:** [accessz-1.onrender.com](https://accessz-1.onrender.com) · **Backend API:** [accessz.onrender.com](https://accessz.onrender.com) (`/api`)

## Contents

- [What AccessZ does](#what-accessz-does)
- [Technology](#technology)
- [Architecture](#architecture)
- [Audit workflow](#audit-workflow)
- [Repository layout](#repository-layout)
- [Run locally](#run-locally)
- [Configuration](#configuration)
- [Use the application](#use-the-application)
- [API reference](#api-reference)
- [Scanner, WCAG coverage, and scoring](#scanner-wcag-coverage-and-scoring)
- [Security and responsible scanning](#security-and-responsible-scanning)
- [Testing and quality checks](#testing-and-quality-checks)
- [Deployment and troubleshooting](#deployment-and-troubleshooting)
- [Screenshots](#screenshots)
- [Project status and limitations](#project-status-and-limitations)
- [Contributing](#contributing)
- [License](#license)

## What AccessZ does

After signing in, a user can submit a public HTTP(S) URL or a small HTML document for an automated accessibility scan. The dashboard displays recent audit summaries; finding details include axe-core rule guidance, affected selectors, HTML evidence, impact, and WCAG tags when axe-core provides them. Users can download JSON or print-friendly HTML reports.

For controlled HTML, the repair workspace can use a finding to prepare a small proposed patch. Users review and explicitly approve changes to an owned, sanitized artifact. A follow-up scan compares findings and reports resolved, remaining, changed, newly introduced, and incomplete items. The repair feature does not modify a remote website.

Implemented application areas include:

- Account registration, sign-in, sign-out, and session checks.
- URL and pasted-HTML scans, with optional additional CSS and WCAG-level settings.
- Audit dashboard, results, issue details, history, reports, and settings.
- Owner-scoped audits, repairs, verification runs, controlled artifacts, and sessions in MongoDB when configured.
- Optional Groq-backed repair suggestions, with deterministic or manual guidance when the provider is not configured or unavailable.
- JSON and escaped, print-friendly HTML report downloads.

## Technology

| Area | Technology | Role in this repository |
| --- | --- | --- |
| Frontend | React 18, React Router 7 | Single-page application, route handling, and UI state. |
| Frontend build and styles | Vite 6, Tailwind CSS 3, PostCSS | Development server and production assets. |
| UI libraries | Lucide React, Recharts | Icons and dashboard charts. |
| Backend | Node.js, Express 4 | JSON API, middleware, and HTTP server. |
| Validation | Zod | Authentication, audit, repair, and response data validation. |
| Browser automation | Playwright, Chromium | Isolated headless page execution for audits. |
| Accessibility engine | axe-core via `@axe-core/playwright` | Automated accessibility rules and evidence. |
| Persistence | MongoDB Atlas, Mongoose, `connect-mongo` | Accounts, owner-scoped workspace records, and sessions. |
| Authentication | `express-session`, bcryptjs | HTTP-only session cookies and password hashing. |
| Optional repair provider | Groq Chat Completions API | Structured repair suggestion proposals. |
| Tests | Vitest, Testing Library, Supertest, Playwright Test | Unit, UI/API, and browser-level tests. |
| Hosting | Render Static Site and Node web service | Frontend and API deployments are configured separately. |

Lighthouse is not part of the implemented scanner. Automated checks use axe-core; custom code adds score calculation, contrast evidence, and keyboard-focus review candidates for pasted HTML.

## Architecture

```mermaid
flowchart LR
  subgraph Client[User device]
    User[User]
    UI[React application<br/>React Router]
    APIClient[Frontend API client<br/>credentials included]
    User --> UI --> APIClient
  end

  subgraph Render[Render deployment]
    Static[Static Site CDN<br/>SPA rewrite to index.html]
    API[Node web service<br/>Express /api]
    Browser[Playwright + Chromium<br/>fresh headless context]
    Proxy[Loopback pinned egress proxy]
    Static -. serves app assets .-> UI
    API -->|launch and control| Browser
    Browser -->|URL scan requests| Proxy
  end

  APIClient -->|HTTPS JSON + session cookie| API
  API --> Auth[Origin checks, session,<br/>authenticated user]
  Auth --> Routes[Audit, artifact,<br/>repair, report routes]
  Routes -->|scan request| Browser
  Browser --> Axe[axe-core analysis]
  Axe --> Normalize[Finding normalization<br/>WCAG tags and impact]
  Normalize --> Score[AccessZ weighted indicator]
  Score --> Routes
  Routes -->|audit / repair / verification data| Mongo[(MongoDB Atlas)]
  Auth -->|session records| Mongo
  Proxy -->|validated public HTTP(S)| Target[External target site]
  Routes -. selected finding context<br/>when requested .-> Groq[Optional Groq API]
  Routes --> Report[JSON or escaped HTML report]
```

The frontend and backend are separate Render services. The frontend uses `VITE_API_BASE_URL` at build time. The Express service serves the API; it does not host the React files. In production, the API loads the authenticated user's workspace from MongoDB, and `connect-mongo` stores sessions in the same database.

## Audit workflow

```mermaid
sequenceDiagram
  actor User
  participant UI as React application
  participant API as Express API
  participant Session as Auth/session middleware
  participant DB as MongoDB
  participant Scan as Scanner service
  participant Browser as Playwright + Chromium
  participant Proxy as Restricted proxy
  participant Target as Public target
  participant Axe as axe-core

  User->>UI: Sign in and submit URL or HTML
  UI->>API: POST /api/audits/url or /api/audits/html
  API->>Session: Check readiness, session, and request Origin
  Session->>DB: Load user session and workspace
  DB-->>Session: User-scoped records
  Session-->>API: Authenticated user
  API->>API: Validate request with Zod
  API->>Scan: Start bounded scan
  alt Public URL
    Scan->>Scan: Validate scheme, port, hostname, and DNS
    Scan->>Browser: Launch fresh headless context through proxy
    Browser->>Proxy: GET/HEAD page and resources
    Proxy->>Target: Pinned requests to public addresses
    Target-->>Proxy: Page and resource responses
    Proxy-->>Browser: Validated responses
  else Pasted HTML
    Scan->>Scan: Sanitize source and start tokenized loopback preview
    Scan->>Browser: Launch fresh context; block other network requests
  end
  Browser->>Axe: Analyze selected WCAG and optional best-practice tags
  Axe-->>Scan: Violations, passes, incomplete, and inapplicable rules
  Scan->>Scan: Normalize findings, capture supported evidence, calculate indicator
  Scan-->>API: Completed audit or structured scan error
  alt Scan completed
    API->>DB: Persist owner-scoped audit
    DB-->>API: Saved record
    API-->>UI: Audit data and summary
    UI-->>User: Render results and finding details
  else Scan or persistence failed
    API-->>UI: Error code, message, and request ID
    UI-->>User: Show failure; failed scan is not reported as saved
  end
```

For verification, the backend runs a follow-up scan, compares normalized finding fingerprints, records incomplete/manual-review results, and persists the verification. A failed follow-up is recorded as failed and does not receive a final score. Verification of a live URL is labeled environmental; only controlled-artifact verification can confirm a repair in that artifact.

## Repository layout

```text
.
├── package.json                 # npm workspaces and root scripts
├── package-lock.json            # root workspace lockfile
├── README.md
├── backend/
│   ├── .env.example             # backend variable names; inspect before use
│   ├── package.json             # Express API scripts and dependencies
│   ├── scripts/
│   │   ├── install-chromium.js  # installs the matching browser locally
│   │   └── start.js             # selects the project-local browser path
│   ├── src/
│   │   ├── app.js               # middleware and API routes
│   │   ├── server.js            # API process and Render port binding
│   │   ├── auth.js              # registration, login, sessions, origin checks
│   │   ├── database.js          # MongoDB connection and index setup
│   │   ├── models.js            # account and owned-record schemas
│   │   ├── auditRepository.js   # owner-scoped persistence
│   │   ├── schemas.js           # request and audit validation
│   │   ├── scanner.js           # Playwright, axe, scan orchestration
│   │   ├── networkGuard.js      # URL validation and pinned proxy
│   │   ├── results.js           # axe result normalization
│   │   ├── scoring.js           # finding fingerprints and score indicator
│   │   ├── contrast.js          # contrast calculations and evidence
│   │   ├── verification/        # rescan comparisons and verification records
│   │   ├── repairs/             # scoped repair validation and lifecycle
│   │   ├── reports/             # JSON data and HTML report renderer
│   │   └── ai/                  # optional Groq provider and model setting
│   └── test/                    # API, service, scanner, and security tests
└── frontend/
    ├── .env.example             # frontend development defaults
    ├── .env.production           # production API base URL
    ├── package.json             # Vite, UI, and frontend test scripts
    ├── vite.config.js           # dev server and /api proxy
    ├── playwright.config.js     # browser test server configuration
    ├── e2e/                     # browser workflow tests
    └── src/
        ├── App.jsx              # React Router and auth-gated routes
        ├── api/client.js        # credentialed API requests
        ├── auth/                # auth context and account forms
        ├── components/          # application shell and shared UI
        ├── pages/               # audit, results, repair, history, settings
        ├── utils/               # preferences, browser history, helpers
        └── styles.css
```

Build output, dependencies, and test reports are generated and excluded from this tree. There is no `render.yaml` Blueprint in the repository.

## Run locally

### Requirements

- Node.js 20.19+ or 22.12+.
- npm 10+.
- A reachable MongoDB database and a session secret for accounts and persistent workspace features.
- Playwright's Chromium browser for actual scans. The backend workspace install hook downloads the matching browser into its local dependency tree. The explicit browser command below installs the browser in the current user's default Playwright cache for local development.

Clone the repository and install from the root lockfile:

```powershell
git clone https://github.com/Saurav-S-Mehta-07/AccessZ.git
cd AccessZ
npm ci
npm exec --workspace backend playwright install chromium
```

Create `backend/.env` with your own local values. Do not copy credential-like values from the checked-in `backend/.env.example`; replace exposed values and rotate them if they are real. A minimal local configuration is:

```dotenv
PORT=3001
FRONTEND_ORIGIN=http://localhost:5173
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<database>
SESSION_SECRET=<at-least-32-random-characters>
```

Generate a session secret with Node.js:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Set `MONGODB_URI` to a database you control and allow the backend host through your database network policy. `npm run dev` starts the API and Vite frontend together. The frontend is available at `http://localhost:5173`; the API listens on `http://127.0.0.1:3001` locally. Vite proxies `/api` to the API by default.

```powershell
npm run dev
```

The service can start without MongoDB, but reports database state as unavailable; authentication and protected routes return `503` until the database and session configuration are ready.

For separate processes, run these from the repository root in separate terminals:

```powershell
npm run dev --workspace backend
npm run dev --workspace frontend
```

## Configuration

Frontend variables are read during the Vite build or development-server startup. Frontend variables are public and must not contain secrets.

| Frontend variable | Purpose | Required | Default / example | Consumer |
| --- | --- | --- | --- | --- |
| `VITE_API_BASE_URL` | API base URL. In production, set to the deployed API `/api` base. | Optional in development; required to point a separately hosted production frontend at its API. | `/api`; production config in `frontend/.env.production` uses `https://accessz.onrender.com/api`. | Vite build and frontend API client. |
| `VITE_PORT` | Vite development server port. | No | `5173` | `frontend/vite.config.js`. |
| `VITE_API_PROXY_TARGET` | Development proxy target for `/api`. | No | `http://127.0.0.1:3001` | `frontend/vite.config.js`; E2E overrides it. |

Backend variables are backend-only. Configure them in `backend/.env` locally and in the API service's Render environment. Do not put backend values in `VITE_*` variables.

| Backend variable | Purpose | Required | Example / default | Consumer |
| --- | --- | --- | --- | --- |
| `PORT` | HTTP listen port; Render supplies this in production. | Platform supplies it; local default is `3001`. | `3001` | `backend/src/server.js`. |
| `FRONTEND_ORIGIN` | Exact allowed frontend origin for CORS and state-changing Origin checks. Production requires an HTTPS origin. | Yes for production auth. | `https://accessz-1.onrender.com` | `app.js`, `auth.js`. |
| `MONGODB_URI` | MongoDB connection URI. | Yes for account, session, and durable workspace persistence. | `mongodb+srv://<user>:<password>@<cluster>/<database>` | `database.js`, `auth.js`. |
| `SESSION_SECRET` | Secret used to sign session cookies; at least 32 characters. | Yes for authentication. | Generate a unique random value. | `auth.js`. |
| `SCAN_TIMEOUT_MS` | Overall bounded scan timeout. | No | `35000`; clamped to 1,000–45,000 ms. | `scanner.js`. |
| `NAVIGATION_TIMEOUT_MS` | Browser navigation/action timeout. | No | `10000`; clamped to 1,000–15,000 ms. | `scanner.js`. |
| `CHROMIUM_EXECUTABLE_PATH` | Override Playwright's bundled browser with a system-managed Chromium executable. | No | Unset to use Playwright's matching browser. | `scanner.js`. |
| `GROQ_API_KEY` | Credentials for optional repair suggestions. | No | Unset disables Groq suggestions. | `groqProvider.js`. |
| `GROQ_MODEL` | Groq model identifier for structured suggestions. | No | `openai/gpt-oss-120b` | `ai/config.js`, `groqProvider.js`. |
| `NODE_ENV` | Enables production cookie, origin, proxy, and CORS behavior when set to `production`. | Set by deployment platform. | `production` on Render. | `app.js`, `auth.js`. |
| `E2E_API_PORT` | Port for the E2E-only test API server. | No; test-only. | `3101` | `backend/test/e2eServer.js`. |

`PLAYWRIGHT_BROWSERS_PATH=0` is set by the backend install and start scripts; it selects Chromium stored under the installed Playwright package so the build-installed browser is available at runtime.

## Use the application

1. Register an account or sign in. Account features require MongoDB and a valid session configuration.
2. Open **New audit** and submit a public page URL or paste an HTML snippet. Choose a WCAG level, optionally enable best practices, and optionally supply additional CSS.
3. Review the summary and finding evidence. Incomplete checks remain separate from passes and violations and may require manual assessment.
4. Download a JSON or HTML report from Reports & history.
5. For pasted HTML, create or use a controlled artifact in the Repair workspace. Review any proposed code, explicitly confirm manual review, and apply it only to the artifact.
6. Run verification. A result is marked verified only when an actual controlled-artifact rescan resolves the relevant finding without an unresolved regression or manual-review item.

The current React routes include `/login`, `/signup`, `/`, `/audits/new`, `/audits/results`, `/audits/:auditId/issues/:issueId`, `/workspace`, `/verification`, `/reports`, and `/settings`. Workspace routes require authentication. A Render Static Site must rewrite client-side routes to `index.html`; see [deployment](#deployment-and-troubleshooting).

## API reference

The deployed base URL is `https://accessz.onrender.com/api`. Paths below are relative to that base, for example `GET https://accessz.onrender.com/api/health`. The frontend sends requests with credentials so the browser can include the session cookie.

Successful responses include a `requestId` and the `X-Request-Id` header. Errors use `{ "error": { "code", "message", "requestId", "details?" } }`. Except for health and account bootstrap routes, API resources require a signed-in session and are scoped to its owner. State-changing requests also require an allowed `Origin`.

### Health and authentication

| Method and path | Auth | Purpose and input | Success / common errors |
| --- | --- | --- | --- |
| `GET /health` | No | Reports database, authentication, scanner, and repair-provider availability. | `200`; includes `database.status`, `scanner.status`, and capability statuses. |
| `POST /auth/register` | No; requires configured service and allowed Origin | `{ name, email, username, password, confirmPassword }` | `201`; `400` invalid details, `409` duplicate account, `503` unavailable configuration. |
| `POST /auth/login` | No; requires configured service and allowed Origin | `{ identifier, password }`; identifier may be email or username. | `200`; `400` validation, `401` invalid credentials, `429` rate limited, `503` unavailable. |
| `GET /auth/me` | Yes | Returns the current account. | `200`; `401` missing/invalid session, `503` unavailable. |
| `POST /auth/logout` | Yes; allowed Origin | Ends the session. | `200`; `401` unauthenticated. |

Registration validates name, email, username, and password; passwords are hashed with bcrypt. Login is limited to 10 attempts per 15 minutes. Production auth requires `FRONTEND_ORIGIN` to be a valid HTTPS origin.

### Audits and reports

| Method and path | Auth | Purpose and input | Success / common errors |
| --- | --- | --- | --- |
| `POST /audits/url` | Yes | `{ url, wcagLevel?, includeBestPractices?, additionalCss? }`. Only public HTTP(S) URLs on standard ports are accepted. | `201` with completed audit; `400` validation, `429` limits, `502` target/scanner failure, `504` timeout, `503` persistence failure. |
| `POST /audits/html` | Yes | `{ html, projectName?, wcagLevel?, includeBestPractices?, additionalCss? }`; HTML plus CSS is limited to 300,000 bytes. | `201` with completed audit and sanitized preview; validation, scanner, and persistence errors as above. |
| `GET /audits/?limit=25` | Yes | Lists recent audits; limit range is 1–50, default 25. | `200` with summaries. |
| `GET /audits/:auditId` | Yes | Returns a saved audit and, for HTML scans, sanitized preview HTML. | `200`; `404` if not found for this account. |
| `GET /audits/:auditId/repairs` | Yes | Lists repair proposals for an audit. | `200`; `404` if audit is unavailable. |
| `GET /audits/:auditId/verifications` | Yes | Lists verification attempts for an audit. | `200`; `404` if audit is unavailable. |
| `POST /audits/:auditId/verify` | Yes | Rescans an owned controlled artifact or, where applicable, the original live URL. | `201` with verification; `404`, `409`, scan, or persistence errors. Live URL results are environmental. |
| `GET /audits/:auditId/report.json` | Yes | Downloads audit, repair, and verification report data. | `200` JSON attachment; `404` if unavailable. |
| `GET /audits/:auditId/report.html` | Yes | Downloads an escaped, print-friendly HTML report. | `200` HTML attachment; `404` if unavailable. |

### Controlled artifacts and repairs

| Method and path | Auth | Purpose and input | Success / common errors |
| --- | --- | --- | --- |
| `GET /artifacts/` | Yes | Lists owned controlled artifacts. | `200`. |
| `POST /artifacts/` | Yes | `{ name, html, sourceAuditId? }`; HTML is limited to 300,000 bytes. When `sourceAuditId` is supplied, it must identify an owned pasted-HTML audit. | `201`; `400` validation, `404` invalid source audit, `503` persistence failure. |
| `GET /artifacts/:artifactId` | Yes | Returns an owned artifact. | `200`; `404` if unavailable. |
| `GET /artifacts/:artifactId/download` | Yes | Downloads owned HTML as an attachment with sandboxing and `nosniff` headers. | `200`; `404` if unavailable. |
| `POST /repairs/suggest` | Yes | `{ auditId, artifactId, violationId, nodeIndex?, cssSource? }`; index defaults to 0 and is bounded. | `201` proposal; `404` missing evidence/artifact, `422` source not safely patchable, `502`/`503` provider errors. |
| `POST /repairs/:repairId/apply` | Yes | `{ manualReviewConfirmed, reviewedPatchHash, artifactVersion }`; requires the reviewed 64-character patch hash and current artifact version. | `200` applied proposal; `400` invalid confirmation, `409` stale/mismatched source, `503` persistence failure. |
| `POST /repairs/:repairId/reject` | Yes | Rejects a pending suggestion. No request body. | `200`; repair-specific error if unavailable or not rejectable. |
| `POST /repairs/:repairId/rollback` | Yes | Restores the saved pre-application artifact snapshot. No request body. | `200`; refuses stale rollback if a later change replaced the artifact. |
| `POST /repairs/:repairId/verify` | Yes | Rescans the exact applied controlled artifact against its stored baseline. | `201` verification; `404` missing repair, `409` when no eligible applied artifact/baseline exists, scan or persistence errors. |

The API returns `400` for malformed JSON or invalid requests, `401` for missing authentication, `403` for disallowed origins, `413` for oversized payloads, and JSON `404` for unknown API routes. Exact error codes/messages are returned in the response body.

## Scanner, WCAG coverage, and scoring

The backend launches a fresh headless Chromium browser context for each scan. URL audits use a loopback proxy that validates DNS results, pins the selected public address, and revalidates every navigation/resource request. Pasted HTML is sanitized, served from a random-token loopback origin, and scanned with other network access blocked. Browser downloads, service workers, and authenticated target-site state are not used.

The configured axe-core tags are:

| Requested level | Tags applied |
| --- | --- |
| A | WCAG 2.0 A and WCAG 2.1 A |
| AA | WCAG 2.0 A/AA, WCAG 2.1 A/AA, and axe-core's WCAG 2.2 AA tag |
| AAA | WCAG 2.0 A/AA/AAA, WCAG 2.1 A/AA/AAA, and axe-core's WCAG 2.2 AA tag |

Optional axe best-practice checks are added when selected. This tag configuration does not provide separate WCAG 2.2 A or AAA tags. The result normalizer keeps `violations`, `passes`, `incomplete`, and `inapplicable` distinct, maps axe WCAG tags to criterion labels, and retains at most 40 nodes per rule in the response.

The AccessZ indicator deduplicates applicable rules. Passing rules have weight 1; failing rules use axe impact weights: critical 5, serious 4, moderate 2, minor 1. Inapplicable rules and incomplete-only rules are excluded; a rule with a violation remains a failing rule even if it also appears as incomplete. Untested rules do not enter the score. The score is `100 × passing applicable weight ÷ total passing and failing applicable weight`, rounded to an integer; if no applicable rules were tested, it is `null`. It is a project-defined indicator, not a WCAG rating or compliance score.

For pasted HTML, AccessZ also captures forward/reverse keyboard-focus sequences and computes contrast evidence where supported. Focus order/visibility heuristics are review candidates, not definitive failures. Automated checks cannot reliably assess every content, context, keyboard, assistive-technology, or usability issue and cannot establish conformance. Review findings manually against the target page and applicable WCAG criteria.

## Security and responsible scanning

- **Account boundaries:** Protected workspaces are loaded and queried by signed-in user ID. Passwords are bcrypt-hashed; sessions are HTTP-only and stored in MongoDB.
- **Cross-site request controls:** CORS is limited to the configured frontend origin in production. State-changing API requests require that exact Origin. Production session cookies use `Secure` and `SameSite=None`; browsers may restrict third-party cookies when the services are cross-site.
- **URL safety:** The scanner permits only HTTP(S) and standard ports, rejects credentials and restricted/local destinations, resolves and checks DNS answers, and pins a public IP for proxied requests to reduce DNS-rebinding risk. Browser requests are limited to GET/HEAD and bounded in count, bytes, response size, time, and concurrency.
- **HTML isolation:** Pasted markup is sanitized and scanned from an isolated local preview with scripts/forms/frames removed and external network requests blocked. Preview responses use restrictive content security policy and are not treated as an editable remote page.
- **Repair scope:** Suggestions are validated against the exact audited element and artifact version. A human must review and approve the patch; applying it changes only the controlled artifact, not the scanned live site. Verification is required before a repair is described as verified.
- **Optional AI:** When requested, a bounded selected-finding/source context is sent to the configured Groq API. Do not submit sensitive page content unless you are authorized to share it with that provider. Groq is not required for audits.
- **Secrets:** Keep MongoDB credentials, session secrets, and Groq keys in backend-only environment settings. The current `backend/.env.example` contains credential-like values rather than safe blank placeholders. Treat those values as exposed if real, rotate them, and replace the sample with placeholders before distributing the repository.

Only scan external websites when you have permission to do so. AccessZ's URL validation and request limits reduce risk but do not replace deployment-level security review or eliminate all risk from scanning remote content.

## Testing and quality checks

Run commands from the repository root after `npm ci`:

| Command | What it checks |
| --- | --- |
| `npm test` | Backend Vitest tests, then frontend Vitest/Testing Library tests. |
| `npm test --workspace backend` | Backend scanner, network guard, scoring, auth, repository, API, repair, verification, and report tests. |
| `npm test --workspace frontend` | Frontend unit and component tests in jsdom. |
| `npm run lint` | ESLint for backend and frontend. |
| `npm run build` | Vite production build followed by backend Node syntax checks. |
| `npm run test:e2e --workspace frontend` | Browser flows against a test-only API identity/repository plus the real local scanner. |

Install the frontend test browser before running E2E tests:

```powershell
npm exec --workspace frontend playwright install chromium
npm run test:e2e --workspace frontend
```

The E2E server uses a fixed test identity and in-memory test repository. It exercises UI, scanner, repair, verification, and downloads; it does not validate MongoDB Atlas, production sessions/cookies, or Render configuration. Backend tests use injected test dependencies where appropriate. Tests are evidence about the exercised cases, not proof of WCAG conformance or production readiness.

## Deployment and troubleshooting

### Render services

The repository has no `render.yaml`, so current service settings are managed in the Render Dashboard. The deployed URLs configured/identified for this project are:

| Service | URL | Configuration source |
| --- | --- | --- |
| Frontend Static Site | [https://accessz-1.onrender.com](https://accessz-1.onrender.com) | Frontend URL supplied for the deployed application. |
| Backend API | [https://accessz.onrender.com](https://accessz.onrender.com) | `frontend/.env.production` sets `VITE_API_BASE_URL=https://accessz.onrender.com/api`. |

```mermaid
flowchart TB
  Repo[Git repository]
  subgraph RenderBuild[Render builds]
    StaticBuild[Frontend Static Site build<br/>Vite assets]
    ApiBuild[Backend Docker image build<br/>workspace install]
    BrowserInstall[Backend postinstall<br/>Playwright Chromium in node_modules]
    ApiBuild --> BrowserInstall
  end
  subgraph Runtime[Deployed services]
    CDN[Frontend Static Site CDN<br/>rewrite /* to /index.html]
    Web[Express API<br/>accessz.onrender.com]
    Mongo[(MongoDB Atlas<br/>records and sessions)]
    Chromium[Playwright + Chromium]
    ApiStart[Backend start wrapper<br/>sets browser path and starts Express]
  end
  Repo --> StaticBuild --> CDN
  Repo --> ApiBuild
  CDN -->|Browser loads app and keeps route URL| BrowserUser[User browser / React Router]
  BrowserUser -->|HTTPS /api requests| Web
  Web --> Mongo
  BrowserInstall --> ApiStart --> Web
  Web --> Chromium
  Chromium -->|restricted public HTTP(S)| Internet[Authorized public target]
```

The backend needs Chromium's Linux system libraries as well as the browser binary. Render's native build pipeline runs separately from the deployed runtime, so installing operating-system packages only during a native build does not guarantee they exist in the service instance. This repository uses a Dockerfile so the browser, its Linux libraries, and the Node service are built into one runtime image.

In the Render Dashboard, set the backend service runtime to **Docker**, keep the Docker context at the repository root, and set the Dockerfile path to `Dockerfile`. Render's Docker runtime builds from that file; it does not use a separate Build Command. The Dockerfile installs only the backend production workspace from the root lockfile:

```dockerfile
RUN npm ci --omit=dev --workspace backend --include-workspace-root=false
```

The backend workspace `postinstall` downloads the Playwright-matched browser into `node_modules`; the Dockerfile then runs `npm exec --workspace backend -- playwright install --with-deps chromium` as root to install the matching Chromium and Debian runtime libraries. It performs a headless Chromium launch check during image build, then runs the app as the unprivileged `node` user. `PLAYWRIGHT_BROWSERS_PATH=0` keeps the browser alongside the installed Playwright package. The production start command is `npm run start --workspace backend`, which uses the existing start script and startup diagnostic. No `render.yaml` exists, so Runtime and Dockerfile Path need to be set on the existing backend service in Render.

The backend's startup diagnostic checks the executable path and logs a clear message; the image build separately verifies Chromium actually launches with its runtime libraries. The `/api/health` response exposes scanner status and a safe diagnostic message. A missing file is reported as Chromium unavailable; a browser that exists but cannot start is reported separately, with a Linux-library hint for `ENOENT`. Playwright documents the compatible browser installer and Linux dependency flag in its [browser setup guide](https://playwright.dev/docs/browsers).

Keep the existing backend environment variables (`FRONTEND_ORIGIN`, `MONGODB_URI`, `SESSION_SECRET`, and optionally `GROQ_API_KEY`) on the Render service when switching its runtime. The app continues to use Render's `PORT` and the existing workspace start script.

For a Render Static Site using React Router, add a dashboard rewrite rule:

| Source | Destination | Action |
| --- | --- | --- |
| `/*` | `/index.html` | Rewrite |

This serves the SPA entry document at the original path so React Router can handle refreshes and direct links while the browser URL stays unchanged. Do not configure this as a redirect. Render documents the rule in [Static Site redirects and rewrites](https://render.com/docs/redirects-rewrites). This dashboard rule has not been verified from the repository because no Blueprint is checked in.

Set the backend's `FRONTEND_ORIGIN` to the exact frontend origin. Configure the production API URL in the frontend build environment as `VITE_API_BASE_URL=https://accessz.onrender.com/api`. Frontend variables are compiled into public assets; never put database or provider secrets there. Configure MongoDB network access and production secrets in the backend service environment, then redeploy both services after configuration changes.

### Troubleshooting

| Symptom | Likely cause | Checks and safe action |
| --- | --- | --- |
| Refresh/direct link to `/audits/new` returns 404 | Static Site is looking for a file at the React route. | Add the `/*` → `/index.html` **Rewrite** rule to the frontend Static Site. Confirm the browser keeps `/audits/new` after refresh. |
| Health reports scanner unavailable or scan says Chromium is not installed | The deployed image was not built from the backend Dockerfile, or `CHROMIUM_EXECUTABLE_PATH` points to a missing file. | Configure the existing Render API service to use Docker with the repository-root `Dockerfile`; check the startup diagnostic and build logs. Clear an obsolete custom browser path. |
| Browser executable exists but will not launch | Runtime OS libraries or execute permissions are missing. | Use the Docker image built from the repository Dockerfile; it installs Linux dependencies with Playwright and runs the service with the same browser path. Review the startup and request diagnostics. |
| Health reports database `not_configured` or `unavailable` | `MONGODB_URI` is absent, malformed, or unreachable; Atlas network/user configuration may be wrong. | Check the backend environment and Atlas network policy. Do not print the full URI in logs or support tickets. |
| Auth returns `503` in production | MongoDB is unreachable, the session secret is missing/too short, or the frontend origin is not a valid HTTPS origin. | Configure `MONGODB_URI`, a unique `SESSION_SECRET` of at least 32 characters, and the exact HTTPS `FRONTEND_ORIGIN`. |
| Browser shows CORS, failed fetch, or auth request errors | Wrong frontend API base or allowed Origin; frontend/API may be on different sites and third-party cookies may be restricted. | Check build-time `VITE_API_BASE_URL`, backend `FRONTEND_ORIGIN`, HTTPS origins, and browser cookie policies. Keep the API base ending in `/api`. |
| State-changing auth/API request returns `403` | Missing or mismatched `Origin` header relative to `FRONTEND_ORIGIN`. | Open the frontend at the configured origin and make the values match exactly, including scheme and host. |
| Scan fails with target/network errors | Target is private, DNS resolves to restricted addresses, a redirect is blocked, the site requires login, or it blocks automated browsing. | Scan only public sites you are authorized to test. Use the error code and request ID to inspect backend logs; AccessZ does not scan authenticated target sessions. |
| Scan reports no saved result after a failure | The scan did not complete or persistence failed. | A failed scan is not shown as a saved audit. Check scanner/database health and retry after resolving the cause. |

## Screenshots

No committed product screenshots or image assets were found in the repository. Add reviewed captures under a dedicated directory such as `docs/images/` and link them here when available; no image link is included until an asset exists.

## Project status and limitations

The repository contains an implemented React/Vite frontend and Express API with account-backed MongoDB persistence, URL and HTML scanning, JSON/HTML reports, controlled-artifact repair proposals, and verification workflows. The frontend and backend deployment URLs are identified above, but live database readiness, browser behavior on Render, production cookie behavior, and the dashboard rewrite state cannot be verified from repository files alone.

Known boundaries:

- axe-core and custom heuristics cover only a subset of accessibility review. Manual keyboard, screen reader, content, and interaction testing remain necessary.
- URL scans use an unauthenticated browser context and public targets only.
- Local scan/API status may be available while account features remain unavailable without MongoDB and session configuration.
- Cross-site cookies can be blocked by browser privacy settings; a same-site custom domain or reverse proxy can improve compatibility.
- No Render Blueprint, screenshot set, formal contribution guide, or license file is present.

### Proposed roadmap

These are suggestions, not committed project plans:

- Add a production deployment smoke check for SPA deep links, browser availability, cookies, and database readiness.
- Add screenshots after reviewing captures of the current UI.
- Add a Render Blueprint only after matching the existing service settings and keeping secrets out of source control.
- Replace populated credential-like values in `backend/.env.example` with blank safe placeholders.

## Contributing

There is no checked-in `CONTRIBUTING.md` or formal contribution policy. Before proposing a change, inspect the existing route, validation, persistence, and security patterns. Keep API changes owner-scoped, add or update focused tests for behavior changes, and run `npm test`, `npm run lint`, and `npm run build`. For scanner changes, preserve the URL boundary and isolated-browser assumptions. Do not include secrets, real user data, or unauthorized third-party page content in commits or test fixtures.

## License

No `LICENSE` file was found in the repository. No license is declared here; confirm the project owner's intended terms before reusing or redistributing this code.
