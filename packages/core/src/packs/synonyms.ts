/**
 * Words visitors use for something the website calls by another name. A question that matches is searched
 * a second time with `search`, and each section keeps its better score.
 */
export type Synonym = { words: RegExp; search: string };

export const COMMON_SYNONYMS: Synonym[] = [
  { words: /\b(?:stations?|tube|trains?|underground|overground|buses|bus stop|directions|nearest stop|walk from)\b/i, search: "Getting here" },
  { words: /\b(?:park(?:ing)?|car park|drive)\b/i, search: "Getting here parking" },
];
