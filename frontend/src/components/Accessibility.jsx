/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useCallback } from 'react'

/**
 * Announce message to screen readers
 */
export function useAnnounce() {
  const regionRef = useRef(null)

  useEffect(() => {
    // Create live region if it doesn't exist
    let region = document.getElementById('live-region')
    if (!region) {
      region = document.createElement('div')
      region.id = 'live-region'
      region.setAttribute('role', 'status')
      region.setAttribute('aria-live', 'polite')
      region.setAttribute('aria-atomic', 'true')
      region.className = 'sr-only'
      document.body.appendChild(region)
    }
    regionRef.current = region

    return () => {
      // Don't remove on unmount - other components may use it
    }
  }, [])

  const announce = useCallback((message, priority = 'polite') => {
    if (regionRef.current) {
      regionRef.current.setAttribute('aria-live', priority)
      regionRef.current.textContent = ''
      // Small delay to ensure screen readers pick up the change
      setTimeout(() => {
        if (regionRef.current) {
          regionRef.current.textContent = message
        }
      }, 100)
    }
  }, [])

  return announce
}

/**
 * Trap focus within a container (for modals, dialogs)
 */
export function useFocusTrap(isActive = true) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!isActive || !containerRef.current) return undefined

    const container = containerRef.current
    const focusableSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'textarea:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(', ')

    const focusableElements = container.querySelectorAll(focusableSelector)
    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]

    // Focus first element on mount
    firstElement?.focus()

    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault()
          lastElement?.focus()
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault()
          firstElement?.focus()
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [isActive])

  return containerRef
}

/**
 * Detect keyboard navigation mode
 */
export function useKeyboardNav() {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Tab') {
        document.body.setAttribute('data-keyboard-nav', 'true')
      }
    }

    const handleMouseDown = () => {
      document.body.removeAttribute('data-keyboard-nav')
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleMouseDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [])
}

/**
 * Skip Link Component
 */
export function SkipLink({ targetId = 'main-content', children = 'Skip to main content' }) {
  return (
    <a href={`#${targetId}`} className="skip-link">
      {children}
    </a>
  )
}

/**
 * Live Region Component (for announcements)
 */
export function LiveRegion({ message, priority = 'polite' }) {
  return (
    <div
      role="status"
      aria-live={priority}
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  )
}

export default {
  useAnnounce,
  useFocusTrap,
  useKeyboardNav,
  SkipLink,
  LiveRegion
}
