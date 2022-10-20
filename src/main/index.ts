import { handleAction } from './action';
import { Parameter } from './action/input/types';
import Action from '@ionos-deploy-now/actions-core';

Action.run<Parameter, Record<string, any>>(
  handleAction,
  (input, context) =>
    <Parameter>{
      action: '',
      serviceHost: input.required('service-host'),
      apiKey: input.required('api-key'),
      projectId: input.required('project-id'),
      branchId: input.optional('branch-id'),
      deploymentId: input.optional('deployment-id'),
      status: input.optional('status'),
      branchName: context.required('ref').replace(/refs\/heads\//g, ''),
      runId: context.required('runId'),
      commitId: context.required('sha'),
    }
);
