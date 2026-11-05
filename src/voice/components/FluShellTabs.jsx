import { FLU_CONFIG } from '../lib/fluConfig.js'

export function FluShellTabs({ activeTab, onTabChange, visibleIds }) {
  const items = FLU_CONFIG.ui.tabs.items
  // Filtrar por las pestañas visibles del ambiente activo (si se especifican)
  const visible =
    Array.isArray(visibleIds) && visibleIds.length > 0
      ? items.filter((item) => visibleIds.includes(item.id))
      : items

  return (
    <nav className="flu-shell-tabs" role="tablist" aria-label={FLU_CONFIG.ui.tabs.ariaLabel}>
      <div className="flu-shell-tabs__list">
        {visible.map((item) => {
          const isActive = activeTab === item.id
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`flu-tab-${item.id}`}
              aria-selected={isActive}
              aria-controls={`flu-tabpanel-${item.id}`}
              tabIndex={isActive ? 0 : -1}
              className={['flu-shell-tabs__tab', isActive ? 'is-active' : ''].filter(Boolean).join(' ')}
              onClick={() => onTabChange(item.id)}
            >
              <span className="flu-shell-tabs__label">{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export function FluTabPanel({ tabId, activeTab, className = '', children }) {
  const isActive = activeTab === tabId

  return (
    <section
      id={`flu-tabpanel-${tabId}`}
      role="tabpanel"
      aria-labelledby={`flu-tab-${tabId}`}
      hidden={!isActive}
      className={['flu-tab-panel', isActive ? 'is-active' : '', className].filter(Boolean).join(' ')}
    >
      {children}
    </section>
  )
}
