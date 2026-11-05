/*
 * Mac platform module. scripts/build.mjs --mac (npm run build:mac) resolves `#platform/index` to this file; shared code
 * imports platform modules by that name and never branches on the platform at run time. Stub until the Mac port
 * (native bridge, keys, locale) fills it in.
 */
export const PLATFORM = 'mac';

export { installPointer } from './pointer.js'; // mouse and trackpad -> focus, OK and scrolling; main.js's Mac patch calls it with the focus engine
export { installPlayHook } from './play-hook.js'; // the air/ play check: ?play=<url> in the shell's --page opens the player (main.js's Mac patch)
export { installBackButton } from './back-button.js'; // a visible Back button on the screens where Esc is the only way back (main.js's Mac patch)
