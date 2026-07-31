import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { h } from '../http.js';
import { buildManifest } from '../services/sync.js';

export const syncRouter: Router = Router();

/**
 * The endpoint every installed CLI hits, potentially on every Claude session
 * start. It answers `304 Not Modified` when the caller's manifest hash still
 * matches, so the common case costs one small query and no payload.
 */
syncRouter.get(
  '/',
  requireAuth,
  h((req, res) => {
    const manifest = buildManifest(req.user!.id);
    res.setHeader('ETag', `"${manifest.manifest}"`);
    res.setHeader('Cache-Control', 'no-cache');

    const known = (req.header('if-none-match') ?? '').replace(/"/g, '').trim();
    if (req.deviceTokenId) {
      db.prepare("UPDATE device_tokens SET last_sync_at = datetime('now') WHERE id = ?").run(
        req.deviceTokenId,
      );
    }
    if (known && known === manifest.manifest) {
      res.status(304).end();
      return;
    }

    res.json({
      manifest: manifest.manifest,
      generatedAt: manifest.generatedAt,
      user: { name: req.user!.name, email: req.user!.email },
      skills: manifest.skills.map((s) => ({
        slug: s.slug,
        title: s.title,
        description: s.description,
        category: s.category,
        audiences: s.audiences,
        tags: s.tags,
        version: s.version,
        checksum: s.checksum,
        content: s.content,
        sources: s.sources,
        updatedAt: s.updatedAt,
      })),
    });
  }),
);
