import { DENTAL_PACK } from "./dental.ts";
import { SALON_PACK } from "./salon.ts";
import type { Pack, Vertical } from "./types.ts";

export type { Pack, Vertical } from "./types.ts";
export { DENTAL_PACK, SALON_PACK };

const PACKS: Record<Vertical, Pack> = { dental: DENTAL_PACK, salon: SALON_PACK };

export function packFor(vertical: string | null | undefined): Pack {
  return PACKS[vertical as Vertical] ?? DENTAL_PACK;
}
