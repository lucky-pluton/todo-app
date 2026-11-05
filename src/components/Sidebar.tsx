import { useState } from 'react';
import type { FormEvent } from 'react';
import type { TeamSummary, WorkspaceView } from '../types';
import { ListIcon, PlusIcon, TeamIcon, UsersIcon } from './icons';

function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s._-]/gu, ' ')
    .split(/[\s._-]+/)
    .filter(Boolean);

  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

interface SidebarProps {
  teams: TeamSummary[];
  view: WorkspaceView;
  personalCount: number;
  loading: boolean;
  onCreateTeam: (name: string) => Promise<boolean>;
  onSelectPersonal: () => void;
  onSelectTeam: (id: string) => void;
}

export default function Sidebar({
  teams,
  view,
  personalCount,
  loading,
  onCreateTeam,
  onSelectPersonal,
  onSelectTeam,
}: SidebarProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = name.trim();
    if (!value || submitting) return;

    setSubmitting(true);
    const created = await onCreateTeam(value);
    setSubmitting(false);

    if (created) {
      setName('');
      setCreating(false);
    }
  }

  return (
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="sidebar-section">
        <span className="sidebar-label">Workspace</span>
        <button
          type="button"
          className={`nav-item${view.kind === 'personal' ? ' active' : ''}`}
          aria-current={view.kind === 'personal' ? 'page' : undefined}
          onClick={onSelectPersonal}
        >
          <ListIcon />
          <span className="nav-item-label">My Tasks</span>
          {personalCount > 0 && <span className="nav-count">{personalCount}</span>}
        </button>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-heading">
          <span className="sidebar-label">Teams</span>
          <span className="sidebar-count">{teams.length}</span>
        </div>

        {loading && teams.length === 0 && (
          <div className="sidebar-loading" aria-label="Loading teams">
            <span className="skeleton" />
            <span className="skeleton" />
          </div>
        )}

        {!loading && teams.length === 0 && (
          <p className="sidebar-empty">
            No teams yet. Create one and invite teammates by email.
          </p>
        )}

        <nav className="team-nav-list" aria-label="Teams">
          {teams.map((team) => {
            const active = view.kind === 'team' && view.teamId === team.id;
            return (
              <button
                key={team.id}
                type="button"
                className={`team-nav${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                title={`${team.name} · ${team.memberCount} member${
                  team.memberCount === 1 ? '' : 's'
                }`}
                onClick={() => onSelectTeam(team.id)}
              >
                <span className="team-avatar" aria-hidden="true">
                  {initials(team.name)}
                </span>
                <span className="team-nav-body">
                  <span className="team-nav-name">{team.name}</span>
                  <span className="team-nav-meta">
                    <UsersIcon size={11} />
                    {team.memberCount} · {team.taskCount + team.historyCount} task
                    {team.taskCount + team.historyCount === 1 ? '' : 's'}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        {creating ? (
          <form className="new-team-form" onSubmit={handleCreate} autoComplete="off">
            <label className="new-team-label" htmlFor="new-team-name">
              Team name
            </label>
            <input
              id="new-team-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Design team"
              maxLength={60}
              autoFocus
              disabled={submitting}
            />
            <div className="new-team-actions">
              <button type="submit" disabled={submitting || !name.trim()}>
                {submitting ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setName('');
                }}
                disabled={submitting}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="new-team-btn" onClick={() => setCreating(true)}>
            <PlusIcon size={15} />
            New team
          </button>
        )}
      </div>

      <div className="sidebar-tip">
        <TeamIcon size={16} />
        <p>
          Personal tasks stay private. Team tasks are shared with everyone you invite.
        </p>
      </div>
    </aside>
  );
}
