
export interface LinkRequest {
  /** @minLength 1 */
  linkToken: string;
  /**
   * @minLength 0
   * @maxLength 128
   */
  password: string;
}
