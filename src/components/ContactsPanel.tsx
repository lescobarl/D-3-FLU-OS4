// ============================================================
// ContactsPanel — Agenda de contactos (Fase 6, Módulo I)
// ------------------------------------------------------------
// Componente presentacional controlado: recibe participantes,
// contactos, cumpleaños próximos y callbacks desde App (que usa
// useContacts) y renderiza:
//   - formulario de alta (nombre, teléfono, correo, relación,
//     cumpleaños, vínculo opcional a participante, notas)
//   - cumpleaños próximos dentro de la ventana configurada (B9)
//   - agenda ordenada por nombre con borrado
//
// Cumple:
//   - Rule #1: NO HARDCODE — etiquetas de FLU_CONFIG.contacts.ui
//     y ventana de cumpleaños de FLU_CONFIG.contacts
//   - Módulo I: agenda con cumpleaños y vínculo a participantes
// ============================================================
import { useState } from 'react';
import type { FormEvent } from 'react';
import { FLU_CONFIG } from '../voice/api/config';
import type { ContactRecord, ParticipantRecord } from '../core/db/fluDatabase';
import type { BirthdayContact, ContactInput } from '../core/contacts/contactService';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { ParticipantSelect } from './ParticipantSelect';
import { SettingsPanelShell } from './SettingsPanelShell';
import { SettingsTextField } from './SettingsTextField';

export interface ContactsPanelProps {
  participants: ParticipantRecord[];
  contacts: ContactRecord[];
  birthdayNear: BirthdayContact[];
  loading: boolean;
  onAdd: (input: ContactInput) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

export function ContactsPanel({
  participants,
  contacts,
  birthdayNear,
  loading,
  onAdd,
  onRemove,
}: ContactsPanelProps) {
  const config = FLU_CONFIG.contacts || {};
  const ui = config.ui || {};
  const birthdayWindowDays =
    typeof config.birthdayWindowDays === 'number' ? config.birthdayWindowDays : 7;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState('');
  const [birthday, setBirthday] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [notes, setNotes] = useState('');
  const { busy, run } = useAsyncAction('[ContactsPanel]');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    const participant = participants.find((p) => p.id === participantId);
    const result = await run(() =>
      onAdd({
        name: name.trim(),
        phone: phone.trim() ? phone.trim() : undefined,
        email: email.trim() ? email.trim() : undefined,
        relationship: relationship.trim() ? relationship.trim() : undefined,
        birthday: birthday || undefined,
        participantId: participantId || undefined,
        participantName: participant?.name,
        notes: notes.trim() ? notes.trim() : undefined,
      }),
    );
    if (!result.ok) return;
    setName('');
    setPhone('');
    setEmail('');
    setRelationship('');
    setBirthday('');
    setParticipantId('');
    setNotes('');
  };

  const handleRemove = (id: string) => {
    void run(() => onRemove(id), `remove:${id}`);
  };

  const birthdayLabel = (item: BirthdayContact): string => {
    const days = item.daysUntil;
    if (days === 0) return ui.todayLabel || '¡Hoy!';
    if (days === 1) return ui.tomorrowLabel || 'Mañana';
    return `${ui.inDaysLabel || 'En'} ${days} ${days === 1 ? (ui.dayLabel || 'día') : (ui.daysLabel || 'días')}`;
  };

  return (
    <SettingsPanelShell title={ui.panelTitle || 'Agenda de contactos'}>
        {/* Alta de contacto */}
        <form className="flu-settings-section" onSubmit={handleSubmit}>
          <div className="flu-settings-section__body">
            <SettingsTextField
              label={ui.nameLabel || 'Nombre'}
              value={name}
              onChange={setName}
              placeholder={ui.namePlaceholder || 'Nombre del contacto'}
              ariaLabel={ui.nameLabel || 'Nombre'}
              testId="contacts-add-name"
              disabled={busy}
            />
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.phoneLabel || 'Teléfono'}</span>
              <input
                type="text"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder={ui.phonePlaceholder || 'Teléfono (opcional)'}
                aria-label={ui.phoneLabel || 'Teléfono'}
                data-testid="contacts-add-phone"
                disabled={busy}
              />
            </label>
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.emailLabel || 'Correo'}</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={ui.emailPlaceholder || 'Correo (opcional)'}
                aria-label={ui.emailLabel || 'Correo'}
                data-testid="contacts-add-email"
                disabled={busy}
              />
            </label>
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.relationshipLabel || 'Relación'}</span>
              <input
                type="text"
                value={relationship}
                onChange={(event) => setRelationship(event.target.value)}
                placeholder={ui.relationshipPlaceholder || 'Familiar, amigo… (opcional)'}
                aria-label={ui.relationshipLabel || 'Relación'}
                data-testid="contacts-add-relationship"
                disabled={busy}
              />
            </label>
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.birthdayLabel || 'Cumpleaños'}</span>
              <input
                type="date"
                value={birthday}
                onChange={(event) => setBirthday(event.target.value)}
                aria-label={ui.birthdayLabel || 'Cumpleaños'}
                data-testid="contacts-add-birthday"
                disabled={busy}
              />
            </label>
            <ParticipantSelect
              value={participantId}
              onChange={setParticipantId}
              participants={participants}
              ui={ui}
              testId="contacts-add-participant"
              disabled={busy}
              emptyFallback="— Ninguno —"
            />
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.notesLabel || 'Notas'}</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={ui.notesPlaceholder || 'Notas (opcional)'}
                aria-label={ui.notesLabel || 'Notas'}
                data-testid="contacts-add-notes"
                disabled={busy}
                rows={2}
              />
            </label>
            <button
              type="submit"
              className="flu-settings-image-config__field--stacked"
              data-testid="contacts-add-submit"
              disabled={busy || !name.trim()}
            >
              {ui.addLabel || 'Agregar contacto'}
            </button>
          </div>
        </form>

        {/* Cumpleaños próximos (B9) */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading" data-testid="contacts-birthday-near">
              {ui.birthdayNearLabel || `Cumpleaños próximos (${birthdayWindowDays} días)`}
            </h4>
            {loading ? (
              <p className="flu-settings-image-config__hint">…</p>
            ) : birthdayNear.length === 0 ? (
              <p className="flu-settings-image-config__hint">
                {ui.emptyBirthdayNear || 'No hay cumpleaños en la ventana.'}
              </p>
            ) : (
              <ul className="flu-reminders-list" data-testid="contacts-birthday-list">
                {birthdayNear.map((item) => (
                  <li
                    key={item.record.id}
                    className="flu-reminders-item"
                    data-testid={`contacts-birthday-item-${item.record.id}`}
                  >
                    <div className="flu-reminders-item__info">
                      <span className="flu-reminders-item__text">
                        {item.record.name}
                        <span className="flu-reminders-item__when">
                          {item.nextBirthday} · {birthdayLabel(item)}
                        </span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Agenda de contactos */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading">{ui.listLabel || 'Contactos'}</h4>
            {loading ? (
              <p className="flu-settings-image-config__hint">…</p>
            ) : contacts.length === 0 ? (
              <p className="flu-settings-image-config__hint">
                {ui.emptyState || 'Aún no hay contactos.'}
              </p>
            ) : (
              <ul className="flu-reminders-list" data-testid="contacts-list">
                {contacts.map((contact) => (
                  <li
                    key={contact.id}
                    className="flu-reminders-item"
                    data-testid={`contacts-item-${contact.id}`}
                  >
                    <div className="flu-reminders-item__info">
                      <span className="flu-reminders-item__text">
                        {contact.name}
                        {contact.favorite ? ` ${ui.favoriteMark || '★'}` : ''}
                        <span className="flu-reminders-item__when">
                          {[
                            contact.relationship,
                            contact.phone,
                            contact.birthday,
                            contact.participantName || contact.participantId,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      {contact.email ? (
                        <span className="flu-reminders-item__when">{contact.email}</span>
                      ) : null}
                      {contact.notes ? (
                        <span className="flu-reminders-item__when">{contact.notes}</span>
                      ) : null}
                    </div>
                    <div className="flu-habits-actions">
                      <button
                        type="button"
                        data-testid={`contacts-remove-${contact.id}`}
                        onClick={() => handleRemove(contact.id)}
                      >
                        {ui.removeLabel || 'Eliminar'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
    </SettingsPanelShell>
  );
}
