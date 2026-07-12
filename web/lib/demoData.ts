/**
 * Shared static constants for the marketing site + demo fallbacks. Kept in one
 * place so adding/renaming a region or moving the repo is a single edit, not a
 * six-file hunt. Client-safe (no server-only imports).
 */

/** The three demo regions, in display order. Primary is the write gateway. */
export const DEMO_REGIONS: { region: string; primary: boolean }[] = [
  { region: "aws-us-east-1", primary: true },
  { region: "aws-eu-west-1", primary: false },
  { region: "aws-ap-south-1", primary: false },
];

/** Public source repository. */
export const REPO = "https://github.com/Uthmannabeel/blackbox";

/** Strip the cloud prefix for compact region labels: aws-eu-west-1 -> eu-west-1. */
export function shortRegion(region: string): string {
  return region.replace(/^aws-/, "");
}
