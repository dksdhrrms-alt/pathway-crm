/**
 * formatPhone — progressive auto-formatter for North American phone numbers.
 *
 * Sales reps were typing "8144663366" and getting raw digits back; reps wanted
 * the dashes inserted as they type ("814-466-3366"). Rather than reach for a
 * heavyweight masked-input library, this lives in every phone <input>
 * onChange handler.
 *
 * Behavior:
 *   - Strip everything that isn't a digit (so paste from "1 (814) 466-3366"
 *     still normalizes cleanly).
 *   - Up to 10 digits → format as US local "XXX-XXX-XXXX", partial groups
 *     supported ("814", "814-4", "814-466-33").
 *   - 11 digits starting with "1" → "1-XXX-XXX-XXXX" (country code).
 *   - Anything that doesn't fit those shapes (e.g. user pastes a long
 *     international number) is returned as the raw digit string — better
 *     than mangling a valid +44 / +82 number into a US shape.
 */
export function formatPhone(input: string): string {
  const digits = (input || '').replace(/\D/g, '');
  if (!digits) return '';

  // US country code "1" + 10 digits → 1-XXX-XXX-XXXX
  if (digits.length === 11 && digits.startsWith('1')) {
    return `1-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7, 11)}`;
  }

  // > 10 digits and not a leading-1 case — likely an international number.
  // Leave it untouched so we don't mangle a valid foreign format.
  if (digits.length > 10) return digits;

  // ≤ 10 digits: format progressively as user types.
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}
