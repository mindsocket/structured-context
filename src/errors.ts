/**
 * Stable codes for configuration and environment problems. Hooks and agent skills map a code to a
 * fix, so the message wording can change without breaking them.
 */
export type SctxErrorCode =
  | 'E_CONFIG_NOT_FOUND'
  | 'E_CONFIG_INVALID'
  | 'E_INCLUDE_NOT_FOUND'
  | 'E_NO_SPACES'
  | 'E_SPACE_PATH_MISSING'
  | 'E_SCHEMA_MISSING'
  | 'E_SCHEMA_NOT_FOUND'
  | 'E_SCHEMA_INVALID'
  | 'E_SPACE_EXISTS'
  | 'E_TARGET_REQUIRED'
  | 'E_CONFIG_NEEDS_MANUAL_EDIT';

export class SctxError extends Error {
  constructor(
    readonly code: SctxErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SctxError';
  }
}
