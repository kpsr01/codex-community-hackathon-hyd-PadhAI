import { useState } from 'react'
import { Upload, Sparkles, FileText, Image, Clock, X } from 'lucide-react'
import './SourcePanel.css'

const MAX_TOTAL_BYTES = 20 * 1024 * 1024
const SUPPORTED_TYPES = ['application/pdf', 'image/png', 'image/jpg', 'image/jpeg', 'image/webp']

function formatTime(value) {
  try {
    const date = new Date(value)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  } catch {
    return value
  }
}

function SourcePanel({
  chatHistory,
  selectedHistoryId,
  onSelectChat,
  onSubmit,
  isLoading,
  loadingStage
}) {
  const [prompt, setPrompt] = useState('')
  const [files, setFiles] = useState([])
  const [isDragging, setIsDragging] = useState(false)
  const [validationError, setValidationError] = useState('')
  const [generateQuiz, setGenerateQuiz] = useState(true)
  const [generateFlashcards, setGenerateFlashcards] = useState(true)

  const clearError = () => setValidationError('')

  const validateFileSet = (nextFiles) => {
    if (nextFiles.length === 0) return ''
    const pdfs = nextFiles.filter((file) => file.type === 'application/pdf')
    const images = nextFiles.filter((file) => file.type.startsWith('image/'))
    const unsupported = nextFiles.find((file) => !SUPPORTED_TYPES.includes(file.type))
    const totalBytes = nextFiles.reduce((acc, file) => acc + file.size, 0)

    if (unsupported) return `Unsupported file type: ${unsupported.type || unsupported.name}`
    if (pdfs.length > 0 && images.length > 0) return 'Choose either one PDF or up to five images.'
    if (pdfs.length > 1) return 'Only one PDF is allowed per request.'
    if (images.length > 5) return 'You can upload up to five images.'
    if (totalBytes > MAX_TOTAL_BYTES) return 'Total upload size exceeds 20 MB.'
    return ''
  }

  const applyFiles = (incomingFiles) => {
    const nextFiles = Array.from(incomingFiles || [])
    const error = validateFileSet(nextFiles)
    if (error) {
      setValidationError(error)
      return
    }
    clearError()
    setFiles(nextFiles)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (isLoading) return

    if (!prompt.trim() && files.length === 0) {
      setValidationError('Add a prompt or upload notes to continue.')
      return
    }

    clearError()
    onSubmit({ prompt, files, generateQuiz, generateFlashcards })

    if (!files.length) {
      setPrompt('')
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    if (isLoading) return
    applyFiles(e.dataTransfer.files)
  }

  const removeFile = (fileToRemove) => {
    clearError()
    setFiles((prev) => prev.filter((f) => !(f.name === fileToRemove.name && f.size === fileToRemove.size)))
  }

  return (
    <aside className="source-panel">
      <div className="source-panel-header">
        <h2 className="source-panel-title">Sources</h2>
        <p className="source-panel-subtitle">Add notes and prompts to generate lectures</p>
      </div>

      <div className="source-input-section">
        <form onSubmit={handleSubmit}>
          <textarea
            className="prompt-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you'd like to learn about..."
            disabled={isLoading}
            rows={4}
          />

          <div
            className={`upload-zone ${isDragging ? 'dragging' : ''}`}
            onDragEnter={() => setIsDragging(true)}
            onDragLeave={() => setIsDragging(false)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => document.getElementById('file-input').click()}
            role="button"
            tabIndex={0}
          >
            <Upload className="upload-zone-icon" size={28} />
            <p className="upload-zone-text">Drop files here or click to upload</p>
            <p className="upload-zone-hint">1 PDF or up to 5 images, max 20 MB</p>
            <input
              id="file-input"
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              onChange={(e) => applyFiles(e.target.files)}
              disabled={isLoading}
            />
          </div>

          {files.length > 0 && (
            <div className="file-chips">
              {files.map((file) => (
                <button
                  type="button"
                  key={`${file.name}_${file.size}`}
                  className="file-chip"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeFile(file)
                  }}
                  disabled={isLoading}
                >
                  {file.type === 'application/pdf' ? (
                    <FileText size={14} />
                  ) : (
                    <Image size={14} />
                  )}
                  <span className="file-chip-name">{file.name}</span>
                  <X size={14} className="file-chip-remove" />
                </button>
              ))}
            </div>
          )}

          <div className="options-row">
            <label className="option-toggle">
              <input
                type="checkbox"
                checked={generateQuiz}
                onChange={(e) => setGenerateQuiz(e.target.checked)}
                disabled={isLoading}
              />
              Generate Quiz
            </label>
            <label className="option-toggle">
              <input
                type="checkbox"
                checked={generateFlashcards}
                onChange={(e) => setGenerateFlashcards(e.target.checked)}
                disabled={isLoading}
              />
              Generate Flashcards
            </label>
          </div>

          {validationError && (
            <p className="validation-error">{validationError}</p>
          )}

          {isLoading && loadingStage && (
            <p className="loading-stage">
              <span className="spinner" style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid var(--accent-amber)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              {loadingStage}
            </p>
          )}

          <button type="submit" className="generate-btn" disabled={isLoading}>
            {isLoading ? (
              <>
                <span className="spinner" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Generate Lecture
              </>
            )}
          </button>
        </form>
      </div>

      <div className="history-section">
        <div className="history-header">
          <h3 className="history-title">
            <Clock size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Recent Lectures
          </h3>
        </div>

        {chatHistory.length === 0 ? (
          <div className="history-empty">
            <p>No lectures yet</p>
          </div>
        ) : (
          <div className="history-list">
            {chatHistory.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className={`history-item ${selectedHistoryId === chat.id ? 'selected' : ''}`}
                onClick={() => onSelectChat(chat)}
              >
                <div className="history-item-header">
                  <span className="history-item-title">{chat.title || chat.prompt}</span>
                  <span className={`history-item-badge ${(chat.sourceBadge || 'text').toLowerCase()}`}>
                    {chat.sourceBadge || 'Text'}
                  </span>
                </div>
                <span className="history-item-time">{formatTime(chat.timestamp)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="tips-section">
        <h4 className="tips-title">Tips</h4>
        <ul className="tips-list">
          <li>Use prompt + file for better focus</li>
          <li>Press Enter to submit, Shift+Enter for new line</li>
        </ul>
      </div>
    </aside>
  )
}

export default SourcePanel
