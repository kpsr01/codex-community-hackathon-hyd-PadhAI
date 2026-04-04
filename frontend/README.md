# Frontend

The frontend is a React + Vite workspace for submitting lecture requests, reviewing generated videos, and studying with transcripts, quizzes, and flashcards.

## Main UI Areas

- Sources panel for prompts, uploads, and lecture history
- Video stage for loading, playback, and warning states
- Learning tools panel for transcript, quiz, and flashcards
- Theme toggle and keyboard-accessible navigation helpers

## Setup

```bash
cd frontend
npm install
```

## Scripts

- `npm run dev` starts the Vite dev server
- `npm run build` creates a production bundle
- `npm run preview` previews the production build
- `npm run lint` runs ESLint

## API Dependency

The app expects the backend API at `http://localhost:3001`.

If you change the backend host, update `API_BASE` in [`src/App.jsx`](src/App.jsx).
