/**
 * Tekst til skærmlæseren (VoiceOver / TalkBack).
 *
 * Det der står på skærmen er ikke altid det, der skal læses op: "12.95 kr"
 * læses på dansk som "tolv punktum ni fem", og "−", "›" og "✎" læses som
 * symbolnavne eller slet ikke. Funktionerne her giver én fælles udtale, så
 * skærmene ikke hver især opfinder deres egen.
 */

/** Pris til oplæsning: 12.95 -> "12,95 kr". */
export function spokenKr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return `${value.toFixed(2).replace('.', ',')} kr`;
}

/** Sætter dele sammen til én etiket og springer tomme dele over. */
export function joinLabel(parts: Array<string | null | undefined | false>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join(', ');
}
