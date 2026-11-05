/**
 * SettingsTextArea — área de texto ÚNICA de los paneles y formularios de ajustes.
 *
 * Dueño del par etiqueta + textarea con la clase de campo del panel.
 */
export interface SettingsTextAreaProps {
  /** Etiqueta visible. */
  label: string
  /** Valor actual. */
  value: string
  /** Cambio de valor. */
  onChange: (value: string) => void
  /** Texto de ayuda. */
  placeholder?: string
  /** Test id del textarea. */
  testId?: string
  /** Filas visibles. */
  rows?: number
  /** Deshabilita el campo. */
  disabled?: boolean
}

/**
 * Renderiza una etiqueta apilada con su textarea.
 * @param props Etiqueta, valor, cambio y atributos.
 * @returns Campo de texto multilínea.
 */
export function SettingsTextArea({
  label,
  value,
  onChange,
  placeholder,
  testId,
  rows = 3,
  disabled = false,
}: SettingsTextAreaProps) {
  return (
    <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
      <span>{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        data-testid={testId}
        disabled={disabled}
      />
    </label>
  )
}
