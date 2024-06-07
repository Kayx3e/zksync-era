/**
 * This suite contains tests displaying prices for some of the most common operations under various L1 gas prices.
 *
 * IMPORTANT: this test affects the internal state of the server and so
 * it should never be run in parallel with other tests.
 *
 * Locally, for maximal representation the test should be run with batches of size 1.
 * However, we do not want to overload the CI for such purposes and so the job of the CI would be to make
 * sure that the test is maintained does not get broken.
 *
 */
import * as utils from 'utils';
import * as fs from 'fs';
import { TestMaster } from '../src';

import * as zksync from 'zksync-ethers';
import * as ethers from 'ethers';
import { DataAvailabityMode, Token } from '../src/types';
import { SYSTEM_CONTEXT_ADDRESS, getTestContract } from '../src/helpers';

const UINT32_MAX = 2n ** 32n - 1n;
const MAX_GAS_PER_PUBDATA = 50_000;

const logs = fs.createWriteStream('fees.log', { flags: 'a' });

// Unless `RUN_FEE_TEST` is provided, skip the test suit
const testFees = process.env.RUN_FEE_TEST ? describe : describe.skip;

// The L1 gas prices under which the test will be conducted.
// For CI we use only 2 gas prices to not slow it down too much.
const L1_GAS_PRICES_TO_TEST = process.env.CI
    ? [
          5_000_000_000n, // 5 gwei
          10_000_000_000n // 10 gwei
      ]
    : [
          1_000_000_000n, // 1 gwei
          5_000_000_000n, // 5 gwei
          10_000_000_000n, // 10 gwei
          25_000_000_000n, // 25 gwei
          50_000_000_000n, // 50 gwei
          100_000_000_000n, // 100 gwei
          200_000_000_000n, // 200 gwei
          400_000_000_000n, // 400 gwei
          800_000_000_000n, // 800 gwei
          1_000_000_000_000n, // 1000 gwei
          2_000_000_000_000n // 2000 gwei
      ];

testFees('Test fees', () => {
    let testMaster: TestMaster;
    let alice: zksync.Wallet;

    let tokenDetails: Token;
    let aliceErc20: zksync.Contract;

    beforeAll(() => {
        testMaster = TestMaster.getInstance(__filename);
        alice = testMaster.mainAccount();

        tokenDetails = testMaster.environment().erc20Token;
        aliceErc20 = new ethers.Contract(tokenDetails.l1Address, zksync.utils.IERC20, alice.ethWallet());
    });

    test('Test fees', async () => {
        const receiver = ethers.Wallet.createRandom().address;

        // Getting ETH price in gas.
        const feeTestL1Receipt = await (
            await alice.ethWallet().sendTransaction({
                to: receiver,
                value: 1n
            })
        ).wait();

        if (feeTestL1Receipt === null) {
            throw new Error('Failed to send ETH transaction');
        }

        const feeTestL1ReceiptERC20 = await (
            await alice.ethWallet().sendTransaction({
                to: aliceErc20.getAddress(),
                data: aliceErc20.interface.encodeFunctionData('transfer', [receiver, 1n])
            })
        ).wait();

        if (feeTestL1ReceiptERC20 === null) {
            throw new Error('Failed to send ERC20 transaction');
        }

        // Warming up slots for the receiver
        await (
            await alice.sendTransaction({
                to: receiver,
                value: BigInt(1)
            })
        ).wait();

        await (
            await alice.sendTransaction({
                data: aliceErc20.interface.encodeFunctionData('transfer', [receiver, 1n]),
                to: tokenDetails.l2Address
            })
        ).wait();

        let reports = [
            'ETH transfer (to new):\n\n',
            'ETH transfer (to old):\n\n',
            'ERC20 transfer (to new):\n\n',
            'ERC20 transfer (to old):\n\n'
        ];
        for (const gasPrice of L1_GAS_PRICES_TO_TEST) {
            reports = await appendResults(
                alice,
                [feeTestL1Receipt, feeTestL1Receipt, feeTestL1ReceiptERC20, feeTestL1ReceiptERC20],
                // We always regenerate new addresses for transaction requests in order to estimate the cost for a new account
                [
                    {
                        to: ethers.Wallet.createRandom().address,
                        value: 1n
                    },
                    {
                        to: receiver,
                        value: 1n
                    },
                    {
                        data: aliceErc20.interface.encodeFunctionData('transfer', [
                            ethers.Wallet.createRandom().address,
                            1n
                        ]),
                        to: tokenDetails.l2Address
                    },
                    {
                        data: aliceErc20.interface.encodeFunctionData('transfer', [receiver, 1n]),
                        to: tokenDetails.l2Address
                    }
                ],
                gasPrice,
                reports
            );
        }

        console.log(`Full report: \n\n${reports.join('\n\n')}`);
    });

    test('Test gas consumption under large L1 gas price', async () => {
        if (testMaster.environment().l1BatchCommitDataGeneratorMode === DataAvailabityMode.Validium) {
            // We skip this test for Validium mode, since L1 gas price has little impact on the gasLimit in this mode.
            return;
        }

        // In this test we check that the server works fine when the required gasLimit is over u32::MAX.
        // Under normal server behavior, the maximal gas spent on pubdata is around 120kb * 2^20 gas/byte = ~120 * 10^9 gas.

        // In this test we will set gas per pubdata byte to its maximum value, while publishing a large L1->L2 message.

        const minimalL2GasPrice = testMaster.environment().minimalL2GasPrice;

        // We want the total gas limit to be over u32::MAX, so we need the gas per pubdata to be 50k.
        //
        // Note, that in case, any sort of overhead is present in the l2 fair gas price calculation, the final
        // gas per pubdata may be lower than 50_000. Here we assume that it is not the case, but we'll double check
        // that the gasLimit is indeed over u32::MAX, which is the most important tested property.
        const requiredPubdataPrice = minimalL2GasPrice * 100_000n;

        await setInternalL1GasPrice(
            alice._providerL2(),
            requiredPubdataPrice.toString(),
            requiredPubdataPrice.toString()
        );

        const l1Messenger = new ethers.Contract(zksync.utils.L1_MESSENGER_ADDRESS, zksync.utils.L1_MESSENGER, alice);

        // Firstly, let's test a successful transaction.
        const largeData = ethers.randomBytes(90_000);
        const tx = await l1Messenger.sendToL1(largeData, { type: 0 });
        expect(tx.gasLimit > UINT32_MAX).toBeTruthy();
        const receipt = await tx.wait();
        expect(receipt.gasUsed > UINT32_MAX).toBeTruthy();

        // Let's also check that the same transaction would work as eth_call
        const systemContextArtifact = getTestContract('ISystemContext');
        const systemContext = new ethers.Contract(SYSTEM_CONTEXT_ADDRESS, systemContextArtifact.abi, alice.provider);
        const systemContextGasPerPubdataByte = await systemContext.gasPerPubdataByte();
        expect(systemContextGasPerPubdataByte.toNumber()).toEqual(MAX_GAS_PER_PUBDATA);

        const dataHash = await l1Messenger.sendToL1.staticCall(largeData, { type: 0 });
        expect(dataHash).toEqual(ethers.keccak256(largeData));

        // Secondly, let's test an unsuccessful transaction with large refund.

        // The size of the data has increased, so the previous gas limit is not enough.
        const largerData = ethers.randomBytes(91_000);
        const gasToPass = receipt.gasUsed;
        const unsuccessfulTx = await l1Messenger.sendToL1(largerData, {
            gasLimit: gasToPass,
            type: 0
        });

        try {
            await unsuccessfulTx.wait();
            throw new Error('The transaction should have reverted');
        } catch {
            const receipt = await alice.provider.getTransactionReceipt(unsuccessfulTx.hash);
            expect(gasToPass - receipt!.gasUsed > UINT32_MAX).toBeTruthy();
        }
    });

    afterAll(async () => {
        // Returning the pubdata price to the default one
        await setInternalL1GasPrice(alice._providerL2(), undefined, undefined, true);

        await testMaster.deinitialize();
    });
});

async function appendResults(
    sender: zksync.Wallet,
    originalL1Receipts: ethers.TransactionReceipt[],
    transactionRequests: ethers.TransactionRequest[],
    newL1GasPrice: bigint,
    reports: string[]
): Promise<string[]> {
    // For the sake of simplicity, we'll use the same pubdata price as the L1 gas price.
    await setInternalL1GasPrice(sender._providerL2(), newL1GasPrice.toString(), newL1GasPrice.toString());

    if (originalL1Receipts.length !== reports.length && originalL1Receipts.length !== transactionRequests.length) {
        throw new Error('The array of receipts and reports have different length');
    }

    const results = [];

    for (let i = 0; i < originalL1Receipts.length; i++) {
        const receipt = originalL1Receipts[i];
        const request = transactionRequests[i];
        const oldReport = reports[i];

        results.push(await updateReport(sender, receipt, request, newL1GasPrice, oldReport));
    }

    return results;
}

async function updateReport(
    sender: zksync.Wallet,
    l1Receipt: ethers.TransactionReceipt,
    transactionRequest: ethers.TransactionRequest,
    newL1GasPrice: bigint,
    oldReport: string
): Promise<string> {
    const expectedL1Price = +ethers.formatEther(l1Receipt.gasUsed * newL1GasPrice);

    const estimatedL2GasPrice = await sender.provider.getGasPrice();
    const estimatedL2GasLimit = await sender.estimateGas(transactionRequest);
    const estimatedPrice = estimatedL2GasPrice * estimatedL2GasLimit;

    const balanceBefore = await sender.getBalance();
    const transaction = await sender.sendTransaction(transactionRequest);
    console.log(`Sending transaction: ${transaction.hash}`);
    await transaction.wait();
    const balanceAfter = await sender.getBalance();
    const balanceDiff = balanceBefore - balanceAfter;

    const l2PriceAsNumber = +ethers.formatEther(balanceDiff);
    const l2EstimatedPriceAsNumber = +ethers.formatEther(estimatedPrice);

    const gasReport = `Gas price ${newL1GasPrice / 1000000000n} gwei:
    L1 cost ${expectedL1Price},
    L2 estimated cost: ${l2EstimatedPriceAsNumber}
    Estimated Gain: ${expectedL1Price / l2EstimatedPriceAsNumber}
    L2 cost: ${l2PriceAsNumber},
    Gain: ${expectedL1Price / l2PriceAsNumber}\n`;
    console.log(gasReport);

    return oldReport + gasReport;
}

async function killServerAndWaitForShutdown(provider: zksync.Provider) {
    await utils.exec('pkill zksync_server');
    // Wait until it's really stopped.
    let iter = 0;
    while (iter < 30) {
        try {
            await provider.getBlockNumber();
            await utils.sleep(2);
            iter += 1;
        } catch (_) {
            // When exception happens, we assume that server died.
            return;
        }
    }
    // It's going to panic anyway, since the server is a singleton entity, so better to exit early.
    throw new Error("Server didn't stop after a kill request");
}

async function setInternalL1GasPrice(
    provider: zksync.Provider,
    newL1GasPrice?: string,
    newPubdataPrice?: string,
    disconnect?: boolean
) {
    // Make sure server isn't running.
    try {
        await killServerAndWaitForShutdown(provider);
    } catch (_) {}

    // Run server in background.
    let command = 'zk server --components api,tree,eth,state_keeper';
    command = `DATABASE_MERKLE_TREE_MODE=full ${command}`;

    if (newPubdataPrice) {
        command = `ETH_SENDER_GAS_ADJUSTER_INTERNAL_ENFORCED_PUBDATA_PRICE=${newPubdataPrice} ${command}`;
    }

    if (newL1GasPrice) {
        // We need to ensure that each transaction gets into its own batch for more fair comparison.
        command = `ETH_SENDER_GAS_ADJUSTER_INTERNAL_ENFORCED_L1_GAS_PRICE=${newL1GasPrice}  ${command}`;
    }

    const testMode = newPubdataPrice || newL1GasPrice;
    if (testMode) {
        // We need to ensure that each transaction gets into its own batch for more fair comparison.
        command = `CHAIN_STATE_KEEPER_TRANSACTION_SLOTS=1 ${command}`;
    }

    const zkSyncServer = utils.background(command, [null, logs, logs]);

    if (disconnect) {
        zkSyncServer.unref();
    }

    // Server may need some time to recompile if it's a cold run, so wait for it.
    let iter = 0;
    let mainContract;
    while (iter < 30 && !mainContract) {
        try {
            mainContract = await provider.getMainContractAddress();
        } catch (_) {
            await utils.sleep(2);
            iter += 1;
        }
    }
    if (!mainContract) {
        throw new Error('Server did not start');
    }

    await utils.sleep(10);
}
