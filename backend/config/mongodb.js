// backend/config/mongodb.mjs
import mongoose from 'mongoose';
import { config } from 'dotenv';

config(); // Load .env variables

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 30000, // 30 seconds timeout
    });
    console.log('MongoDB connected successfully');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1); // Exit process on connection failure
  }
}

export default connectDB;