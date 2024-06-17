import DeployNowClient from './api/deployNow';
import { error, warning } from '@actions/core';
import {
  DeploymentInfo,
  DeploymentVariables,
  DisabledProject,
  EnabledProject,
  Info,
  TemplateVariables,
} from './output/types';
import {
  BaseParameter,
  DispatchDeploymentsParameter,
  Parameter,
  RetrieveInfoParameter,
  UpdateStatusParameter,
} from './input/types';
import Retryable from './api/retry';
import { BranchOverview, Deployment, DeploymentState, WebspaceState } from './api/api';

export async function handleAction(parameter: Parameter): Promise<Record<string, any>> {
  const { action, serviceHost, apiKey, ...actionParameter } = parameter as BaseParameter;
  const client = new DeployNowClient(serviceHost, apiKey);
  switch (action) {
    case 'retrieve-info':
      return retrieveInfo(client, actionParameter as RetrieveInfoParameter);
    case 'update-status':
      await updateDeploymentStatus(client, parameter as Required<UpdateStatusParameter>);
      return {};
    case 'set-deployments-finished':
      await setDeploymentsFinishedBranchStatus(client, actionParameter as UpdateStatusParameter);
      return {};
    case 'dispatch-deployments':
      await dispatchDeployments(client, actionParameter as DispatchDeploymentsParameter);
      return {};
    default:
      error(`Action ${action} is not supported`);
      return {};
  }
}

async function setDeploymentsFinishedBranchStatus(
  client: DeployNowClient,
  { projectId, branchId }: UpdateStatusParameter,
) {
  await client.branchApi.finishDeployments('me', projectId, branchId).catch((error) => {
    throw new Error(`Failed to to inform Deploy Now that deployments have finished : ${getErrorMessage(error)}`);
  });
}

async function updateDeploymentStatus(
  client: DeployNowClient,
  { projectId, branchId, deploymentId, status, runId }: Required<UpdateStatusParameter>,
) {
  const state = getState(status);
  await client.deploymentApi
    .updateDeploymentState('me', projectId, branchId, deploymentId, {
      state,
      externalId: runId,
    })
    .catch((error) => {
      throw new Error(`Failed to set state "${state}" for deployment: ${getErrorMessage(error)}`);
    });
}

function getState(status: string): DeploymentState {
  switch (status) {
    case 'success':
      return DeploymentState.SUCCESS;
    case 'failure':
    case 'cancelled':
      return DeploymentState.FAILED;
    case 'in_progress':
      return DeploymentState.RUNNING;
    default:
      throw new Error('Could not retrieve deployment state from action status: ' + status);
  }
}

export async function retrieveInfo(
  client: DeployNowClient,
  parameter: RetrieveInfoParameter,
): Promise<Info<EnabledProject | DisabledProject | DeploymentInfo> | TemplateVariables<DeploymentVariables>> {
  if (!parameter.branchId && !parameter.deploymentId) {
    return await retrieveProjectInfo(client, parameter);
  } else {
    return await retrieveDeploymentInfo(client, parameter as Required<RetrieveInfoParameter>);
  }
}

async function retrieveProjectInfo(
  client: DeployNowClient,
  { projectId, branchName }: RetrieveInfoParameter,
): Promise<Info<EnabledProject | DisabledProject>> {
  const branch = await new Retryable<BranchOverview>(
    async (retry, lastRetry) =>
      await client.branchApi
        .getBranches('me', projectId, { name: branchName })
        .then(({ data }) => {
          if (data.total === 0) {
            if (lastRetry) {
              throw new Error('The setup of this DeployNow project is not fully completed yet');
            } else {
              return retry();
            }
          }
          return data.values[0];
        })
        .catch((error) => {
          throw new Error(`Failed to fetch information about branch "${branchName}": ${getErrorMessage(error)}`);
        }),
    { count: 5 },
  ).run();

  const deploymentCount = await new Retryable<number>(
    async (retry, lastRetry) =>
      await client.deploymentApi
        .getDeployments('me', projectId, branch.id)
        .then(({ data }) => {
          if (data.total === 0) {
            if (lastRetry) {
              return 0;
            } else {
              return retry();
            }
          }
          return data.total;
        })
        .catch((error) => {
          throw new Error(`Failed to get deployments for branch "${branchName}": ${getErrorMessage(error)}`);
        }),
    { count: 5 },
  ).run();

  if (deploymentCount < 1) {
    warning('The deployment is disabled for this branch');
    return { info: { 'deployment-enabled': false } };
  }
  return {
    info: {
      'deployment-enabled': true,
      'branch-id': branch.id,
    },
  };
}

async function retrieveDeploymentInfo(
  client: DeployNowClient,
  { projectId, branchId, deploymentId }: Required<RetrieveInfoParameter>,
): Promise<Info<DeploymentInfo> & TemplateVariables<DeploymentVariables>> {
  const deployment = await new Retryable<Deployment>(
    async (retry, lastRetry) =>
      await client.deploymentApi
        .getDeployment('me', projectId, branchId, deploymentId)
        .then(({ data }) => {
          if (
            data.webspace.state === WebspaceState.IN_CREATION ||
            data.webspace.webspace.quota === undefined ||
            data.domain === undefined
          ) {
            if (lastRetry) {
              throw new Error('The setup of this DeployNow project is not fully completed yet');
            } else {
              return retry();
            }
          }
          return data;
        })
        .catch((error) => {
          throw new Error('Failed to fetch information about deployment: ' + getErrorMessage(error));
        }),
    { count: 5 },
  ).run();

  return {
    info: {
      'remote-host': deployment.webspace.webspace.sshHost,
      'last-deployment-date': deployment.state.lastDeployedDate?.toString(),
      'site-url': `https://${deployment.domain.name}`,
      'storage-quota': deployment.webspace.webspace.quota!.storageQuota,
      'webspace-id': deployment.webspace.webspace.id,
      'php-version': deployment.webspace.webspace.phpVersion,
    },
    'template-variables': {
      IONOS_APP_URL: `https://${deployment.domain.name}`,
    },
  };
}

export async function dispatchDeployments(
  client: DeployNowClient,
  { projectId, branchId, commitId }: DispatchDeploymentsParameter,
) {
  await client.branchApi
    .triggerDeployments('me', projectId, branchId, { version: commitId, onlyFailed: false })
    .catch((error) => {
      throw new Error('Failed to trigger deployments: ' + getErrorMessage(error));
    });
}

function getErrorMessage(error: any): string {
  if (error instanceof Error) {
    return (error as Error).message;
  }
  return error;
}
