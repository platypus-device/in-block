import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

interface Option {
  value: string;
  label: string;
  category?: string; // Optional grouping category
}

interface CustomSelectProps {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  isDarkMode: boolean;
  className?: string;
  placeholder?: string;
  prefixIcon?: React.ReactNode;
  disabled?: boolean;
  minimal?: boolean;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  options,
  onChange,
  isDarkMode,
  className = "",
  placeholder = "Select...",
  prefixIcon,
  disabled = false,
  minimal = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.value === value);
  const displayLabel = selectedOption ? selectedOption.label : (value || placeholder);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Unified Glass Style Variables
  let triggerBg = isDarkMode ? 'bg-black/20 hover:bg-black/30 border-gray-700' : 'bg-white/50 hover:bg-white/80 border-gray-200';
  if (minimal) {
    triggerBg = isDarkMode ? 'bg-transparent hover:bg-white/10 border-transparent' : 'bg-transparent hover:bg-black/5 border-transparent';
  }

  const triggerText = minimal ? 'text-inherit' : (isDarkMode ? 'text-gray-200' : 'text-gray-700');

  const menuBg = isDarkMode ? 'bg-gray-800/90 backdrop-blur-xl border-gray-700' : 'bg-white/90 backdrop-blur-xl border-gray-200';
  const menuShadow = 'shadow-2xl';

  const itemHover = isDarkMode ? 'hover:bg-white/10 text-gray-300' : 'hover:bg-gray-100 text-gray-700';
  const itemActive = isDarkMode ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-50 text-blue-600';
  const categoryText = isDarkMode ? 'text-gray-500' : 'text-gray-400';

  // Group options by category
  let lastCategory = '';

  return (
    <div
      ref={containerRef}
      className={`relative ${className} ${disabled ? 'opacity-50' : ''}`}
      onMouseDown={(e) => e.stopPropagation()} // Stop propagation to prevent parent drag/click handlers
    >
      {/* Trigger */}
      <div
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`flex items-center justify-between cursor-pointer border rounded-lg px-2.5 py-1.5 transition-all w-full shadow-sm ${triggerBg} ${triggerText} ${disabled ? 'cursor-not-allowed' : ''} ${isOpen ? 'ring-2 ring-blue-500/20 border-blue-500/50' : ''}`}
        title={value}
      >
        <div className="flex items-center gap-2 truncate flex-1">
          {prefixIcon && <span className="opacity-50 flex-shrink-0">{prefixIcon}</span>}
          <span className="text-[10px] font-medium truncate opacity-90">
            {displayLabel}
          </span>
        </div>
        <ChevronDown className={`w-3 h-3 opacity-50 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </div>

      {/* Dropdown Menu */}
      {isOpen && !disabled && (
        <div className={`absolute left-0 top-full mt-1.5 w-full min-w-[180px] max-w-[260px] z-[200] rounded-xl border ${menuShadow} overflow-hidden animate-in fade-in zoom-in-95 duration-150 origin-top-left ${menuBg}`}>
          <div className="max-h-[240px] overflow-y-auto custom-scrollbar p-1.5">
            {options.length === 0 ? (
              <div className="px-2 py-3 text-[10px] text-center opacity-50">No options</div>
            ) : (
              options.map((option, index) => {
                const showHeader = option.category && option.category !== lastCategory;
                if (option.category) lastCategory = option.category;

                const isSelected = option.value === value;

                return (
                  <React.Fragment key={option.value}>
                    {showHeader && (
                      <div className={`px-2 py-1.5 mt-1 text-[9px] font-bold uppercase tracking-widest opacity-60 ${categoryText} ${index > 0 ? 'border-t border-dashed border-gray-500/20 pt-2' : ''}`}>
                        {option.category}
                      </div>
                    )}
                    <div
                      onClick={() => {
                        onChange(option.value);
                        setIsOpen(false);
                      }}
                      className={`flex items-center justify-between px-2.5 py-2 rounded-lg text-[11px] cursor-pointer transition-colors ${isSelected ? itemActive : itemHover}`}
                      title={option.label}
                    >
                      <span className="truncate mr-2 font-medium">{option.label}</span>
                      {isSelected && <Check className="w-3 h-3 opacity-80 flex-shrink-0" />}
                    </div>
                  </React.Fragment>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};