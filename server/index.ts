import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';

interface PersonRef {
  sub: string | null;
  email: string;
  name: string;
}

interface TaskComment {
  id: string;
  text: string;
  progress: number | null;
  createdAt: string;
  author?: PersonRef | null;
}

interface Task {
  id: string;
  text: string;
  createdAt: string;
  dueAt: string | null;
  progress: number;
  comments: TaskComment[];
}

interface HistoryEntry extends Task {
  completedAt: string;
}

interface Database {
  tasks: Task[];
  history: HistoryEntry[];
}

interface TeamMember {
  email: string;
  role: 'owner' | 'member';
  addedAt: string;
  sub: string | null;
  name: string | null;
  picture: string | null;
}

interface TeamTask extends Task {
  author: PersonRef;
  assignee: PersonRef | null;
}

interface TeamHistoryEntry extends HistoryEntry {
  author: PersonRef;
  assignee: PersonRef | null;
}

interface Team {
  id: string;
  name: string;
  createdAt: string;
  ownerSub: string;
  ownerEmail: string;
  members: TeamMember[];
  tasks: TeamTask[];
  history: TeamHistoryEntry[];
}

interface AuthUser {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
  userDatabase?: Database;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  loadEnvFile(path.join(projectRoot, '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    console.warn('Could not load .env:', error);
  }
}

const dataDir = path.join(projectRoot, 'data');
const usersDir = path.join(dataDir, 'users');
const teamsDir = path.join(dataDir, 'teams');
const legacyDataFile = path.join(dataDir, 'tasks.json');
const distDir = path.join(projectRoot, 'dist');
const port = Number(process.env.PORT) || 3001;
const maxTextLength = 300;
const maxCommentLength = 500;
const maxTeamNameLength = 60;
const maxTeamMembers = 100;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '';
const googleConfigured = Boolean(googleClientId && googleClientSecret);
const configuredAppUrl = (process.env.APP_URL ?? process.env.PUBLIC_URL ?? '')
  .trim()
  .replace(/\/+$/, '');
const legacyOwnerEmail = process.env.LEGACY_OWNER_EMAIL?.trim().toLowerCase() ?? '';
const sessionCookieName = 'todo_session';
const stateCookieName = 'todo_oauth_state';
const sessionMaxAgeSeconds = 30 * 24 * 60 * 60;
const secureCookiesInProduction = process.env.NODE_ENV === 'production';

const userDatabases = new Map<string, Database>();
const userLoads = new Map<string, Promise<Database>>();
const userQueues = new Map<string, Promise<unknown>>();
const teamDatabases = new Map<string, Team>();
const teamLoads = new Map<string, Promise<Team | null>>();
const teamQueues = new Map<string, Promise<unknown>>();
let writeQueue: Promise<void> = Promise.resolve();
let teamWriteQueue: Promise<void> = Promise.resolve();
let sessionSecret = '';
let legacyClaimPromise: Promise<Database> | null = null;

function emptyDatabase(): Database {
  return { tasks: [], history: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clampProgress(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function parseDueAt(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !emailPattern.test(email)) return null;
  return email;
}

function normalizePersonRef(value: unknown): PersonRef | null {
  if (!isRecord(value)) return null;
  const email = normalizeEmail(value.email);
  if (!email) return null;

  return {
    sub: typeof value.sub === 'string' && value.sub ? value.sub : null,
    email,
    name:
      typeof value.name === 'string' && value.name.trim() ? value.name.trim() : email,
  };
}

function normalizeComment(value: unknown): TaskComment | null {
  if (!isRecord(value)) return null;

  const text = typeof value.text === 'string' ? value.text.slice(0, maxCommentLength) : '';
  const progress =
    typeof value.progress === 'number' && Number.isFinite(value.progress)
      ? clampProgress(value.progress)
      : null;

  if (!text && progress === null) return null;

  const comment: TaskComment = {
    id: typeof value.id === 'string' ? value.id : randomUUID(),
    text,
    progress,
    createdAt:
      typeof value.createdAt === 'string' && !Number.isNaN(Date.parse(value.createdAt))
        ? value.createdAt
        : new Date().toISOString(),
  };

  const author = normalizePersonRef(value.author);
  if (author) comment.author = author;

  return comment;
}

function normalizeTask(value: unknown): Task | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.text !== 'string') return null;

  const dueAt = parseDueAt(value.dueAt);
  const progress =
    typeof value.progress === 'number' && Number.isFinite(value.progress)
      ? clampProgress(value.progress)
      : 0;
  const comments = Array.isArray(value.comments)
    ? value.comments
        .map(normalizeComment)
        .filter((comment): comment is TaskComment => comment !== null)
    : [];

  return {
    id: value.id,
    text: value.text,
    createdAt:
      typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    dueAt: dueAt ?? null,
    progress,
    comments,
  };
}

function normalizeHistoryEntry(value: unknown): HistoryEntry | null {
  const task = normalizeTask(value);
  if (!task || !isRecord(value)) return null;

  return {
    ...task,
    progress: 100,
    completedAt:
      typeof value.completedAt === 'string' && !Number.isNaN(Date.parse(value.completedAt))
        ? value.completedAt
        : new Date().toISOString(),
  };
}

function normalizeTeamMember(value: unknown): TeamMember | null {
  if (!isRecord(value)) return null;
  const email = normalizeEmail(value.email);
  if (!email) return null;

  return {
    email,
    role: value.role === 'owner' ? 'owner' : 'member',
    addedAt:
      typeof value.addedAt === 'string' && !Number.isNaN(Date.parse(value.addedAt))
        ? value.addedAt
        : new Date().toISOString(),
    sub: typeof value.sub === 'string' && value.sub ? value.sub : null,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : null,
    picture: typeof value.picture === 'string' ? value.picture : null,
  };
}

function normalizeTeamTask(value: unknown): TeamTask | null {
  const task = normalizeTask(value);
  if (!task || !isRecord(value)) return null;

  const author = normalizePersonRef(value.author);
  if (!author) return null;

  return {
    ...task,
    author,
    assignee: normalizePersonRef(value.assignee),
  };
}

function normalizeTeamHistoryEntry(value: unknown): TeamHistoryEntry | null {
  const task = normalizeTeamTask(value);
  if (!task || !isRecord(value)) return null;

  return {
    ...task,
    progress: 100,
    completedAt:
      typeof value.completedAt === 'string' && !Number.isNaN(Date.parse(value.completedAt))
        ? value.completedAt
        : new Date().toISOString(),
  };
}

function normalizeTeam(value: unknown, idFallback: string): Team {
  if (!isRecord(value)) {
    throw new Error('Unexpected team data format.');
  }

  const members: TeamMember[] = [];
  const seenEmails = new Set<string>();
  if (Array.isArray(value.members)) {
    for (const rawMember of value.members) {
      const member = normalizeTeamMember(rawMember);
      if (!member || seenEmails.has(member.email)) continue;
      seenEmails.add(member.email);
      members.push(member);
    }
  }

  const ownerEmail =
    normalizeEmail(value.ownerEmail) ??
    members.find((member) => member.role === 'owner')?.email ??
    members[0]?.email ??
    '';

  return {
    id: typeof value.id === 'string' && value.id ? value.id : idFallback,
    name:
      typeof value.name === 'string' && value.name.trim()
        ? value.name.trim().slice(0, maxTeamNameLength)
        : 'Untitled team',
    createdAt:
      typeof value.createdAt === 'string' && !Number.isNaN(Date.parse(value.createdAt))
        ? value.createdAt
        : new Date().toISOString(),
    ownerSub: typeof value.ownerSub === 'string' ? value.ownerSub : '',
    ownerEmail,
    members,
    tasks: Array.isArray(value.tasks)
      ? value.tasks
          .map(normalizeTeamTask)
          .filter((task): task is TeamTask => task !== null)
      : [],
    history: Array.isArray(value.history)
      ? value.history
          .map(normalizeTeamHistoryEntry)
          .filter((entry): entry is TeamHistoryEntry => entry !== null)
      : [],
  };
}

function normalizeDatabase(value: unknown): Database {
  if (!isRecord(value)) {
    throw new Error('Unexpected data format.');
  }

  return {
    tasks: Array.isArray(value.tasks)
      ? value.tasks.map(normalizeTask).filter((task): task is Task => task !== null)
      : [],
    history: Array.isArray(value.history)
      ? value.history
          .map(normalizeHistoryEntry)
          .filter((entry): entry is HistoryEntry => entry !== null)
      : [],
  };
}

function userDatabaseFile(sub: string): string {
  const key = createHash('sha256').update(`google:${sub}`).digest('hex').slice(0, 40);
  return path.join(usersDir, `${key}.json`);
}

async function persist(userSub: string, database: Database): Promise<void> {
  const write = writeQueue.catch(() => undefined).then(async () => {
    await fs.mkdir(usersDir, { recursive: true });
    const file = userDatabaseFile(userSub);
    const tempFile = `${file}.tmp`;
    await fs.writeFile(tempFile, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
    await fs.rename(tempFile, file);
  });

  writeQueue = write;
  return write;
}

function isValidTeamId(id: string): boolean {
  return /^[a-zA-Z0-9-]{8,64}$/.test(id);
}

function teamDatabaseFile(id: string): string {
  return path.join(teamsDir, `${id}.json`);
}

async function persistTeam(team: Team): Promise<void> {
  const write = teamWriteQueue.catch(() => undefined).then(async () => {
    await fs.mkdir(teamsDir, { recursive: true });
    const file = teamDatabaseFile(team.id);
    const tempFile = `${file}.tmp`;
    await fs.writeFile(tempFile, `${JSON.stringify(team, null, 2)}\n`, 'utf8');
    await fs.rename(tempFile, file);
  });

  teamWriteQueue = write;
  return write;
}

async function loadTeam(id: string): Promise<Team | null> {
  const file = teamDatabaseFile(id);

  try {
    const raw = await fs.readFile(file, 'utf8');
    return normalizeTeam(JSON.parse(raw), id);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;

    const backupFile = `${file}.corrupt-${Date.now()}`;
    try {
      await fs.rename(file, backupFile);
      console.warn(
        `Could not read ${path.basename(file)}. Backed it up to ${path.basename(backupFile)}.`,
      );
    } catch {
      console.warn(`Could not read or back up ${path.basename(file)}.`);
    }

    return null;
  }
}

function ensureTeam(id: string): Promise<Team | null> {
  const cached = teamDatabases.get(id);
  if (cached) return Promise.resolve(cached);

  const loading = teamLoads.get(id);
  if (loading) return loading;

  const load = loadTeam(id)
    .then((team) => {
      if (team) teamDatabases.set(id, team);
      return team;
    })
    .finally(() => {
      teamLoads.delete(id);
    });

  teamLoads.set(id, load);
  return load;
}

async function listTeams(): Promise<Team[]> {
  let entries: string[];

  try {
    entries = await fs.readdir(teamsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const ids = entries
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => entry.slice(0, -'.json'.length))
    .filter(isValidTeamId);

  const teams = await Promise.all(ids.map(ensureTeam));
  return teams.filter((team): team is Team => team !== null);
}

async function readLegacyDatabase(): Promise<Database> {
  try {
    await fs.access(legacyDataFile);
  } catch {
    return emptyDatabase();
  }

  try {
    const raw = await fs.readFile(legacyDataFile, 'utf8');
    const database = normalizeDatabase(JSON.parse(raw));
    const importedFile = `${legacyDataFile}.imported-${Date.now()}`;
    await fs.rename(legacyDataFile, importedFile);
    console.log(
      `Imported the existing data/tasks.json into the first account. The old file is now ${path.basename(importedFile)}.`,
    );
    return database;
  } catch (error) {
    console.error('Could not import the existing data/tasks.json.', error);
    try {
      const backupFile = `${legacyDataFile}.corrupt-${Date.now()}`;
      await fs.rename(legacyDataFile, backupFile);
      console.warn(`The old data file was backed up as ${path.basename(backupFile)}.`);
    } catch {
      // Continue with an empty account if the old file cannot be moved.
    }
    return emptyDatabase();
  }
}

function claimLegacyDatabase(user: AuthUser): Promise<Database> {
  if (legacyClaimPromise) return Promise.resolve(emptyDatabase());
  if (legacyOwnerEmail && user.email.toLowerCase() !== legacyOwnerEmail) {
    return Promise.resolve(emptyDatabase());
  }

  legacyClaimPromise = readLegacyDatabase();
  return legacyClaimPromise;
}

async function loadUserDatabase(user: AuthUser): Promise<Database> {
  const file = userDatabaseFile(user.sub);

  try {
    const raw = await fs.readFile(file, 'utf8');
    return normalizeDatabase(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const database = await claimLegacyDatabase(user);
      await persist(user.sub, database);
      return database;
    }

    const backupFile = `${file}.corrupt-${Date.now()}`;
    try {
      await fs.rename(file, backupFile);
      console.warn(`Could not read ${path.basename(file)}. Backed it up to ${path.basename(backupFile)}.`);
    } catch {
      console.warn(`Could not read or back up ${path.basename(file)}. Starting with an empty list.`);
    }

    const database = emptyDatabase();
    await persist(user.sub, database);
    return database;
  }
}

function ensureUserDatabase(user: AuthUser): Promise<Database> {
  const cached = userDatabases.get(user.sub);
  if (cached) return Promise.resolve(cached);

  const loading = userLoads.get(user.sub);
  if (loading) return loading;

  const load = loadUserDatabase(user)
    .then((database) => {
      userDatabases.set(user.sub, database);
      return database;
    })
    .finally(() => {
      userLoads.delete(user.sub);
    });

  userLoads.set(user.sub, load);
  return load;
}

async function initializeStorage(): Promise<void> {
  await fs.mkdir(usersDir, { recursive: true });
  await fs.mkdir(teamsDir, { recursive: true });
}

async function resolveSessionSecret(): Promise<string> {
  const fromEnv = process.env.SESSION_SECRET?.trim() ?? '';
  if (fromEnv.length >= 32) return fromEnv;
  if (fromEnv) {
    console.warn(
      'SESSION_SECRET is shorter than 32 characters. Generating a stronger secret in data/.session-secret instead.',
    );
  }

  const secretFile = path.join(dataDir, '.session-secret');
  try {
    const saved = (await fs.readFile(secretFile, 'utf8')).trim();
    if (saved.length >= 32) return saved;
  } catch {
    // Create a new secret below.
  }

  const generated = randomBytes(48).toString('hex');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(secretFile, generated, { mode: 0o600 });
  console.warn(
    'SESSION_SECRET is not set. Created data/.session-secret. Set SESSION_SECRET in production so sessions survive restarts and redeploys.',
  );
  return generated;
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};

  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;

    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;

    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }

  return cookies;
}

function cookieFlags(req: Request, maxAgeSeconds: number): string {
  const flags = [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];

  if (req.secure || secureCookiesInProduction) {
    flags.push('Secure');
  }

  return flags.join('; ');
}

function setCookie(
  req: Request,
  res: Response,
  name: string,
  value: string,
  maxAgeSeconds: number,
): void {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; ${cookieFlags(req, maxAgeSeconds)}`);
}

function clearCookie(req: Request, res: Response, name: string): void {
  res.append(
    'Set-Cookie',
    `${name}=; ${cookieFlags(req, 0)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  );
}

function signValue(value: string): string {
  return createHmac('sha256', sessionSecret).update(value).digest('base64url');
}

function createSessionToken(user: AuthUser): string {
  const payload = Buffer.from(
    JSON.stringify({ ...user, exp: Date.now() + sessionMaxAgeSeconds * 1000 }),
    'utf8',
  ).toString('base64url');

  return `${payload}.${signValue(payload)}`;
}

function parseSessionToken(token: string | undefined): AuthUser | null {
  if (!token) return null;

  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = signValue(payload);

  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!isRecord(parsed)) return null;
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    if (typeof parsed.sub !== 'string' || !parsed.sub) return null;
    if (typeof parsed.email !== 'string' || !parsed.email) return null;

    return {
      sub: parsed.sub,
      email: parsed.email,
      name: typeof parsed.name === 'string' && parsed.name ? parsed.name : parsed.email,
      picture: typeof parsed.picture === 'string' ? parsed.picture : null,
    };
  } catch {
    return null;
  }
}

function getSessionUser(req: Request): AuthUser | null {
  return parseSessionToken(parseCookies(req)[sessionCookieName]);
}

function getBaseUrl(req: Request): string {
  if (configuredAppUrl) return configuredAppUrl;
  return `${req.protocol}://${req.get('host') ?? `localhost:${port}`}`;
}

function getRedirectUri(req: Request): string {
  const explicit = process.env.OAUTH_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return `${getBaseUrl(req)}/api/auth/google/callback`;
}

function authErrorRedirect(res: Response, code: string): void {
  res.redirect(`/?auth_error=${encodeURIComponent(code)}`);
}

function normalizeGoogleProfile(value: unknown): AuthUser | null {
  if (!isRecord(value)) return null;
  if (value.email_verified !== true) return null;
  if (typeof value.sub !== 'string' || !value.sub) return null;
  if (typeof value.email !== 'string' || !value.email) return null;

  return {
    sub: value.sub,
    email: value.email,
    name:
      typeof value.name === 'string' && value.name.trim() ? value.name.trim() : value.email,
    picture: typeof value.picture === 'string' ? value.picture : null,
  };
}

async function handleGoogleCallback(req: Request, res: Response): Promise<void> {
  const stateCookie = parseCookies(req)[stateCookieName];
  clearCookie(req, res, stateCookieName);

  const queryState = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const oauthError = typeof req.query.error === 'string' ? req.query.error : '';

  if (oauthError) {
    authErrorRedirect(res, 'access_denied');
    return;
  }

  if (!stateCookie || !queryState || stateCookie !== queryState) {
    authErrorRedirect(res, 'state_mismatch');
    return;
  }

  if (!code) {
    authErrorRedirect(res, 'missing_code');
    return;
  }

  if (!googleConfigured) {
    authErrorRedirect(res, 'not_configured');
    return;
  }

  try {
    const redirectUri = getRedirectUri(req);
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenResponse.ok) {
      console.error(
        'Google token exchange failed:',
        tokenResponse.status,
        await tokenResponse.text(),
      );
      authErrorRedirect(res, 'oauth_failed');
      return;
    }

    const tokens: unknown = await tokenResponse.json();
    const accessToken = isRecord(tokens) && tokens.access_token;
    if (typeof accessToken !== 'string') {
      console.error('Google token response did not contain an access token.');
      authErrorRedirect(res, 'oauth_failed');
      return;
    }

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!profileResponse.ok) {
      console.error('Google profile request failed:', profileResponse.status);
      authErrorRedirect(res, 'profile_failed');
      return;
    }

    const user = normalizeGoogleProfile(await profileResponse.json());
    if (!user) {
      authErrorRedirect(res, 'profile_failed');
      return;
    }

    await ensureUserDatabase(user);
    setCookie(
      req,
      res,
      sessionCookieName,
      createSessionToken(user),
      sessionMaxAgeSeconds,
    );
    res.redirect('/');
  } catch (error) {
    console.error('Google sign-in failed:', error);
    authErrorRedirect(res, 'oauth_failed');
  }
}

async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Please sign in with Google to continue.' });
    return;
  }

  try {
    const database = await ensureUserDatabase(user);
    const authenticated = req as AuthenticatedRequest;
    authenticated.authUser = user;
    authenticated.userDatabase = database;
    next();
  } catch (error) {
    next(error);
  }
}

function getAuthUser(req: Request): AuthUser {
  const user = (req as AuthenticatedRequest).authUser;
  if (!user) throw new Error('Authenticated user missing from request.');
  return user;
}

function getUserDatabase(req: Request): Database {
  const database = (req as AuthenticatedRequest).userDatabase;
  if (!database) throw new Error('User database missing from request.');
  return database;
}

function teamRole(team: Team, user: AuthUser): 'owner' | 'member' | null {
  const email = user.email.toLowerCase();
  if (team.ownerSub === user.sub || team.ownerEmail === email) return 'owner';
  if (
    team.members.some(
      (member) => member.email === email || (member.sub !== null && member.sub === user.sub),
    )
  ) {
    return 'member';
  }
  return null;
}

function personRefForUser(user: AuthUser): PersonRef {
  return {
    sub: user.sub,
    email: user.email.toLowerCase(),
    name: user.name,
  };
}

function memberToPersonRef(member: TeamMember): PersonRef {
  return {
    sub: member.sub,
    email: member.email,
    name: member.name ?? member.email,
  };
}

function isSamePerson(ref: PersonRef | null | undefined, user: AuthUser): boolean {
  if (!ref) return false;
  return (
    ref.sub === user.sub || ref.email.toLowerCase() === user.email.toLowerCase()
  );
}

function canCompleteTeamTask(team: Team, task: TeamTask, user: AuthUser): boolean {
  return (
    teamRole(team, user) === 'owner' ||
    isSamePerson(task.author, user) ||
    isSamePerson(task.assignee, user)
  );
}

function canDeleteTeamTask(team: Team, task: TeamTask, user: AuthUser): boolean {
  return teamRole(team, user) === 'owner' || isSamePerson(task.author, user);
}

function teamSummary(team: Team, user: AuthUser) {
  return {
    id: team.id,
    name: team.name,
    createdAt: team.createdAt,
    ownerEmail: team.ownerEmail,
    role: teamRole(team, user) ?? 'member',
    memberCount: team.members.length,
    taskCount: team.tasks.length,
    historyCount: team.history.length,
  };
}

function syncMemberProfile(team: Team, user: AuthUser): boolean {
  const email = user.email.toLowerCase();
  const member = team.members.find((entry) => entry.email === email);
  if (!member) return false;

  let changed = false;
  if (member.sub !== user.sub) {
    member.sub = user.sub;
    changed = true;
  }
  if (member.name !== user.name) {
    member.name = user.name;
    changed = true;
  }
  if (member.picture !== user.picture) {
    member.picture = user.picture;
    changed = true;
  }

  const refreshRef = (ref: PersonRef | null | undefined): void => {
    if (!ref || !isSamePerson(ref, user)) return;
    if (ref.sub !== user.sub) {
      ref.sub = user.sub;
      changed = true;
    }
    if (ref.name !== user.name) {
      ref.name = user.name;
      changed = true;
    }
  };

  for (const task of team.tasks) {
    refreshRef(task.author);
    refreshRef(task.assignee);
    for (const comment of task.comments) refreshRef(comment.author);
  }

  for (const entry of team.history) {
    refreshRef(entry.author);
    refreshRef(entry.assignee);
    for (const comment of entry.comments) refreshRef(comment.author);
  }

  return changed;
}

async function syncAndPersistMemberProfile(team: Team, user: AuthUser): Promise<void> {
  if (!syncMemberProfile(team, user)) return;

  try {
    await persistTeam(team);
  } catch (error) {
    console.error('Could not save the updated team member profile.', error);
  }
}

function commitTeam(
  team: Team,
  res: Response,
  next: NextFunction,
  mutate: (team: Team) => void,
): void {
  const previousRun = teamQueues.get(team.id) ?? Promise.resolve();

  const run = previousRun.then(async () => {
    const previous = structuredClone(team);

    try {
      mutate(team);
      await persistTeam(team);
      res.json(team);
    } catch (error) {
      Object.assign(team, previous);
      next(error);
    }
  });

  teamQueues.set(team.id, run.catch(() => undefined));
}

function parseTeamName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > maxTeamNameLength) return null;
  return name;
}

function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

async function requireTeamMember(
  req: Request,
  res: Response,
  roles?: Array<'owner' | 'member'>,
): Promise<Team | null> {
  const id = req.params.id;

  if (!isValidTeamId(id)) {
    res.status(404).json({ error: 'Team not found.' });
    return null;
  }

  const user = getAuthUser(req);
  const team = await ensureTeam(id);

  if (!team) {
    res.status(404).json({ error: 'Team not found.' });
    return null;
  }

  const role = teamRole(team, user);
  if (!role) {
    res.status(403).json({ error: 'You are not a member of this team.' });
    return null;
  }

  if (roles && !roles.includes(role)) {
    res.status(403).json({ error: 'Only the team owner can do that.' });
    return null;
  }

  return team;
}

function parseTaskText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > maxTextLength) return null;
  return text;
}

function parseCommentText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseProgress(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value < 0 || value > 100) return undefined;
  return Math.round(value);
}

function commit(
  req: Request,
  res: Response,
  next: NextFunction,
  mutate: (database: Database) => void,
): void {
  const user = getAuthUser(req);
  const database = getUserDatabase(req);
  const previousRun = userQueues.get(user.sub) ?? Promise.resolve();

  const run = previousRun.then(async () => {
    const previous = structuredClone(database);

    try {
      mutate(database);
      await persist(user.sub, database);
      res.json(database);
    } catch (error) {
      database.tasks = previous.tasks;
      database.history = previous.history;
      next(error);
    }
  });

  userQueues.set(user.sub, run.catch(() => undefined));
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '28kb' }));

app.get('/api/auth/me', (req, res) => {
  res.json({ user: getSessionUser(req), configured: googleConfigured });
});

app.get('/api/auth/google', (req, res) => {
  if (!googleConfigured) {
    res.status(503).json({ error: 'Google sign-in is not configured on this server.' });
    return;
  }

  const state = randomBytes(24).toString('hex');
  setCookie(req, res, stateCookieName, state, 10 * 60);

  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: getRedirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get('/api/auth/google/callback', (req, res) => {
  handleGoogleCallback(req, res).catch((error: unknown) => {
    console.error('Google callback failed:', error);
    if (!res.headersSent) authErrorRedirect(res, 'oauth_failed');
  });
});

app.post('/api/auth/logout', (req, res) => {
  clearCookie(req, res, sessionCookieName);
  clearCookie(req, res, stateCookieName);
  res.json({ ok: true });
});

const api = express.Router();
api.use((req, res, next) => {
  requireAuth(req, res, next).catch(next);
});

api.get('/state', (req, res) => {
  res.json(getUserDatabase(req));
});

api.get(
  '/teams',
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const teams = (await listTeams())
      .filter((team) => teamRole(team, user) !== null)
      .sort((first, second) => first.createdAt.localeCompare(second.createdAt));

    await Promise.all(teams.map((team) => syncAndPersistMemberProfile(team, user)));
    res.json({ teams: teams.map((team) => teamSummary(team, user)) });
  }),
);

api.post('/teams', (req, res, next) => {
  const user = getAuthUser(req);
  const body = req.body as { name?: unknown } | undefined;
  const name = parseTeamName(body?.name);

  if (!name) {
    res.status(400).json({
      error: `Team name must be between 1 and ${maxTeamNameLength} characters.`,
    });
    return;
  }

  const now = new Date().toISOString();
  const email = user.email.toLowerCase();
  const team: Team = {
    id: randomUUID(),
    name,
    createdAt: now,
    ownerSub: user.sub,
    ownerEmail: email,
    members: [
      {
        email,
        role: 'owner',
        addedAt: now,
        sub: user.sub,
        name: user.name,
        picture: user.picture,
      },
    ],
    tasks: [],
    history: [],
  };

  void (async () => {
    await persistTeam(team);
    teamDatabases.set(team.id, team);
    res.status(201).json(team);
  })().catch(next);
});

api.get(
  '/teams/:id',
  asyncHandler(async (req, res) => {
    const team = await requireTeamMember(req, res);
    if (!team) return;

    await syncAndPersistMemberProfile(team, getAuthUser(req));
    res.json(team);
  }),
);

api.post(
  '/teams/:id/members',
  asyncHandler(async (req, res, next) => {
    const team = await requireTeamMember(req, res);
    if (!team) return;

    const body = req.body as { email?: unknown } | undefined;
    const email = normalizeEmail(body?.email);

    if (!email) {
      res.status(400).json({ error: 'Enter a valid email address.' });
      return;
    }

    if (team.members.some((member) => member.email === email)) {
      res.status(409).json({ error: 'That email address is already on the team.' });
      return;
    }

    if (team.members.length >= maxTeamMembers) {
      res.status(400).json({ error: `A team can have at most ${maxTeamMembers} members.` });
      return;
    }

    const addedAt = new Date().toISOString();
    commitTeam(team, res, next, (current) => {
      if (current.members.some((member) => member.email === email)) return;
      if (current.members.length >= maxTeamMembers) return;

      current.members.push({
        email,
        role: 'member',
        addedAt,
        sub: null,
        name: null,
        picture: null,
      });
    });
  }),
);

api.delete(
  '/teams/:id/members/:email',
  asyncHandler(async (req, res, next) => {
    const team = await requireTeamMember(req, res);
    if (!team) return;

    const user = getAuthUser(req);
    const email = normalizeEmail(req.params.email);
    if (!email) {
      res.status(400).json({ error: 'Enter a valid email address.' });
      return;
    }

    const target = team.members.find((member) => member.email === email);
    if (!target) {
      res.status(404).json({ error: 'That person is not on this team.' });
      return;
    }

    const ownerTarget =
      target.role === 'owner' ||
      email === team.ownerEmail ||
      (target.sub !== null && target.sub === team.ownerSub);

    if (ownerTarget) {
      res.status(400).json({
        error: 'The team owner cannot be removed. Delete the team instead.',
      });
      return;
    }

    const isSelf = email === user.email.toLowerCase();
    if (teamRole(team, user) !== 'owner' && !isSelf) {
      res.status(403).json({ error: 'Only the team owner can remove other members.' });
      return;
    }

    commitTeam(team, res, next, (current) => {
      const index = current.members.findIndex((member) => member.email === email);
      if (index !== -1) current.members.splice(index, 1);
    });
  }),
);

api.delete(
  '/teams/:id',
  asyncHandler(async (req, res, next) => {
    const team = await requireTeamMember(req, res, ['owner']);
    if (!team) return;

    const pending = teamQueues.get(team.id);
    if (pending) await pending.catch(() => undefined);

    try {
      await fs.unlink(teamDatabaseFile(team.id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        next(error);
        return;
      }
    }

    teamDatabases.delete(team.id);
    teamQueues.delete(team.id);
    res.json({ ok: true });
  }),
);

api.post(
  '/teams/:id/tasks',
  asyncHandler(async (req, res, next) => {
    const team = await requireTeamMember(req, res);
    if (!team) return;

    const user = getAuthUser(req);
    const body = req.body as
      | { text?: unknown; dueAt?: unknown; assigneeEmail?: unknown }
      | undefined;
    const text = parseTaskText(body?.text);
    const dueAt = parseDueAt(body?.dueAt);

    if (!text) {
      res.status(400).json({
        error: `Task text must be between 1 and ${maxTextLength} characters.`,
      });
      return;
    }

    if (dueAt === undefined) {
      res.status(400).json({ error: 'Deadline is not a valid date.' });
      return;
    }

    let assignee = personRefForUser(user);
    const rawAssignee = body?.assigneeEmail;
    if (rawAssignee !== undefined && rawAssignee !== null && rawAssignee !== '') {
      const assigneeEmail = normalizeEmail(rawAssignee);
      if (!assigneeEmail) {
        res.status(400).json({ error: 'Choose a valid assignee.' });
        return;
      }

      const member = team.members.find((entry) => entry.email === assigneeEmail);
      if (!member) {
        res.status(400).json({ error: 'Choose a teammate who is on this team.' });
        return;
      }

      assignee = memberToPersonRef(member);
    }

    commitTeam(team, res, next, (current) => {
      current.tasks.unshift({
        id: randomUUID(),
        text,
        createdAt: new Date().toISOString(),
        dueAt,
        progress: 0,
        comments: [],
        author: personRefForUser(user),
        assignee,
      });
    });
  }),
);

api.post(
  '/teams/:id/tasks/:taskId/complete',
  asyncHandler(async (req, res, next) => {
    const team = await requireTeamMember(req, res);
    if (!team) return;

    const user = getAuthUser(req);
    const task = team.tasks.find((entry) => entry.id === req.params.taskId);

    if (!task) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }

    if (!canCompleteTeamTask(team, task, user)) {
      res.status(403).json({
        error: 'Only the task owner, its assignee, or the team owner can complete it.',
      });
      return;
    }

    commitTeam(team, res, next, (current) => {
      const index = current.tasks.findIndex((entry) => entry.id === task.id);
      if (index === -1) return;
      const [completed] = current.tasks.splice(index, 1);
      current.history.unshift({
        ...completed,
        progress: 100,
        completedAt: new Date().toISOString(),
      });
    });
  }),
);

api.post(
  '/teams/:id/tasks/:taskId/comments',
  asyncHandler(async (req, res, next) => {
    const team = await requireTeamMember(req, res);
    if (!team) return;

    const user = getAuthUser(req);
    const task = team.tasks.find((entry) => entry.id === req.params.taskId);

    if (!task) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }

    const body = req.body as { text?: unknown; progress?: unknown } | undefined;
    const text = parseCommentText(body?.text);
    const progress = parseProgress(body?.progress);

    if (text.length > maxCommentLength) {
      res.status(400).json({
        error: `Comment must be ${maxCommentLength} characters or fewer.`,
      });
      return;
    }

    if (progress === undefined) {
      res.status(400).json({ error: 'Progress must be a number between 0 and 100.' });
      return;
    }

    if (!text && progress === null) {
      res.status(400).json({ error: 'Add a comment or a progress value.' });
      return;
    }

    commitTeam(team, res, next, (current) => {
      const target = current.tasks.find((entry) => entry.id === task.id);
      if (!target) return;

      target.comments.unshift({
        id: randomUUID(),
        text,
        progress,
        createdAt: new Date().toISOString(),
        author: personRefForUser(user),
      });

      if (progress !== null) {
        target.progress = progress;
      }
    });
  }),
);

api.delete(
  '/teams/:id/tasks/:taskId/comments/:commentId',
  asyncHandler(async (req, res, next) => {
    const team = await requireTeamMember(req, res);
    if (!team) return;

    const user = getAuthUser(req);
    const task = team.tasks.find((entry) => entry.id === req.params.taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }

    const comment = task.comments.find((entry) => entry.id === req.params.commentId);
    if (!comment) {
      res.status(404).json({ error: 'Update not found.' });
      return;
    }

    if (teamRole(team, user) !== 'owner' && !isSamePerson(comment.author, user)) {
      res.status(403).json({ error: 'You can only delete your own updates.' });
      return;
    }

    commitTeam(team, res, next, (current) => {
      const target = current.tasks.find((entry) => entry.id === task.id);
      if (!target) return;
      const index = target.comments.findIndex((entry) => entry.id === comment.id);
      if (index !== -1) target.comments.splice(index, 1);
    });
  }),
);

api.delete(
  '/teams/:id/tasks/:taskId',
  asyncHandler(async (req, res, next) => {
    const team = await requireTeamMember(req, res);
    if (!team) return;

    const user = getAuthUser(req);
    const task = team.tasks.find((entry) => entry.id === req.params.taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }

    if (!canDeleteTeamTask(team, task, user)) {
      res.status(403).json({
        error: 'Only the person who added the task or the team owner can delete it.',
      });
      return;
    }

    commitTeam(team, res, next, (current) => {
      const index = current.tasks.findIndex((entry) => entry.id === task.id);
      if (index !== -1) current.tasks.splice(index, 1);
    });
  }),
);

api.delete(
  '/teams/:id/history',
  asyncHandler(async (req, res, next) => {
    const team = await requireTeamMember(req, res, ['owner']);
    if (!team) return;

    commitTeam(team, res, next, (current) => {
      current.history = [];
    });
  }),
);

api.post('/tasks', (req, res, next) => {
  const database = getUserDatabase(req);
  const body = req.body as { text?: unknown; dueAt?: unknown } | undefined;
  const text = parseTaskText(body?.text);
  const dueAt = parseDueAt(body?.dueAt);

  if (!text) {
    res.status(400).json({
      error: `Task text must be between 1 and ${maxTextLength} characters.`,
    });
    return;
  }

  if (dueAt === undefined) {
    res.status(400).json({ error: 'Deadline is not a valid date.' });
    return;
  }

  commit(req, res, next, () => {
    database.tasks.unshift({
      id: randomUUID(),
      text,
      createdAt: new Date().toISOString(),
      dueAt,
      progress: 0,
      comments: [],
    });
  });
});

api.post('/tasks/:id/complete', (req, res, next) => {
  const database = getUserDatabase(req);
  const index = database.tasks.findIndex((task) => task.id === req.params.id);

  if (index === -1) {
    res.status(404).json({
      error: 'Task not found. It may have already been completed or deleted.',
    });
    return;
  }

  commit(req, res, next, () => {
    const [task] = database.tasks.splice(index, 1);
    database.history.unshift({
      ...task,
      progress: 100,
      completedAt: new Date().toISOString(),
    });
  });
});

api.post('/tasks/:id/comments', (req, res, next) => {
  const database = getUserDatabase(req);
  const task = database.tasks.find((entry) => entry.id === req.params.id);

  if (!task) {
    res.status(404).json({ error: 'Task not found.' });
    return;
  }

  const body = req.body as { text?: unknown; progress?: unknown } | undefined;
  const text = parseCommentText(body?.text);
  const progress = parseProgress(body?.progress);

  if (text.length > maxCommentLength) {
    res.status(400).json({
      error: `Comment must be ${maxCommentLength} characters or fewer.`,
    });
    return;
  }

  if (progress === undefined) {
    res.status(400).json({ error: 'Progress must be a number between 0 and 100.' });
    return;
  }

  if (!text && progress === null) {
    res.status(400).json({ error: 'Add a comment or a progress value.' });
    return;
  }

  commit(req, res, next, () => {
    task.comments.unshift({
      id: randomUUID(),
      text,
      progress,
      createdAt: new Date().toISOString(),
    });

    if (progress !== null) {
      task.progress = progress;
    }
  });
});

api.delete('/tasks/:id/comments/:commentId', (req, res, next) => {
  const database = getUserDatabase(req);
  const task = database.tasks.find((entry) => entry.id === req.params.id);

  if (!task) {
    res.status(404).json({ error: 'Task not found.' });
    return;
  }

  const index = task.comments.findIndex((comment) => comment.id === req.params.commentId);

  if (index === -1) {
    res.status(404).json({ error: 'Update not found.' });
    return;
  }

  commit(req, res, next, () => {
    task.comments.splice(index, 1);
  });
});

api.delete('/tasks/:id', (req, res, next) => {
  const database = getUserDatabase(req);
  const index = database.tasks.findIndex((task) => task.id === req.params.id);

  if (index === -1) {
    res.status(404).json({ error: 'Task not found.' });
    return;
  }

  commit(req, res, next, () => {
    database.tasks.splice(index, 1);
  });
});

api.delete('/history', (req, res, next) => {
  const database = getUserDatabase(req);
  commit(req, res, next, () => {
    database.history = [];
  });
});

app.use('/api', api);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

const hasBuild = await fileExists(path.join(distDir, 'index.html'));

if (hasBuild) {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .type('text/plain')
      .send(
        'Frontend build not found. Run "npm run dev" for development, or "npm run build" then "npm start".',
      );
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: 'Invalid JSON body.' });
    return;
  }

  console.error(error);
  res.status(500).json({ error: 'Could not save your changes. Please try again.' });
});

await initializeStorage();
sessionSecret = await resolveSessionSecret();

const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  console.log(
    googleConfigured
      ? 'Google sign-in is configured.'
      : 'Google sign-in is NOT configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.',
  );
  if (hasBuild) {
    console.log(`App available at http://localhost:${port}`);
  }
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${port} is already in use. Stop the other process or set PORT to a different value.`,
    );
  } else {
    console.error(error);
  }
  process.exit(1);
});
