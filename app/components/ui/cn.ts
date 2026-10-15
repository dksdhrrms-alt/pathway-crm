/**
 * cn — tiny classname joiner.
 *
 * The usual recipe is `clsx` + `tailwind-merge`, but we don't need to pay
 * the bundle cost for a 60-component CRM: Tailwind utility collisions are
 * rare in our code because the primitives below render a fixed set of
 * classes and only take a `className` override at the end. Simple
 * concatenation (last wins when the browser resolves CSS) is enough.
 *
 * If we grow and start seeing dup-utility conflicts, swap in `tailwind-merge`
 * — the signature here is already compatible.
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
