-- Add Expo personal access token (encrypted at rest) to the User model.
-- Used by cloud APK build flow (eas build) so users can use their own
-- Expo account credits/queue instead of the server's local Docker builder.

ALTER TABLE "users"
  ADD COLUMN "expo_token_enc" TEXT,
  ADD COLUMN "expo_token_set_at" TIMESTAMP(3);
