/**
 * Client-Side Indian Mobile Phone Number Validation & Formatting Utility
 */

/**
 * Validates and normalizes an Indian mobile phone number.
 *
 * @param {string} rawPhone - Raw phone string
 * @param {boolean} [isRequired=true] - Whether an empty value is an error
 * @returns {{ isValid: boolean, normalized: string, error: string|null }}
 */
export function validateAndNormalizeIndianPhone(rawPhone, isRequired = true) {
  if (rawPhone === undefined || rawPhone === null || String(rawPhone).trim() === '') {
    if (isRequired) {
      return {
        isValid: false,
        normalized: '',
        error: 'Mobile phone number is required',
      };
    }
    return {
      isValid: true,
      normalized: '',
      error: null,
    };
  }

  const cleaned = String(rawPhone).trim().replace(/[\s\-\(\)\.]/g, '');

  let digits = cleaned;
  if (cleaned.startsWith('+91')) {
    digits = cleaned.slice(3);
  } else if (cleaned.startsWith('+')) {
    return {
      isValid: false,
      normalized: '',
      error: 'Only Indian mobile numbers (+91) are supported',
    };
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    digits = cleaned.slice(2);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    digits = cleaned.slice(1);
  }

  const indianMobileRegex = /^[6-9]\d{9}$/;
  if (!indianMobileRegex.test(digits)) {
    return {
      isValid: false,
      normalized: '',
      error: 'Enter a valid 10-digit Indian mobile number (e.g. 9876543210 or +91 9876543210)',
    };
  }

  return {
    isValid: true,
    normalized: `+91${digits}`,
    error: null,
  };
}

/**
 * Masks a phone number for unprivileged UI display: +91 ******4321
 */
export function maskPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return '';
  const trimmed = phone.trim();
  if (trimmed.length < 4) return '***';
  const last4 = trimmed.slice(-4);
  return `+91 ******${last4}`;
}

export default {
  validateAndNormalizeIndianPhone,
  maskPhoneNumber,
};
