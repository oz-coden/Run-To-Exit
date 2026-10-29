/** Width-aware wrapping shared by measurement and paint; no global Pixi hooks. */
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const words = new Intl.Segmenter(undefined, { granularity: "word" });
const opening = /[（〔［｛〈《「『【([{]$/u;
const closing =
  /^[、。，．？！：；）〕］｝〉》」』】)\]!,.:;?ー々ぁぃぅぇぉっゃゅょァィゥェォッャュョ]/u;
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const space = /^\s+$/u;

/** Preserve explicit lines/spaces. Soft-wrap separators are omitted at the line edge.
 * Common Japanese punctuation is kept with its neighbor when a fitting break exists.
 * An indivisible grapheme wider than the box is retained and presentation clips it.
 */
export function wrapCanvasText(
  text: string,
  width: number,
  measure: (text: string) => number,
): string {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!paragraph || measure(paragraph) <= width) {
      lines.push(paragraph);
      continue;
    }
    const chars = Array.from(graphemes.segment(paragraph), (s) => s.segment);
    const offsets = [0];
    for (const c of chars) offsets.push((offsets.at(-1) ?? 0) + c.length);
    const boundaries = new Set(
      Array.from(words.segment(paragraph), (s) => s.index),
    );
    let start = 0;
    const part = (end: number) => paragraph.slice(offsets[start], offsets[end]);
    while (start < chars.length) {
      let low = start + 1,
        high = chars.length,
        fit = start;
      // Measure complete substrings, preserving kerning/ligature shaping.
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (measure(part(mid)) <= width) {
          fit = mid;
          low = mid + 1;
        } else high = mid - 1;
      }
      if (fit === chars.length) {
        lines.push(part(fit));
        break;
      }
      let end = Math.max(start + 1, fit);
      const legal = (i: number) =>
        !opening.test(chars[i - 1] ?? "") && !closing.test(chars[i] ?? "");
      const preferred = (i: number) =>
        boundaries.has(offsets[i] ?? -1) ||
        cjk.test(chars[i - 1] ?? "") ||
        cjk.test(chars[i] ?? "") ||
        space.test(chars[i] ?? "");
      let candidate = end;
      while (candidate > start && !(legal(candidate) && preferred(candidate)))
        candidate--;
      if (candidate === start) {
        candidate = end;
        while (candidate > start && !legal(candidate)) candidate--;
      }
      if (candidate > start) end = candidate;
      lines.push(part(end).replace(/[\t \u3000]+$/u, ""));
      start = end;
      while (start < chars.length && space.test(chars[start] ?? "")) start++;
    }
  }
  return lines.join("\n");
}
