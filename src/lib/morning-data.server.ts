import dataset from "../../server/data/morning-2026-10-06.json";
import type { MorningCatalog } from "./morning";
import type { Bar } from "./game/types";

// Import only from server handlers. Never include this module in a page loader,
// shared store, public directory or offline classroom bundle.
export const morningCatalog: MorningCatalog = dataset.catalog;
export const morningBars: Record<string, Bar[]> = dataset.bars;
