export default interface Configuration {
  readonly serviceHost: string;
  readonly apiKey: string;
  readonly projectId: string;
  readonly branchName: string;
}

export interface BaseParameter {
  readonly action: 'update-status' | 'retrieve-info' | 'dispatch-deployments' | 'set-deployments-finished';
  readonly apiKey: string;
  readonly serviceHost: string;
}

export interface UpdateStatusParameter {
  readonly projectId: string;
  readonly branchId: string;
  readonly deploymentId?: string;
  readonly status: string;
  readonly runId: string;
}

export interface RetrieveInfoParameter {
  readonly projectId: string;
  readonly branchName: string;
  readonly branchId?: string;
  readonly deploymentId?: string;
}

export interface DispatchDeploymentsParameter {
  readonly projectId: string;
  readonly branchId: string;
  readonly commitId: string;
}

export type Parameter = BaseParameter | UpdateStatusParameter | RetrieveInfoParameter | DispatchDeploymentsParameter;
