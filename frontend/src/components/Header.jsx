import { Sparkles, Moon, Sun } from 'lucide-react'
import { useTheme } from '../ThemeContext'
import './Header.css'
function Header() {
  const { theme, toggleTheme } = useTheme()

  return (
    <header className="header">
      <div className="header-left">
        <div className="header-logo">
          <Sparkles size={20} />
        </div>
        <div className="header-brand">
          <h1 className="header-title">PadhAI</h1>
          <span className="header-subtitle">AI-Powered Learning</span>
        </div>
      </div>

      <div className="header-right">
        <span className="header-badge">
          <Sparkles size={12} />
          Beta
        </span>
        <button 
          className="header-icon-btn" 
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          onClick={toggleTheme}
        >
          {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
        </button>
      </div>
    </header>
  )
}

export default Header
