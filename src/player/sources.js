/*
 * The transcode hook (PLAN.md section 1). The player asks this for the URL it should hand to AVPlay for a stream.
 * Today the answer is the stream's own URL. A future provider (a TorBox transcoder, a home server) plugs in here to turn a
 * DTS / TrueHD file into one this TV can play: return the new URL, or a promise of it. Nothing else in the player changes.
 *
 * The engine awaits the result, so the hook may do network work. If it rejects, that source counts as failed.
 */

/** @param {{ url: string }} stream  a core/addon.js Stream  @returns {string | Promise<string>} */
export function resolvePlayableUrl(stream) {
  return stream.url;
}
