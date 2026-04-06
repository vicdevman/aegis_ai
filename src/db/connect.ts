import mongoose from "mongoose";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

export async function connectDB(): Promise<void> {
  // Add this line to debug:
  logger.info(`Attempting to connect to: ${config.mongodbUri}`); 
  
  try {
    await mongoose.connect(config.mongodbUri);
    logger.info(`[DB] Connected`);
  } catch (err) {
    logger.error(`[DB] Connection failed: ${err}`);
    process.exit(1);
  }
}