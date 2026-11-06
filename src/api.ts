import type { AppState, Team, TeamsResponse, UserProfile } from './types';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body: unknown = await response.json();
      if (
        typeof body === 'object' &&
        body !== null &&
        'error' in body &&
        typeof (body as { error: unknown }).error === 'string'
      ) {
        message = (body as { error: string }).error;
      }
    } catch {
      // Keep the generic message when the response has no JSON body.
    }
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export function getMe(): Promise<{ user: UserProfile | null }> {
  return request('/api/auth/me');
}

export function register(
  name: string,
  email: string,
  password: string,
): Promise<{ user: UserProfile }> {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  });
}

export function login(
  email: string,
  password: string,
): Promise<{ user: UserProfile }> {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function logout(): Promise<{ ok: boolean }> {
  return request('/api/auth/logout', { method: 'POST' });
}

export function getState(): Promise<AppState> {
  return request('/api/state');
}

export function addTask(text: string, dueAt: string | null): Promise<AppState> {
  return request('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ text, dueAt }),
  });
}

export function completeTask(id: string): Promise<AppState> {
  return request(`/api/tasks/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
  });
}

export function deleteTask(id: string): Promise<AppState> {
  return request(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function addComment(
  taskId: string,
  text: string,
  progress: number | null,
): Promise<AppState> {
  return request(`/api/tasks/${encodeURIComponent(taskId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text, progress }),
  });
}

export function deleteComment(taskId: string, commentId: string): Promise<AppState> {
  return request(
    `/api/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`,
    { method: 'DELETE' },
  );
}

export function clearHistory(): Promise<AppState> {
  return request('/api/history', {
    method: 'DELETE',
  });
}

export function getTeams(): Promise<TeamsResponse> {
  return request('/api/teams');
}

export function getTeam(id: string): Promise<Team> {
  return request(`/api/teams/${encodeURIComponent(id)}`);
}

export function createTeam(name: string): Promise<Team> {
  return request('/api/teams', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function addTeamMember(teamId: string, email: string): Promise<Team> {
  return request(`/api/teams/${encodeURIComponent(teamId)}/members`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function removeTeamMember(teamId: string, email: string): Promise<Team> {
  return request(
    `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(email)}`,
    { method: 'DELETE' },
  );
}

export function deleteTeam(teamId: string): Promise<{ ok: boolean }> {
  return request(`/api/teams/${encodeURIComponent(teamId)}`, {
    method: 'DELETE',
  });
}

export function addTeamTask(
  teamId: string,
  text: string,
  dueAt: string | null,
  assigneeEmail: string,
): Promise<Team> {
  return request(`/api/teams/${encodeURIComponent(teamId)}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ text, dueAt, assigneeEmail }),
  });
}

export function completeTeamTask(teamId: string, taskId: string): Promise<Team> {
  return request(
    `/api/teams/${encodeURIComponent(teamId)}/tasks/${encodeURIComponent(taskId)}/complete`,
    { method: 'POST' },
  );
}

export function deleteTeamTask(teamId: string, taskId: string): Promise<Team> {
  return request(
    `/api/teams/${encodeURIComponent(teamId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: 'DELETE' },
  );
}

export function addTeamComment(
  teamId: string,
  taskId: string,
  text: string,
  progress: number | null,
): Promise<Team> {
  return request(
    `/api/teams/${encodeURIComponent(teamId)}/tasks/${encodeURIComponent(taskId)}/comments`,
    {
      method: 'POST',
      body: JSON.stringify({ text, progress }),
    },
  );
}

export function deleteTeamComment(
  teamId: string,
  taskId: string,
  commentId: string,
): Promise<Team> {
  return request(
    `/api/teams/${encodeURIComponent(teamId)}/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`,
    { method: 'DELETE' },
  );
}

export function clearTeamHistory(teamId: string): Promise<Team> {
  return request(`/api/teams/${encodeURIComponent(teamId)}/history`, {
    method: 'DELETE',
  });
}
