// Linking an authenticator app to the factory reset. The database makes the secret and checks every code (see
// supabase/migrations/20261123108000_factory_reset_authenticator.sql); this only turns the secret into what an app
// reads: the base32 key and the otpauth:// address inside the QR code.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, without padding, as authenticator apps expect. */
export function base32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** The secret as the database hands it out (hex), in base32. */
export function keyFromHex(hex: string): string {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error("not a hex secret");
  return base32(Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16))));
}

/** The key in groups of 4, for typing it into an app by hand. */
export function groupKey(key: string): string {
  return key.replace(/(.{4})(?=.)/g, "$1 ");
}

export const TOTP_ISSUER = "VRPRIME Supplier Portal";

/** The address an authenticator app reads from the QR code (Key Uri Format: SHA1, 6 digits, 30 seconds). */
export function otpauthUri(key: string, account: string): string {
  // Spaces as %20, not "+": some apps show a "+" as it is.
  const label = `${encodeURIComponent(TOTP_ISSUER)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${key}&issuer=${encodeURIComponent(TOTP_ISSUER)}&algorithm=SHA1&digits=6&period=30`;
}
