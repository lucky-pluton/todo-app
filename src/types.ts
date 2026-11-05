export interface PersonRef {
  sub: string | null;
  email: string;
  name: string;
}

export interface TaskComment {
  id: string;
  text: string;
  progress: number | null;
  createdAt: string;
  author?: PersonRef | null;
}

export interface Task {
  id: string;
  text: string;
  createdAt: string;
  dueAt: string | null;
  progress: number;
  comments: TaskComment[];
  author?: PersonRef | null;
  assignee?: PersonRef | null;
}

export interface HistoryEntry extends Task {
  completedAt: string;
}

export interface AppState {
  tasks: Task[];
  history: HistoryEntry[];
}

export interface AuthUser {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

export interface AuthInfo {
  user: AuthUser | null;
  configured: boolean;
}

export type TaskFilter = 'all' | 'pending' | 'overdue' | 'completed';

export type TeamRole = 'owner' | 'member';

export interface TeamMember {
  email: string;
  role: TeamRole;
  addedAt: string;
  sub: string | null;
  name: string | null;
  picture: string | null;
}

export interface TeamTask extends Task {
  author: PersonRef;
  assignee: PersonRef | null;
}

export interface TeamHistoryEntry extends HistoryEntry {
  author: PersonRef;
  assignee: PersonRef | null;
}

export interface Team {
  id: string;
  name: string;
  createdAt: string;
  ownerSub: string;
  ownerEmail: string;
  members: TeamMember[];
  tasks: TeamTask[];
  history: TeamHistoryEntry[];
}

export interface TeamSummary {
  id: string;
  name: string;
  createdAt: string;
  ownerEmail: string;
  role: TeamRole;
  memberCount: number;
  taskCount: number;
  historyCount: number;
}

export interface TeamsResponse {
  teams: TeamSummary[];
}

export type WorkspaceView =
  | { kind: 'personal' }
  | { kind: 'team'; teamId: string };

export type TeamTab = 'tasks' | 'members';
