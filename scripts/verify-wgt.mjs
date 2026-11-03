/*
 * Checks a .wgt the way Apps2Samsung (Apps2Samsung.Core/Packaging: WgtManifest, WgtPrivileges, PackageIdRewriter)
 * reads it, so a package that passes here installs and gets re-signed there:
 *  - a zip with config.xml at the root, no path tricks, no leftover signature files (it is signed on install)
 *  - <tizen:application id="Pkg.App" package="Pkg" ...> in that attribute order (the regex fallback needs it),
 *    Pkg alphanumeric (PackageIdRewriter.IsValidPackageId), required_version not above 5.5
 *  - no Partner-level privilege (the listed ones or any name ending ".partner") and no on-boot / auto-restart "true"
 *  - <content src> and <icon src> present in the package; the icon a PNG
 *  - the package id does not occur in any text file (a rename would have to rewrite it)
 */
import { readFileSync } from 'node:fs';
import { unzip } from './zip.mjs';

const PARTNER = [
  'http://tizen.org/privilege/vpnservice',
  'http://developer.samsung.com/privilege/drminfo',
  'http://developer.samsung.com/privilege/sso.partner',
];
export const ALLOWED_PRIVILEGES = [
  'http://tizen.org/privilege/internet',
  'http://tizen.org/privilege/tv.inputdevice',
  'http://developer.samsung.com/privilege/productinfo',
];

/** A small well-formedness check: tags nest and close. Returns an error string or null. */
export function xmlProblem(xml) {
  const body = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let last = 0;
  let m;
  while ((m = re.exec(body)) !== null) {
    const between = body.slice(last, m.index);
    if (/[<]/.test(between)) return 'stray "<" near ' + JSON.stringify(between.slice(0, 40));
    last = re.lastIndex;
    if (m[1]) {
      if (stack.pop() !== m[2]) return 'closing </' + m[2] + '> does not match the open tag';
    } else if (!m[4]) stack.push(m[2]);
  }
  if (/[<]/.test(body.slice(last))) return 'stray "<" after the last tag';
  return stack.length ? 'unclosed <' + stack[stack.length - 1] + '>' : null;
}

export function verifyWgt(input) {
  const errors = [];
  const warnings = [];
  const buf = Buffer.isBuffer(input) ? input : readFileSync(input);
  let entries;
  try { entries = unzip(buf); } catch (e) { return { errors: ['not a readable zip: ' + e.message], warnings, info: {} }; }
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const info = { files: entries.map((e) => e.name), bytes: buf.length };

  for (const name of byName.keys()) {
    if (name.startsWith('/') || name.indexOf('..') >= 0 || name.indexOf('\\') >= 0) errors.push('unsafe entry name ' + name);
    if (/(^|\/)(author-signature|signature\d*)\.xml$/i.test(name)) errors.push(name + ': the package must be unsigned (Apps2Samsung signs it on install)');
  }

  const configBuf = byName.get('config.xml');
  if (!configBuf) { errors.push('config.xml is not at the root of the package'); return { errors, warnings, info }; }
  const config = configBuf.toString('utf8');
  const noComments = config.replace(/<!--[\s\S]*?-->/g, '');
  const bad = xmlProblem(config);
  if (bad) errors.push('config.xml is not well-formed: ' + bad);

  const app = /<tizen:application\s+id="([A-Za-z0-9]+)\.([A-Za-z0-9]+)"\s+package="([A-Za-z0-9]+)"([^>]*)>/.exec(noComments);
  if (!app) errors.push('config.xml: <tizen:application id="Pkg.App" package="Pkg"> not found in the form Apps2Samsung reads');
  else {
    const [, pkg, appName, pkg2, rest] = app;
    if (pkg !== pkg2) errors.push('config.xml: application id prefix "' + pkg + '" differs from package "' + pkg2 + '"');
    if (pkg.length !== 10) warnings.push('package id "' + pkg + '" is not 10 characters (Tizen convention)');
    info.packageId = pkg; info.appId = pkg + '.' + appName;
    const rv = /required_version="([^"]+)"/.exec(rest);
    info.requiredVersion = rv ? rv[1] : null;
    if (rv && parseFloat(rv[1]) > 5.5) errors.push('required_version ' + rv[1] + ' is newer than the TV (Tizen 5.5)');
    for (const [name, data] of byName) {
      if (/\.(xml|js|json|html|css|txt)$/i.test(name) && name !== 'config.xml' && data.toString('utf8').indexOf(pkg) >= 0) {
        warnings.push(name + ' mentions the package id (a rename by Apps2Samsung would rewrite it)');
      }
    }
  }
  const version = /<widget\b[^>]*\bversion="([^"]+)"/.exec(noComments);
  info.version = version ? version[1] : null;
  if (!version || !/^\d+\.\d+\.\d+$/.test(version[1])) errors.push('config.xml: widget version must look like 1.2.3');

  const privileges = Array.from(noComments.matchAll(/<tizen:privilege\b[^>]*\bname="([^"]+)"/g), (m) => m[1]);
  info.privileges = privileges;
  for (const p of privileges) {
    if (PARTNER.indexOf(p) >= 0 || /\.partner$/i.test(p)) errors.push('Partner-level privilege ' + p + ' (Apps2Samsung would need a Partner certificate)');
    else if (ALLOWED_PRIVILEGES.indexOf(p) < 0) warnings.push('privilege ' + p + ' is not on the project allow-list: check WgtPrivileges.cs');
  }
  for (const m of noComments.matchAll(/\b(on-boot|auto-restart)\s*=\s*"\s*true\s*"/gi)) errors.push('Partner-only launch setting ' + m[1] + '="true"');

  const content = /<content\b[^>]*\bsrc="([^"]+)"/.exec(noComments);
  if (!content || !byName.has(content[1])) errors.push('<content src> missing or not in the package');
  const icon = /<icon\b[^>]*\bsrc="([^"]+)"/.exec(noComments);
  if (!icon || !byName.has(icon[1])) errors.push('<icon src> missing or not in the package');
  else {
    const png = byName.get(icon[1]);
    if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) errors.push(icon[1] + ' is not a PNG');
    else info.icon = png.readUInt32BE(16) + 'x' + png.readUInt32BE(20);
  }
  if (!/<access\b[^>]*origin="\*"/.test(noComments)) warnings.push('config.xml has no <access origin="*">: add-on and Stremio requests would be blocked');
  return { errors, warnings, info };
}
