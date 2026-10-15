
export interface DisableRequest {
  /**
   * @minLength 0
   * @maxLength 128
   */
  password: string;
  /**
   * @minLength 0
   * @maxLength 32
   */
  code: string;
}
