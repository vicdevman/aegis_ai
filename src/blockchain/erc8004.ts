import { createPublicClient, createWalletClient, http, Hex, encodeFunctionData, keccak256, toBytes } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';

// Contract addresses (Sepolia)
const AGENT_REGISTRY = '0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3' as Hex;
const HACKATHON_VAULT = '0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90' as Hex;
const RISK_ROUTER = '0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC' as Hex;
const VALIDATION_REGISTRY = '0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1' as Hex;
const REPUTATION_REGISTRY = '0x423a9904e39537a9997fbaF0f220d79D7d545763' as Hex;

// Your agent ID and wallet
export const AGENT_ID = 48n; // from registration
export const AGENT_WALLET = '0x507699CA5ecEEb8eCB0c3b7Fa8E85dc0Bc7b35e8' as Hex;

function normalizePrivateKey(key: string | undefined): Hex {
  if (!key) throw new Error('Private key missing in env');
  let hex = key.trim();
  if (!hex.startsWith('0x')) hex = '0x' + hex;
  if (hex.length !== 66) throw new Error('Private key must be 32 bytes (64 hex chars)');
  return hex as Hex;
}

// Operator wallet (the one that signed registration)
const OPERATOR_PRIVATE_KEY = normalizePrivateKey(config.operatorPrivateKey);
const AGENT_PRIVATE_KEY = normalizePrivateKey(config.agentPrivateKey); // Hot wallet for signing trades

const account = privateKeyToAccount(OPERATOR_PRIVATE_KEY);
const agentAccount = privateKeyToAccount(AGENT_PRIVATE_KEY);

// Public client (read-only)
export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http('https://ethereum-sepolia-rpc.publicnode.com'),
});

// Wallet client (for transactions)
export const walletClient = createWalletClient({
  account,
  chain: sepolia,
  transport: http('https://ethereum-sepolia-rpc.publicnode.com'),
});

// ================================
// 1. Vault ABIs (viem‑compatible)
// ================================
const vaultAbi = [
  {
    type: 'function',
    name: 'claimAllocation',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'getBalance',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  }
] as const;

// ================================
// 2. Router ABIs (full for simulate & submit)
// ================================
const routerAbi = [
  {
    type: 'function',
    name: 'getIntentNonce',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'simulateIntent',
    inputs: [
      {
        name: 'intent',
        type: 'tuple',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'agentWallet', type: 'address' },
          { name: 'pair', type: 'string' },
          { name: 'action', type: 'string' },
          { name: 'amountUsdScaled', type: 'uint256' },
          { name: 'maxSlippageBps', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' }
        ]
      }
    ],
    outputs: [
      { name: 'valid', type: 'bool' },
      { name: 'reason', type: 'string' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'submitTradeIntent',
    inputs: [
      {
        name: 'intent',
        type: 'tuple',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'agentWallet', type: 'address' },
          { name: 'pair', type: 'string' },
          { name: 'action', type: 'string' },
          { name: 'amountUsdScaled', type: 'uint256' },
          { name: 'maxSlippageBps', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' }
        ]
      },
      { name: 'signature', type: 'bytes' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  }
] as const;

// ================================
// 3. Claim allocation (raw transaction to avoid ABI parsing issues)
// ================================
export async function claimAllocation() {
  try {
    // First check if already claimed
    const balance = await publicClient.readContract({
      address: HACKATHON_VAULT,
      abi: vaultAbi,
      functionName: 'getBalance',
      args: [AGENT_ID],
    }) as bigint;
    if (balance > 0n) {
      logger.info(`[ERC8004] Already claimed: ${balance / 10n**18n} ETH`);
      return;
    }

    logger.info('[ERC8004] Claiming allocation via raw transaction...');
    const data = encodeFunctionData({
      abi: [{
        type: 'function',
        name: 'claimAllocation',
        inputs: [{ name: 'agentId', type: 'uint256' }],
        outputs: [],
        stateMutability: 'nonpayable'
      }],
      functionName: 'claimAllocation',
      args: [AGENT_ID]
    });

    const hash = await walletClient.sendTransaction({
      to: HACKATHON_VAULT,
      data,
      account,
    });
    logger.info(`[ERC8004] Claim tx: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
    logger.info('[ERC8004] Allocation claimed!');
  } catch (err) {
    logger.error(`[ERC8004] Claim failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ================================
// 4. EIP‑712 signing & submission
// ================================
const DOMAIN = {
  name: 'RiskRouter',
  version: '1',
  chainId: 11155111,
  verifyingContract: RISK_ROUTER,
} as const;

const TRADE_INTENT_TYPES = {
  TradeIntent: [
    { name: 'agentId', type: 'uint256' },
    { name: 'agentWallet', type: 'address' },
    { name: 'pair', type: 'string' },
    { name: 'action', type: 'string' },
    { name: 'amountUsdScaled', type: 'uint256' },
    { name: 'maxSlippageBps', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

export async function getIntentNonce(): Promise<bigint> {
  const nonce = await publicClient.readContract({
    address: RISK_ROUTER,
    abi: routerAbi,
    functionName: 'getIntentNonce',
    args: [AGENT_ID],
  }) as bigint;
  return nonce;
}

export async function submitTradeIntent(
  pair: string,
  action: 'BUY' | 'SELL',
  amountUsd: number,          // e.g., 500 = $500
  maxSlippageBps = 100,       // 1% slippage
  deadlineSeconds = 300       // 5 minutes
) {
  const nonce = await getIntentNonce();
  const amountUsdScaled = BigInt(Math.floor(amountUsd * 100)); // $500 -> 50000
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

  const intent = {
    agentId: AGENT_ID,
    agentWallet: AGENT_WALLET,
    pair,
    action,
    amountUsdScaled,
    maxSlippageBps: BigInt(maxSlippageBps),
    nonce,
    deadline,
  };

  // Sign with AGENT_PRIVATE_KEY (hot wallet)
  const signature = await agentAccount.signTypedData({
    domain: DOMAIN,
    types: TRADE_INTENT_TYPES,
    primaryType: 'TradeIntent',
    message: intent,
  });

  // Simulate before submitting
  const [valid, reason] = await publicClient.readContract({
    address: RISK_ROUTER,
    abi: routerAbi,
    functionName: 'simulateIntent',
    args: [intent],
  }) as [boolean, string];
  if (!valid) {
    logger.warn(`[ERC8004] Simulation failed: ${reason}`);
    return null;
  }

  // Submit
  const { request } = await publicClient.simulateContract({
    address: RISK_ROUTER,
    abi: routerAbi,
    functionName: 'submitTradeIntent',
    args: [intent, signature],
    account,
  });
  const hash = await walletClient.writeContract(request);
  logger.info(`[ERC8004] Trade intent submitted: ${hash}`);
  return hash;
}