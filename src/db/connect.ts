import mongoose from "mongoose";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

export async function connectDB(): Promise<void> {
  if (config.devMode) {
    logger.info(`[DB] Using Simulation Mode (${config.mongodbUri})`);
    return;
  }

  try {
    await mongoose.connect(config.mongodbUri);
    logger.info(`[DB] Connected`);
  } catch (err) {
    logger.error(`[DB] Connection failed: ${err}`);
    process.exit(1);
  }
}