// ============================================================
// ContactsPanel — Contactos dentro del panel HOY (sección compacta)
// ------------------------------------------------------------
// Presentacional controlado: recibe participantes, contactos,
// cumpleaños y callbacks desde App. La navegación imita Notas:
// fila compacta, título, detalle al expandir y acciones al lado.
// En desarrollo y sin contactos muestra 2 ejemplos para ver el
// diseño; en test/producción no inventa datos.
// ============================================================
import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { FLU_CONFIG } from '../voice/api/config';
import type { ContactRecord, ParticipantRecord } from '../core/db/fluDatabase';
import type { BirthdayContact, ContactInput } from '../core/contacts/contactService';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { ParticipantSelect } from './ParticipantSelect';

export interface ContactsPanelProps {
  participants: ParticipantRecord[];
  contacts: ContactRecord[];
  birthdayNear: BirthdayContact[];
  loading: boolean;
  onAdd: (input: ContactInput) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

const SHOW_DEMO_CONTACTS = import.meta.env.DEV && import.meta.env.MODE !== 'test';

const DEMO_CONTACTS = [
  { id: 'demo-1', name: 'Ana', relationship: 'Hermana', phone: '555 123 4567', email: 'ana@ejemplo.com', birthday: '1990-04-12', participantName: 'Familia', favorite: true, createdAt: 2 },
  { id: 'demo-2', name: 'Beto', relationship: 'Amigo', phone: '555 987 6543', email: 'beto@ejemplo.com', favorite: false, createdAt: 1 },
] as unknown as ContactRecord[];

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
  const [query, setQuery] = useState('');
  const [relationshipFilter, setRelationshipFilter] = useState('all');
  const [sort, setSort] = useState<'name' | 'recent'>('name');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { busy, run } = useAsyncAction('[ContactsPanel]');

  const demoMode = !loading && contacts.length === 0 && SHOW_DEMO_CONTACTS;
  const sourceContacts = demoMode ? DEMO_CONTACTS : contacts;

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
      }),
    );
    if (!result.ok) return;
    setName('');
    setPhone('');
    setEmail('');
    setRelationship('');
    setBirthday('');
    setParticipantId('');
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

  const relationships = useMemo(
    () => Array.from(new Set(sourceContacts.map((contact) => contact.relationship).filter(Boolean))),
    [sourceContacts],
  );

  const visibleContacts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = sourceContacts.filter((contact) => {
      if (relationshipFilter !== 'all' && contact.relationship !== relationshipFilter) return false;
      if (!needle) return true;
      return [contact.name, contact.phone, contact.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
    return [...filtered].sort((a, b) => {
      if (sort === 'recent') return (b.createdAt || 0) - (a.createdAt || 0);
      return a.name.localeCompare(b.name);
    });
  }, [sourceContacts, query, relationshipFilter, sort]);

  return (
    <div className="flu-contacts" data-testid="contacts-panel" aria-label={ui.panelTitle || 'Contactos'}>
      <div className="flu-contacts__toolbar">
        <input
          type="search"
          className="flu-contacts__search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={ui.searchPlaceholder || 'Buscar contacto…'}
          aria-label={ui.searchPlaceholder || 'Buscar contactos'}
          data-testid="contacts-search"
        />
        <select
          className="flu-contacts__select"
          value={relationshipFilter}
          onChange={(event) => setRelationshipFilter(event.target.value)}
          aria-label={ui.filterRelationshipLabel || 'Filtrar por relación'}
          data-testid="contacts-filter-relationship"
        >
          <option value="all">{ui.allRelationships || 'Todas'}</option>
          {relationships.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          className="flu-contacts__select"
          value={sort}
          onChange={(event) => setSort(event.target.value as 'name' | 'recent')}
          aria-label={ui.sortLabel || 'Ordenar contactos'}
          data-testid="contacts-sort"
        >
          <option value="name">{ui.sortName || 'Nombre'}</option>
          <option value="recent">{ui.sortRecent || 'Recientes'}</option>
        </select>
        <span className="flu-contacts__count">
          {visibleContacts.length}/{sourceContacts.length}
        </span>
      </div>

      {birthdayNear.length > 0 && (
        <div className="flu-contacts__birthdays" data-testid="contacts-birthday-near">
          <span className="flu-contacts__birthdays-title">
            {ui.birthdayNearLabel || `Cumpleaños (${birthdayWindowDays} días)`}
          </span>
          <ul className="flu-contacts__birthdays-list" data-testid="contacts-birthday-list">
            {birthdayNear.map((item) => (
              <li key={item.record.id} data-testid={`contacts-birthday-item-${item.record.id}`}>
                {item.record.name} · {birthdayLabel(item)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="flu-contacts__form-wrap">
        <summary className="flu-contacts__form-summary">{ui.addLabel || 'Agregar contacto'}</summary>
        <form className="flu-contacts__form" onSubmit={handleSubmit}>
          <label className="flu-contacts__field">
            <span>{ui.nameLabel || 'Nombre'}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={ui.namePlaceholder || 'Nombre del contacto'}
              aria-label={ui.nameLabel || 'Nombre'}
              data-testid="contacts-add-name"
              disabled={busy}
            />
          </label>
          <label className="flu-contacts__field">
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
          <label className="flu-contacts__field">
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
          <label className="flu-contacts__field">
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
          <label className="flu-contacts__field">
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
            emptyFallback="Ninguno"
          />
          <button
            type="submit"
            className="flu-contacts__submit"
            data-testid="contacts-add-submit"
            disabled={busy || !name.trim()}
          >
            {ui.saveContactLabel || 'Guardar contacto'}
          </button>
        </form>
      </details>

      {loading ? (
        <p className="hoy-panel__empty">…</p>
      ) : visibleContacts.length === 0 ? (
        <p className="hoy-panel__empty">
          {sourceContacts.length === 0 ? (ui.emptyState || 'Aún no hay contactos.') : (ui.noResults || 'Sin resultados.')}
        </p>
      ) : (
        <ul className="flu-contacts__list" data-testid="contacts-list">
          {visibleContacts.map((contact) => {
            const isDemo = contact.id.startsWith('demo-');
            const expanded = expandedId === contact.id;
            return (
              <li key={contact.id} className="flu-contacts__row" data-testid={`contacts-item-${contact.id}`}>
                <span className={`flu-contacts__dot${contact.favorite ? ' flu-contacts__dot--fav' : ''}`} />
                <div className="flu-contacts__body">
                  <button
                    type="button"
                    className="flu-contacts__name"
                    onClick={() => setExpandedId(expanded ? null : contact.id)}
                    aria-expanded={expanded}
                  >
                    {contact.name}
                    {contact.favorite ? ` ${ui.favoriteMark || '★'}` : ''}
                    {isDemo ? <span className="flu-contacts__demo">ejemplo</span> : null}
                  </button>
                  <span className="flu-contacts__meta">
                    {[contact.relationship, contact.phone].filter(Boolean).join(' · ')}
                  </span>
                  {expanded ? (
                    <div className="flu-contacts__detail">
                      {contact.email ? <span>{contact.email}</span> : null}
                      {contact.birthday ? <span>{ui.birthdayLabel || 'Cumpleaños'}: {contact.birthday}</span> : null}
                      {contact.participantName || contact.participantId ? (
                        <span>{ui.columnParticipant || 'Participante'}: {contact.participantName || contact.participantId}</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {!isDemo && (
                  <button
                    type="button"
                    className="flu-contacts__remove"
                    data-testid={`contacts-remove-${contact.id}`}
                    onClick={() => handleRemove(contact.id)}
                    disabled={busy}
                    aria-label={ui.removeLabel || 'Eliminar'}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
