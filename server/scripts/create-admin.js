import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { User } from '../models/User.js';

const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
  console.error('Set ADMIN_NAME, ADMIN_EMAIL, and an ADMIN_PASSWORD of at least 12 characters in .env.');
  process.exit(1);
}

try {
  await mongoose.connect(config.mongoUri);
  const email = ADMIN_EMAIL.trim().toLowerCase();
  if (await User.exists({ email })) {
    console.error('An account with that email already exists.');
    process.exitCode = 1;
  } else {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await User.create({ name: ADMIN_NAME.trim(), email, passwordHash, role: 'administrator', status: 'active' });
    console.log(`Administrator account created for ${email}.`);
  }
} catch (error) {
  console.error('Could not create administrator account:', error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
