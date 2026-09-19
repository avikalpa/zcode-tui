// Ported from opencode v2.0.7 packages/tui/src/util/string-width.ts
// Grapheme-aware terminal width. The reference pulls `string-width` from npm;
// we carry a compact equivalent (Intl.Segmenter graphemes + the East Asian
// Wide/Fullwidth ranges) so the diff viewer's path truncation math matches
// without adding a bundled runtime dependency.

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// East Asian Wide + Fullwidth code points (short canonical set — the ranges
// that actually appear in file paths: CJK, Hangul, Kana, fullwidth forms).
const WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

export function stringWidth(value: string): number {
  let width = 0;
  for (const { segment } of segmenter.segment(value)) {
    const head = segment.codePointAt(0) ?? 0;
    // Combining marks add no columns.
    if (new RegExp("^\\p{M}$", "u").test(segment)) continue;
    width += WIDE.test(segment) ? 2 : 1;
  }
  return width;
}
