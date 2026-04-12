import { Router } from 'express';
import { logger } from '../../utils/logger.js';
import { publicClient, AGENT_ID, AGENT_WALLET } from '../../blockchain/erc8004.js';
import { formatEther } from 'viem';

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

type AgentResultTuple = readonly [
  `0x${string}`,
  `0x${string}`,
  string,
  string,
  readonly string[],
  bigint,
  boolean,
];

function parseAgent(agent: AgentResultTuple) {
  const [operatorWallet, agentWallet, name, description, capabilities, registeredAt, active] = agent;
  return {
    operatorWallet,
    agentWallet,
    name,
    description,
    capabilities,
    registeredAt,
    active,
  };
}

// Helper to get recent TradeApproved events from RiskRouter
async function getRecentTrades(limit = 20) {
  const fromBlock = 0n; // or start from agent registration block
  const toBlock = await publicClient.getBlockNumber();
  
  const logs = await publicClient.getLogs({
    address: RISK_ROUTER,
    event: {
      type: 'event',
      name: 'TradeApproved',
      inputs: [
        { name: 'agentId', type: 'uint256', indexed: true },
        { name: 'intentHash', type: 'bytes32', indexed: false },
        { name: 'amountUsdScaled', type: 'uint256', indexed: false }
      ]
    },
    args: { agentId: AGENT_ID },
    fromBlock,
    toBlock
  });
  
  return logs.slice(-limit).reverse();
}

// Helper to get recent ValidationAttestation events
async function getRecentAttestations(limit = 20) {
  const fromBlock = 0n;
  const toBlock = await publicClient.getBlockNumber();
  
  const logs = await publicClient.getLogs({
    address: VALIDATION_REGISTRY,
    event: {
      type: 'event',
      name: 'ValidationAttestation',
      inputs: [
        { name: 'agentId', type: 'uint256', indexed: true },
        { name: 'checkpointHash', type: 'bytes32', indexed: false },
        { name: 'score', type: 'uint8', indexed: false },
        { name: 'attestor', type: 'address', indexed: false }
      ]
    },
    args: { agentId: AGENT_ID },
    fromBlock,
    toBlock
  });
  
  return logs.slice(-limit).reverse();
}

// GET /api/onchain/agent - Get agent details
router.get('/agent', async (req, res) => {
  try {
    const agent = await publicClient.readContract({
      address: AGENT_REGISTRY,
      abi: agentRegistryAbi,
      functionName: 'getAgent',
      args: [AGENT_ID]
    }) as AgentResultTuple;
    const parsed = parseAgent(agent);
    
    res.json({
      agentId: AGENT_ID.toString(),
      ...parsed,
      registeredAt: new Date(Number(parsed.registeredAt) * 1000).toISOString(),
      explorerUrl: `https://sepolia.etherscan.io/address/${AGENT_REGISTRY}#readContract`
    });
  } catch (err) {
    logger.error(`[API] /onchain/agent error: ${err}`);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/onchain/reputation - Get reputation score
router.get('/reputation', async (req, res) => {
  try {
    const score = await publicClient.readContract({
      address: REPUTATION_REGISTRY,
      abi: reputationRegistryAbi,
      functionName: 'getAverageScore',
      args: [AGENT_ID]
    });
    
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

// GET /api/onchain/trades - Get recent trade intents
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

// GET /api/onchain/attestations - Get recent validation attestations
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

// GET /api/onchain/summary - All agent data in one call
router.get('/summary', async (req, res) => {
  try {
    const [agent, reputation, trades, attestations] = await Promise.all([
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
      }).catch(() => null),
      getRecentTrades(10),
      getRecentAttestations(10)
    ]);
    
    res.json({
      agentId: AGENT_ID.toString(),
      agentWallet: AGENT_WALLET,
      agentDetails: agent
        ? (() => {
            const parsed = parseAgent(agent as AgentResultTuple);
            return {
              name: parsed.name,
              description: parsed.description,
              capabilities: parsed.capabilities,
              registeredAt: new Date(Number(parsed.registeredAt) * 1000).toISOString(),
              active: parsed.active,
              operatorWallet: parsed.operatorWallet,
              agentWallet: parsed.agentWallet,
              explorerUrl: `https://sepolia.etherscan.io/address/${AGENT_REGISTRY}#readContract`,
            };
          })()
        : null,
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