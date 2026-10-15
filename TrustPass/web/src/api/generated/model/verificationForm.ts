import type { VerificationFormDocType } from './verificationFormDocType';

export interface VerificationForm {
  document: Blob;
  docType: VerificationFormDocType;
  /**
   * @minLength 0
   * @maxLength 160
   */
  fullName: string;
  dateOfBirth: string;
  /**
   * @minLength 1
   * @pattern [A-Za-z0-9-]{4,40}
   */
  idNumber: string;
  idExpiry: string;
}
