import { PositionModel } from "../src/db/models/Position.ts";
import { randomUUID } from "crypto";

async function test() {
  console.log("--- Testing MongoDB Simulation ---");
  
  const id1 = randomUUID();
  const id2 = randomUUID();

  // Test Create
  console.log("Creating positions...");
  // await PositionModel.create({
  //   id: id1,
  //   pair: "BTC/USD",
  //   direction: "buy",
  //   entryPrice: 50000,
  //   volume: 0.1,
  //   positionSizeUSD: 5000,
  //   stopLoss: 48000,
  //   takeProfit: 55000,
  //   status: "open",
  //   strategy: "test",
  //   openedAt: new Date()
  // });

  // await PositionModel.create({
  //   id: id2,
  //   pair: "ETH/USD",
  //   direction: "sell",
  //   entryPrice: 3000,
  //   volume: 1,
  //   positionSizeUSD: 3000,
  //   stopLoss: 3100,
  //   takeProfit: 2800,
  //   status: "closed",
  //   strategy: "test",
  //   openedAt: new Date(),
  //   closedAt: new Date()
  // });

  // Test Find with chainable
  console.log("Finding closed positions (sorted)...");
  const closed = await PositionModel
    .find({ status: "closed" })
    .sort({ closedAt: -1 })
    .limit(1)
    .lean();

  console.log("Closed:", closed.length);
  if (closed.length > 0 && closed[0].id === id2) {
    console.log("✅ Find/Sort/Limit/Lean Success");
  } else {
    console.log("❌ Find/Sort/Limit/Lean Failed");
  }

  // Test findOneAndUpdate
  console.log("Updating position...");
  await PositionModel.findOneAndUpdate({ id: id1 }, { status: "closed", pnl: 100 });
  
  const updated = await PositionModel.find({ id: id1 }).lean();
  if (updated[0].status === "closed" && updated[0].pnl === 100) {
    console.log("✅ findOneAndUpdate Success");
  } else {
    console.log("❌ findOneAndUpdate Failed");
  }

  console.log("--- Test Complete ---");
}

test().catch(console.error);
