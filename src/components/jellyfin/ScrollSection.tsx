import React, { useRef, useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface ScrollSectionProps {
  title: string
  icon?: React.ReactNode
  rightAction?: React.ReactNode
  children: React.ReactNode
  className?: string
  // Fired while scrolling when the right end is near (~600px) — used for
  // infinite horizontal strips. The parent must guard against repeat calls.
  onEndReached?: () => void
}

export function ScrollSection({ title, icon, rightAction, children, className = '', onEndReached }: ScrollSectionProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isHovering, setIsHovering] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  // Ref so the scroll listener never has to re-attach when the callback changes
  const onEndReachedRef = useRef(onEndReached)
  onEndReachedRef.current = onEndReached

  const checkScrollability = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current
      setCanScrollLeft(scrollLeft > 0)
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1)
      if (scrollLeft > 0 && scrollWidth - clientWidth - scrollLeft < 600) {
        onEndReachedRef.current?.()
      }
    }
  }

  useEffect(() => {
    checkScrollability()
    const scrollEl = scrollRef.current
    if (scrollEl) {
      scrollEl.addEventListener('scroll', checkScrollability)
      const resizeObserver = new ResizeObserver(checkScrollability)
      resizeObserver.observe(scrollEl)
      return () => {
        scrollEl.removeEventListener('scroll', checkScrollability)
        resizeObserver.disconnect()
      }
    }
  }, [children])

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = scrollRef.current.clientWidth * 0.8
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      })
    }
  }

  return (
    <section className={`${className}`}>
      <div className="flex items-center justify-between mb-4 px-8 phone:px-4">
        <h2 className="text-xl phone:text-lg font-semibold flex items-center gap-2">
          {icon}
          {title}
        </h2>
        {rightAction}
      </div>

      <div
        className="relative"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* Left Arrow */}
        <button
          onClick={() => scroll('left')}
          className={`absolute left-0 top-0 bottom-4 z-10 w-16 flex items-center justify-start pl-2 phone:hidden
            bg-gradient-to-r from-gray-900 via-gray-900/90 to-transparent
            transition-opacity duration-200
            ${isHovering && canScrollLeft ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          aria-label="Scroll left"
        >
          <div className="p-2 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-sm transition-colors shadow-lg">
            <ChevronLeft size={22} className="text-white" />
          </div>
        </button>

        {/* Right Arrow */}
        <button
          onClick={() => scroll('right')}
          className={`absolute right-0 top-0 bottom-4 z-10 w-16 flex items-center justify-end pr-2 phone:hidden
            bg-gradient-to-l from-gray-900 via-gray-900/90 to-transparent
            transition-opacity duration-200
            ${isHovering && canScrollRight ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          aria-label="Scroll right"
        >
          <div className="p-2 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-sm transition-colors shadow-lg">
            <ChevronRight size={22} className="text-white" />
          </div>
        </button>

        {/* Scrollable Container */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto px-8 phone:px-4 pb-4 scroll-smooth scrollbar-hide"
        >
          {children}
        </div>
      </div>
    </section>
  )
}
