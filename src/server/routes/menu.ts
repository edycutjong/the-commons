/**
 * Moderator menu actions: Seed Preseason · Void Round · Force Settle ·
 * Approve Forge Dilemma. All respond with Devvit UiResponse-shaped JSON
 * ({ showToast }) — shape per the official template/menu docs.
 */

import { Hono } from 'hono';
import type { Deps } from '../core/deps';
import { K } from '../core/keys';
import { seedPreseason } from '../core/seed';
import { approveForge } from '../core/forge';
import { runSettlePass } from './cron';
import { dayOf } from '../core/time';

type UiResponse = { showToast?: string; navigateTo?: string };

export function makeMenu(deps: Deps): Hono {
  const menu = new Hono();

  menu.post('/seed-preseason', async (c) => {
    try {
      const result = await seedPreseason(deps, dayOf(deps.now()));
      return c.json<UiResponse>({
        showToast: `Preseason seeded: ${result.seededRounds} rounds settled, tonight open (day ${result.tonightDay}).`,
      });
    } catch (e) {
      console.error('seed failed:', e);
      return c.json<UiResponse>({ showToast: 'Seeding failed — check logs.' }, 400);
    }
  });

  menu.post('/void-round', async (c) => {
    const pointer = await deps.redis.get(K.roundCurrent);
    if (!pointer) return c.json<UiResponse>({ showToast: 'No current round to void.' });
    const day = Number.parseInt(pointer, 10);
    const state = await deps.redis.hGet(K.round(day), 'state');
    if (state !== 'open') {
      return c.json<UiResponse>({ showToast: `Round ${day} is not open (state: ${state ?? 'none'}).` });
    }
    await deps.redis.hSet(K.round(day), { state: 'void' });
    return c.json<UiResponse>({
      showToast: `Round ${day} voided. Envelopes stay sealed forever; no payouts.`,
    });
  });

  menu.post('/force-settle', async (c) => {
    try {
      const result = await runSettlePass(deps);
      const text =
        result.status === 'settled'
          ? `Round ${result.day} settled. The Reckoning is live.`
          : `Settle pass: ${result.status}${result.day !== undefined ? ` (day ${result.day})` : ''}.`;
      return c.json<UiResponse>({ showToast: text });
    } catch (e) {
      console.error('force settle failed:', e);
      return c.json<UiResponse>({ showToast: 'Settle failed — check logs.' }, 400);
    }
  });

  menu.post('/approve-forge', async (c) => {
    const result = await approveForge(deps);
    return c.json<UiResponse>({
      showToast: result.ok
        ? `Approved “${result.title}” by u/${result.author}. It rotates in at the next open.`
        : result.message,
    });
  });

  return menu;
}
