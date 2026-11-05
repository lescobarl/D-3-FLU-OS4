/**
 * SettingsTextField — campo de texto ÚNICO de los paneles y formularios de ajustes.
 *
 * Dueño del par etiqueta + input con la clase de campo del panel. Los paneles de
 * contactos, participantes, compras y los editores de catálogo lo consumen.
 */
export interface SettingsTextFieldProps {
  /** Etiqueta visible del campo. */
  label: string
  /** Valor actual. */
  value: string
  /** Cambio de valor. */
  onChange: (value: string) => void
  /** Texto de ayuda del input. */
  placeholder?: string
  /** Test id del input. */
  testId?: string
  /** Etiqueta accesible cuando difiere de la visible. */
  ariaLabel?: string
  /** Tipo de input (por defecto texto). */
  type?: string
  /** Deshabilita el campo mientras se guarda. */
  disabled?: boolean
}

/**
 * Renderiza una etiqueta apilada con su input de texto.
 * @param props Etiqueta, valor, cambio y atributos del input.
 * @returns Campo de texto del panel de ajustes.
 */
export function SettingsTextField({
  label,
  value,
  onChange,
  placeholder,
  testId,
  ariaLabel,
  type = 'text',
  disabled = false,
}: SettingsTextFieldProps) {
  return (
    <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        data-testid={testId}
        disabled={disabled}
      />
    </label>
  )
}
