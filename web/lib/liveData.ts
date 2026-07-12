"use client";

/**
 * Shared client-side fetchers + response types for the live cluster endpoints.
 *
 * The home page mounts three components that each want /api/regions and
 * /api/stats (RecorderStrip, LiveStat, CapabilityBento). Without sharing, that
 * was 2x/2x duplicate requests — and each /api/stats hit is a real vector
 * search. These fetchers dedupe concurrent callers and briefly cache the
 * result, so one page load makes one call to each endpoint.
 */

export interface RegionInfo {
  region: string;
  primary?: boolean;
}
export interface RegionDistribution {
  region: string;
  rows: number;
}
export interface RegionLiveness {
  region: string;
  liveNodes: number;
  totalNodes: number;
}
export interface RegionsResponse {
  live: boolean;
  mock?: boolean;
  regions: RegionInfo[];
  distribution: RegionDistribution[];
  liveness?: RegionLiveness[];
  survivalGoal: string;
}

export interface StatsResponse {
  totalMemories: number;
  recallMs: number | null;
  regionsLive: number;
  regionsTotal: number;
  survivalGoal?: string;
  mock?: boolean;
}

const TTL_MS = 5_000;

interface Slot<T> {
  at: number;
  inflight: Promise<T> | null;
  value: T | null;
}

function makeFetcher<T>(url: string): (fresh?: boolean) => Promise<T> {
  const slot: Slot<T> = { at: 0, inflight: null, value: null };
  return (fresh = false) => {
    const now = Date.now();
    if (!fresh && slot.value && now - slot.at < TTL_MS) return Promise.resolve(slot.value);
    if (!fresh && slot.inflight) return slot.inflight;
    const p = fetch(url)
      .then((r) => r.json() as Promise<T>)
      .then((v) => {
        slot.value = v;
        slot.at = Date.now();
        slot.inflight = null;
        return v;
      })
      .catch((err) => {
        slot.inflight = null;
        throw err;
      });
    slot.inflight = p;
    return p;
  };
}

export const fetchRegions = makeFetcher<RegionsResponse>("/api/regions");
export const fetchStats = makeFetcher<StatsResponse>("/api/stats");
