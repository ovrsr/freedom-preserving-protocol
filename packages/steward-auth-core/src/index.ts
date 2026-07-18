/**
 * Harness-neutral steward identity and OpenPGP operator authorization
 * for the Freedom Preserving Protocol.
 */

export const PACKAGE_NAME = "@ovrsr/fpp-steward-auth-core" as const;
export const PACKAGE_VERSION = "0.1.0" as const;

export {
  SignatureBackendRegistry,
  createDefaultBackendRegistry,
  type ParsePublicKeyResult,
  type SignatureBackend,
  type SignatureVerifyErr,
  type SignatureVerifyOk,
  type SignatureVerifyResult,
  type VerifyCleartextInput,
  type VerifyDetachedInput,
} from "./signature-backend.js";

export { createOpenPgpBackend } from "./openpgp-backend.js";

export {
  STEWARD_LEDGER_DIGEST_DOMAIN,
  STEWARD_LEDGER_EVENT_KINDS,
  STEWARD_LEDGER_SCHEMA_VERSION,
  STEWARD_LEDGER_ZERO_HASH,
  StewardAuthorizationLedger,
  StewardLedgerUnavailableError,
  type AppendEventInput,
  type LedgerLoadErr,
  type LedgerLoadOk,
  type LedgerResult,
  type LedgerTransaction,
  type StewardAuthorizationLedgerOptions,
  type StewardLedgerEvent,
  type StewardLedgerEventKind,
  type StewardLedgerPolicy,
  type StewardLedgerUniqueKeys,
} from "./ledger.js";

export {
  StewardRegistry,
  type AdmitKeyAttestationInput,
  type AdmitResult,
  type KeyBindingStatus,
  type StewardKeyBinding,
  type StewardState,
} from "./steward-registry.js";

export {
  matchesAuthorizationScope,
  type ActionDescriptor,
  type ScopeMatchReason,
  type ScopeMatchResult,
} from "./scope.js";

export {
  AuthorizationService,
  type AdmitAuthResult,
  type AdmittedAuthorization,
  type CandidateResult,
  type ConsumeReason,
  type ConsumeResult,
  type VerifyAdmitInput,
  type VerifyResult,
} from "./authorization-service.js";
