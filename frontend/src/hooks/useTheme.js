import { useState, useEffect } from 'react'

export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'system')

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    let effective = theme
    if (theme === 'system') {
      effective = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
    }
    root.classList.add(effective)
    localStorage.setItem('theme', theme)
  }, [theme])

  return { theme, setTheme }
}
