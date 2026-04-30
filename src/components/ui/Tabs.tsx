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
  return (
    <div className="flex gap-0.5 border-b border-theme-border">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
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
