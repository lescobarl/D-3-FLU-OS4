import { FLU_CONFIG } from '../lib/fluConfig'

export function PanelFrame({
  frameId,
  title,
  subtitle,
  expandedFrameId = '',
  onToggleExpand = () => {},
  headerActions = null,
  children,
  className = '',
  expandable = true,
}) {
  const expanded = expandable && expandedFrameId === frameId

  return (
    <section
      className={[
        'panel-frame',
        expanded ? 'panel-frame--expanded' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-frame-id={frameId}
    >
      <header className="panel-frame__header">
        <div className="panel-frame__header-titles">
          <strong className="panel-frame__title" title={title}>
            {title}
          </strong>
          {subtitle ? (
            <span className="panel-frame__subtitle">{subtitle}</span>
          ) : null}
        </div>
        <div className="panel-frame__header-actions">
          {headerActions}
          {expandable ? (
            <button
              type="button"
              className="panel-frame__toggle"
              onClick={() => onToggleExpand(frameId)}
              aria-label={expanded ? (FLU_CONFIG.ui.panel.restore || 'Restaurar') : (FLU_CONFIG.ui.panel.maximize || 'Maximizar')}
              title={expanded ? (FLU_CONFIG.ui.panel.restore || 'Restaurar') : (FLU_CONFIG.ui.panel.maximize || 'Maximizar')}
            >
              {expanded ? '⤡' : '⤢'}
            </button>
          ) : null}
        </div>
      </header>
      <div className="panel-frame__body">{children}</div>
    </section>
  )
}
