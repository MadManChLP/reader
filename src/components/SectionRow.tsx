import React, { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface SectionRowProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export const SectionRow: React.FC<SectionRowProps> = ({ title, icon, children }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScrollability = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
    }
  };

  useEffect(() => {
    checkScrollability();
    const scrollEl = scrollRef.current;
    if (scrollEl) {
      scrollEl.addEventListener('scroll', checkScrollability);
      // Also check on resize
      const resizeObserver = new ResizeObserver(checkScrollability);
      resizeObserver.observe(scrollEl);
      return () => {
        scrollEl.removeEventListener('scroll', checkScrollability);
        resizeObserver.disconnect();
      };
    }
  }, []);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const { current } = scrollRef;
      const scrollAmount = current.clientWidth * 0.8;
      current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className="flex flex-col gap-3 py-4">
      {/* Header */}
      <div className="flex items-center justify-between px-8 phone:px-4">
        <h2 className="text-xl phone:text-lg font-semibold text-white flex items-center gap-2">
          {icon && <span className="text-theme-400">{icon}</span>}
          {title}
        </h2>
      </div>

      {/* Scrollable Content with Hover Arrows */}
      <div
        className="relative group/row"
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
          <div className="p-2 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-sm transition-colors shadow-lg group-hover/row:scale-110">
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
          <div className="p-2 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-sm transition-colors shadow-lg group-hover/row:scale-110">
            <ChevronRight size={22} className="text-white" />
          </div>
        </button>

        {/* Scrollable Container - Hide Scrollbar */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto px-8 phone:px-4 pb-4 snap-x scroll-smooth scrollbar-hide"
        >
          {children}
        </div>
      </div>
    </div>
  );
};
