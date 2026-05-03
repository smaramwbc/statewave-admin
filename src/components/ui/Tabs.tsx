interface Tab {
  id: string
  label: string
  count?: number
}

interface TabsProps {
  tabs: Tab[]
  activeTab: string
  onTabChange: (tabId: string) => void
}

export function Tabs({ tabs, activeTab, onTabChange }: TabsProps) {
  // Horizontally scrollable on phones — four tabs ("Overview · Memories ·
  // Episodes · Sessions") plus their counts overflow at 320–430px and
  // were clipping the rightmost tab. The wrapper owns its own
  // overflow-x-auto so the page never inherits a scrollbar; -mx + px
  // bleed lets the scroll touch the screen edge so the last tab can
  // peek-and-pull. Native scrollbar hidden via the standard
  // `scrollbar-none` recipe (the inner UI surface is the affordance).
  return (
    <div
      className="flex gap-0.5 border-b border-theme-border overflow-x-auto whitespace-nowrap -mx-4 sm:mx-0 px-4 sm:px-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-pressed={tab.id === activeTab}
          onClick={() => onTabChange(tab.id)}
          className={`flex-shrink-0 px-4 min-h-11 py-2.5 text-sm font-medium transition-colors relative ${
            tab.id === activeTab
              ? 'text-theme-primary'
              : 'text-theme-muted hover:text-theme-secondary'
          }`}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={`ml-1.5 text-xs ${
                tab.id === activeTab ? 'text-accent' : 'text-theme-muted'
              }`}
            >
              {tab.count}
            </span>
          )}
          {tab.id === activeTab && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
          )}
        </button>
      ))}
    </div>
  )
}

interface TabPanelProps {
  children: React.ReactNode
  isActive: boolean
}

export function TabPanel({ children, isActive }: TabPanelProps) {
  if (!isActive) return null
  return <div className="py-4">{children}</div>
}
