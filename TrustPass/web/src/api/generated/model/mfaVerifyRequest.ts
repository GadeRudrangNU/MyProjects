
export interface MfaVerifyRequest {
  /** @minLength 1 */
  mfaToken: string;
  /**
   * @minLength 0
   * @maxLength 32
   */
  code: string;
}
