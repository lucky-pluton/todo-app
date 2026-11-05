import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Task, TaskComment } from '../types';
import { commentDateFormatter } from '../format';
import {
  CalendarIcon,
  ChatIcon,
  CheckIcon,
  ChevronIcon,
  TrashIcon,
  UserIcon,
  UsersIcon,
} from './icons';

const dueFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const dueTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

type DueTone = 'overdue' | 'today' | 'upcoming';

interface DueInfo {
  label: string;
  tone: DueTone;
}

function describeDue(dueAt: string): DueInfo | null {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;

  const now = new Date();
  const overdue = due.getTime() < now.getTime();
  const sameDay =
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate();

  if (sameDay) {
    return {
      label: `${overdue ? 'Overdue' : 'Due today'} · ${dueTimeFormatter.format(due)}`,
      tone: overdue ? 'overdue' : 'today',
    };
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow =
    due.getFullYear() === tomorrow.getFullYear() &&
    due.getMonth() === tomorrow.getMonth() &&
    due.getDate() === tomorrow.getDate();

  if (isTomorrow && !overdue) {
    return {
      label: `Due tomorrow · ${dueTimeFormatter.format(due)}`,
      tone: 'today',
    };
  }

  return {
    label: `${overdue ? 'Overdue' : 'Due'} · ${dueFormatter.format(due)}`,
    tone: overdue ? 'overdue' : 'upcoming',
  };
}

interface TaskItemProps {
  task: Task;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onAddComment: (taskId: string, text: string, progress: number) => Promise<boolean>;
  onDeleteComment: (taskId: string, commentId: string) => void;
  canComplete?: boolean;
  canDelete?: boolean;
  canDeleteComment?: (comment: TaskComment) => boolean;
}

export default function TaskItem({
  task,
  onComplete,
  onDelete,
  onAddComment,
  onDeleteComment,
  canComplete = true,
  canDelete = true,
  canDeleteComment,
}: TaskItemProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [draftProgress, setDraftProgress] = useState(task.progress);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    setDraftProgress(task.progress);
  }, [task.progress]);

  const author = task.author ?? null;
  const assignee = task.assignee ?? null;
  const due = task.dueAt ? describeDue(task.dueAt) : null;
  const hasProgress = task.progress > 0 || task.comments.length > 0;
  const canPost =
    !posting && (text.trim().length > 0 || draftProgress !== task.progress);
  const updatesId = `updates-${task.id}`;
  const canDeleteUpdate = canDeleteComment ?? (() => true);

  async function handlePost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canPost) return;

    setPosting(true);
    const posted = await onAddComment(task.id, text.trim(), draftProgress);
    setPosting(false);

    if (posted) {
      setText('');
    }
  }

  return (
    <li className={`task-item${open ? ' expanded' : ''}`}>
      <div className="task-top">
        <button
          type="button"
          className="check"
          title={
            canComplete
              ? 'Mark as complete'
              : 'Only the task owner, its assignee, or the team owner can complete this task.'
          }
          aria-label={`Complete task: ${task.text}`}
          disabled={!canComplete}
          onClick={() => onComplete(task.id)}
        >
          <CheckIcon />
        </button>

        <div className="task-content">
          <span className="task-text">{task.text}</span>

          {(due || author || assignee) && (
            <div className="task-meta">
              {due && (
                <span className={`due ${due.tone}`}>
                  <CalendarIcon />
                  {due.label}
                </span>
              )}

              {author && (
                <span className="person-chip" title={`Added by ${author.email}`}>
                  <UserIcon />
                  {author.name}
                </span>
              )}

              {assignee && (
                <span className="person-chip assignee" title={`Assigned to ${assignee.email}`}>
                  <UsersIcon />
                  {assignee.name}
                </span>
              )}
            </div>
          )}

          {hasProgress && (
            <div className="progress-row">
              <div
                className="progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={task.progress}
                aria-label={`Progress on ${task.text}`}
              >
                <div
                  className={`progress-fill${task.progress >= 100 ? ' complete' : ''}`}
                  style={{ width: `${task.progress}%` }}
                />
              </div>
              <span className="progress-value">{task.progress}%</span>
            </div>
          )}

          <button
            type="button"
            className="updates-toggle"
            aria-expanded={open}
            aria-controls={updatesId}
            onClick={() => setOpen((value) => !value)}
          >
            <ChatIcon />
            {task.comments.length > 0
              ? `${task.comments.length} update${task.comments.length === 1 ? '' : 's'}`
              : 'Add update'}
            <span className="chevron">
              <ChevronIcon />
            </span>
          </button>

          {open && (
            <div className="updates" id={updatesId}>
              <form className="update-form" onSubmit={handlePost}>
                <div className="progress-picker">
                  <label htmlFor={`progress-${task.id}`}>Progress</label>
                  <input
                    id={`progress-${task.id}`}
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={draftProgress}
                    disabled={posting}
                    onChange={(event) => setDraftProgress(Number(event.target.value))}
                  />
                  <output htmlFor={`progress-${task.id}`}>{draftProgress}%</output>
                </div>

                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="What did you get done?"
                  rows={2}
                  maxLength={500}
                  disabled={posting}
                />

                <button type="submit" disabled={!canPost}>
                  {posting ? 'Posting…' : 'Post update'}
                </button>
              </form>

              <ul className="comment-list">
                {task.comments.map((comment) => (
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
                      {canDeleteUpdate(comment) && (
                        <button
                          type="button"
                          className="comment-delete"
                          title="Delete update"
                          aria-label="Delete update"
                          onClick={() => onDeleteComment(task.id, comment.id)}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                    {comment.text && <p>{comment.text}</p>}
                  </li>
                ))}

                {task.comments.length === 0 && (
                  <li className="comment-empty">
                    No updates yet. Post one to track your progress.
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        {canDelete && (
          <button
            type="button"
            className="delete-btn"
            title="Delete task"
            aria-label={`Delete task: ${task.text}`}
            onClick={() => onDelete(task.id)}
          >
            <TrashIcon />
          </button>
        )}
      </div>
    </li>
  );
}
