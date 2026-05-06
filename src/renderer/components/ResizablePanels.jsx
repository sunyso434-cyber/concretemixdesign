import React, { useRef, useState, useCallback, useEffect } from 'react'

const MIN_WIDTH_PX = 200
const STORAGE_KEY = 'panelWidths'

function loadWidths() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length === 2) return parsed
    }
  } catch (e) { /* ignore */ }
  return [20, 80]
}

function saveWidths(widths) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
  } catch (e) { /* ignore */ }
}

export default function ResizablePanels({ left, middle }) {
  const containerRef = useRef(null)
  const [widths, setWidths] = useState(loadWidths)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidths = useRef([20, 80])

  const onMouseDown = useCallback((e) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startWidths.current = [...widths]
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [widths])

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const containerWidth = rect.width
      if (containerWidth <= 0) return
      const dx = e.clientX - startX.current
      const dxPct = (dx / containerWidth) * 100
      const [l, m] = startWidths.current

      let newL = l + dxPct
      let newM = m - dxPct

      const minPct = (MIN_WIDTH_PX / containerWidth) * 100
      if (newL < minPct) { newM -= (minPct - newL); newL = minPct }
      if (newM < minPct) { newL -= (minPct - newM); newM = minPct }
      if (newL < minPct) newL = minPct
      if (newM < minPct) newM = minPct

      setWidths([newL, newM])
    }

    const onMouseUp = () => {
      if (dragging.current) {
        dragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        setWidths(current => { saveWidths(current); return current })
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  return (
    <div className="resizable-panels" ref={containerRef}>
      <div className="panel panel-left" style={{ width: `${widths[0]}%` }}>
        {left}
      </div>
      <div
        className="panel-handle"
        onMouseDown={onMouseDown}
      />
      <div className="panel panel-middle" style={{ width: `${widths[1]}%` }}>
        {middle}
      </div>
    </div>
  )
}
