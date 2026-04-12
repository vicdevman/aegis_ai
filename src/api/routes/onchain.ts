import { Router } from 'express';
import { logger } from '../../utils/logger.js';
import { publicClient, AGENT_ID, AGENT_WALLET } from '../../blockchain/erc8004.js';

const router = Router();

// Contract addresses (Sepolia)
const AGENT_REGISTRY = '0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3';
const RISK_ROUTER = '0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC';
const VALIDATION_REGISTRY = '0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1';
const REPUTATION_REGISTRY = '0x423a9904e39537a9997fbaF0f220d79D7d545763';

// ABIs for read-only queries
const agentRegistryAbi = [
  {
    type: 'function',
    name: 'getAgent',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      { name: 'operatorWallet', type: 'address' },
      { name: 'agentWallet', type: 'address' },
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'capabilities', type: 'string[]' },
      { name: 'registeredAt', type: 'uint256' },
      { name: 'active', type: 'bool' }
    ],
    stateMutability: 'view'
  }
] as const;

const reputationRegistryAbi = [
  {
    type: 'function',
    name: 'getAverageScore',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  }
] as const;

// Helper: fetch logs in chunks to avoid block range limit
async function fetchLogsInChunks(address: `0x${string}`, event: any, args: any, fromBlock: bigint, toBlock: bigint, chunkSize = 50000n) {
  const allLogs: any[] = [];
  let currentFrom = fromBlock;
  
  while (currentFrom <= toBlock) {
    const currentTo = currentFrom + chunkSize - 1n > toBlock ? toBlock : currentFrom + chunkSize - 1n;
    try {
      const logs = await publicClient.getLogs({
        address,
        event,
        args,
        fromBlock: currentFrom,
        toBlock: currentTo,
      });
      allLogs.push(...logs);
    } catch (err) {
      logger.warn(`[Onchain] Log fetch failed for blocks ${currentFrom}-${currentTo}: ${err}`);
    }
    currentFrom = currentTo + 1n;
  }
  return allLogs;
}

// Helper: get recent TradeApproved events (last 50k blocks, paginated)
async function getRecentTrades(limit = 20) {
  const toBlock = await publicClient.getBlockNumber();
  const fromBlock = toBlock > 50000n ? toBlock - 50000n : 0n;
  
  const logs = await fetchLogsInChunks(
    RISK_ROUTER as `0x${string}`,
    {
      type: 'event',
      name: 'TradeApproved',
      inputs: [
        { name: 'agentId', type: 'uint256', indexed: true },
        { name: 'intentHash', type: 'bytes32', indexed: false },
        { name: 'amountUsdScaled', type: 'uint256', indexed: false }
      ]
    },
    { agentId: AGENT_ID },
    fromBlock,
    toBlock
  );
  
  return logs.slice(-limit).reverse();
}

// Helper: get recent ValidationAttestation events (EIP-712 version)
async function getRecentAttestations(limit = 20) {
  const toBlock = await publicClient.getBlockNumber();
  const fromBlock = toBlock > 50000n ? toBlock - 50000n : 0n;
  
  const logs = await fetchLogsInChunks(
    VALIDATION_REGISTRY as `0x${string}`,
    {
      type: 'event',
      name: 'ValidationAttestation',
      inputs: [
        { name: 'agentId', type: 'uint256', indexed: true },
        { name: 'checkpointHash', type: 'bytes32', indexed: false },
        { name: 'score', type: 'uint8', indexed: false },
        { name: 'attestor', type: 'address', indexed: false }
      ]
    },
    { agentId: AGENT_ID },
    fromBlock,
    toBlock
  );
  
  return logs.slice(-limit).reverse();
}

// GET /api/onchain/agent - Get agent details
router.get('/agent', async (req, res) => {
  try {
    const result = await publicClient.readContract({
      address: AGENT_REGISTRY,
      abi: agentRegistryAbi,
      functionName: 'getAgent',
      args: [AGENT_ID]
    });
    
    // Destructure safely, handle BigInt
    const [operatorWallet, agentWallet, name, description, capabilities, registeredAtBigInt, active] = result as any;
    const registeredAt = Number(registeredAtBigInt); // Convert BigInt to number (fits within 2^53 for timestamps up to year 3000)
    
    res.json({
      agentId: AGENT_ID.toString(),
      operatorWallet,
      agentWallet,
      name,
      description,
      capabilities,
      registeredAt: new Date(registeredAt * 1000).toISOString(),
      registeredAtTimestamp: registeredAt,
      active,
      contractAddress: AGENT_REGISTRY,
      explorerUrl: `https://sepolia.etherscan.io/address/${AGENT_REGISTRY}#readContract`
    });
  } catch (err) {
    logger.error(`[API] /onchain/agent error: ${err}`);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/onchain/reputation
router.get('/reputation', async (req, res) => {
  try {
    const score = await publicClient.readContract({
      address: REPUTATION_REGISTRY,
      abi: reputationRegistryAbi,
      functionName: 'getAverageScore',
      args: [AGENT_ID]
    }) as bigint;
    
    res.json({
      agentId: AGENT_ID.toString(),
      averageScore: Number(score),
      reputationRegistry: REPUTATION_REGISTRY,
      explorerUrl: `https://sepolia.etherscan.io/address/${REPUTATION_REGISTRY}#readContract`
    });
  } catch (err) {
    logger.error(`[API] /onchain/reputation error: ${err}`);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/onchain/trades
router.get('/trades', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const trades = await getRecentTrades(limit);
    
    const formattedTrades = trades.map(log => ({
      txHash: log.transactionHash,
      blockNumber: log.blockNumber.toString(),
      intentHash: log.args.intentHash,
      amountUsdScaled: log.args.amountUsdScaled?.toString(),
      amountUsd: Number(log.args.amountUsdScaled) / 100,
      explorerUrl: `https://sepolia.etherscan.io/tx/${log.transactionHash}`
    }));
    
    res.json({
      agentId: AGENT_ID.toString(),
      total: formattedTrades.length,
      trades: formattedTrades
    });
  } catch (err) {
    logger.error(`[API] /onchain/trades error: ${err}`);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/onchain/attestations
router.get('/attestations', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const attestations = await getRecentAttestations(limit);
    
    const formatted = attestations.map(log => ({
      txHash: log.transactionHash,
      blockNumber: log.blockNumber.toString(),
      checkpointHash: log.args.checkpointHash,
      score: log.args.score,
      attestor: log.args.attestor,
      explorerUrl: `https://sepolia.etherscan.io/tx/${log.transactionHash}`
    }));
    
    res.json({
      agentId: AGENT_ID.toString(),
      total: formatted.length,
      attestations: formatted
    });
  } catch (err) {
    logger.error(`[API] /onchain/attestations error: ${err}`);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/onchain/summary
router.get('/summary', async (req, res) => {
  try {
    const [agentResult, reputation, trades, attestations] = await Promise.all([
      publicClient.readContract({
        address: AGENT_REGISTRY,
        abi: agentRegistryAbi,
        functionName: 'getAgent',
        args: [AGENT_ID]
      }).catch(() => null),
      publicClient.readContract({
        address: REPUTATION_REGISTRY,
        abi: reputationRegistryAbi,
        functionName: 'getAverageScore',
        args: [AGENT_ID]
      }).catch(() => null) as Promise<bigint | null>,
      getRecentTrades(10),
      getRecentAttestations(10)
    ]);
    
    const agent = agentResult ? {
      name: (agentResult as any)[2],
      description: (agentResult as any)[3],
      capabilities: (agentResult as any)[4],
      registeredAt: new Date(Number((agentResult as any)[5]) * 1000).toISOString(),
      active: (agentResult as any)[6],
      operatorWallet: (agentResult as any)[0],
      agentWallet: (agentResult as any)[1],
      explorerUrl: `https://sepolia.etherscan.io/address/${AGENT_REGISTRY}#readContract`
    } : null;
    
    res.json({
      agentId: AGENT_ID.toString(),
      agentWallet: AGENT_WALLET,
      agentDetails: agent,
      reputationScore: reputation ? Number(reputation) : 0,
      recentTrades: trades.map(log => ({
        txHash: log.transactionHash,
        amountUsd: Number(log.args.amountUsdScaled) / 100,
        explorerUrl: `https://sepolia.etherscan.io/tx/${log.transactionHash}`
      })),
      recentAttestations: attestations.map(log => ({
        txHash: log.transactionHash,
        score: log.args.score,
        explorerUrl: `https://sepolia.etherscan.io/tx/${log.transactionHash}`
      }))
    });
  } catch (err) {
    logger.error(`[API] /onchain/summary error: ${err}`);
    res.status(500).json({ error: String(err) });
  }
});

export default router;