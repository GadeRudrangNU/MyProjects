
export interface LocationRequest {
  /**
   * @minLength 0
   * @maxLength 120
   */
  name: string;
  /**
   * @minLength 0
   * @maxLength 240
   */
  address: string;
}
