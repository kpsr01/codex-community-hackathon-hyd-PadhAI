# Backend

The backend is an Express service that orchestrates lecture generation from request intake through narrated video output.

## Responsibilities

- Validate runtime prerequisites on startup
- Normalize prompt and file uploads
- Extract context from PDFs and images
- Enrich source material into lecture-ready context
- Generate lecture content through the OpenAI API
- Render Manim scenes into MP4 files
- Synthesize narration audio and mux it into the final video
- Return lecture metadata, quiz items, and flashcards

## Key Directories

- [`routes/`](routes) HTTP handlers
- [`services/`](services) pipeline, OpenAI, runtime, and audio services
- [`tests/`](tests) backend checks
- [`audio/`](audio) ignored narration output
- [`videos/`](videos) ignored lecture output

## Setup

```bash
cd backend
npm install
copy .env.example .env
```

Fill in `OPENAI_API_KEY` and verify `ffmpeg` and `ffprobe` are available.

## Scripts

- `npm start` starts the API
- `npm dev` runs the API without a watcher
- `npm test` runs the backend test suite

## API Surface

- `GET /health`
- `POST /api/generate`
- `POST /api/generate/artifacts`

## Environment

See [`backend/.env.example`](.env.example) for the expected variables.
