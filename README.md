# Prompt-to-Lecture Generator

A VS Code-like interface for generating educational lectures with synchronized animations and narration using AI.

## Features

- **VS Code-inspired UI**: Three-panel layout with sidebar, video player, and chat interface
- **AI-Generated Content**: Uses Groq API (OSS model) to generate Manim code and narration scripts
- **Manim Animations**: Automatically generates educational animations for STEM topics
- **TTS**: Browser Web Speech API (free)
- **Video Output**: Combines animations with narration for complete lecture videos
- **Keyboard Shortcuts**: Enter to submit, Shift+Enter for new line

## Project Structure

```
gpt-open-hack/
├── frontend/          # React + Vite frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── Sidebar.jsx      # Left panel - chat history
│   │   │   ├── VideoPlayer.jsx  # Center panel - video player
│   │   │   └── ChatPanel.jsx    # Right panel - prompt input
│   │   └── App.jsx
│   └── package.json
├── backend/           # Node.js + Express backend
│   ├── routes/
│   │   └── generate.js          # Main API endpoint
│   ├── videos/                  # Generated video files
│   └── index.js
└── README.md
```

## Setup Instructions

### Prerequisites

1. **Node.js** (v20+)
2. **Python** with **Manim** installed:
   ```bash
   pip install manim
   ```
3. **Groq API Key** (or adapt back to OpenRouter)

### Installation

1. **Clone and setup**:
   ```bash
   cd gpt-open-hack
   ```

2. **Setup Backend**:
   ```bash
   cd backend
   npm install
   copy .env.example .env   # (Windows PowerShell; use cp on macOS/Linux)
   # Edit .env and add your GROQ_API_KEY
   ```

3. **Setup Frontend**:
   ```bash
   cd ../frontend
   npm install
   ```

### Configuration

1. **Get Groq API Key**:
   - Visit https://console.groq.com/
   - Create an API key

2. **Configure Backend** (`backend/.env`):
   ```env
   PORT=3001
   GROQ_API_KEY=your_key_here
   ```

**Note**: TTS is handled automatically by your browser - no additional setup required!

### Running the Application

1. **Start Backend** (Terminal 1):
   ```bash
   cd backend
   npm start
   ```

2. **Start Frontend** (Terminal 2):
   ```bash
   cd frontend
   npm run dev
   ```

3. **Open Browser**:
   - Navigate to `http://localhost:5173`

## Usage

1. **Enter a Prompt**: In the right panel, enter a topic like:
   - "Explain Newton's laws of motion with visual examples"
   - "Teach calculus derivatives with animated graphs"
   - "Show how electromagnetic waves work"

2. **Generate Lecture**: Click "Generate Lecture" to create:
   - Manim animation code
   - Narration script
   - Combined video output

3. **View Results**: 
   - Video plays in center panel
   - Chat history appears in left panel
   - Click previous chats to replay videos

## Technical Details

### Frontend (React + Vite)
- **Components**: Modular React components for each panel
- **Styling**: VS Code-inspired dark theme with CSS
- **State Management**: React hooks for managing video and chat state

### Backend (Node.js + Express)
- **API Endpoint**: `/api/generate` - handles lecture generation
- **LLM Integration**: Groq API for content generation (model: `openai/gpt-oss-120b`)
- **Manim Execution**: Runs Python scripts to generate animations
- **File Serving**: Static file serving for generated videos

### AI Integration
- **Model**: `openai/gpt-oss-120b` via Groq
- **Prompt Engineering**: "Maestro" system prompt producing shot-based timeline JSON (title, manim_header, scenes[shots], manim_footer)
- **Output Format**: JSON transformed into executable Manim scene

## Free Services Used

- **Groq**: Fast OSS model inference API
- **Browser TTS**: Web Speech API for text-to-speech
- **Local Manim**: Community edition for animations
- **Local Storage**: Browser memory for chat history

## Troubleshooting

### Common Issues

1. **Manim not found**:
   ```bash
   pip install manim
   # or
   conda install -c conda-forge manim
   ```

2. **API Key errors**:
   - Check `.env` file exists in `backend/`
   - Verify `GROQ_API_KEY` is correct
   - If switching back to OpenRouter, adjust endpoint & env var in `routes/generate.js`

3. **Port conflicts**:
   - Backend runs on port 3001
   - Frontend runs on port 5173
   - Change ports in config if needed

### Development Notes

- Backend includes fallback responses for offline development
- Minimal guardrails (prompt length + pattern filtering) applied before execution
- For production consider sandboxing Manim (Docker, seccomp, etc.)

## Future Enhancements

- [ ] Real TTS streaming integration
- [ ] Audio + video mux (ffmpeg) for packaged lectures
- [ ] Template library of common pedagogy animations
- [ ] Persistent storage for prompts & metadata
- [ ] Authentication / multi-user support
- [ ] Docker sandbox / safer code execution
- [ ] CI (lint, type, minimal unit test)

## Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Test locally
5. Submit pull request

## License

MIT License - see LICENSE file for details.
