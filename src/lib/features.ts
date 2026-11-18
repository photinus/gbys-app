// Server-side feature flags (env, read at request time). Not exposed to the client.
// FEATURE_VOLUNTEER_SHIFTS=true turns shift scheduling (sign-up, manage, kiosk
// check-in) back on. Default off: volunteer roles replace it for now. Shift code
// and data are kept intact.
export type FeatureName = "volunteerShifts";

const ENV: Record<FeatureName, string> = {
  volunteerShifts: "FEATURE_VOLUNTEER_SHIFTS",
};

export function isFeatureEnabled(name: FeatureName): boolean {
  return process.env[ENV[name]] === "true";
}
