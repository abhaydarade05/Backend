import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { User } from './models/index.js';

let connectionPromise;

function validateEnvironment() {
  const requiredEnvironment = ['MONGODB_URI', 'JWT_SECRET'];
  const missingEnvironment = requiredEnvironment.filter(key => !process.env[key]);
  if (missingEnvironment.length) {
    throw new Error(`Missing required environment variables: ${missingEnvironment.join(', ')}`);
  }
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long.');
  }
}

async function bootstrapAdmin() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;
  if (password.length < 12) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters long.');

  let result;
  try {
    result = await User.updateOne(
      { email },
      {
        $setOnInsert: {
          name: process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Portal Administrator',
          email,
          role: 'MASTER',
          passwordHash: await bcrypt.hash(password, 12)
        }
      },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000 || !await User.exists({ email })) throw error;
    return;
  }
  if (result.upsertedCount) {
    console.log(`Created the initial Master Admin account for ${email}.`);
  }
}

export async function connectToDatabase() {
  validateEnvironment();

  if (mongoose.connection.readyState === 0) connectionPromise = null;
  if (mongoose.connection.readyState === 1 && !connectionPromise) {
    connectionPromise = bootstrapAdmin().catch(error => {
      connectionPromise = null;
      throw error;
    });
  }
  if (!connectionPromise) {
    connectionPromise = mongoose.connect(process.env.MONGODB_URI)
      .then(async () => {
        console.log(`Connected to MongoDB database "${mongoose.connection.name}".`);
        await bootstrapAdmin();
      })
      .catch(error => {
        connectionPromise = null;
        throw error;
      });
  }
  return connectionPromise;
}
