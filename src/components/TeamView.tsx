import type {
  Task,
  TaskComment,
  TaskFilter,
  Team,
  TeamTab,
  UserProfile,
} from '../types';
import FilterTabs from './FilterTabs';
import HistoryList from './HistoryList';
import MembersPanel from './MembersPanel';
import TeamTaskForm from './TeamTaskForm';
import TaskList from './TaskList';
import { ListIcon, UsersIcon } from './icons';

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

interface TeamViewProps {
  team: Team;
  user: UserProfile;
  loading: boolean;
  filter: TaskFilter;
  tab: TeamTab;
  now: number;
  onTabChange: (tab: TeamTab) => void;
  onFilterChange: (filter: TaskFilter) => void;
  onRefresh: () => void;
  onAddTask: (
    text: string,
    dueAt: string | null,
    assigneeEmail: string,
  ) => Promise<boolean>;
  onCompleteTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onAddComment: (
    taskId: string,
    text: string,
    progress: number,
  ) => Promise<boolean>;
  onDeleteComment: (taskId: string, commentId: string) => void;
  onClearHistory: () => void;
  onInvite: (email: string) => Promise<boolean>;
  onRemoveMember: (email: string) => Promise<boolean>;
  onDeleteTeam: () => void;
}

export default function TeamView({
  team,
  user,
  loading,
  filter,
  tab,
  now,
  onTabChange,
  onFilterChange,
  onRefresh,
  onAddTask,
  onCompleteTask,
  onDeleteTask,
  onAddComment,
  onDeleteComment,
  onClearHistory,
  onInvite,
  onRemoveMember,
  onDeleteTeam,
}: TeamViewProps) {
  const currentEmail = user.email.toLowerCase();
  const isOwner =
    team.ownerSub === user.sub || team.ownerEmail === currentEmail;
  const owner =
    team.members.find(
      (member) => member.role === 'owner' || member.email === team.ownerEmail,
    ) ?? null;
  const ownerName = owner?.name ?? owner?.email ?? team.ownerEmail;

  function isSamePerson(ref: { sub: string | null; email: string } | null | undefined) {
    if (!ref) return false;
    return ref.sub === user.sub || ref.email.toLowerCase() === currentEmail;
  }

  function canCompleteTask(task: Task): boolean {
    return isOwner || isSamePerson(task.author) || isSamePerson(task.assignee);
  }

  function canDeleteTask(task: Task): boolean {
    return isOwner || isSamePerson(task.author);
  }

  function canDeleteComment(_task: Task, comment: TaskComment): boolean {
    return isOwner || isSamePerson(comment.author);
  }

  const orderedTasks = [...team.tasks].sort(
    (first, second) => deadlineValue(first) - deadlineValue(second),
  );
  const pendingTasks = orderedTasks.filter((task) => !isOverdue(task, now));
  const overdueTasks = orderedTasks.filter((task) => isOverdue(task, now));

  const counts: Record<TaskFilter, number> = {
    all: team.tasks.length + team.history.length,
    pending: pendingTasks.length,
    overdue: overdueTasks.length,
    completed: team.history.length,
  };

  const visibleTasks =
    filter === 'pending'
      ? pendingTasks
      : filter === 'overdue'
        ? overdueTasks
        : orderedTasks;

  const activePanelTitle =
    filter === 'pending' ? 'Pending' : filter === 'overdue' ? 'Overdue' : 'Team tasks';

  const emptyTitle =
    filter === 'pending'
      ? 'Nothing pending'
      : filter === 'overdue'
        ? 'No overdue tasks'
        : 'No team tasks yet';

  const emptyMessage =
    filter === 'pending'
      ? 'No upcoming team tasks right now.'
      : filter === 'overdue'
        ? 'The team is on schedule.'
        : 'Add the first shared task above and assign it to a teammate.';

  const showActivePanel = filter !== 'completed';
  const showHistoryPanel = filter === 'all' || filter === 'completed';

  return (
    <div className="team-view">
      <section className="team-header" aria-labelledby="team-heading">
        <div className="team-heading">
          <span className="team-eyebrow">Shared workspace</span>
          <h2 id="team-heading">{team.name}</h2>
          <p className="team-subtitle">
            {team.members.length} member{team.members.length === 1 ? '' : 's'} · Owner{' '}
            {ownerName}
          </p>
        </div>

        <div className="team-header-actions">
          <span className={`role-badge ${isOwner ? 'owner' : 'member'}`}>
            {isOwner ? 'Owner' : 'Member'}
          </span>
          <button
            type="button"
            className="ghost-btn refresh-btn"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </section>

      <div className="team-tabs" role="group" aria-label="Team sections">
        <button
          type="button"
          className="team-tab"
          aria-pressed={tab === 'tasks'}
          onClick={() => onTabChange('tasks')}
        >
          <ListIcon />
          Team tasks
          <span className="filter-count">{team.tasks.length + team.history.length}</span>
        </button>
        <button
          type="button"
          className="team-tab"
          aria-pressed={tab === 'members'}
          onClick={() => onTabChange('members')}
        >
          <UsersIcon />
          Members
          <span className="filter-count">{team.members.length}</span>
        </button>
      </div>

      {tab === 'members' ? (
        <MembersPanel
          team={team}
          currentUser={user}
          onInvite={onInvite}
          onRemove={onRemoveMember}
          onDeleteTeam={onDeleteTeam}
        />
      ) : (
        <>
          <TeamTaskForm
            members={team.members}
            currentUserEmail={currentEmail}
            onAdd={onAddTask}
          />

          <FilterTabs value={filter} counts={counts} onChange={onFilterChange} />

          {showActivePanel && (
            <section className="panel" aria-labelledby="team-tasks-heading">
              <div className="panel-head">
                <h2 id="team-tasks-heading">{activePanelTitle}</h2>
                <span className="count" aria-live="polite">
                  {visibleTasks.length}
                </span>
              </div>

              <TaskList
                tasks={visibleTasks}
                onComplete={onCompleteTask}
                onDelete={onDeleteTask}
                onAddComment={onAddComment}
                onDeleteComment={onDeleteComment}
                canCompleteTask={canCompleteTask}
                canDeleteTask={canDeleteTask}
                canDeleteComment={canDeleteComment}
                emptyTitle={emptyTitle}
                emptyMessage={emptyMessage}
              />
            </section>
          )}

          {showHistoryPanel && (
            <section className="panel" aria-labelledby="team-history-heading">
              <div className="panel-head">
                <h2 id="team-history-heading">
                  {filter === 'completed' ? 'Completed' : 'Team history'}
                </h2>
                <div className="head-actions">
                  <span className="count" aria-live="polite">
                    {team.history.length}
                  </span>
                  {isOwner && team.history.length > 0 && (
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={onClearHistory}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <HistoryList entries={team.history} />
            </section>
          )}

          <p className="team-hint">
            Everyone on this team can see these tasks and post progress updates. Only the
            task owner, its assignee, or the team owner can complete a task.
          </p>
        </>
      )}
    </div>
  );
}
