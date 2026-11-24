# ClipGenie

Turn any YouTube video into vertical (9:16) short clips ready for YouTube Shorts, Instagram Reels, and Facebook Reels.

## Project Structure

```
.
├── client/               # Standalone React + TypeScript + Vite + Tailwind frontend
│   ├── src/
│   │   ├── api.ts        # All API calls + standalone mock mode (VITE_USE_MOCK=true)
│   │   ├── components/   # Header, HeroForm, OptionsRow, ProcessingStepper, VerticalVideoPlayer, ClipCard, ResultsGrid, ErrorState, Footer
│   │   └── utils/        # YouTube URL validation & safe download helpers
│   └── .env.example
├── server/               # Standalone Node.js + Express + TypeScript backend
│   ├── src/
│   │   ├── pipeline/     # 6-stage video clipping pipeline with guaranteed temp cleanup
│   │   ├── queue/        # BullMQ + Redis with automatic in-memory fallback
│   │   ├── services/     # yt-dlp, Whisper, Claude API, ffmpeg 9:16 renderer, Cloudinary
│   │   └── middleware/   # Rate limiting (5 jobs/IP/hour) & structured error handling
│   ├── Dockerfile        # Node 22 + ffmpeg + yt-dlp + fonts
│   └── .env.example
└── docker-compose.yml    # Server + Redis stack
```

---

## 1. Quick Start — Standalone Client (Mock Mode)

Run the frontend immediately without configuring Redis, yt-dlp, ffmpeg, or external API keys:

```bash
cd client
cp .env.example .env
# .env defaults to VITE_USE_MOCK=true
npm install
npm run dev
```

Open `http://localhost:5173`. Paste any YouTube link (`youtube.com/watch`, `youtu.be`, or `youtube.com/shorts`) to step through simulated processing and preview 3 playable 9:16 clips.

> Tip: Paste `https://www.youtube.com/watch?v=errorDemo00` in mock mode to preview the failure and `"Try again"` error state.

---

## 2. Full-Stack Local Setup

### Prerequisites
- Node.js 20+
- `ffmpeg` and `yt-dlp` installed locally (or use Docker Compose below)
- Optional: Redis (if omitted or unreachable, the server automatically falls back to an in-memory queue)

### Configure Environment Variables

**Backend (`server/.env`)**:
```bash
cp server/.env.example server/.env
```
Fill in:
- `PORT=4000`
- `ALLOWED_ORIGIN=http://localhost:5173`
- `REDIS_URL=redis://localhost:6379` (optional — leave blank for in-memory queue)
- `CLAUDE_API_KEY` and `CLAUDE_MODEL` (e.g. `claude-sonnet-4-20250514`)
- `OPENAI_API_KEY` (used for Whisper fallback when a video lacks YouTube captions)
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- `YTDLP_COOKIES_B64` or `YTDLP_COOKIES_PATH` (optional — base64-encoded or local Netscape YouTube `cookies.txt` to allow downloading all YouTube videos from cloud datacenter IPs)
- `YTDLP_PROXY` (optional — residential proxy URL such as `http://user:pass@host:port` for cloud datacenter IPs)

**Frontend (`client/.env`)**:
```env
VITE_API_BASE_URL=http://localhost:4000
VITE_USE_MOCK=false
```

### Run Backend + Redis with Docker Compose
```bash
docker compose up --build
```

### Or Run Backend Directly
```bash
cd server
npm install
npm run dev
```

Then start the frontend:
```bash
cd client
npm install
npm run dev
```

---

## 3. API Reference

### `POST /api/jobs`
Rate limited to **5 jobs per IP per hour**. Rejects videos longer than **60 minutes**.

Request body:
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "clipLength": 30,
  "clipCount": 3,
  "captions": true
}
```

Response (`202 Accepted`):
```json
{ "jobId": "550e8400-e29b-41d4-a716-446655440000" }
```

### `GET /api/jobs/:id`
Poll every 3 seconds until `status` is `"done"` or `"failed"`:

```json
{
  "status": "processing",
  "step": "Cutting and formatting",
  "progress": 84,
  "clips": []
}
```

---

## 4. Deployment

### Deploying to Railway
1. Create a new Railway project and connect your repository.
2. Add a **Redis** service in Railway (Railway exposes `REDIS_URL` automatically).
3. Add a **Backend Service** pointing to Root Directory `server`:
   - Railway detects `server/Dockerfile` automatically (includes `ffmpeg` and `yt-dlp`).
   - Add env vars: `PORT=4000`, `ALLOWED_ORIGIN=https://<your-client-domain>`, `REDIS_URL=${{Redis.REDIS_URL}}`, `CLAUDE_API_KEY`, `CLAUDE_MODEL`, `OPENAI_API_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
4. Add a **Frontend Service** (or deploy `client/` to Vercel/Netlify/Cloudflare Pages):
   - Root Directory: `client`, Build Command: `npm run build`, Output Directory: `dist`.
   - Set `VITE_API_BASE_URL=https://<your-railway-server-domain>` and `VITE_USE_MOCK=false`.

### Deploying to Render
1. Create a **Render Key Value / Redis** instance and copy its internal `REDIS_URL`.
2. Create a **Web Service** for the backend:
   - Root Directory: `server`
   - Runtime: **Docker** (uses `server/Dockerfile`)
   - Set all env vars from `server/.env.example` (set `ALLOWED_ORIGIN` to your Render Static Site URL).
3. Create a **Static Site** for the frontend:
   - Root Directory: `client`
   - Build Command: `npm install && npm run build`
   - Publish Directory: `dist`
   - Env vars: `VITE_API_BASE_URL=https://<your-render-server>.onrender.com`, `VITE_USE_MOCK=false`.

---

## Legal Notice
Only use videos you own or have permission to edit.
