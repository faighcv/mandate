import { getSetting, setSetting } from "../db";

/**
 * Company-wide rules that apply to every agent on top of its own mandate. The matching
 * policy document in the Company Brain explains them in prose; this object is what the code enforces.
 */
export interface CompanyPolicy {
  collections: {
    maxInstallments: number;
    maxPlanDays: number;
    minFirstInstallmentPct: number;
    maxExtensionDays: number;
    highRiskNeedsApproval: boolean;
    contactCooldownHours: number;
  };
  payables: { requireVerifiedBeneficiary: boolean; maxEarlyPaymentDays: number };
  treasury: { minCashBufferUsd: number };
  disputes: { contestMinUsd: number };
}

export const DEFAULT_POLICY: CompanyPolicy = {
  collections: { maxInstallments: 3, maxPlanDays: 90, minFirstInstallmentPct: 25, maxExtensionDays: 30, highRiskNeedsApproval: true, contactCooldownHours: 0 },
  payables: { requireVerifiedBeneficiary: true, maxEarlyPaymentDays: 10 },
  treasury: { minCashBufferUsd: 40_000 },
  disputes: { contestMinUsd: 250 },
};

export function companyPolicy(): CompanyPolicy {
  const p = getSetting<Partial<CompanyPolicy>>("company_policy", {});
  return {
    collections: { ...DEFAULT_POLICY.collections, ...p.collections },
    payables: { ...DEFAULT_POLICY.payables, ...p.payables },
    treasury: { ...DEFAULT_POLICY.treasury, ...p.treasury },
    disputes: { ...DEFAULT_POLICY.disputes, ...p.disputes },
  };
}

export function setCompanyPolicy(p: CompanyPolicy) {
  setSetting("company_policy", p);
}
