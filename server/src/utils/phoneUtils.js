/**
 * Indian Mobile Phone Number Validation & Normalization Utility
 *
 * Requirements:
 * - 10-digit Indian mobile numbers starting with 6, 7, 8, or 9
 * - Optional +91 country prefix (or 91 or trunk 0)
 * - Strip formatting characters (spaces, hyphens, parentheses, dots)
 * - Normalize consistently to +91XXXXXXXXXX
 * - Reject malformed numbers
 * - Mask phone numbers for safe logging / unprivileged display
 */

/**
 * Validates and normalizes an Indian mobile phone number.
 *
 * @param {string} rawPhone - Raw phone string
 * @param {boolean} [isRequired=true] - Whether an empty or omitted value is an error
 * @returns {{ isValid: boolean, normalized: string, error: string|null }}
 */
export function validateAndNormalizeIndianPhone(rawPhone, isRequired = true) {
  if (rawPhone === undefined || rawPhone === null || String(rawPhone).trim() === '') {
    if (isRequired) {
      return {
        isValid: false,
        normalized: '',
        error: 'Mobile phone number is required'
      };
    }
    return {
      isValid: true,
      normalized: '',
      error: null
    };
  }

  if (typeof rawPhone !== 'string' && typeof rawPhone !== 'number') {
    return {
      isValid: false,
      normalized: '',
      error: 'Phone number must be a string or number'
    };
  }

  // Convert to string and strip spaces, hyphens, parentheses, dots
  let cleaned = String(rawPhone).trim().replace(/[\s\-\(\)\.]/g, '');

  // Handle leading +91
  if (cleaned.startsWith('+91')) {
    cleaned = cleaned.slice(3);
  } else if (cleaned.startsWith('+')) {
    return {
      isValid: false,
      normalized: '',
      error: 'Only Indian mobile numbers with country code +91 are supported'
    };
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    // 91 prefix without plus
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    // Leading 0 trunk prefix
    cleaned = cleaned.slice(1);
  }

  // Must now be exactly 10 digits starting with 6, 7, 8, or 9
  const indianMobileRegex = /^[6-9]\d{9}$/;
  if (!indianMobileRegex.test(cleaned)) {
    return {
      isValid: false,
      normalized: '',
      error: 'Invalid Indian mobile number. Must be a 10-digit number starting with 6, 7, 8, or 9.'
    };
  }

  return {
    isValid: true,
    normalized: `+91${cleaned}`,
    error: null
  };
}

/**
 * Masks a phone number to protect privacy when logging: +91 ******4321
 *
 * @param {string} phone - Phone number to mask
 * @returns {string} Masked string
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
  maskPhoneNumber
};
