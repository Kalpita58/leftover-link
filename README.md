# Leftover Link

This workspace now includes the landing page, a role-based sign-in page, three dashboard views, and a MongoDB-backed Express API.

## Run locally

Requirements: Node.js 20.19+ and a MongoDB Atlas database or a local MongoDB instance.

1. Copy `.env.example` to `.env` and set `MONGODB_URI` and a `SESSION_SECRET` with at least 32 characters. For local MongoDB, use `mongodb://127.0.0.1:27017/leftoverlink`. For Atlas, use its connection string and allow the machine running the server in the Atlas network access list.
2. Install dependencies with `npm install`.
3. Start the app with `npm run dev`.
4. Open `http://localhost:3000`.
5. Use the sign-in page to create a consumer account. Restaurant accounts are held for administrator review.

To create the first administrator, set `ADMIN_NAME`, `ADMIN_EMAIL`, and a unique `ADMIN_PASSWORD` of at least 12 characters in `.env`, then run `npm run admin:create`. Administrator accounts cannot be created through public registration. After creating the account, remove `ADMIN_PASSWORD` from `.env`.

The static dashboard preview remains available without signing in. Its sample records are in-memory UI examples. Backend actions require a server session and MongoDB connection.

## AI listing assistant

The restaurant **Share surplus** form includes an optional AI drafting helper. It can polish an offer title and description using details supplied in the form. The restaurant reviews and publishes the draft; publication is saved through the regular MongoDB offer endpoint. The assistant does not invent missing facts or safety claims.

The administrator dashboard also has **Ask AI about your data**. It answers questions about current MongoDB totals for consumer accounts, restaurant accounts and review statuses, available offers, pickups awaiting collection, completed pickups, and closed offers. This app tracks claimed offers as pickups, not in a separate order collection, so “pending orders” means claimed offers awaiting collection. The server calculates exact totals; only the administrator's question is sent to Gemini, not user names, emails, or database records. Date-specific reports and trends are not currently tracked.

To enable it, create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey) and add it to the server `.env` file as `GEMINI_API_KEY=...`. `GEMINI_MODEL` defaults to `gemini-3.8-flash`. Keep the key on the server and out of browser code, screenshots, and version control. AI requests are sent to Google and may use quota or incur API charges depending on the account and project. The assistant is available only to signed-in restaurant accounts, not the static preview.

## Browser and API flow

- `GET /` - Leftover Link landing page
- `GET /login.html` - sign in or register as a consumer or restaurant
- `GET /dashboard.html` - role-based dashboard; a signed-in user is limited to their account role
- `POST /api/auth/register` - consumer or restaurant registration
- `POST /api/auth/login` - role-checked sign-in; session cookie is HTTP-only
- `GET /api/auth/me` - current signed-in account
- `POST /api/auth/logout` - end the session
- `GET /api/offers` - browse available offers
- `GET /api/offers/saved/mine` - consumer's saved offers
- `PUT /api/offers/:id/saved` - save or remove an offer as a consumer (`{ "saved": true }`)
- `GET /api/offers/mine` - restaurant's own offers
- `POST /api/offers` - create an offer as an active restaurant
- `POST /api/offers/:id/claim` - claim an available offer as a consumer
- `GET /api/offers/claims/mine` - consumer's claims
- `PATCH /api/offers/:id/status` - restaurant or administrator offer status action
- `GET /api/admin/partners?status=pending` - administrator partner review list
- `PATCH /api/admin/partners/:id/status` - approve, reject, or suspend a restaurant account
- `GET /api/admin/offers` - administrator offer list
- `GET /api/health` - service and database readiness
- `POST /api/ai/listing-draft` - create a restaurant listing title and description draft (requires an active restaurant session and `GEMINI_API_KEY`)
- `POST /api/ai/admin-insights` - answer admin questions using current database totals (requires an administrator session and `GEMINI_API_KEY`)

All API writes require same-origin requests. Authentication uses server-side sessions stored in MongoDB, bcrypt password hashes, role checks, rate limits on sign-in and registration, and HTTP-only SameSite cookies. The sign-in form's “Remember me” option extends a session from 8 hours to 30 days. Set `NODE_ENV=production` behind HTTPS so cookies are marked Secure. Set `TRUST_PROXY=true` only when the app is actually behind a trusted reverse proxy.

## Postman

Import `postman/Leftover-Link-API.postman_collection.json`. Set `baseUrl` to `http://localhost:3000`. Postman keeps the session cookie between requests. Register a consumer or restaurant first, then try listing and claim requests. For administrator routes, sign in with the administrator created by the script above.

## Current limits

The sign-in and registration forms, offer browsing/saving/claiming, restaurant listing creation/status, and administrator partner review connect to the API when opened from the running app server. Password reset email, map/geocoding, live notifications, deployment, and production monitoring are not configured. No Atlas credentials or production secrets are stored in this repository.
