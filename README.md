## Amadeus (Steins;Gate 0) — Web Frontend

This project recreates the Amadeus assistant from the anime **Steins;Gate 0**. This repository contains the frontend only, built with Next.js and React. The UI is designed exclusively for phone-sized screens.

- Use a mobile browser to view the app.
- Or, in a desktop browser, open DevTools and switch to a phone device preset (device emulation) for correct layout and interactions.

### What this repo is
- Frontend-only implementation (no server here other than Next.js dev server)
- Uses LiveKit for real-time audio/video
- Uses Live2D rendering via `pixi-live2d-display-lipsyncpatch`

## Prerequisites
- Node.js 20+ and npm
- [mkcert](https://github.com/FiloSottile/mkcert) (for local HTTPS)
- A LiveKit deployment (self-hosted or LiveKit Cloud) to obtain `LIVEKIT_*` credentials

## Setup
1) Install dependencies
```bash
npm i
```

2) Create environment file
```bash
cp .env.local.example .env.local
```
Then edit `.env.local` and provide the required values:

- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_URL`

Optional:

- `NEXT_PUBLIC_APP_CONFIG_ENDPOINT`
- `SANDBOX_ID`

3) Generate local HTTPS certificates with mkcert
- Trust the local CA (one-time):
```bash
mkcert -install
```
- Generate certs in the project root. The dev script expects these exact filenames:
```bash
mkcert localhost 127.0.0.1 ::1 [other-addresses]
# This creates: ./localhost+2.pem and ./localhost+2-key.pem
```

## Run
- HTTP (local development):
```bash
npm run dev
```

- HTTPS (to enable audio/video with microphone/camera transport over non-loopback addresses):
```bash
npm run dev:https
```
This uses Next.js HTTPS flags with the `./localhost+2.pem` and `./localhost+2-key.pem` you created above.

## Production build
```bash
npm run build
npm start
```
