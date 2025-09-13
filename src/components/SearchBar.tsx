import { useState, useMemo, useCallback } from 'react';
import Fuse from 'fuse.js';
import type { PolymarketEvent, SearchResult } from '../types/polymarket';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from './ui/command';

interface SearchBarProps {
  events: PolymarketEvent[];
  onEventSelect: (event: PolymarketEvent) => void;
}

const SearchBar: React.FC<SearchBarProps> = ({ events, onEventSelect }) => {
  const [searchValue, setSearchValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  // Configure Fuse.js for fuzzy search
  const fuse = useMemo(() => {
    return new Fuse(events, {
      keys: [
        { name: 'title', weight: 0.7 },
        { name: 'description', weight: 0.2 },
        { name: 'category', weight: 0.1 },
      ],
      threshold: 0.4,
      includeScore: true,
      includeMatches: true,
      minMatchCharLength: 1,
    });
  }, [events]);

  // Perform fuzzy search
  const searchResults = useMemo(() => {
    if (!searchValue.trim() || searchValue.length < 1) {
      return [];
    }
    return fuse.search(searchValue) as SearchResult[];
  }, [fuse, searchValue]);

  const handleInputChange = useCallback((value: string) => {
    setSearchValue(value);
    setIsOpen(value.length >= 1);
  }, []);

  const handleSelect = useCallback((event: PolymarketEvent) => {
    setSearchValue(event.title);
    setIsOpen(false);
    onEventSelect(event);
  }, [onEventSelect]);

  const handleInputFocus = useCallback(() => {
    if (searchValue.length >= 1) {
      setIsOpen(true);
    }
  }, [searchValue]);

  const handleInputBlur = useCallback(() => {
    // Delay closing to allow for click events
    setTimeout(() => setIsOpen(false), 300);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Prevent input from losing focus when clicking on dropdown
    e.preventDefault();
  }, []);

  return (
    <div className="relative">
      <Command className="rounded-lg border border-gray-800 bg-gray-900/50 backdrop-blur-sm">
        <CommandInput
          placeholder="Search events by title, description, or category..."
          value={searchValue}
          onValueChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          className="h-12 text-white placeholder:text-gray-400 border-0 focus:ring-0 bg-transparent"
        />
        {isOpen && (
          <CommandList 
            className="absolute top-full left-0 right-0 z-[9999] mt-1 max-h-80 overflow-auto rounded-lg border border-gray-800 bg-gray-900/95 backdrop-blur-sm shadow-2xl cmdk-list"
            onMouseDown={handleMouseDown}
          >
            {searchResults.length === 0 ? (
              <CommandEmpty className="py-6 text-center text-sm text-gray-400">
                No events found.
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {searchResults.slice(0, 10).map((result) => (
                  <CommandItem
                    key={result.item.id}
                    value={result.item.title}
                    onSelect={() => handleSelect(result.item)}
                    className="flex flex-col items-start gap-2 p-4 hover:bg-gray-800/50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-3 w-full">
                      <img
                        src={result.item.icon}
                        alt={result.item.title}
                        className="w-8 h-8 rounded-lg object-cover flex-shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/vite.svg';
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-medium text-sm truncate">
                          {result.item.title}
                        </div>
                        <div className="text-gray-400 text-xs mt-1">
                          {result.item.category} • Volume: ${result.item.volume.toLocaleString()}
                        </div>
                      </div>
                      {result.score && (
                        <div className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">
                          {Math.round((1 - result.score) * 100)}% match
                        </div>
                      )}
                    </div>
                    <div className="text-gray-300 text-xs line-clamp-2 w-full">
                      {result.item.description}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        )}
      </Command>
    </div>
  );
};

export default SearchBar;
