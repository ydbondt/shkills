import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export interface Message {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sending mail.
 *
 * There is exactly one thing Shkills ever sends — a password-reset link — so
 * this stays a plain-text sender with three transports and no template engine.
 *
 * `send` answers whether the message actually left, and never throws: a failing
 * mail server must not turn "I forgot my password" into a 500, and must not
 * change the answer the caller gives (which has to be the same whether or not
 * the account exists). The caller falls back to the administrator queue.
 */
export async function send(message: Message): Promise<boolean> {
  try {
    switch (config.mail.transport) {
      case 'smtp':
        return await sendSmtp(message);
      case 'file':
        return sendToFile(message);
      default:
        return false;
    }
  } catch (err) {
    console.error('[shkills] could not send mail:', err instanceof Error ? err.message : err);
    return false;
  }
}

/** Whether a self-service request can be delivered without a human in the loop. */
export function canDeliver(): boolean {
  return config.mail.transport !== 'none';
}

async function sendSmtp(message: Message): Promise<boolean> {
  if (!config.mail.smtpUrl) {
    console.error('[shkills] SHKILLS_MAIL_TRANSPORT=smtp but SHKILLS_SMTP_URL is not set');
    return false;
  }
  // Imported here so a deployment that never sends mail never loads it.
  const { createTransport } = await import('nodemailer');
  const transport = createTransport(config.mail.smtpUrl);
  try {
    await transport.sendMail({
      from: config.mail.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    return true;
  } finally {
    transport.close();
  }
}

/**
 * Writes the message where an operator can read it. Useful for trying the flow
 * out, and it is what the acceptance tests read, so they exercise the real
 * delivery decision rather than a stub of it.
 */
function sendToFile(message: Message): boolean {
  fs.mkdirSync(config.mail.dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = message.to.replace(/[^a-z0-9@._-]/gi, '_');
  const file = path.join(config.mail.dir, `${stamp}-${safe}.txt`);
  const body = [
    `From: ${config.mail.from}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    '',
    message.text,
    '',
  ].join('\n');
  fs.writeFileSync(file, body, { mode: 0o600 });
  return true;
}

/** The one message Shkills sends. */
export function resetMessage(to: string, name: string, url: string, ttlMinutes: number): Message {
  return {
    to,
    subject: 'Your Shkills password',
    text: [
      `Hello ${name},`,
      '',
      'Somebody asked to set a new password for your Shkills account.',
      'If that was you, open this link and choose one:',
      '',
      url,
      '',
      `The link works once, and stops working in ${ttlMinutes} minutes.`,
      '',
      'If it was not you, you do not have to do anything: your password has not',
      'changed, and nobody can use this link without opening this mailbox.',
    ].join('\n'),
  };
}
