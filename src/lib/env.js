/*
 * Build-time constants. scripts/build.mjs replaces __ALDER_ENV__, __ALDER_DEV__ and __ALDER_VERSION__ (esbuild
 * --define). Under Node (tests) they are undefined: ENV is 'test'.
 *
 * Code that must not exist in the production bundle (the fixture redirect) tests the define itself, written out:
 *     if (typeof __ALDER_DEV__ !== 'undefined' && __ALDER_DEV__) { ... }
 * esbuild folds that to `if (false)` while parsing that file and drops the block together with whatever only it
 * used. A constant imported from another module (IS_DEV below) is substituted only after parsing, too late for that,
 * so IS_DEV is for ordinary logic and not for keeping code out of the .wgt. compat-check fails the build if fixture
 * code or strings survive in dist/app.
 */
export const ENV = typeof __ALDER_ENV__ === 'string' ? __ALDER_ENV__ : 'test';
export const VERSION = typeof __ALDER_VERSION__ === 'string' ? __ALDER_VERSION__ : '0.0.0-test';
export const IS_DEV = typeof __ALDER_DEV__ !== 'undefined' && __ALDER_DEV__;
