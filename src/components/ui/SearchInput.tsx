import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { IconButton } from './IconButton'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  debounceMs?: number
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  debounceMs = 300,
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Sync from external value prop - legitimate controlled component pattern
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalValue(value)
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setLocalValue(newValue)

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      onChange(newValue)
    }, debounceMs)
  }

  return (
    <div className="relative">
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-theme-muted pointer-events-none"
        aria-hidden="true"
      />
      <input
        type="text"
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full pl-9 pr-9 py-2 text-sm bg-[var(--theme-surface-1)] border border-theme-border rounded-lg text-theme-primary placeholder:text-theme-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50"
      />
      {localValue && (
        <IconButton
          aria-label="Clear search"
          icon={<X />}
          variant="ghost"
          size="sm"
          onClick={() => {
            setLocalValue('')
            onChange('')
          }}
          // Float over the input on the right edge.
          className="absolute right-1.5 top-1/2 -translate-y-1/2"
        />
      )}
    </div>
  )
}
