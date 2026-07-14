/**
 * The weekly flair ceremony: #1 Saint, #1 Serpent, seeded Wildcard, ×0.8
 * ladder decay, synthetic-founder exclusion, and the flair-template
 * cache/fallback/error paths.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, type TestEnv } from './helpers/env';
import { weeklyCeremony } from '../src/server/core/ceremony';
import { K } from '../src/server/core/keys';

describe('weeklyCeremony', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  it('crowns the top saint/serpent, picks a seeded wildcard, and decays both ladders', async () => {
    await env.redis.zAdd(
      K.repSaint,
      { member: 'ash', score: 50 },
      { member: 'birch', score: 30 }
    );
    await env.redis.zAdd(
      K.repSerpent,
      { member: 'cedar', score: 40 },
      { member: 'ash', score: 5 } // ash is also a minor serpent but crowned saint already
    );
    await env.redis.zAdd(
      K.seasonPoints,
      { member: 'ash', score: 150 },
      { member: 'birch', score: 120 },
      { member: 'cedar', score: 110 },
      { member: 'dill', score: 200 }
    );

    const result = await weeklyCeremony(env.deps);
    expect(result.saint).toBe('ash');
    expect(result.serpent).toBe('cedar'); // ash excluded — already crowned saint
    expect(result.wildcard).not.toBeNull();
    expect(result.wildcard).not.toBe('ash');
    expect(result.wildcard).not.toBe('cedar');
    expect(result.decayed).toEqual({ saint: 2, serpent: 2 });
    expect(result.flairErrors).toEqual([]);

    // decay ×0.8 floored
    expect(await env.redis.zScore(K.repSaint, 'ash')).toBe(40);
    expect(await env.redis.zScore(K.repSaint, 'birch')).toBe(24);

    // flair applied for all three crowned roles, via the cached templates
    const saintTemplate = env.reddit.flairTemplates.find((t) => t.text.includes('Saint'));
    const saintFlair = env.reddit.flairSet.find((f) => f.username === 'ash');
    expect(saintFlair?.flairTemplateId).toBe(saintTemplate?.id);
    const serpentTemplate = env.reddit.flairTemplates.find((t) => t.text.includes('Serpent'));
    const serpentFlair = env.reddit.flairSet.find((f) => f.username === 'cedar');
    expect(serpentFlair?.flairTemplateId).toBe(serpentTemplate?.id);

    // ceremony:last recorded
    const raw = await env.redis.get(K.ceremonyLast);
    expect(JSON.parse(raw!)).toMatchObject({ saint: 'ash', serpent: 'cedar' });
  });

  it('is deterministic: the same scores + week produce the same wildcard', async () => {
    async function crownIn(e: TestEnv) {
      await e.redis.zAdd(K.repSaint, { member: 'ash', score: 10 });
      await e.redis.zAdd(K.seasonPoints, { member: 'ash', score: 10 }, { member: 'elm', score: 10 });
      return weeklyCeremony(e.deps);
    }
    const r1 = await crownIn(env);
    const env2 = makeEnv({ now: env.now() });
    const r2 = await crownIn(env2);
    expect(r2.wildcard).toBe(r1.wildcard);
  });

  it('decay drops a member to zero and removes it from the ladder', async () => {
    await env.redis.zAdd(K.repSaint, { member: 'faint', score: 1 }); // floor(1*0.8)=0
    await weeklyCeremony(env.deps);
    expect(await env.redis.zScore(K.repSaint, 'faint')).toBeUndefined();
  });

  it('an empty ladder decays to zero rounds touched', async () => {
    const result = await weeklyCeremony(env.deps);
    expect(result.saint).toBeNull();
    expect(result.serpent).toBeNull();
    expect(result.wildcard).toBeNull();
    expect(result.decayed).toEqual({ saint: 0, serpent: 0 });
  });

  it('never flairs synthetic preseason founders', async () => {
    await env.redis.zAdd(K.repSaint, { member: 'commons_founder_ash', score: 50 });
    await env.redis.zAdd(K.seasonPoints, { member: 'commons_founder_ash', score: 50 });
    const result = await weeklyCeremony(env.deps);
    expect(result.saint).toBe('commons_founder_ash');
    expect(env.reddit.flairSet).toHaveLength(0);
  });

  it('skips flairing entirely with no bound subreddit', async () => {
    const noSub = makeEnv();
    noSub.deps.ctx = () => ({ userId: 't2_judge', postId: 't3_fake1', subredditName: undefined });
    await noSub.redis.zAdd(K.repSaint, { member: 'ash', score: 50 });
    await noSub.redis.zAdd(K.seasonPoints, { member: 'ash', score: 50 });
    const result = await weeklyCeremony(noSub.deps);
    expect(result.saint).toBe('ash');
    expect(noSub.reddit.flairSet).toHaveLength(0);
    expect(noSub.reddit.flairTemplates).toHaveLength(0);
  });

  it('recreates flair templates when the cached JSON is corrupted', async () => {
    await env.redis.set(K.flairTemplates, 'not-json-at-all');
    await env.redis.zAdd(K.repSaint, { member: 'ash', score: 50 });
    await env.redis.zAdd(K.seasonPoints, { member: 'ash', score: 50 });
    await weeklyCeremony(env.deps);
    expect(env.reddit.flairTemplates).toHaveLength(3); // recreated, not reused
  });

  it('reuses cached flair templates on a second ceremony', async () => {
    await env.redis.zAdd(K.repSaint, { member: 'ash', score: 50 });
    await env.redis.zAdd(K.seasonPoints, { member: 'ash', score: 50 });
    await weeklyCeremony(env.deps);
    expect(env.reddit.flairTemplates).toHaveLength(3);

    await env.redis.zAdd(K.repSaint, { member: 'birch', score: 50 });
    await env.redis.zAdd(K.seasonPoints, { member: 'birch', score: 50 });
    await weeklyCeremony(env.deps);
    expect(env.reddit.flairTemplates).toHaveLength(3); // not recreated
  });

  it('falls back to plain-text flair when template creation fails, and records the error', async () => {
    env.reddit.failFlairTemplates = true;
    await env.redis.zAdd(K.repSaint, { member: 'ash', score: 50 });
    await env.redis.zAdd(K.seasonPoints, { member: 'ash', score: 50 });
    const result = await weeklyCeremony(env.deps);
    expect(result.flairErrors[0]).toContain('templates:');
    const flair = env.reddit.flairSet.find((f) => f.username === 'ash');
    expect(flair?.text).toContain('Saint');
    expect(flair?.flairTemplateId).toBeUndefined();
  });

  it('falls back to plain text for a serpent and a wildcard crown too', async () => {
    env.reddit.failFlairTemplates = true;
    await env.redis.zAdd(K.repSerpent, { member: 'cedar', score: 50 });
    await env.redis.zAdd(K.seasonPoints, { member: 'cedar', score: 50 }, { member: 'elm', score: 40 });
    await weeklyCeremony(env.deps);
    const serpentFlair = env.reddit.flairSet.find((f) => f.username === 'cedar');
    expect(serpentFlair?.text).toContain('Serpent');
    const wildcardFlair = env.reddit.flairSet.find((f) => f.username === 'elm');
    expect(wildcardFlair?.text).toContain('Wildcard');
  });

  it('records a per-crown flair error but still returns the other crowns', async () => {
    env.reddit.failFlairFor = 'ash';
    await env.redis.zAdd(K.repSaint, { member: 'ash', score: 50 });
    await env.redis.zAdd(K.repSerpent, { member: 'cedar', score: 40 });
    await env.redis.zAdd(
      K.seasonPoints,
      { member: 'ash', score: 50 },
      { member: 'cedar', score: 40 },
      { member: 'elm', score: 30 }
    );
    const result = await weeklyCeremony(env.deps);
    expect(result.flairErrors.some((e) => e.startsWith('saint:ash:'))).toBe(true);
    // cedar (serpent) still got flaired despite ash's failure
    expect(env.reddit.flairSet.some((f) => f.username === 'cedar')).toBe(true);
  });
});
