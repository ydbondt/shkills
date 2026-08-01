import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { db } from '../db.js';
import { hashPassword } from '../auth.js';

export const app: Express = createApp();

export function resetDb(): void {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM audit_log;
    DELETE FROM device_auth;
    DELETE FROM device_tokens;
    DELETE FROM password_resets;
    DELETE FROM subscriptions;
    DELETE FROM collection_skills;
    DELETE FROM collections;
    UPDATE skills SET published_version_id = NULL;
    DELETE FROM skill_versions;
    DELETE FROM skills;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
    PRAGMA foreign_keys = ON;
  `);
}

export function makeUser(
  email: string,
  role: 'member' | 'curator' | 'admin' = 'member',
  name = email.split('@')[0],
): number {
  return Number(
    db
      .prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(email, name, hashPassword('password123'), role).lastInsertRowid,
  );
}

/** Signs in and returns the session cookie, ready to hand to supertest. */
export async function login(email: string, password = 'password123'): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${res.text}`);
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw];
  return cookies.map((c: string) => c.split(';')[0]).join('; ');
}

export const sampleSkill = {
  slug: 'commit-messages',
  title: 'Conventional Commit Messages',
  description:
    'Use when writing a git commit message, so that every commit follows the company conventional-commit format.',
  category: 'engineering',
  audiences: ['engineering'],
  tags: ['git'],
  userInvocable: false,
  body: 'Write commit messages as `type(scope): summary`. Keep the summary under 72 characters.',
  changeNote: 'initial version',
};
