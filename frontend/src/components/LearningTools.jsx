import { useEffect, useMemo, useState } from 'react'
import { 
  FileText, 
  HelpCircle, 
  Layers, 
  ChevronLeft,
  ChevronRight,
  Check,
  RotateCcw,
  BookOpen
} from 'lucide-react'
import './LearningTools.css'

function LearningTools({ lecture, onGenerateArtifacts }) {
  const [activeTab, setActiveTab] = useState('transcript')
  const [quizAnswers, setQuizAnswers] = useState({})
  const [quizSubmitted, setQuizSubmitted] = useState(false)
  const [cardIndex, setCardIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [cardStatus, setCardStatus] = useState({})
  const [artifactLoading, setArtifactLoading] = useState({ quiz: false, flashcards: false })
  const [artifactError, setArtifactError] = useState('')

  const lectureData = lecture?.lecture || null
  const quiz = useMemo(() => (Array.isArray(lecture?.quiz) ? lecture.quiz : []), [lecture])
  const flashcards = useMemo(() => (Array.isArray(lecture?.flashcards) ? lecture.flashcards : []), [lecture])

  useEffect(() => {
    setQuizAnswers({})
    setQuizSubmitted(false)
    setCardIndex(0)
    setFlipped(false)
    setCardStatus({})
    setArtifactLoading({ quiz: false, flashcards: false })
    setArtifactError('')
    setActiveTab('transcript')
  }, [lecture?.id])

  const quizScore = useMemo(() => {
    if (!quizSubmitted) return null
    let correct = 0
    quiz.forEach((question, idx) => {
      const userAnswer = (quizAnswers[idx] || '').trim().toLowerCase()
      const actual = String(question.answer || '').trim().toLowerCase()
      if (userAnswer && userAnswer === actual) correct += 1
    })
    return { correct, total: quiz.length }
  }, [quiz, quizAnswers, quizSubmitted])

  const currentCard = flashcards[cardIndex] || null

  const tabs = [
    { id: 'transcript', label: 'Transcript', icon: FileText },
    { id: 'quiz', label: 'Quiz', icon: HelpCircle, count: quiz.length },
    { id: 'flashcards', label: 'Flashcards', icon: Layers, count: flashcards.length }
  ]

  const handleGenerateArtifact = async (artifactType) => {
    if (typeof onGenerateArtifacts !== 'function') return
    const isQuiz = artifactType === 'quiz'

    setArtifactError('')
    setArtifactLoading((prev) => ({
      ...prev,
      [artifactType]: true
    }))

    try {
      await onGenerateArtifacts({
        generateQuiz: isQuiz,
        generateFlashcards: !isQuiz
      })
    } catch (error) {
      setArtifactError(error?.message || 'Could not generate study material right now.')
    } finally {
      setArtifactLoading((prev) => ({
        ...prev,
        [artifactType]: false
      }))
    }
  }

  return (
    <aside className="learning-tools">
      <div className="learning-tools-header">
        <h2 className="learning-tools-title">Learning Tools</h2>
      </div>

      {/* Tab Navigation */}
      <nav className="tab-nav" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.icon size={14} />
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="tab-badge">{tab.count}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Tab Content */}
      <div className="tab-content">
        {/* Transcript Tab */}
        {activeTab === 'transcript' && (
          <div className="tab-panel transcript-panel">
            {lectureData?.narration ? (
              <p className="transcript-text">{lectureData.narration}</p>
            ) : (
              <div className="tab-empty">
                <FileText size={40} className="tab-empty-icon" />
                <p className="tab-empty-text">Transcript will appear here after generating a lecture.</p>
              </div>
            )}
          </div>
        )}

        {/* Quiz Tab */}
        {activeTab === 'quiz' && (
          <div className="tab-panel quiz-panel">
            {quiz.length === 0 ? (
              <div className="tab-empty">
                <HelpCircle size={40} className="tab-empty-icon" />
                <p className="tab-empty-text">Quiz was not generated for this lecture yet.</p>
                {lectureData && typeof onGenerateArtifacts === 'function' && (
                  <button
                    type="button"
                    className="tab-empty-action"
                    onClick={() => handleGenerateArtifact('quiz')}
                    disabled={artifactLoading.quiz}
                  >
                    {artifactLoading.quiz ? 'Generating Quiz...' : 'Generate Quiz'}
                  </button>
                )}
                {artifactError && (
                  <p className="tab-empty-error">{artifactError}</p>
                )}
              </div>
            ) : (
              <>
                {quizScore && (
                  <div className="quiz-progress">
                    <span className="quiz-progress-text">Your Score</span>
                    <span className="quiz-progress-score">
                      {quizScore.correct} / {quizScore.total}
                    </span>
                  </div>
                )}

                {quiz.map((question, idx) => (
                  <div key={`quiz_${idx}`} className="quiz-card">
                    <h4 className="quiz-question">
                      <span className="quiz-question-number">{idx + 1}</span>
                      {question.question}
                    </h4>

                    {Array.isArray(question.options) && question.options.length > 0 ? (
                      <div className="quiz-options">
                        {question.options.map((option, optionIdx) => (
                          <label
                            key={`opt_${idx}_${optionIdx}`}
                            className={`quiz-option ${quizAnswers[idx] === option ? 'selected' : ''} ${quizSubmitted ? 'disabled' : ''}`}
                          >
                            <input
                              type="radio"
                              name={`q_${idx}`}
                              value={option}
                              checked={quizAnswers[idx] === option}
                              onChange={(e) => setQuizAnswers((prev) => ({ ...prev, [idx]: e.target.value }))}
                              disabled={quizSubmitted}
                            />
                            {option}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <textarea
                        className="quiz-textarea"
                        value={quizAnswers[idx] || ''}
                        onChange={(e) => setQuizAnswers((prev) => ({ ...prev, [idx]: e.target.value }))}
                        disabled={quizSubmitted}
                        placeholder="Type your answer here..."
                        rows={3}
                      />
                    )}

                    {quizSubmitted && (
                      <div className="quiz-result">
                        <p className="quiz-result-answer">
                          <strong>Answer:</strong> {question.answer}
                        </p>
                        <p className="quiz-result-explanation">{question.explanation}</p>
                      </div>
                    )}
                  </div>
                ))}

                <div className="quiz-actions">
                  <button
                    type="button"
                    className="quiz-reveal-btn"
                    onClick={() => setQuizSubmitted(true)}
                    disabled={quizSubmitted}
                  >
                    <Check size={16} />
                    Reveal Answers
                  </button>
                  <button
                    type="button"
                    className="quiz-retry-btn"
                    onClick={() => {
                      setQuizAnswers({})
                      setQuizSubmitted(false)
                    }}
                  >
                    <RotateCcw size={16} />
                    Retry
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Flashcards Tab */}
        {activeTab === 'flashcards' && (
          <div className="tab-panel flashcards-panel">
            {flashcards.length === 0 ? (
              <div className="tab-empty">
                <Layers size={40} className="tab-empty-icon" />
                <p className="tab-empty-text">Flashcards were not generated for this lecture yet.</p>
                {lectureData && typeof onGenerateArtifacts === 'function' && (
                  <button
                    type="button"
                    className="tab-empty-action"
                    onClick={() => handleGenerateArtifact('flashcards')}
                    disabled={artifactLoading.flashcards}
                  >
                    {artifactLoading.flashcards ? 'Generating Flashcards...' : 'Generate Flashcards'}
                  </button>
                )}
                {artifactError && (
                  <p className="tab-empty-error">{artifactError}</p>
                )}
              </div>
            ) : (
              <>
                <div className="flashcard-container">
                  <div
                    className={`flashcard ${flipped ? 'flipped' : ''}`}
                    onClick={() => setFlipped((prev) => !prev)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setFlipped((prev) => !prev)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label="Flip flashcard"
                  >
                    <div className="flashcard-face front">
                      <span className="flashcard-label">{currentCard?.tag || 'Question'}</span>
                      <div className="flashcard-content">{currentCard?.front}</div>
                      <span className="flashcard-hint">Click to flip</span>
                    </div>
                    <div className="flashcard-face back">
                      <span className="flashcard-label">{currentCard?.sourceConcept || 'Answer'}</span>
                      <div className="flashcard-content">{currentCard?.back}</div>
                      <span className="flashcard-hint">Click to flip back</span>
                    </div>
                  </div>
                </div>

                <div className="flashcard-nav">
                  <button
                    type="button"
                    className="flashcard-nav-btn"
                    onClick={() => {
                      setCardIndex((prev) => Math.max(0, prev - 1))
                      setFlipped(false)
                    }}
                    disabled={cardIndex === 0}
                    aria-label="Previous card"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <span className="flashcard-counter">
                    {cardIndex + 1} / {flashcards.length}
                  </span>
                  <button
                    type="button"
                    className="flashcard-nav-btn"
                    onClick={() => {
                      setCardIndex((prev) => Math.min(flashcards.length - 1, prev + 1))
                      setFlipped(false)
                    }}
                    disabled={cardIndex >= flashcards.length - 1}
                    aria-label="Next card"
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>

                <div className="flashcard-status-actions">
                  <button
                    type="button"
                    className={`flashcard-status-btn ${cardStatus[cardIndex] === 'known' ? 'known' : ''}`}
                    onClick={() => setCardStatus((prev) => ({ ...prev, [cardIndex]: 'known' }))}
                  >
                    <Check size={16} />
                    Known
                  </button>
                  <button
                    type="button"
                    className={`flashcard-status-btn ${cardStatus[cardIndex] === 'review' ? 'review' : ''}`}
                    onClick={() => setCardStatus((prev) => ({ ...prev, [cardIndex]: 'review' }))}
                  >
                    <BookOpen size={16} />
                    Review Later
                  </button>
                </div>

                <div className="flashcard-progress">
                  <span>Current: {cardStatus[cardIndex] || 'Unmarked'}</span>
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </aside>
  )
}

export default LearningTools
