# DigitalX AI Proxy

Secure Node.js proxy between the Leave Planner HTML and the Anthropic API.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env and paste your Anthropic API key

# 3. Start the server
npm start
# → Running on http://localhost:3000

# 4. Test it
curl http://localhost:3000/health
```

## Production (PM2)

```bash
npm install -g pm2
pm2 start server.js --name "dx-ai-proxy"
pm2 save
pm2 startup
```

## Update the HTML planner

In `personal-leave-planner.html`, find:
```js
const AI_PROXY_URL = 'http://localhost:3000/api/chat';
```
Replace `localhost:3000` with your server's IP or domain.

## API

**POST** `/api/chat`

Request body:
```json
{
  "messages": [{ "role": "user", "content": "What are UAE holidays in 2026?" }],
  "system": "You are a helpful leave planning assistant."
}
```

Response:
```json
{
  "content": [{ "type": "text", "text": "UAE public holidays in 2026 are..." }]
}
```

## Security Notes
- API key is in `.env` only — never in the HTML
- Rate limited to 30 requests/minute per IP
- Set `ALLOWED_ORIGIN` to your domain in production
- Helmet.js adds security headers
