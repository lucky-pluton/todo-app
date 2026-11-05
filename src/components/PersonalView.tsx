import type { AppState, Task, TaskFilter } from '../types';
import FilterTabs from './FilterTabs';
import HistoryList from './HistoryList';
import TaskForm from './TaskForm';
import TaskList from './TaskList';

function deadlineValue(task: Task): number {
  if (!task.dueAt) return Number.POSITIVE_INFINITY;
  const time = new Date(task.dueAt).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function isOverdue(task: Task, now: number): boolean {
  if (!task.dueAt) return false;
  const time = new Date(task.dueAt).getTime();
  return !Number.isNaN(time) && time < now;
}

interface PersonalViewProps {
  state: AppState;
  loading: boolean;
  filter: TaskFilter;
  now: number;
  onFilterChange: (filter: TaskFilter) => void;
  onAdd: (text: string, dueAt: string | null) => Promise<boolean>;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onAddComment: (
    taskId: string,
    text: string,
    progress: number,
  ) => Promise<boolean>;
  onDeleteComment: (taskId: string, commentId: string) => void;
  onClearHistory: () => void;
}

export default function PersonalView({
  state,
  loading,
  filter,
  now,
  onFilterChange,
  onAdd,
  onComplete,
  onDelete,
  onAddComment,
  onDeleteComment,
  onClearHistory,
}: PersonalViewProps) {
  const orderedTasks = [...state.tasks].sort(
    (first, second) => deadlineValue(first) - deadlineValue(second),
  );

  const pendingTasks = orderedTasks.filter((task) => !isOverdue(task, now));
  const overdueTasks = orderedTasks.filter((task) => isOverdue(task, now));

  const counts: Record<TaskFilter, number> = {
    all: state.tasks.length + state.history.length,
    pending: pendingTasks.length,
    overdue: overdueTasks.length,
    completed: state.history.length,
  };

  const visibleTasks =
    filter === 'pending'
      ? pendingTasks
      : filter === 'overdue'
        ? overdueTasks
        : orderedTasks;

  const activePanelTitle =
    filter === 'pending' ? 'Pending' : filter === 'overdue' ? 'Overdue' : 'To do';

  const emptyTitle =
    filter === 'pending'
      ? 'Nothing pending'
      : filter === 'overdue'
        ? 'No overdue tasks'
        : 'All clear';

  const emptyMessage =
    filter === 'pending'
      ? 'No upcoming tasks right now.'
      : filter === 'overdue'
        ? "You're on schedule."
        : 'Add your first task above.';

  const showActivePanel = filter !== 'completed';
  const showHistoryPanel = filter === 'all' || filter === 'completed';

  return (
    <div className="personal-view">
      <TaskForm onAdd={onAdd} />

      <FilterTabs value={filter} counts={counts} onChange={onFilterChange} />

      {showActivePanel && (
        <section className="panel" aria-labelledby="tasks-heading">
          <div className="panel-head">
            <h2 id="tasks-heading">{activePanelTitle}</h2>
            <span className="count" aria-live="polite">
              {visibleTasks.length}
            </span>
          </div>

          {loading ? (
            <div className="loading" aria-label="Loading tasks">
              <span className="skeleton" />
              <span className="skeleton" />
            </div>
          ) : (
            <TaskList
              tasks={visibleTasks}
              onComplete={onComplete}
              onDelete={onDelete}
              onAddComment={onAddComment}
              onDeleteComment={onDeleteComment}
              emptyTitle={emptyTitle}
              emptyMessage={emptyMessage}
            />
          )}
        </section>
      )}

      {showHistoryPanel && (
        <section className="panel" aria-labelledby="history-heading">
          <div className="panel-head">
            <h2 id="history-heading">
              {filter === 'completed' ? 'Completed' : 'History'}
            </h2>
            <div className="head-actions">
              <span className="count" aria-live="polite">
                {state.history.length}
              </span>
              {state.history.length > 0 && (
                <button type="button" className="ghost-btn" onClick={onClearHistory}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="loading" aria-label="Loading history">
              <span className="skeleton" />
            </div>
          ) : (
            <HistoryList entries={state.history} />
          )}
        </section>
      )}
    </div>
  );
}
