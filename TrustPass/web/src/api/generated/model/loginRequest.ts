
export interface LoginRequest {
  /** @minLength 1 */
  email: string;
  /**
   * @minLength 0
   * @maxLength 128
   */
  password: string;
}
