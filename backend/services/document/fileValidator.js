/**
 * Detects actual file format from buffer magic bytes and rejects executables / polyglots (MED-05)
 */
export function validateFileBuffer(buffer, claimedMimeType) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { valid: false, error: "Empty or invalid file buffer" };
  }

  // 1. Immediately block known dangerous binary executable signatures regardless of extension
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return { valid: false, error: "Dangerous executable format detected (PE/MZ)" };
  }
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    return { valid: false, error: "Dangerous executable format detected (ELF)" };
  }
  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0xca && buffer[1] === 0xfe && buffer[2] === 0xba && buffer[3] === 0xbe) ||
      (buffer[0] === 0xcf && buffer[1] === 0xfa && buffer[2] === 0xed && buffer[3] === 0xfe))
  ) {
    return { valid: false, error: "Dangerous executable format detected (Mach-O/Java)" };
  }

  // 2. Validate claimed MIME type against magic bytes
  switch (claimedMimeType) {
    case "application/pdf": {
      // PDF must start with '%PDF-' (0x25, 0x50, 0x44, 0x46, 0x2D)
      if (buffer.length < 5 || buffer.toString("ascii", 0, 5) !== "%PDF-") {
        return { valid: false, error: "File content does not match PDF format (missing %PDF- header)" };
      }
      return { valid: true, detectedType: "application/pdf" };
    }

    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      // DOCX is a zip archive starting with PK\x03\x04 (0x50, 0x4B, 0x03, 0x04)
      if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
        return { valid: false, error: "File content does not match DOCX format (missing PK zip header)" };
      }
      return { valid: true, detectedType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    }

    case "image/png": {
      // PNG starts with 89 50 4E 47 0D 0A 1A 0A
      const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      if (buffer.length < 8 || !pngHeader.every((byte, idx) => buffer[idx] === byte)) {
        return { valid: false, error: "File content does not match PNG format" };
      }
      return { valid: true, detectedType: "image/png" };
    }

    case "image/jpeg": {
      // JPEG starts with FF D8 FF
      if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
        return { valid: false, error: "File content does not match JPEG format" };
      }
      return { valid: true, detectedType: "image/jpeg" };
    }

    case "text/plain": {
      // Reject binary null bytes in plain text files (prevents binary polyglots)
      const sampleLength = Math.min(buffer.length, 4096);
      for (let i = 0; i < sampleLength; i++) {
        if (buffer[i] === 0x00) {
          return { valid: false, error: "Binary content or null bytes detected in plain text document" };
        }
      }
      // Block shell script shebangs in text files
      if (buffer.length >= 2 && buffer[0] === 0x23 && buffer[1] === 0x21) {
        return { valid: false, error: "Executable scripts (shebang #!) are not permitted" };
      }
      return { valid: true, detectedType: "text/plain" };
    }

    default:
      return { valid: false, error: `Unsupported MIME type: ${claimedMimeType}` };
  }
}
