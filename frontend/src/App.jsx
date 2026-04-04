import { useEffect, useMemo, useState } from 'react'
import './App.css'
import Header from './components/Header'
import SourcePanel from './components/SourcePanel'
import VideoStage from './components/VideoStage'
import LearningTools from './components/LearningTools'
import { SkipLink, useKeyboardNav } from './components/Accessibility'
import './components/Accessibility.css'

const API_BASE = 'http://localhost:3001'
const STORAGE_KEY = 'padhai_lecture_history_v1'

function buildLoadingStages({ includeQuiz, includeFlashcards }) {
  const stages = [
    'Normalizing input',
    'Building context',
    'Enriching context',
    'Generating lecture',
    'Rendering video',
    'Generating narration'
  ]
  if (includeQuiz) stages.push('Preparing quiz')
  if (includeFlashcards) stages.push('Preparing flashcards')
  stages.push('Stitching lecture')
  stages.push('Assembling response')
  return stages
}

function normalizeAssetUrl(value) {
  if (!value || typeof value !== 'string') return ''
  if (/^https?:\/\//.test(value)) return value
  return `${API_BASE}${value}`
}

function toHistoryBadge(inputMode) {
  if (inputMode === 'mixed') return 'Mixed'
  if (inputMode === 'pdf_only') return 'PDF'
  if (inputMode === 'image_only') return 'Image'
  if (inputMode === 'file_only_mixed') return 'Mixed'
  return 'Text'
}

function normalizeContextText(value, maxLength = 1200) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`
}

function buildFallbackArtifactContext(lectureEntry) {
  const promptText = normalizeContextText(lectureEntry?.prompt || '', 1000)
  const narrationText = normalizeContextText(lectureEntry?.lecture?.narration || '', 1200)
  const title = normalizeContextText(lectureEntry?.title || promptText || 'Generated Lecture', 220)
  const sourceText = narrationText || promptText
  const sourceChunks = sourceText
    ? [{
        id: 'saved_lecture_1',
        sourceType: 'prompt',
        sourceName: 'saved_lecture',
        text: sourceText
      }]
    : []

  return {
    topic: title,
    promptText,
    keyConcepts: [],
    definitions: [],
    formulas: [],
    examples: [],
    coverageGaps: [],
    sourceSummary: lectureEntry?.sourceSummary || {},
    sourceChunks
  }
}

function mergeUniqueStrings(...lists) {
  const seen = new Set()
  const merged = []
  lists.flat().forEach((item) => {
    const value = String(item || '').trim()
    if (!value) return
    const key = value.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    merged.push(value)
  })
  return merged
}

function readHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function App() {
  // Enable keyboard navigation detection
  useKeyboardNav()

  const [chatHistory, setChatHistory] = useState([])
  const [currentLecture, setCurrentLecture] = useState(null)
  const [selectedHistoryId, setSelectedHistoryId] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingStageIndex, setLoadingStageIndex] = useState(0)
  const [loadingStages, setLoadingStages] = useState(() =>
    buildLoadingStages({ includeQuiz: true, includeFlashcards: true })
  )
  const [requestError, setRequestError] = useState('')

  useEffect(() => {
    const history = readHistory()
    setChatHistory(history)
    if (history.length > 0) {
      setCurrentLecture(history[0])
      setSelectedHistoryId(history[0].id)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chatHistory))
  }, [chatHistory])

  useEffect(() => {
    if (!isLoading) return undefined
    const timer = setInterval(() => {
      setLoadingStageIndex((prev) => Math.min(prev + 1, loadingStages.length - 1))
    }, 2200)
    return () => clearInterval(timer)
  }, [isLoading, loadingStages])

  const loadingStage = useMemo(() => loadingStages[loadingStageIndex], [loadingStages, loadingStageIndex])

  const handleGenerateLecture = async ({ prompt, files, generateQuiz, generateFlashcards }) => {
    setIsLoading(true)
    setRequestError('')
    setLoadingStages(buildLoadingStages({
      includeQuiz: Boolean(generateQuiz),
      includeFlashcards: Boolean(generateFlashcards)
    }))
    setLoadingStageIndex(0)

    try {
      let response
      if (files.length > 0) {
        const formData = new FormData()
        if (prompt.trim()) formData.append('prompt', prompt.trim())
        files.forEach((file) => formData.append('files', file))
        formData.append('generateQuiz', String(generateQuiz))
        formData.append('generateFlashcards', String(generateFlashcards))
        response = await fetch(`${API_BASE}/api/generate`, {
          method: 'POST',
          body: formData
        })
      } else {
        response = await fetch(`${API_BASE}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            prompt: prompt.trim(),
            generateQuiz,
            generateFlashcards
          })
        })
      }

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data?.details || data?.error || 'Lecture generation failed.')
      }

      const savedLecture = {
        id: data.requestId || `req_${Date.now()}`,
        prompt: prompt.trim() || 'Uploaded source material',
        timestamp: new Date().toISOString(),
        inputMode: data.inputMode || (files.length > 0 ? 'mixed' : 'text_only'),
        sourceBadge: toHistoryBadge(data.inputMode || (files.length > 0 ? 'mixed' : 'text_only')),
        sourceSummary: data.sourceSummary || {},
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
        metadata: data.metadata || {},
        videoUrl: data.videoUrl,
        audio: data.audio
          ? {
              ...data.audio,
              url: normalizeAssetUrl(data.audio.url),
              manifestUrl: normalizeAssetUrl(data.audio.manifestUrl)
            }
          : null,
        title: data.title || 'Generated Lecture',
        totalDuration: data.totalDuration || 90,
        lecture: {
          url: normalizeAssetUrl(data.videoUrl),
          narration: data.narration,
          manimCode: data.manimCode,
          scenes: data.scenes || []
        },
        quiz: Array.isArray(data.quiz) ? data.quiz : [],
        flashcards: Array.isArray(data.flashcards) ? data.flashcards : []
      }

      setCurrentLecture(savedLecture)
      setSelectedHistoryId(savedLecture.id)
      setChatHistory((prev) => [savedLecture, ...prev].slice(0, 40))
    } catch (error) {
      console.error('Error generating lecture:', error)
      setRequestError(error.message || 'Lecture generation failed.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSelectChat = (entry) => {
    setCurrentLecture(entry)
    setSelectedHistoryId(entry.id)
  }

  const handleGenerateArtifacts = async ({ generateQuiz, generateFlashcards }) => {
    if (!currentLecture) {
      throw new Error('Select a lecture first.')
    }

    const artifactContext = currentLecture?.metadata?.artifactContext || buildFallbackArtifactContext(currentLecture)
    const response = await fetch(`${API_BASE}/api/generate/artifacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        context: artifactContext,
        prompt: currentLecture.prompt || '',
        generateQuiz: Boolean(generateQuiz),
        generateFlashcards: Boolean(generateFlashcards)
      })
    })

    const data = await response.json()
    if (!response.ok || !data.success) {
      throw new Error(data?.details || data?.error || 'Failed to generate study artifacts.')
    }

    const updatedLecture = {
      ...currentLecture,
      quiz: generateQuiz ? (Array.isArray(data.quiz) ? data.quiz : []) : currentLecture.quiz,
      flashcards: generateFlashcards ? (Array.isArray(data.flashcards) ? data.flashcards : []) : currentLecture.flashcards,
      warnings: mergeUniqueStrings(currentLecture.warnings, data.warnings),
      metadata: {
        ...(currentLecture.metadata || {}),
        artifactContext
      }
    }

    setCurrentLecture(updatedLecture)
    setChatHistory((prev) => prev.map((item) => (item.id === updatedLecture.id ? updatedLecture : item)))

    return updatedLecture
  }

  return (
    <div className="app">
      <SkipLink targetId="main-content" />
      <Header />
      
      <div className="app-body" role="main" id="main-content">
        <SourcePanel 
          chatHistory={chatHistory} 
          selectedHistoryId={selectedHistoryId}
          onSelectChat={handleSelectChat}
          onSubmit={handleGenerateLecture}
          isLoading={isLoading}
          loadingStage={loadingStage}
        />
        
        <VideoStage 
          lecture={currentLecture}
          isLoading={isLoading}
          loadingStage={loadingStage}
          loadingStages={loadingStages}
          error={requestError}
        />
        
        <LearningTools 
          lecture={currentLecture}
          onGenerateArtifacts={handleGenerateArtifacts}
        />
      </div>
    </div>
  )
}

export default App
