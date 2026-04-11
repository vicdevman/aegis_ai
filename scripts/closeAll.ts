/**
 * Manual Close All Positions Script
 * ─────────────────────────────────
 * Usage: npm run script scripts/closeAll.ts
 */

import { getActivePositions, closePosition } from "../src/modules/position/index.js";
import { getMarketData } from "../src/modules/market/index.js";
import { connectDB } from "../src/db/connect.js";
import { logger } from "../src/utils/logger.js";
import { PositionModel } from "../src/db/models/Position.js";
import { config } from "../src/config/env.js";

async function main() {
  logger.info("[Manual] Connecting to DB...");
  await connectDB();

  logger.info("[Manual] Fetching all open positions...");
  
  // Directly query DB to bypass devMode memory-only return if needed
  // This ensures a script can always see what's in the actual DB
  const positions = await PositionModel.find({ status: "open" }).lean();
  
  if (positions.length === 0) {
    logger.info("[Manual] No open positions found.");
    return;
  }

  logger.warn(`[Manual] Found ${positions.length} open positions. Closing all...`);

  for (const posDoc of positions) {
    const pos = posDoc as any;
    try {
      logger.info(`[Manual] Closing ${pos.pair} (ID: ${pos.id})...`);
      const market = await getMarketData(pos.pair);
      await closePosition(pos.id, market.price, "MANUAL");
      logger.info(`[Manual] ✅ Closed ${pos.pair} @ $${market.price}`);
    } catch (err) {
      logger.error(`[Manual] ❌ Failed to close ${pos.pair}: ${err}`);
    }
  }

  logger.info("[Manual] Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error(`[Fatal] ${err}`);
    process.exit(1);
  });
