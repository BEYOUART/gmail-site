# Private Gmail Gateway (Personal Use)

> ⚠️ **Security Warning:** This project is designed for private/personal use only (single trusted user). Do **not** use this as a public multi-user Gmail product.

A production-ready Node.js + Express app for Render that adds:

- A custom password gate
- Google OAuth login (server-side only)
- Inbox listing (latest 20)
- Email detail view
- Sending email through Gmail API

## Tech Stack

- Node.js + Express
- express-session
- passport + passport-google-oauth20
- googleapis
- Plain HTML/CSS/JS frontend

## Required Environment Variables

Set **all** of these in Render:

- `APP_PASSWORD`
- `SESSION_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `PORT` (Render injects this automatically)

Use `.env.example` as a template for local development.

## Google Cloud OAuth Setup (Exact Steps)

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create/select a project.
3. Enable **Gmail API** for that project.
4. Configure OAuth consent screen (External or Internal, then add your test user email if needed).
5. Create OAuth 2.0 Client ID credentials of type **Web application**.
6. Under **Authorized redirect URIs**, add this exact URI:
   - `https://YOUR-RENDER-URL/auth/google/callback`
7. Save and copy:
   - Client ID → `GOOGLE_CLIENT_ID`
   - Client Secret → `GOOGLE_CLIENT_SECRET`
8. Set `GOOGLE_REDIRECT_URI` to the same redirect URI you entered above.

## Render Deployment (Exact Steps)

1. Push this project to a Git repository.
2. In Render dashboard, click **New +** → **Web Service**.
3. Connect your repo.
4. Render can detect `render.yaml` automatically; confirm settings:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Add environment variables in Render:
   - `APP_PASSWORD`
   - `SESSION_SECRET`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI` (must be `https://YOUR-RENDER-URL/auth/google/callback`)
6. Deploy.
7. After first deploy, verify:
   - `https://YOUR-RENDER-URL/healthz` returns HTTP 200 JSON.
   - Open app URL, unlock with `APP_PASSWORD`, then connect Gmail.

## Local Run

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env` from `.env.example` and fill values.
3. Start the server:
   ```bash
   npm start
   ```
4. Open `http://localhost:3000`.

## Notes

- This app never asks for or stores your Gmail password.
- OAuth tokens are kept in server session memory only.
- Mail routes require both:
  - password gate unlock
  - successful Google OAuth session
- Server binds to `0.0.0.0` on `process.env.PORT`.
- Includes `/healthz` for Render checks.
