import { useEffect, useRef } from 'react'
import './VideoPlayer.css'

function VideoPlayer({ video, isLoading }) {
  const videoRef = useRef(null)
  const timersRef = useRef([])
  const utterancesRef = useRef([])

  // Function to use browser TTS
  const cleanNarration = (text) => text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\n\n/g, '. ')
    .replace(/\n/g, ' ')
    .trim()

  const cancelScheduledSpeech = () => {
    timersRef.current.forEach(id => clearTimeout(id))
    timersRef.current = []
    window.speechSynthesis.cancel()
    utterancesRef.current = []
  }

  // Schedule timeline-based shots (if provided in video.scenes[].shots)
  const scheduleShots = () => {
    if (!video || !video.scenes || !Array.isArray(video.scenes)) return
    const flatShots = []
    video.scenes.forEach(scene => {
      if (Array.isArray(scene.shots)) {
        scene.shots.forEach(shot => {
          flatShots.push({
            scene: scene.scene_number,
            shot: shot.shot_number,
            start: shot.start_time_sec + (scene._scene_offset_sec || 0), // optional future global offset
            narration: shot.narration_clip
          })
        })
      }
    })
    if (flatShots.length === 0) return
    // Sort by start time
    flatShots.sort((a,b) => a.start - b.start)

    const baseTime = performance.now()
    const videoStartWallClock = baseTime
    const rate = 0.9

    flatShots.forEach(s => {
      const delayMs = s.start * 1000 - (videoRef.current?.currentTime || 0) * 1000
      if (delayMs < 0) return
      const id = setTimeout(() => {
        if (!videoRef.current || videoRef.current.paused) return
        if ('speechSynthesis' in window && s.narration) {
          const utter = new SpeechSynthesisUtterance(cleanNarration(s.narration))
          utter.rate = rate
          const voices = window.speechSynthesis.getVoices()
          const preferredVoice = voices.find(v => v.name.includes('Google') || v.name.includes('Microsoft') || v.lang.startsWith('en-US'))
          if (preferredVoice) utter.voice = preferredVoice
          utterancesRef.current.push(utter)
          window.speechSynthesis.speak(utter)
        }
      }, delayMs)
      timersRef.current.push(id)
    })
  }

  // Handle video events for synchronized narration
  useEffect(() => {
    cancelScheduledSpeech()
    if (video && videoRef.current) {
      const videoElement = videoRef.current

      const handlePlay = () => {
        cancelScheduledSpeech()
        scheduleShots()
      }

      const handlePause = () => {
        window.speechSynthesis.pause()
      }

      const handleSeek = () => {
        cancelScheduledSpeech()
        if (!videoElement.paused) scheduleShots()
      }

      const handleEnded = () => {
        cancelScheduledSpeech()
      }

      // Add event listeners
      videoElement.addEventListener('play', handlePlay)
      videoElement.addEventListener('pause', handlePause)
      videoElement.addEventListener('seeked', handleSeek)
      videoElement.addEventListener('ended', handleEnded)

      // Cleanup listeners
      return () => {
        videoElement.removeEventListener('play', handlePlay)
        videoElement.removeEventListener('pause', handlePause)
        videoElement.removeEventListener('seeked', handleSeek)
        videoElement.removeEventListener('ended', handleEnded)
        window.speechSynthesis.cancel()
        cancelScheduledSpeech()
      }
    }
  }, [video])

  return (
    <div className="video-player">
      <div className="video-header">
        <h3>Generated Lecture</h3>
      </div>
      
      <div className="video-content">
        {isLoading ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Generating your lecture...</p>
          </div>
        ) : video ? (
          <div className="video-container">
            <video 
              ref={videoRef}
              controls 
              width="100%" 
              height="600"
              src={video.url}
              autoPlay
              muted={false}
            >
              Your browser does not support the video tag.
            </video>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">🎬</div>
            <h3>No lecture selected</h3>
            <p>Enter a prompt in the chat panel to generate your first lecture!</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default VideoPlayer
