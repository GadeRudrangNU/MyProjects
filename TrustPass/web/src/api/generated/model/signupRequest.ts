
export interface SignupRequest {
  /**
   * @minLength 0
   * @maxLength 120
   */
  name: string;
  /**
   * @minLength 0
   * @maxLength 254
   */
  email: string;
  /** @minLength 1 */
  password: string;
}
