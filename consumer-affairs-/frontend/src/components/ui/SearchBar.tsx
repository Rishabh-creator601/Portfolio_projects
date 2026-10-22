'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

interface SearchBarProps {
  onSearch: (value: string) => void;
  placeholder?: string;
  delay?: number;
  children?: React.ReactNode;
}

export function SearchBar({ onSearch, placeholder = 'Search...', delay = 300, children }: SearchBarProps) {
  const [value, setValue] = useState('');
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  useEffect(() => {
    const handler = setTimeout(() => onSearchRef.current(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return (
    <div className="flex w-full flex-col items-start gap-3 sm:flex-row sm:items-center">
      <div className="relative w-full flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-600"
          aria-hidden="true"
        />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="input pl-10 pr-10"
        />
        {value && (
          <button
            type="button"
            onClick={() => setValue('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-cyan-50 hover:text-cyan-700"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {children && <div className="flex w-full gap-2 sm:w-auto">{children}</div>}
    </div>
  );
}

export default SearchBar;
