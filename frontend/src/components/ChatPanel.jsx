import { useState } from 'react'
import './ChatPanel.css'

function ChatPanel({ onSubmit, isLoading }) {
  const [prompt, setPrompt] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (prompt.trim() && !isLoading) {
      onSubmit(prompt.trim())
      setPrompt('')
    }
  }

  const handleKeyDown = (e) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
    // Allow Shift+Enter for new line (default textarea behavior)
    // No need to handle this explicitly as it's the default
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h3>Generate Lecture</h3>
      </div>
      
      <div className="chat-content">
        <form onSubmit={handleSubmit} className="chat-form">
          <div className="input-group">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter your lecture topic or prompt here... (e.g., 'Explain Newton's laws of motion with visual examples')&#10;&#10;💡 Press Enter to submit, Shift+Enter for new line"
              rows={6}
              disabled={isLoading}
            />
          </div>
          
          <div className="form-actions">
            <button 
              type="submit" 
              disabled={!prompt.trim() || isLoading}
              className="generate-btn"
            >
              {isLoading ? 'Generating...' : 'Generate Lecture'}
            </button>
          </div>
        </form>
        
        <div className="tips">
          <h4>💡 Tips for better lectures:</h4>
          <ul>
            <li>Be specific about the topic you want to learn</li>
            <li>Mention if you want mathematical equations or diagrams</li>
            <li>Include the difficulty level (beginner, intermediate, advanced)</li>
            <li>Examples: "Explain calculus derivatives with visual graphs" or "Physics of pendulum motion with animations"</li>
          </ul>
          
          <h4>⌨️ Keyboard shortcuts:</h4>
          <ul>
            <li><strong>Enter:</strong> Submit prompt</li>
            <li><strong>Shift + Enter:</strong> New line</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default ChatPanel
