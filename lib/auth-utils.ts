import bcrypt from 'bcryptjs';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
  // Support both hashed and legacy plain text passwords
  if (hashedPassword.startsWith('$2b$') || hashedPassword.startsWith('$2a$')) {
    return bcrypt.compare(plainPassword, hashedPassword);
  }
  // Legacy plain text comparison (for unmigrated passwords)
  return plainPassword === hashedPassword;
}
