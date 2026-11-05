import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { TeamMember } from '../types';
import { CalendarIcon, PlusIcon, UsersIcon } from './icons';

interface TeamTaskFormProps {
  members: TeamMember[];
  currentUserEmail: string;
  onAdd: (text: string, dueAt: string | null, assigneeEmail: string) => Promise<boolean>;
}

export default function TeamTaskForm({
  members,
  currentUserEmail,
  onAdd,
}: TeamTaskFormProps) {
  const [text, setText] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [assigneeEmail, setAssigneeEmail] = useState(currentUserEmail);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const deadlineId = useId();
  const assigneeId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const value = text.trim();
    if (!value || submitting) {
      inputRef.current?.focus();
      return;
    }

    let dueIso: string | null = null;
    if (dueAt) {
      const dueDate = new Date(dueAt);
      if (!Number.isNaN(dueDate.getTime())) {
        dueIso = dueDate.toISOString();
      }
    }

    setSubmitting(true);
    const added = await onAdd(value, dueIso, assigneeEmail);
    setSubmitting(false);

    if (added) {
      setText('');
      setDueAt('');
    }
    inputRef.current?.focus();
  }

  return (
    <form className="add-card" onSubmit={handleSubmit} autoComplete="off">
      <div className="add-row">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="What should the team work on?"
          aria-label="New team task"
          maxLength={300}
        />
        <button
          type="submit"
          className="add-btn"
          aria-label="Add team task"
          disabled={submitting}
        >
          <PlusIcon />
        </button>
      </div>

      <div className="deadline-row">
        <label className="deadline-label" htmlFor={deadlineId}>
          <CalendarIcon />
          Deadline
        </label>
        <input
          id={deadlineId}
          type="datetime-local"
          value={dueAt}
          onChange={(event) => setDueAt(event.target.value)}
          aria-label="Team task deadline (optional)"
        />
        {dueAt && (
          <button type="button" className="clear-deadline" onClick={() => setDueAt('')}>
            Clear
          </button>
        )}

        <label className="deadline-label assignee-label" htmlFor={assigneeId}>
          <UsersIcon size={13} />
          Assign to
        </label>
        <select
          id={assigneeId}
          className="assignee-select"
          value={assigneeEmail}
          onChange={(event) => setAssigneeEmail(event.target.value)}
          disabled={submitting}
        >
          {members.map((member) => (
            <option key={member.email} value={member.email}>
              {member.email === currentUserEmail
                ? `${member.name ?? member.email} (you)`
                : member.name ?? member.email}
            </option>
          ))}
        </select>
      </div>
    </form>
  );
}
