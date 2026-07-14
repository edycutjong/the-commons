/**
 * Public API routes. Factory over Deps so the endpoint tests run these exact
 * handlers against in-memory stubs.
 *
 * I1 enforcement note: /api/round and /api/history are the ONLY readers of
 * game state pre-settle, and both are projections that structurally cannot
 * carry a split (see src/shared/api.ts + tests/endpoints.test.ts).
 */

import { Hono } from 'hono';
import type { Deps } from '../core/deps';
import { K } from '../core/keys';
import { currentRound, publicRoundView } from '../core/rounds';
import { sealedCommit, parseStoredCommit } from '../core/commits';
import { getHistory } from '../core/history';
import { submitForge } from '../core/forge';
import {
  ECONOMY,
  effectiveBalance,
  maxStakeFor,
  parseStreak,
} from '../../shared/payoffs';
import type {
  ApiError,
  CommitRequest,
  CommitResponse,
  ForgeRequest,
  ForgeResponse,
  HistoryResponse,
  LaddersResponse,
  MeView,
  PotTickerMessage,
  RoundResponse,
} from '../../shared/api';
import { POT_TICKER_CHANNEL } from '../../shared/api';

const CODE_STATUS: Record<ApiError['code'], 400 | 401 | 404 | 409 | 500> = {
  not_logged_in: 401,
  no_round: 404,
  round_sealed: 409,
  already_committed: 409,
  bad_choice: 400,
  bad_stake: 400,
  insufficient_points: 400,
  conflict: 409,
  filter_rejected: 400,
  bad_request: 400,
  internal: 500,
};

const err = (code: ApiError['code'], message: string): ApiError => ({
  status: 'error',
  code,
  message,
});

export function makeApi(deps: Deps): Hono {
  const api = new Hono();

  api.get('/round', async (c) => {
    const round = await currentRound(deps);
    const me = await buildMe(deps, round?.state === 'open' ? round.day : null);
    const lastSettledRaw = await deps.redis.get(K.settledLast);
    const lastSettledDay = lastSettledRaw ? Number.parseInt(lastSettledRaw, 10) : null;
    return c.json<RoundResponse>({
      type: 'round',
      round: round ? await publicRoundView(deps, round) : null,
      me,
      lastSettledDay: lastSettledDay !== null && !Number.isNaN(lastSettledDay) ? lastSettledDay : null,
      serverNow: deps.now(),
    });
  });

  api.post('/commit', async (c) => {
    const { userId } = deps.ctx();
    const username = await safeUsername(deps);
    if (!userId || !username) {
      return c.json<ApiError>(err('not_logged_in', 'Log in to seal a choice.'), 401);
    }
    const round = await currentRound(deps);
    if (!round) return c.json<ApiError>(err('no_round', 'No dilemma is open tonight.'), 404);

    let body: CommitRequest;
    try {
      body = await c.req.json<CommitRequest>();
    } catch {
      return c.json<ApiError>(err('bad_request', 'Malformed commit payload.'), 400);
    }
    if (typeof body.choice !== 'string') {
      return c.json<ApiError>(err('bad_request', 'A choice is required.'), 400);
    }

    const result = await sealedCommit(deps, {
      day: round.day,
      userId,
      username,
      choice: body.choice,
      stake: typeof body.stake === 'number' ? body.stake : Number.NaN,
      buyInsurance: body.buyInsurance === true,
    });

    if (!result.ok) {
      // `result` narrows to CommitErr here; every CommitErr code is a member of
      // ApiError['code'] (they were reconciled — `conflict` maps to 409), so the
      // status lookup is total. In practice sealedCommit already remaps the
      // internal `conflict` race signal to `round_sealed` after its retries.
      return c.json<ApiError>(err(result.code, result.message), CODE_STATUS[result.code]);
    }

    // Realtime pot ticker: participation + pot ONLY (two integers, ever).
    try {
      const msg: PotTickerMessage = { participants: result.participants, pot: result.pot };
      await deps.realtime.send(POT_TICKER_CHANNEL, msg);
    } catch (e) {
      console.error('pot_ticker send failed:', e);
    }

    return c.json<CommitResponse>({
      type: 'commit',
      status: 'sealed',
      day: result.day,
      choice: result.choice,
      stake: result.stake,
      insured: result.insured,
      participants: result.participants,
      pot: result.pot,
      revealAt: result.revealAt,
    });
  });

  api.get('/history', async (c) => {
    const { userId } = deps.ctx();
    const limitRaw = c.req.query('limit');
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) || 14 : 14;
    const entries = await getHistory(deps, { meUserId: userId ?? null, limit });
    return c.json<HistoryResponse>({ type: 'history', entries });
  });

  api.post('/forge', async (c) => {
    const username = await safeUsername(deps);
    if (!username) return c.json<ApiError>(err('not_logged_in', 'Log in to forge a dilemma.'), 401);
    let body: ForgeRequest;
    try {
      body = await c.req.json<ForgeRequest>();
    } catch {
      return c.json<ApiError>(err('bad_request', 'Malformed forge payload.'), 400);
    }
    const result = await submitForge(deps, {
      author: username,
      archetype: body.archetype,
      params: body.params,
      title: body.title,
      flavor: body.flavor,
    });
    if (!result.ok) return c.json<ApiError>(err(result.code, result.message), 400);
    return c.json<ForgeResponse>({ type: 'forge', status: 'queued', position: result.position });
  });

  api.get('/ladders', async (c) => {
    const [saint, serpent, season] = await Promise.all([
      deps.redis.zRange(K.repSaint, 0, 9, { by: 'rank', reverse: true }),
      deps.redis.zRange(K.repSerpent, 0, 9, { by: 'rank', reverse: true }),
      deps.redis.zRange(K.seasonPoints, 0, 9, { by: 'rank', reverse: true }),
    ]);
    const rows = (list: { member: string; score: number }[]) =>
      list
        .filter((m) => m.score > 0)
        .map((m, i) => ({ username: m.member, score: m.score, rank: i + 1 }));
    return c.json<LaddersResponse>({
      type: 'ladders',
      saint: rows(saint),
      serpent: rows(serpent),
      season: rows(season),
      weeklyDecay: ECONOMY.weeklyDecay,
    });
  });

  return api;
}

async function safeUsername(deps: Deps): Promise<string | null> {
  try {
    return (await deps.reddit.getCurrentUsername()) ?? null;
  } catch {
    return null;
  }
}

async function buildMe(deps: Deps, openDay: number | null): Promise<MeView> {
  const { userId } = deps.ctx();
  const username = await safeUsername(deps);
  if (!userId || !username) {
    return {
      loggedIn: false,
      username: null,
      myCommit: null,
      balance: ECONOMY.startingPoints,
      maxStake: maxStakeFor(ECONOMY.startingPoints, ECONOMY),
      insuranceCost: ECONOMY.insuranceCost,
      insuranceHeld: false,
      streak: { current: 0, best: 0 },
      saintScore: 0,
      serpentScore: 0,
    };
  }

  const [balanceScore, streakRaw, saintScore, serpentScore] = await Promise.all([
    deps.redis.zScore(K.seasonPoints, username),
    deps.redis.hGetAll(K.streak(userId)),
    deps.redis.zScore(K.repSaint, username),
    deps.redis.zScore(K.repSerpent, username),
  ]);
  const balance = effectiveBalance(balanceScore, ECONOMY);
  const streak = parseStreak(streakRaw);

  let myCommit: MeView['myCommit'] = null;
  if (openDay !== null) {
    const raw = await deps.redis.hGet(K.commit(openDay), userId);
    if (raw) {
      const stored = parseStoredCommit(raw);
      if (stored) {
        myCommit = { choice: stored.choice, stake: stored.stake, insured: stored.insured };
      }
    }
  }

  return {
    loggedIn: true,
    username,
    myCommit,
    balance,
    maxStake: maxStakeFor(balance, ECONOMY),
    insuranceCost: ECONOMY.insuranceCost,
    insuranceHeld: streak.insuranceHeld === 1,
    streak: { current: streak.current, best: streak.best },
    saintScore: saintScore ?? 0,
    serpentScore: serpentScore ?? 0,
  };
}
