/**
 * Must match fresto-backend OTP length (and WhatsApp template digit count).
 * Set VITE_OTP_LENGTH in .env (4–8).
 */
const n = Number(import.meta.env.VITE_OTP_LENGTH);
export const OTP_CODE_LENGTH = Number.isFinite(n) && n >= 4 && n <= 8 ? n : 6;
