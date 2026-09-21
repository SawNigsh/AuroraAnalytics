# Aurora Analytics

A small analytics stack for a Roblox Lua client:

- Express API
- Supabase/PostgreSQL database
- Responsive HTML/CSS/JS dashboard
- Lua client with `start`, `heartbeat` and `end`
- API key authentication
- Rate limiting
- Helmet and CORS

## 1. Supabase

Create a Supabase project and open the SQL editor.

Run:

```sql
-- Copy everything from database/schema.sql
```

Then create your environment variables from `.env.example`.

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `API_KEY`

Keep `SUPABASE_SERVICE_ROLE_KEY` private. Do not put it in HTML, JavaScript or Lua.

## 2. Local run

Install Node.js 20+.

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## 3. Configure Lua

Edit:

```text
lua/AuroraAnalytics.lua
```

Set:

```lua
local API_URL = "https://YOUR-DOMAIN.example/api/v1"
local API_KEY = "YOUR_LONG_RANDOM_API_KEY"
```

The API key must match the server's `API_KEY` environment variable.

## 4. What the dashboard measures

- Total executions
- Executions started today
- Active sessions
- Executor name when the environment exposes it
- Script version
- Roblox PlaceId
- JobId
- Session start time
- Approximate active session duration

An active session is one whose last heartbeat is inside `ACTIVE_WINDOW_SECONDS` (90 seconds by default).

## 5. Endpoint summary

```text
GET  /api/health
POST /api/v1/start
POST /api/v1/heartbeat
POST /api/v1/end
GET  /api/v1/stats
GET  /api/v1/recent
```

`start`, `heartbeat` and `end` require the `X-API-Key` header.

## 6. Security notes

- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client.
- Use a long random `API_KEY`.
- Keep the database table behind Row Level Security.
- The Lua client should send only the telemetry needed for the dashboard.
