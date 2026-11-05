import { useState } from 'react';
import type { FormEvent } from 'react';
import type { AuthUser, Team, TeamMember } from '../types';
import { PlusIcon, UserIcon, UsersIcon } from './icons';

function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s._-]/gu, ' ')
    .split(/[\s._-]+/)
    .filter(Boolean);

  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

interface MembersPanelProps {
  team: Team;
  currentUser: AuthUser;
  onInvite: (email: string) => Promise<boolean>;
  onRemove: (email: string) => Promise<boolean>;
  onDeleteTeam: () => void;
}

export default function MembersPanel({
  team,
  currentUser,
  onInvite,
  onRemove,
  onDeleteTeam,
}: MembersPanelProps) {
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  const currentEmail = currentUser.email.toLowerCase();
  const isOwner =
    team.ownerSub === currentUser.sub || team.ownerEmail === currentEmail;

  function isOwnerMember(member: TeamMember): boolean {
    return (
      member.role === 'owner' ||
      member.email === team.ownerEmail ||
      (member.sub !== null && member.sub === team.ownerSub)
    );
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim();
    if (!value || inviting) return;

    setInviting(true);
    const added = await onInvite(value);
    setInviting(false);

    if (added) setEmail('');
  }

  return (
    <div className="members-panel">
      <form className="invite-card" onSubmit={handleInvite} autoComplete="off">
        <div className="invite-head">
          <span className="invite-icon" aria-hidden="true">
            <UsersIcon size={18} />
          </span>
          <div>
            <h3>Invite a teammate</h3>
            <p>
              Add the Google email they use to sign in. They are added right away and
              will see this team automatically when they open or return to the app.
            </p>
          </div>
        </div>

        <div className="invite-row">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="teammate@gmail.com"
            aria-label="Teammate email address"
            maxLength={254}
            disabled={inviting}
          />
          <button type="submit" disabled={inviting || !email.trim()}>
            <PlusIcon size={15} />
            {inviting ? 'Inviting…' : 'Invite'}
          </button>
        </div>
      </form>

      <section className="members-card" aria-labelledby="members-heading">
        <div className="members-head">
          <h3 id="members-heading">Team members</h3>
          <span className="count">{team.members.length}</span>
        </div>

        <ul className="member-list">
          {team.members.map((member) => {
            const ownerMember = isOwnerMember(member);
            const self = member.email === currentEmail;
            const displayName = member.name ?? member.email;

            return (
              <li key={member.email} className="member-item">
                {member.picture ? (
                  <img
                    className="member-avatar"
                    src={member.picture}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="member-avatar member-avatar-fallback" aria-hidden="true">
                    {initials(displayName)}
                  </span>
                )}

                <div className="member-body">
                  <span className="member-name">
                    {displayName}
                    {self && <span className="member-you">you</span>}
                  </span>
                  <span className="member-email">{member.email}</span>
                </div>

                <div className="member-actions">
                  {!member.sub && (
                    <span
                      className="member-pending"
                      title="They have not opened the app since being invited. Their account will be linked automatically the next time they sign in with this email."
                    >
                      Awaiting sign-in
                    </span>
                  )}
                  {ownerMember ? (
                    <span className="member-role owner">Owner</span>
                  ) : (
                    <span className="member-role">Member</span>
                  )}
                  {isOwner && !ownerMember && (
                    <button
                      type="button"
                      className="member-remove"
                      onClick={() => void onRemove(member.email)}
                    >
                      Remove
                    </button>
                  )}
                  {!isOwner && self && (
                    <button
                      type="button"
                      className="member-remove"
                      onClick={() => void onRemove(member.email)}
                    >
                      Leave
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {isOwner ? (
        <section className="danger-zone" aria-labelledby="danger-heading">
          <div>
            <h3 id="danger-heading">Delete this team</h3>
            <p>
              This permanently removes every shared task, update, and member from the
              team. Personal tasks are not affected.
            </p>
          </div>
          <button type="button" className="danger-btn" onClick={onDeleteTeam}>
            Delete team
          </button>
        </section>
      ) : (
        <p className="members-note">
          <UserIcon />
          Only the team owner can remove other members or delete the team. You can leave
          at any time.
        </p>
      )}
    </div>
  );
}
