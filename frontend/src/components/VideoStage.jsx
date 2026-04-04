import { useRef } from 'react'
import { 
  Play, 
  Clock, 
  AlertCircle, 
  ArrowLeft, 
  Check,
  BookOpen
} from 'lucide-react'
import './VideoStage.css'

function VideoStage({ lecture, isLoading, loadingStage, loadingStages = [], error }) {
  const videoRef = useRef(null)

  const lectureVideo = lecture?.lecture || null

  const resolvedStages = Array.isArray(loadingStages) && loadingStages.length > 0
    ? loadingStages
    : [loadingStage || 'Generating lecture']
  const currentStageIndex = resolvedStages.findIndex((s) => s === loadingStage)

  // Format duration
  const formatDuration = (seconds) => {
    if (!seconds) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <main className="video-stage">
      <div className="video-stage-content">
        {/* Loading State */}
        {isLoading && (
          <div className="video-loading-state">
            <div className="loading-spinner-large" />
            <p className="loading-stage-text">{loadingStage || 'Generating lecture...'}</p>
            
            <div className="loading-stage-steps">
              {resolvedStages.map((stage, idx) => {
                const isActive = idx === currentStageIndex
                const isCompleted = idx < currentStageIndex
                
                return (
                  <div 
                    key={stage} 
                    className={`loading-step ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                  >
                    <span className="loading-step-icon">
                      {isCompleted ? (
                        <Check size={16} />
                      ) : isActive ? (
                        <span className="loading-step-icon spinner" />
                      ) : (
                        <span style={{ width: 16, height: 16 }} />
                      )}
                    </span>
                    {stage}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Error State */}
        {!isLoading && error && (
          <div className="video-error-state">
            <AlertCircle className="video-error-icon" />
            <h3 className="video-error-title">Generation Failed</h3>
            <p className="video-error-text">{error}</p>
          </div>
        )}

        {/* Video Player */}
        {!isLoading && !error && lectureVideo && (
          <div className="video-wrapper">
            <div className="video-container">
              <video 
                ref={videoRef} 
                controls 
                src={lectureVideo.url} 
                autoPlay 
                muted={false}
              >
                Your browser does not support the video tag.
              </video>
            </div>

            <div className="video-title-bar">
              <div>
                <h2 className="video-title">{lecture?.title || 'Generated Lecture'}</h2>
                <div className="video-meta">
                  <span className="video-meta-item">
                    <Clock size={14} />
                    {formatDuration(lecture?.totalDuration)}
                  </span>
                  <span className="video-meta-item">
                    <BookOpen size={14} />
                    {lecture?.quiz?.length || 0} questions
                  </span>
                </div>
                <p className="video-empty-hint" style={{ marginTop: 10 }}>
                  Narration is generated on the server and stitched into this lecture video.
                </p>
              </div>
            </div>

            {/* Warnings */}
            {Array.isArray(lecture?.warnings) && lecture.warnings.length > 0 && (
              <div className="video-warnings">
                <h4 className="video-warnings-title">
                  <AlertCircle size={16} />
                  Warnings
                </h4>
                <ul className="video-warnings-list">
                  {lecture.warnings.map((warning, idx) => (
                    <li key={`${warning}_${idx}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && !lectureVideo && (
          <div className="video-empty-state">
            <Play className="video-empty-icon" />
            <h2 className="video-empty-title">Ready to Learn</h2>
            <p className="video-empty-text">
              Upload your notes or describe a topic in the left panel to generate an AI-powered lecture with stitched narration.
            </p>
            <span className="video-empty-hint">
              <ArrowLeft size={16} />
              Start from the Sources panel
            </span>
          </div>
        )}
      </div>
    </main>
  )
}

export default VideoStage
