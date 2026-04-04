export const REQUEST_TIMEOUT_MS = 5 * 60 * 1000

export async function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => {
    controller.abort(new Error('Request timed out after 5 minutes.'))
  }, REQUEST_TIMEOUT_MS)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Request timed out after 5 minutes.')
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}
