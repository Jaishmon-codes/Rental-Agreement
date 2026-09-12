/**
 * Computes the SHA-256 hash of a File or Blob using the browser's native Web Crypto API.
 * @param {File|Blob} file 
 * @returns {Promise<string>} Hexadecimal SHA-256 string
 */
export async function computeFileSHA256(file) {
  if (!file) return "";
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hexHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return hexHash;
}

/**
 * Shortens an Ethereum address or transaction hash for clean display.
 * @param {string} addr 
 * @param {number} chars 
 * @returns {string}
 */
export function formatShortAddress(addr, chars = 4) {
  if (!addr) return "";
  if (addr.length <= chars * 2 + 2) return addr;
  return `${addr.substring(0, chars + 2)}...${addr.substring(addr.length - chars)}`;
}
