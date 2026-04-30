interface SelectOption {
  value: string
  label: string
}

interface FilterSelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  allowClear?: boolean
  'aria-label'?: string
}

export function FilterSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  allowClear = true,
  'aria-label': ariaLabel,
}: FilterSelectProps) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className="appearance-none w-full pl-3 pr-8 py-2 text-sm bg-[var(--theme-surface-1)] border border-theme-border rounded-lg text-theme-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50"
      >
        {allowClear && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-muted text-xs pointer-events-none" aria-hidden="true">
        ▾
      </span>
    </div>
  )
}
