import { Command } from 'commander';

import { up } from './up';
import { announced } from './utils';
import { initDevCmdAction, initHyperCmdAction } from './init';
import { DeploymentMode } from './contract';

const reinitDevCmdAction = async (): Promise<void> => {
    await announced('Setting up containers', up(false));
    // skipEnvSetup and skipSubmodulesCheckout, because we only want to compile
    // no ERC20 token deployment, because they are already deployed
    await initDevCmdAction({
        skipEnvSetup: true,
        skipSubmodulesCheckout: true,
        skipTestTokenDeployment: true,
        // TODO set proper values
        runObservability: true,
        deploymentMode: DeploymentMode.Rollup
    });
};

type ReinitHyperCmdActionOptions = { baseTokenName?: string; deploymentMode: DeploymentMode };
const reinitHyperCmdAction = async ({ baseTokenName, deploymentMode }: ReinitHyperCmdActionOptions): Promise<void> => {
    // skipSetupCompletely, because we only want to compile
    // bumpChainId, because we want to reinitialize hyperchain with a new chain id
    await initHyperCmdAction({
        skipSetupCompletely: true,
        baseTokenName: baseTokenName,
        bumpChainId: true,
        runObservability: false,
        deploymentMode
    });
};

export const reinitCommand = new Command('reinit')
    .description('"Reinitializes" network. Runs faster than a full init, but requires `init` to be executed prior.')
    .action(reinitDevCmdAction);

reinitCommand
    .command('hyper')
    .description('Bumps chain id and reinitializes hyperchain. Requires `init` to be executed prior.')
    .option('--base-token-name <base-token-name>', 'base token name')
    .action(reinitHyperCmdAction);
