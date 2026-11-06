import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import { CheckIcon } from './components/icons';
import PersonalView from './components/PersonalView';
import Sidebar from './components/Sidebar';
import TeamView from './components/TeamView';
import type {
  AppState,
  TaskFilter,
  Team,
  TeamRole,
  TeamSummary,
  TeamTab,
  UserProfile,
  WorkspaceView,
} from './types';

const emptyState: AppState = { tasks: [], history: [] };

const todayLabel = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
}).format(new Date());

function teamSummaryFrom(team: Team, role: TeamRole): TeamSummary {
  return {
    id: team.id,
    name: team.name,
    createdAt: team.createdAt,
    ownerEmail: team.ownerEmail,
    role,
    memberCount: team.members.length,
    taskCount: team.tasks.length,
    historyCount: team.history.length,
  };
}

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [state, setState] = useState<AppState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [now, setNow] = useState(() => Date.now());

  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [view, setView] = useState<WorkspaceView>({ kind: 'personal' });
  const [team, setTeam] = useState<Team | null>(null);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamFilter, setTeamFilter] = useState<TaskFilter>('all');
  const [teamTab, setTeamTab] = useState<TeamTab>('tasks');

  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const teamQueue = useRef<Promise<unknown>>(Promise.resolve());
  const teamRequest = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const info = await api.getMe();
        if (!cancelled) setUser(info.user);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Could not load your local profile.',
          );
        }
      } finally {
        if (!cancelled) setUserLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleActionError = useCallback((actionError: unknown) => {
    setError(
      actionError instanceof Error ? actionError.message : 'Something went wrong.',
    );
  }, []);

  const updateTeamSummary = useCallback((next: Team) => {
    setTeams((current) =>
      current.map((summary) =>
        summary.id === next.id
          ? {
              ...summary,
              name: next.name,
              memberCount: next.members.length,
              taskCount: next.tasks.length,
              historyCount: next.history.length,
            }
          : summary,
      ),
    );
  }, []);

  const loadState = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setState(await api.getState());
    } catch (loadError) {
      handleActionError(loadError);
    } finally {
      setLoading(false);
    }
  }, [handleActionError]);

  const loadTeams = useCallback(async () => {
    setTeamsLoading(true);

    try {
      const response = await api.getTeams();
      setTeams(response.teams);
    } catch (loadError) {
      handleActionError(loadError);
    } finally {
      setTeamsLoading(false);
    }
  }, [handleActionError]);

  // Background refresh used for polling and window focus. It never shows the
  // loading skeleton or an error banner, so it can run quietly.
  const refreshTeams = useCallback(async () => {
    try {
      const response = await api.getTeams();
      setTeams(response.teams);
    } catch {
      // Quiet refresh: errors surface through the main actions instead.
    }
  }, []);

  const loadTeam = useCallback(
    async (id: string) => {
      const requestId = ++teamRequest.current;
      setTeamLoading(true);

      try {
        const next = await api.getTeam(id);
        if (teamRequest.current !== requestId) return;

        setTeam(next);
        updateTeamSummary(next);
        setError(null);
      } catch (loadError) {
        if (teamRequest.current !== requestId) return;

        if (
          loadError instanceof api.ApiError &&
          (loadError.status === 403 || loadError.status === 404)
        ) {
          setTeams((current) => current.filter((summary) => summary.id !== id));
          setTeam(null);
          setView({ kind: 'personal' });
          setError(loadError.message);
        } else {
          handleActionError(loadError);
        }
      } finally {
        if (teamRequest.current === requestId) setTeamLoading(false);
      }
    },
    [handleActionError, updateTeamSummary],
  );

  useEffect(() => {
    if (user) {
      void loadState();
      void loadTeams();
    }
  }, [user, loadState, loadTeams]);

  // Keep the sidebar team list fresh so newly invited teams appear without a
  // full page reload.
  useEffect(() => {
    if (!user) return;

    const refresh = () => {
      if (document.hidden) return;
      void refreshTeams();
    };

    const timer = window.setInterval(refresh, 20_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [user, refreshTeams]);

  useEffect(() => {
    if (view.kind !== 'team') return;
    const id = view.teamId;

    const refresh = () => {
      if (document.hidden) return;

      void api
        .getTeam(id)
        .then((next) => {
          setTeam((current) => (current?.id === id ? next : current));
          updateTeamSummary(next);
        })
        .catch((refreshError: unknown) => {
          if (
            refreshError instanceof api.ApiError &&
            (refreshError.status === 403 || refreshError.status === 404)
          ) {
            setTeams((current) => current.filter((summary) => summary.id !== id));
            setTeam((current) => (current?.id === id ? null : current));
            setView((current) =>
              current.kind === 'team' && current.teamId === id
                ? { kind: 'personal' }
                : current,
            );
            setError(refreshError.message);
          }
        });
    };

    const timer = window.setInterval(refresh, 20_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [view, updateTeamSummary]);

  const runAction = useCallback(
    (action: () => Promise<AppState>): Promise<boolean> => {
      const result = queue.current.then(async () => {
        try {
          setState(await action());
          setError(null);
          return true;
        } catch (actionError) {
          handleActionError(actionError);
          return false;
        }
      });

      queue.current = result;
      return result;
    },
    [handleActionError],
  );

  const runTeamAction = useCallback(
    (action: (teamId: string) => Promise<Team>): Promise<boolean> => {
      if (view.kind !== 'team') return Promise.resolve(false);
      const teamId = view.teamId;

      const result = teamQueue.current.then(async () => {
        try {
          const next = await action(teamId);
          setTeam(next);
          updateTeamSummary(next);
          setError(null);
          return true;
        } catch (actionError) {
          handleActionError(actionError);
          return false;
        }
      });

      teamQueue.current = result;
      return result;
    },
    [view, handleActionError, updateTeamSummary],
  );

  const handleAdd = useCallback(
    (text: string, dueAt: string | null) => runAction(() => api.addTask(text, dueAt)),
    [runAction],
  );

  const handleComplete = useCallback(
    (id: string) => {
      void runAction(() => api.completeTask(id));
    },
    [runAction],
  );

  const handleDelete = useCallback(
    (id: string) => {
      void runAction(() => api.deleteTask(id));
    },
    [runAction],
  );

  const handleAddComment = useCallback(
    (taskId: string, text: string, progress: number) =>
      runAction(() => api.addComment(taskId, text, progress)),
    [runAction],
  );

  const handleDeleteComment = useCallback(
    (taskId: string, commentId: string) => {
      void runAction(() => api.deleteComment(taskId, commentId));
    },
    [runAction],
  );

  const handleClearHistory = useCallback(() => {
    if (state.history.length === 0) return;

    const message =
      state.history.length === 1
        ? 'Clear the completed task from history? This cannot be undone.'
        : `Clear all ${state.history.length} completed tasks from history? This cannot be undone.`;

    if (window.confirm(message)) {
      void runAction(api.clearHistory);
    }
  }, [runAction, state.history.length]);

  const handleTeamAdd = useCallback(
    (text: string, dueAt: string | null, assigneeEmail: string) =>
      runTeamAction((teamId) => api.addTeamTask(teamId, text, dueAt, assigneeEmail)),
    [runTeamAction],
  );

  const handleTeamComplete = useCallback(
    (id: string) => {
      void runTeamAction((teamId) => api.completeTeamTask(teamId, id));
    },
    [runTeamAction],
  );

  const handleTeamDeleteTask = useCallback(
    (id: string) => {
      void runTeamAction((teamId) => api.deleteTeamTask(teamId, id));
    },
    [runTeamAction],
  );

  const handleTeamAddComment = useCallback(
    (taskId: string, text: string, progress: number) =>
      runTeamAction((teamId) => api.addTeamComment(teamId, taskId, text, progress)),
    [runTeamAction],
  );

  const handleTeamDeleteComment = useCallback(
    (taskId: string, commentId: string) => {
      void runTeamAction((teamId) =>
        api.deleteTeamComment(teamId, taskId, commentId),
      );
    },
    [runTeamAction],
  );

  const handleTeamClearHistory = useCallback(() => {
    if (!team || team.history.length === 0) return;

    const message =
      team.history.length === 1
        ? 'Clear the completed team task? This cannot be undone.'
        : `Clear all ${team.history.length} completed team tasks? This cannot be undone.`;

    if (window.confirm(message)) {
      void runTeamAction((teamId) => api.clearTeamHistory(teamId));
    }
  }, [team, runTeamAction]);

  const handleInvite = useCallback(
    (email: string) => runTeamAction((teamId) => api.addTeamMember(teamId, email)),
    [runTeamAction],
  );

  const handleRemoveMember = useCallback(
    async (email: string) => {
      if (!team || !user) return false;

      const self = email.toLowerCase() === user.email.toLowerCase();
      const message = self
        ? `Leave "${team.name}"? You will lose access to its shared tasks.`
        : `Remove ${email} from "${team.name}"?`;

      if (!window.confirm(message)) return false;

      if (!self) {
        return runTeamAction((teamId) => api.removeTeamMember(teamId, email));
      }

      try {
        await api.removeTeamMember(team.id, email);
        setTeams((current) => current.filter((summary) => summary.id !== team.id));
        setTeam(null);
        setView({ kind: 'personal' });
        setError(null);
        return true;
      } catch (actionError) {
        handleActionError(actionError);
        return false;
      }
    },
    [team, user, runTeamAction, handleActionError],
  );

  const handleDeleteTeam = useCallback(() => {
    if (!team) return;

    const message = `Delete "${team.name}"? This permanently removes all shared tasks and updates for every member.`;
    if (!window.confirm(message)) return;

    void (async () => {
      try {
        await api.deleteTeam(team.id);
        setTeams((current) => current.filter((summary) => summary.id !== team.id));
        setTeam(null);
        setView({ kind: 'personal' });
        setError(null);
      } catch (actionError) {
        handleActionError(actionError);
      }
    })();
  }, [team, handleActionError]);

  const handleCreateTeam = useCallback(
    async (name: string) => {
      try {
        const created = await api.createTeam(name);
        setTeams((current) => [...current, teamSummaryFrom(created, 'owner')]);
        setView({ kind: 'team', teamId: created.id });
        setTeam(created);
        setTeamTab('tasks');
        setTeamFilter('all');
        setError(null);
        return true;
      } catch (actionError) {
        handleActionError(actionError);
        return false;
      }
    },
    [handleActionError],
  );

  const handleSelectPersonal = useCallback(() => {
    teamRequest.current += 1;
    setView({ kind: 'personal' });
    setTeam(null);
    setTeamLoading(false);
    setError(null);
  }, []);

  const handleSelectTeam = useCallback(
    (id: string) => {
      setView({ kind: 'team', teamId: id });
      setTeam((current) => (current?.id === id ? current : null));
      setTeamTab('tasks');
      setTeamFilter('all');
      setError(null);
      void loadTeam(id);
    },
    [loadTeam],
  );

  const handleRefreshTeam = useCallback(() => {
    if (view.kind === 'team') {
      void loadTeam(view.teamId);
    }
  }, [view, loadTeam]);

  const handleRetry = useCallback(() => {
    if (view.kind === 'personal') {
      void loadState();
      void loadTeams();
    } else {
      void loadTeam(view.teamId);
      void loadTeams();
    }
  }, [view, loadState, loadTeams, loadTeam]);

  if (userLoading) {
    return (
      <main className="startup-page" aria-busy="true">
        <span className="startup-spinner" aria-hidden="true" />
        <p>Loading your workspace…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="startup-page" role="alert">
        <p>{error ?? 'Could not load your local profile.'}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <CheckIcon size={16} />
          </span>
          <div>
            <h1>My Tasks</h1>
            <p className="subtitle">Personal focus, shared progress.</p>
          </div>
        </div>

        <div className="header-right">
          <span className="today-badge">{todayLabel}</span>
          <div className="account">
            {user.picture ? (
              <img
                className="avatar"
                src={user.picture}
                alt=""
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="avatar avatar-fallback" aria-hidden="true">
                {user.name.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="account-name" title={user.email}>
              {user.name}
            </span>
          </div>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <div className="error-actions">
            <button type="button" onClick={handleRetry}>
              Retry
            </button>
            <button type="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="workspace">
        <Sidebar
          teams={teams}
          view={view}
          personalCount={state.tasks.length}
          loading={teamsLoading}
          onCreateTeam={handleCreateTeam}
          onSelectPersonal={handleSelectPersonal}
          onSelectTeam={handleSelectTeam}
        />

        <div className="workspace-main">
          {view.kind === 'personal' ? (
            <PersonalView
              state={state}
              loading={loading}
              filter={filter}
              now={now}
              onFilterChange={setFilter}
              onAdd={handleAdd}
              onComplete={handleComplete}
              onDelete={handleDelete}
              onAddComment={handleAddComment}
              onDeleteComment={handleDeleteComment}
              onClearHistory={handleClearHistory}
            />
          ) : team ? (
            <TeamView
              team={team}
              user={user}
              loading={teamLoading}
              filter={teamFilter}
              tab={teamTab}
              now={now}
              onTabChange={setTeamTab}
              onFilterChange={setTeamFilter}
              onRefresh={handleRefreshTeam}
              onAddTask={handleTeamAdd}
              onCompleteTask={handleTeamComplete}
              onDeleteTask={handleTeamDeleteTask}
              onAddComment={handleTeamAddComment}
              onDeleteComment={handleTeamDeleteComment}
              onClearHistory={handleTeamClearHistory}
              onInvite={handleInvite}
              onRemoveMember={handleRemoveMember}
              onDeleteTeam={handleDeleteTeam}
            />
          ) : (
            <section className="panel team-placeholder" aria-busy={teamLoading}>
              <div className="loading" aria-label="Loading team">
                <span className="skeleton" />
                <span className="skeleton" />
              </div>
              <p>
                {teamLoading
                  ? 'Loading team…'
                  : 'This team is not available. Pick it again from the sidebar.'}
              </p>
            </section>
          )}
        </div>
      </div>

      <p className="storage-note">
        Personal tasks are private to your local profile. Team tasks are shared with
        everyone in that team.
      </p>
    </main>
  );
}
