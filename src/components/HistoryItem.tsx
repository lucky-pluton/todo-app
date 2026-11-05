import { useState } from 'react';
import type { HistoryEntry } from '../types';
import { commentDateFormatter, formatDateTime } from '../format';
import {
  CalendarIcon,
  ChatIcon,
  CheckIcon,
  ChevronIcon,
  UserIcon,
  UsersIcon,
} from './icons';

interface HistoryItemProps {
  entry: HistoryEntry;
}

export default function HistoryItem({ entry }: HistoryItemProps) {
  const [open, setOpen] = useState(false);

  const completed = formatDateTime(entry.completedAt);
  const created = formatDateTime(entry.createdAt);
  const deadline = entry.dueAt ? formatDateTime(entry.dueAt) : null;

  const dueTime = entry.dueAt ? new Date(entry.dueAt).getTime() : null;
  const completedTime = new Date(entry.completedAt).getTime();
  const hasDeadline = dueTime !== null && !Number.isNaN(dueTime);
  const late =
    hasDeadline && !Number.isNaN(completedTime) && completedTime > dueTime;

  const updatesId = `history-updates-${entry.id}`;

  return (
    <li className="history-item">
      <span className="history-check" aria-hidden="true">
        <CheckIcon />
      </span>

      <div className="history-body">
        <span className="history-text">{entry.text}</span>
        <span className="history-date">
          {completed ? `Completed ${completed}` : 'Completed'}
        </span>

        <div className="history-meta">
          {deadline && (
            <span className="history-chip">
              <CalendarIcon />
              Deadline: {deadline}
            </span>
          )}
          {hasDeadline && (
            <span className={`history-chip ${late ? 'late' : 'success'}`}>
              {late ? 'Completed late' : 'Completed on time'}
            </span>
          )}
          {entry.author && (
            <span className="history-chip" title={`Added by ${entry.author.email}`}>
              <UserIcon />
              {entry.author.name}
            </span>
          )}
          {entry.assignee && (
            <span className="history-chip" title={`Assigned to ${entry.assignee.email}`}>
              <UsersIcon />
              {entry.assignee.name}
            </span>
          )}
        </div>

        <span className="history-sub">
          Added {created ?? 'unknown'} · {entry.progress}% complete
        </span>

        {entry.comments.length > 0 ? (
          <button
            type="button"
            className="updates-toggle history-updates-toggle"
            aria-expanded={open}
            aria-controls={updatesId}
            onClick={() => setOpen((value) => !value)}
          >
            <ChatIcon />
            {entry.comments.length} update{entry.comments.length === 1 ? '' : 's'}
            <span className="chevron">
              <ChevronIcon />
            </span>
          </button>
        ) : (
          <span className="history-no-updates">No progress updates</span>
        )}

        {open && (
          <ul className="comment-list history-comments" id={updatesId}>
            {entry.comments.map((comment) => (
              <li key={comment.id} className="comment">
                <div className="comment-head">
                  {comment.author && (
                    <span className="comment-author">{comment.author.name}</span>
                  )}
                  {comment.progress !== null && (
                    <span className="comment-progress">{comment.progress}%</span>
                  )}
                  <span className="comment-date">
                    {commentDateFormatter.format(new Date(comment.createdAt))}
                  </span>
                </div>
                {comment.text && <p>{comment.text}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
