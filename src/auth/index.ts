/**
 * @edcalderon/auth – re-export for internal tracking
 *
 * This module re-exports the @edcalderon/auth package so that
 * the infra package can leverage auth-related constructs
 * (e.g. provisioning Supabase auth, configuring OAuth providers)
 * without consumers needing to install the auth package separately.
 *
 * @edcalderon/auth version tracked: ^1.2.1
 * Internal versioning: independent of monorepo global versioning
 */

// Core types
export type {
    AuthClient,
    AuthRuntime,
    AuthCapabilities,
    AuthErrorCode,
    OAuthFlow,
    SignInOptions,
    Web3SignInOptions,
    User,
} from "@edcalderon/auth";

// Provider & context (server-side compatible)
export { AuthProvider } from "@edcalderon/auth";

// Clients – expose all for infra-level integrations
export { SupabaseClient } from "@edcalderon/auth/supabase";
export { FirebaseWebClient } from "@edcalderon/auth/firebase-web";
export { HybridWebClient } from "@edcalderon/auth/hybrid-web";
