import mongoose from "mongoose";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

export async function connectDB(): Promise<void> {
  try {
    await mongoose.connect(config.mongodbUri);
    logger.info(`[DB] Connected: ${config.mongodbUri}`);
  } catch (err) {
    logger.error(`[DB] Connection failed: ${err}`);
    process.exit(1);
  }
}
