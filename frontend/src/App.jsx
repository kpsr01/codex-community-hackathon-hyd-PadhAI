import { useState } from 'react'
import './App.css'
import Sidebar from './components/Sidebar'
import VideoPlayer from './components/VideoPlayer'
import ChatPanel from './components/ChatPanel'

function App() {
  const [currentVideo, setCurrentVideo] = useState(null)
  const [chatHistory, setChatHistory] = useState([])
  const [isLoading, setIsLoading] = useState(false)

  const handleGenerateLecture = async (prompt) => {
    setIsLoading(true)
    
    try {
      const response = await fetch('http://localhost:3001/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      })

      const data = await response.json()
      
      if (data.success) {
        setCurrentVideo({
          url: `http://localhost:3001${data.videoUrl}`,
          narration: data.narration,
            manimCode: data.manimCode,
            scenes: data.scenes || []
        })
        
        // Add to chat history
        setChatHistory(prev => [...prev, {
          id: Date.now(),
          prompt,
          timestamp: new Date().toLocaleTimeString(),
          videoUrl: data.videoUrl
        }])
      }
    } catch (error) {
      console.error('Error generating lecture:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="app">
      <div className="app-header">
        <div className="brand">
          <div className="logo-mark">
            <img src="/padhai-logo.svg" alt="PadhAI logo" className="logo-img" />
          </div>
          <div className="brand-text">
            <h1>PadhAI</h1>
            <span className="tagline">Adaptive AI Lectures</span>
          </div>
        </div>
        <div className="header-actions">
          <span className="beta-pill">BETA</span>
        </div>
      </div>
      
      <div className="app-body">
        <Sidebar 
          chatHistory={chatHistory} 
          onSelectChat={(chat) => {
            setCurrentVideo({
              url: `http://localhost:3001${chat.videoUrl}`,
              narration: '',
              manimCode: '',
              scenes: []
            })
          }}
        />
        
        <VideoPlayer 
          video={currentVideo} 
          isLoading={isLoading}
        />
        
        <ChatPanel 
          onSubmit={handleGenerateLecture}
          isLoading={isLoading}
        />
      </div>
    </div>
  )
}

export default App
