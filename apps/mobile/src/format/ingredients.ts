/**
 * Ingredienslisten fra butikkerne kommer som HTML: "Økologiske <b>æg</b>.
 * <br>Str M/L". Appen viste tags som ren tekst (GitHub-issue #158). Samme
 * regler som web (sanitizeNutritionHtml i static/js/script.js): <b> er fed
 * (allergener), <br> er linjeskift, alle andre tags fjernes.
 */
export type IngredientPart = { text: string; bold: boolean };

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

export function ingredientParts(html: string | null | undefined): IngredientPart[] {
  const parts: IngredientPart[] = [];
  let bold = false;
  const src = String(html || '').replace(/<br\s*\/?>/gi, '\n');
  const re = /<(\/?)([a-z][a-z0-9]*)[^>]*>/gi;
  let last = 0;
  const push = (raw: string) => {
    const text = decodeEntities(raw);
    if (!text) return;
    const prev = parts[parts.length - 1];
    if (prev && prev.bold === bold) prev.text += text;
    else parts.push({ text, bold });
  };
  for (let m = re.exec(src); m; m = re.exec(src)) {
    push(src.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = m[2].toLowerCase();
    if (tag === 'b' || tag === 'strong') bold = m[1] !== '/';
  }
  push(src.slice(last));
  // Linjeskift lige efter et punktum har tit et mellemrum foran: ". \nStr M/L".
  for (const p of parts) p.text = p.text.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
  if (parts.length) {
    parts[0].text = parts[0].text.replace(/^\s+/, '');
    const end = parts[parts.length - 1];
    end.text = end.text.replace(/\s+$/, '');
  }
  return parts.filter((p) => p.text);
}

/** Ren tekst, fx til skærmlæseren. */
export function ingredientText(html: string | null | undefined): string {
  return ingredientParts(html)
    .map((p) => p.text)
    .join('');
}
