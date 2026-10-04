import { createHmac, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import type { Pool, QueryResultRow } from 'pg';
import { logActivity } from '../activity-log';
import { isValidEmail, isValidUsername, passwordProblem } from '../auth-validation';
import { BREACHED_PASSWORD_MESSAGE, isBreachedPassword } from '../breached-password';
import { recordLoginEvent } from './security';
import { RequestError, withTransaction } from '../transaction';

/**
 * Registration, login, profile and account recovery: the auth routes moved from
 * the former Express app (the last N3 group). Same validation, messages and recovery rules. The route
 * handlers create and destroy sessions (lib/session.ts); these functions only work with users.
 */

type Body = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

// ----- Registration and login -----

/** Create a user and return its id (tracking option 'both' until the welcome step sets it) */
export async function register(pool: Pool, body: Body): Promise<number> {
    const { username, password, name, email, securityQuestion, securityAnswer } = body;
    if (!username || !password || !name || !email || !securityQuestion || !securityAnswer
        || [username, password, name, email, securityQuestion, securityAnswer].some(value => typeof value !== 'string')) {
        throw new RequestError(400, 'All fields are required');
    }
    const [u, p, n, e, q, a] = [username, password, name, email, securityQuestion, securityAnswer].map(str) as
        [string, string, string, string, string, string];
    if (u.length > 50) throw new RequestError(400, 'Username too long (max 50 characters)');
    if (n.length > 100) throw new RequestError(400, 'Name too long (max 100 characters)');
    if (e.length > 255) throw new RequestError(400, 'Email too long (max 255 characters)');
    if (a.length > 200) throw new RequestError(400, 'Security answer too long (max 200 characters)');
    if (!isValidEmail(e)) throw new RequestError(400, 'Invalid email format');
    if (!isValidUsername(u)) throw new RequestError(400, 'Username can only contain letters, numbers, and underscores');
    const problem = passwordProblem(p, u);
    if (problem) throw new RequestError(400, problem);

    const existing = await pool.query('SELECT id FROM users WHERE username = $1 OR email = $2', [u, e]);
    if (existing.rows.length > 0) throw new RequestError(400, 'Username or email already exists');
    if (await isBreachedPassword(p)) throw new RequestError(400, BREACHED_PASSWORD_MESSAGE);

    const passwordHash = await bcrypt.hash(p, 10);
    const answerHash = await bcrypt.hash(a.toLowerCase().trim(), 10);
    try {
        const result = await pool.query(
            'INSERT INTO users (username, password_hash, name, email, security_question, security_answer_hash, tracking_option) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [u, passwordHash, n, e, q, answerHash, 'both'],
        );
        return result.rows[0].id;
    } catch (error) {
        if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505') {
            throw new RequestError(400, 'Username or email already exists');
        }
        throw error;
    }
}

/**
 * Check a username and password (the first step of a login); returns the user's id and whether
 * two-factor login is set up. A wrong password for an existing account goes into its login history.
 */
export async function login(pool: Pool, body: Body, userAgent: string | null = null): Promise<{ id: number; twoFactorEnabled: boolean }> {
    const { username, password } = body;
    if (!username || !password) throw new RequestError(400, 'Username and password are required');
    if (typeof username !== 'string' || typeof password !== 'string' || !isValidUsername(username)) {
        throw new RequestError(400, 'Invalid username format. Username can only contain letters, numbers, and underscores');
    }
    const result = await pool.query('SELECT id, password_hash, totp_enabled_at FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        if (user) await recordLoginEvent(pool, user.id, 'wrong_password', userAgent);
        throw new RequestError(400, 'Invalid credentials');
    }
    return { id: user.id, twoFactorEnabled: user.totp_enabled_at !== null };
}

export async function getUser(pool: Pool, userId: number): Promise<QueryResultRow> {
    const result = await pool.query('SELECT name, tracking_option FROM users WHERE id = $1', [userId]);
    return result.rows[0] ?? {};
}

export async function setTrackingOption(pool: Pool, userId: number, body: Body): Promise<void> {
    const { trackingOption } = body;
    if (trackingOption !== 'income' && trackingOption !== 'expenses' && trackingOption !== 'both') {
        throw new RequestError(400, 'Invalid tracking option');
    }
    await pool.query('UPDATE users SET tracking_option = $1 WHERE id = $2', [trackingOption, userId]);
}

// ----- Account recovery -----
// Responses never reveal whether an account exists: an unknown username or email gets a stable
// made-up security question, and every failed answer (unknown account, wrong answer, or recovery
// paused) gets the same message. Wrong answers are recorded in the account's activity log, and
// RECOVERY_MAX_FAILURES within RECOVERY_WINDOW_MINUTES pause recovery for that account.

const RECOVERY_QUESTIONS = ['pet', 'school', 'city', 'mother', 'car', 'street'];
const RECOVERY_MAX_FAILURES = 5;
const RECOVERY_WINDOW_MINUTES = 15;
export const RECOVERY_FAILED_MESSAGE = `Security answer could not be verified. Check it and try again; after ${RECOVERY_MAX_FAILURES} failed attempts, recovery is paused for ${RECOVERY_WINDOW_MINUTES} minutes.`;

// Without SESSION_SECRET (local runs), a per-process key: made-up questions then change on restart
const fallbackRecoveryKey = randomBytes(32).toString('hex');
const recoveryKey = () => process.env.SESSION_SECRET || fallbackRecoveryKey;

// Unknown or paused accounts still cost one bcrypt comparison, so timing does not tell them apart
let dummyAnswerHash: Promise<string> | undefined;
async function compareWithDummy(answer: string): Promise<void> {
    dummyAnswerHash ??= bcrypt.hash(randomBytes(16).toString('hex'), 10);
    await bcrypt.compare(answer, await dummyAnswerHash);
}

type Identifier = { column: 'email' | 'username'; value: string };

/** The lookup column and value from { username } or { email }; format errors reveal nothing */
function recoveryIdentifier(body: Body, emailOnly = false): Identifier {
    const { username, email } = body;
    if (email) {
        if (typeof email !== 'string' || email.length > 255 || !isValidEmail(email)) throw new RequestError(400, 'Invalid email format');
        return { column: 'email', value: email };
    }
    if (emailOnly) throw new RequestError(400, 'Email is required');
    if (username) {
        if (typeof username !== 'string' || username.length > 50 || !isValidUsername(username)) {
            throw new RequestError(400, 'Invalid username format. Username can only contain letters, numbers, and underscores');
        }
        return { column: 'username', value: username };
    }
    throw new RequestError(400, 'Username or email is required');
}

async function findRecoveryUser(pool: Pool, { column, value }: Identifier): Promise<QueryResultRow | null> {
    const result = await pool.query(
        `SELECT id, username, security_question, security_answer_hash FROM users WHERE ${column === 'email' ? 'email' : 'username'} = $1`,
        [value],
    );
    return result.rows[0] ?? null;
}

/** The question to show: the account's own, or one derived from the identifier so repeated lookups match */
function recoveryQuestion(user: QueryResultRow | null, value: string): string {
    if (user) return user.security_question;
    const digest = createHmac('sha256', recoveryKey()).update(value.trim().toLowerCase()).digest();
    return RECOVERY_QUESTIONS[digest.readUInt32BE(0) % RECOVERY_QUESTIONS.length]!;
}

/** True when the answer is right and recovery is not paused; records each wrong answer */
async function checkRecoveryAnswer(pool: Pool, user: QueryResultRow | null, securityAnswer: string): Promise<boolean> {
    const answer = securityAnswer.toLowerCase().trim();
    if (!user) {
        await compareWithDummy(answer);
        return false;
    }
    const failures = await pool.query(
        `SELECT COUNT(*)::int AS n FROM activity_log
         WHERE user_id = $1 AND action_type = 'recovery_failed' AND created_at > LOCALTIMESTAMP - make_interval(mins => $2)`,
        [user.id, RECOVERY_WINDOW_MINUTES],
    );
    if (failures.rows[0].n >= RECOVERY_MAX_FAILURES) {
        await compareWithDummy(answer);
        return false;
    }
    if (await bcrypt.compare(answer, user.security_answer_hash)) return true;
    // A single insert on its own: it must persist even though the request fails
    await logActivity(pool, user.id, 'recovery_failed', 'account', user.id, 'Failed account recovery attempt: wrong security answer');
    return false;
}

const validAnswer = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '' && value.length <= 200;

/** Step 1 { email }: the security question. Step 2 { email, securityAnswer }: the username */
export async function forgotUsername(pool: Pool, body: Body): Promise<Record<string, unknown>> {
    const identifier = recoveryIdentifier({ email: body.email }, true);
    const user = await findRecoveryUser(pool, identifier);
    if (body.securityAnswer === undefined) return { success: true, securityQuestion: recoveryQuestion(user, identifier.value) };
    if (!validAnswer(body.securityAnswer)) throw new RequestError(400, 'Security answer is required');
    if (!(await checkRecoveryAnswer(pool, user, body.securityAnswer))) throw new RequestError(400, RECOVERY_FAILED_MESSAGE);
    return { success: true, username: user!.username };
}

/** Password reset step 1 { username } or { email }: the security question */
export async function forgotPassword(pool: Pool, body: Body): Promise<Record<string, unknown>> {
    const identifier = recoveryIdentifier(body);
    const user = await findRecoveryUser(pool, identifier);
    return { success: true, securityQuestion: recoveryQuestion(user, identifier.value) };
}

/** Step 2: set a new password after the right answer; signs the account out everywhere and logs it */
export async function resetPassword(pool: Pool, body: Body): Promise<void> {
    const identifier = recoveryIdentifier(body);
    const { securityAnswer, newPassword } = body;
    if (!validAnswer(securityAnswer) || !newPassword || typeof newPassword !== 'string') {
        throw new RequestError(400, 'All fields are required');
    }
    const user = await findRecoveryUser(pool, identifier);
    const problem = passwordProblem(newPassword, user?.username ?? '');
    if (problem) throw new RequestError(400, problem);
    if (!(await checkRecoveryAnswer(pool, user, securityAnswer))) throw new RequestError(400, RECOVERY_FAILED_MESSAGE);
    if (await isBreachedPassword(newPassword)) throw new RequestError(400, BREACHED_PASSWORD_MESSAGE);

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await withTransaction(pool, async (client) => {
        await client.query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [passwordHash, user!.id]);
        await client.query('DELETE FROM session WHERE sess->>\'userId\' = $1', [String(user!.id)]);
        await logActivity(client, user!.id, 'password_reset', 'account', user!.id, 'Password reset through the security question; all sessions signed out');
        await recordLoginEvent(client, user!.id, 'password_changed');
    });
}
