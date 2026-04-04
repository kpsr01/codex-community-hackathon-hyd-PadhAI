# PadhAI

PadhAI is a full-stack app that turns a study prompt, PDF, or image set into a narrated lecture video with supporting study materials.

The current stack is:

- `frontend/`: React 19 + Vite workspace
- `backend/`: Express API that normalizes requests, extracts source context, calls OpenAI, renders Manim, and muxes narration into the final video

## What It Does

- Accepts prompt-only, file-only, or mixed input
- Extracts reusable source context from PDFs and images
- Generates a lecture script and Manim scene plan
- Renders an MP4 lecture and stitches server-side narration into it
- Returns quiz and flashcard artifacts alongside the lecture
- Keeps recent lecture history in browser storage

## Repository Layout

```text
padhai/
|-- frontend/                 React client
|   |-- public/              Static assets
|   `-- src/                 App and UI components
|-- backend/                  Express API and generation pipeline
|   |-- routes/              HTTP handlers
|   |-- services/            OpenAI, audio, pipeline, and runtime services
|   |-- tests/               Backend regression and contract checks
|   |-- audio/               Ignored runtime narration output
|   `-- videos/              Ignored runtime lecture output
|-- .gitignore
`-- README.md
```

## Prerequisites

- Node.js 20+
- Python with Manim installed and available on `PATH`
- `ffmpeg` and `ffprobe` on `PATH`
- An OpenAI API key with access to the configured models

## Local Setup

1. Install backend dependencies:

   ```bash
   cd backend
   npm install
   copy .env.example .env
   ```

2. Fill in `backend/.env`.

3. Install frontend dependencies:

   ```bash
   cd ../frontend
   npm install
   ```

## Environment Variables

Use [`backend/.env.example`](backend/.env.example) as the source of truth. The required values are:

```env
PORT=3001
OPENAI_API_KEY=replace_with_your_openai_key
OPENAI_CORE_MODEL=gpt-5.4
OPENAI_LECTURE_TIMEOUT_MS=180000
OPENAI_TTS_MODEL=gpt-4o-mini-tts-2025-12-15
OPENAI_TTS_VOICE=marin
OPENAI_STORE_RESPONSES=false
```

Optional overrides:

- `FFMPEG_PATH`
- `FFPROBE_PATH`

## Running The App

Start the backend:

```bash
cd backend
npm start
```

Start the frontend in a second terminal:

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173`.

## Verification

Backend tests:

```bash
cd backend
npm test
```

Frontend production build:

```bash
cd frontend
npm run build
```

Frontend lint:

```bash
cd frontend
npm run lint
```

## Notes For GitHub

- Runtime-generated videos, audio files, temp output, env files, and dependency folders are git-ignored.
- The repo keeps lightweight README files inside generated-output folders so the expected directory structure is preserved.
- The frontend and backend each have their own README for implementation-specific details.
