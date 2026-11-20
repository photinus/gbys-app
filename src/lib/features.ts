// Server-side feature flags (env, read at request time). Not exposed to the client.
// FEATURE_VOLUNTEER_SHIFTS=true turns shift scheduling (sign-up, manage, kiosk
// check-in) back on. Default off: volunteer roles replace it for now. Shift code
// and data are kept intact.
// FEATURE_MEMBER_REIMBURSEMENTS=true shows the member "Reimbursements" page
// (submit expense claims). Default off while the flow is refined; finance-side
// review of reimbursements under Bills & payables is unaffected.
export type FeatureName = "volunteerShifts" | "memberReimbursements";

const ENV: Record<FeatureName, string> = {
  volunteerShifts: "FEATURE_VOLUNTEER_SHIFTS",
  memberReimbursements: "FEATURE_MEMBER_REIMBURSEMENTS",
};

export function isFeatureEnabled(name: FeatureName): boolean {
  return process.env[ENV[name]] === "true";
}
