import DeployNowClient from './api/deployNow';
import { error, warning } from '@actions/core';
import { DeploymentInfo, DisabledProject, EnabledProject } from './output/types';
import {
  BaseParameter,
  DispatchDeploymentsParameter,
  Parameter,
  RetrieveInfoParameter,
  UpdateStatusParameter,
} from './input/types';
import Retryable from './api/retry';
import { BranchOverview, Deployment, WebspaceState } from './api/api';

export async function handleAction(parameter: Parameter): Promise<Record<string, any>> {
  const { action, serviceHost, apiKey, ...actionParameter } = parameter as BaseParameter;
  const client = new DeployNowClient(serviceHost, apiKey);
  switch (action) {
    case 'retrieve-info':
      return await retrieveInfo(client, actionParameter as RetrieveInfoParameter);
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
  { projectId, branchId }: UpdateStatusParameter
) {
  await client.branchApi.finishDeployments('me', projectId, branchId);
}

async function updateDeploymentStatus(
  client: DeployNowClient,
  { projectId, branchId, deploymentId, status, runId }: Required<UpdateStatusParameter>
) {
  await client.deploymentApi.updateDeploymentState('me', projectId, branchId, deploymentId, {
    state: getState(status),
    externalId: runId,
  });
}

function getState(status: string): DeploymentState {
  switch (status) {
    case 'success':
      return DeploymentState.SUCCESSFUL;
    case 'failure':
    case 'cancelled':
      return DeploymentState.FAILED;
    case 'in_progress':
      return DeploymentState.IN_PROGRESS;
    default:
      throw new Error();
  }
}

enum DeploymentState {
  IN_CREATION = 'IN_CREATION',
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCESSFUL = 'SUCCESSFUL',
  FAILED = 'FAILED',
}

export async function retrieveInfo(
  client: DeployNowClient,
  parameter: RetrieveInfoParameter
): Promise<EnabledProject | DisabledProject | DeploymentInfo> {
  if (!parameter.branchId && !parameter.deploymentId) {
    return await retrieveProjectInfo(client, parameter);
  } else {
    return await retrieveDeploymentInfo(client, parameter as Required<RetrieveInfoParameter>);
  }
}

async function retrieveProjectInfo(
  client: DeployNowClient,
  { projectId, branchName }: RetrieveInfoParameter
): Promise<EnabledProject | DisabledProject> {
  const branch = await new Retryable<BranchOverview>(
    async (retry, lastRetry) =>
      await client.branchApi.getBranches('me', projectId, { name: branchName }).then(({ data }) => {
        if (data.total === 0) {
          if (lastRetry) {
            throw new Error('The setup of this DeployNow project is not fully completed yet');
          } else {
            return retry();
          }
        }
        return data.values[0];
      }),
    { count: 5 }
  ).run();

  const deploymentCount = await new Retryable<number>(
    async (retry, lastRetry) =>
      await client.deploymentApi.getDeployments('me', projectId, branch.id).then(({ data }) => {
        if (data.total === 0) {
          if (lastRetry) {
            throw new Error('The setup of this DeployNow project is not fully completed yet');
          } else {
            return retry();
          }
        }
        return data.total;
      }),
    { count: 5 }
  ).run();

  if (deploymentCount < 1) {
    warning('The deployment is disabled for this branch');
    return { 'deployment-enabled': false };
  }
  return {
    'deployment-enabled': true,
    'branch-id': branch.id,
  };
}

async function retrieveDeploymentInfo(
  client: DeployNowClient,
  { projectId, branchId, deploymentId }: Required<RetrieveInfoParameter>
): Promise<DeploymentInfo> {
  const deployment = await new Retryable<Deployment>(
    async (retry, lastRetry) =>
      await client.deploymentApi.getDeployment('me', projectId, branchId, deploymentId).then(({ data }) => {
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
      }),
    { count: 5 }
  ).run();

  return {
    'remote-host': deployment.webspace.webspace.sshHost,
    'bootstrap-deploy': false,
    'site-url': deployment.domain!.name,
    'storage-quota': deployment.webspace.webspace.quota!.storageQuota,
    'webspace-id': deployment.webspace.webspace.id,
  };
}

export async function dispatchDeployments(
  client: DeployNowClient,
  { projectId, branchId, commitId }: DispatchDeploymentsParameter
) {
  await client.branchApi.triggerDeployments('me', projectId, branchId, { version: commitId });
}
