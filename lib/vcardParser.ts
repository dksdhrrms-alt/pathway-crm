/**
 * vCard (.vcf) parser — used by ImportModal when a rep drops a vCard
 * file exported from iOS / iCloud Contacts. iCloud lets you select
 * multiple contacts and Export vCard, producing a single .vcf with
 * many BEGIN:VCARD ... END:VCARD blocks; we handle that bulk shape
 * and reshape each block into the same column-keyed RawRow the rest
 * of the import flow already expects.
 *
 * Output columns line up with CONTACT_FIELDS in ImportModal so the
 * column-mapping step auto-resolves cleanly.
 */

export type VCardRow = {
  firstName: string;
  lastName: string;
  title: string;
  accountName: string;
  phone: string;
  email: string;
  linkedIn: string;
};

export const VCARD_HEADERS: (keyof VCardRow)[] = [
  'firstName', 'lastName', 'title', 'accountName', 'phone', 'email', 'linkedIn',
];

/**
 * vCard "line folding" — the spec wraps lines longer than 75 chars by
 * inserting a CRLF + single space. Unfolding restores logical lines.
 */
function unfold(text: string): string {
  // Normalize CRLF/CR to LF first
  const normalized = text.replace(/\r\n?/g, '\n');
  // A continuation is a newline immediately followed by space or tab
  return normalized.replace(/\n[ \t]/g, '');
}

/**
 * Unescape the small set of escapes the spec defines for property
 * values (\\, \;, \,, \n).
 */
function unescapeValue(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Decode QUOTED-PRINTABLE — common in vCards exported from older
 * macOS Contacts and Korean/Japanese name records.
 */
function decodeQP(s: string): string {
  // Join soft-line breaks
  const joined = s.replace(/=\r?\n/g, '');
  try {
    const bytes = joined.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    // Try to UTF-8 decode
    return decodeURIComponent(escape(bytes));
  } catch {
    return joined;
  }
}

interface ParsedLine {
  key: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(raw: string): ParsedLine | null {
  // Split "KEY;PARAM=foo;PARAM2=bar:VALUE"
  const colonAt = raw.indexOf(':');
  if (colonAt === -1) return null;
  const left = raw.slice(0, colonAt);
  let value = raw.slice(colonAt + 1);

  const segments = left.split(';');
  const key = segments[0].toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const eq = seg.indexOf('=');
    if (eq === -1) {
      // Bare param like TYPE in old format (e.g. HOME, WORK)
      params['TYPE'] = (params['TYPE'] ? params['TYPE'] + ',' : '') + seg.toUpperCase();
    } else {
      params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1);
    }
  }

  if ((params['ENCODING'] || '').toUpperCase() === 'QUOTED-PRINTABLE') {
    value = decodeQP(value);
  }
  return { key, params, value: unescapeValue(value) };
}

/** Pick the "best" value when a card has multiple of a property. Pref
 *  order: CELL → MOBILE → HOME → WORK → first one. */
function pickBest(candidates: ParsedLine[], pref: string[]): string {
  if (candidates.length === 0) return '';
  for (const t of pref) {
    const match = candidates.find((c) => (c.params['TYPE'] || '').toUpperCase().includes(t));
    if (match) return match.value.trim();
  }
  return candidates[0].value.trim();
}

function parseSingle(block: string): VCardRow | null {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  const parsed: ParsedLine[] = [];
  for (const ln of lines) {
    const p = parseLine(ln);
    if (p) parsed.push(p);
  }
  if (parsed.length === 0) return null;

  // Names: prefer structured N (Family;Given;Middle;Prefix;Suffix), fall
  // back to FN ("Full Name") split on the first space.
  let firstName = '';
  let lastName = '';
  const n = parsed.find((p) => p.key === 'N');
  if (n) {
    const parts = n.value.split(';');
    lastName = (parts[0] || '').trim();
    firstName = (parts[1] || '').trim();
  }
  if (!firstName && !lastName) {
    const fn = parsed.find((p) => p.key === 'FN');
    if (fn) {
      const full = fn.value.trim();
      const sp = full.indexOf(' ');
      if (sp === -1) {
        firstName = full;
      } else {
        firstName = full.slice(0, sp);
        lastName = full.slice(sp + 1);
      }
    }
  }

  const title = parsed.find((p) => p.key === 'TITLE')?.value.trim() || '';
  const accountName = parsed.find((p) => p.key === 'ORG')?.value.split(';')[0].trim() || '';
  const emailLine = pickBest(parsed.filter((p) => p.key === 'EMAIL'), ['PREF', 'WORK', 'INTERNET', 'HOME']);
  const phoneLine = pickBest(parsed.filter((p) => p.key === 'TEL'), ['CELL', 'MOBILE', 'IPHONE', 'WORK', 'HOME']);
  // LinkedIn — usually exposed as URL with a TYPE that includes "LinkedIn"
  // or as a bare URL property. Pull anything that has "linkedin" in it,
  // otherwise the first URL.
  const urls = parsed.filter((p) => p.key === 'URL');
  let linkedIn = urls.find((u) => u.value.toLowerCase().includes('linkedin'))?.value.trim() || '';
  if (!linkedIn && urls.length > 0) linkedIn = urls[0].value.trim();

  // Skip empty cards (no name at all)
  if (!firstName && !lastName && !emailLine && !phoneLine) return null;

  return {
    firstName,
    lastName,
    title,
    accountName,
    phone: phoneLine,
    email: emailLine,
    linkedIn,
  };
}

/**
 * Parse a full vCard file (one or many cards). Returns rows in the
 * RawRow shape expected by ImportModal (column-keyed).
 */
export function parseVCardFile(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const cleaned = unfold(text);
  // Split into individual cards. Use case-insensitive markers and
  // ignore anything outside BEGIN/END pairs.
  const blocks: string[] = [];
  const re = /BEGIN:VCARD([\s\S]*?)END:VCARD/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    blocks.push(m[1]);
  }

  const rows: Record<string, string>[] = [];
  for (const b of blocks) {
    const row = parseSingle(b);
    if (row) rows.push(row as unknown as Record<string, string>);
  }
  return { headers: VCARD_HEADERS as unknown as string[], rows };
}
