/*
 * QR codes for the sign-in link and Watchly's set-up page. Alder carries its own small encoder (Qr.kt); here qrcode-generator
 * (MIT) does the encoding and this draws it: black on white with the standard 4-module quiet zone, as one SVG path so a code of
 * 4 000 squares is a single element and stays sharp at any size.
 */
import qrcode from 'qrcode-generator';

/** The modules of [text] (error correction M, version picked to fit): rows of booleans, true = dark, without the quiet zone. */
export function qrModules(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const rows = [];
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

/** SVG markup, [quiet] modules of white round the code. dark / light: colours. */
export function qrSvg(text, { quiet = 4, dark = '#0e0c0a', light = '#f3eee6' } = {}) {
  const m = qrModules(text);
  const n = m.length + 2 * quiet;
  let d = '';
  m.forEach((row, r) => {
    let c = 0;
    while (c < row.length) { // runs of dark modules in a row become one rectangle
      if (!row[c]) { c++; continue; }
      let end = c;
      while (end < row.length && row[end]) end++;
      d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h' + (end - c) + 'v1h-' + (end - c) + 'z';
      c = end;
    }
  });
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges">'
    + '<rect width="' + n + '" height="' + n + '" fill="' + light + '"/><path d="' + d + '" fill="' + dark + '"/></svg>';
}
