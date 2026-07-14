/** Daily post creation (open-round cron + manual paths). */

import type { Deps } from './deps';
import { K } from './keys';

export async function createDayPost(
  deps: Deps,
  input: { title: string; day: number }
): Promise<string | null> {
  try {
    const post = await deps.reddit.submitCustomPost({
      title: `⚖️ ${input.title} — one sealed choice. Midnight decides.`,
    });
    await deps.redis.set(K.post(post.id), String(input.day));
    return post.id;
  } catch (err) {
    // A missing post never blocks the round itself (playtest subs, bans, etc.)
    console.error(`createDayPost(day ${input.day}) failed:`, err);
    return null;
  }
}
