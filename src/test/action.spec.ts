import { describe } from 'mocha';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { retrieveInfo, dispatchDeployments, handleAction } from '../main/action';
import DeployNowClient from '../main/action/api/deployNow';
import {
  AxiosIonosSpaceBranchApiClient,
  AxiosIonosSpaceDeploymentApiClient,
  DeploymentState,
  WebspaceState,
} from '../main/action/api/api';

chai.use(chaiAsPromised);

const PAGE = { pageNumber: 0, pageSize: 10 };

function makeBranchOverview(id = 'branch-1') {
  return {
    id,
    name: 'main',
    productionBranch: true,
    webUrl: 'https://example.com',
    workflowPresent: true,
    deleted: false,
    deploymentCount: 1,
  };
}

function makeDeployment() {
  return {
    id: 'dep-1',
    name: 'main',
    webspace: {
      state: WebspaceState.CREATED,
      webspace: {
        id: 'ws-1',
        sshHost: 'ssh.example.com',
        phpVersion: '8.2',
        quota: { storageQuota: 10240 },
        name: 'ws',
        serverNames: [],
        accesses: [],
        cronjobs: [],
      },
    },
    domain: { name: 'app.example.com', customDomain: false },
    state: {
      state: DeploymentState.SUCCESS,
      externalId: 'run-1',
      occurrenceTime: new Date(),
      lastDeployedDate: new Date('2024-01-01'),
    },
  };
}

function makeMockClient(
  branchStubs: Partial<AxiosIonosSpaceBranchApiClient> = {},
  deploymentStubs: Partial<AxiosIonosSpaceDeploymentApiClient> = {},
): DeployNowClient {
  return {
    projectApi: {} as any,
    branchApi: branchStubs as AxiosIonosSpaceBranchApiClient,
    deploymentApi: deploymentStubs as AxiosIonosSpaceDeploymentApiClient,
  } as DeployNowClient;
}

describe('retrieveInfo', () => {
  describe('retrieveProjectInfo (no branchId, no deploymentId)', () => {
    it('returns enabled project when branch and deployments exist', async () => {
      const branch = makeBranchOverview('b-123');
      const client = makeMockClient(
        {
          getBranches: sinon.stub().resolves({ data: { ...PAGE, total: 1, values: [branch] } }),
        },
        {
          getDeployments: sinon.stub().resolves({ data: { ...PAGE, total: 2, values: [] } }),
        },
      );

      const result = await retrieveInfo(client, { projectId: 'proj-1', branchName: 'main' });

      expect(result).to.deep.equal({ info: { 'deployment-enabled': true, 'branch-id': 'b-123' } });
    });

    it('returns disabled project when no deployments exist after retries', async () => {
      const branch = makeBranchOverview('b-123');
      const client = makeMockClient(
        {
          getBranches: sinon.stub().resolves({ data: { ...PAGE, total: 1, values: [branch] } }),
        },
        {
          getDeployments: sinon.stub().resolves({ data: { ...PAGE, total: 0, values: [] } }),
        },
      );

      const result = await retrieveInfo(client, { projectId: 'proj-1', branchName: 'main' });

      expect(result).to.deep.equal({ info: { 'deployment-enabled': false } });
    });

    it('retries when branch list is empty initially', async () => {
      const branch = makeBranchOverview('b-456');
      const getBranches = sinon
        .stub()
        .onFirstCall()
        .resolves({ data: { ...PAGE, total: 0, values: [] } })
        .onSecondCall()
        .resolves({ data: { ...PAGE, total: 1, values: [branch] } });

      const client = makeMockClient(
        { getBranches },
        {
          getDeployments: sinon.stub().resolves({ data: { ...PAGE, total: 1, values: [] } }),
        },
      );

      const result = await retrieveInfo(client, { projectId: 'proj-1', branchName: 'main' });

      expect(result).to.deep.equal({ info: { 'deployment-enabled': true, 'branch-id': 'b-456' } });
      expect((getBranches as sinon.SinonStub).callCount).to.equal(2);
    });

    it('throws after all retries when branch never found', async () => {
      const client = makeMockClient(
        {
          getBranches: sinon.stub().resolves({ data: { ...PAGE, total: 0, values: [] } }),
        },
        {},
      );

      await expect(retrieveInfo(client, { projectId: 'proj-1', branchName: 'main' })).to.be.rejectedWith(
        'The setup of this DeployNow project is not fully completed yet',
      );
    });

    it('throws when branch API errors', async () => {
      const client = makeMockClient(
        {
          getBranches: sinon.stub().rejects(new Error('network error')),
        },
        {},
      );

      await expect(retrieveInfo(client, { projectId: 'proj-1', branchName: 'main' })).to.be.rejectedWith(
        'Failed to fetch information about branch "main"',
      );
    });
  });

  describe('retrieveDeploymentInfo (branchId and deploymentId present)', () => {
    it('returns full deployment info when webspace is ready', async () => {
      const deployment = makeDeployment();
      const client = makeMockClient(
        {},
        {
          getDeployment: sinon.stub().resolves({ data: deployment }),
        },
      );

      const result = await retrieveInfo(client, {
        projectId: 'proj-1',
        branchName: 'main',
        branchId: 'b-1',
        deploymentId: 'dep-1',
      });

      expect(result).to.deep.equal({
        info: {
          'remote-host': 'ssh.example.com',
          'site-url': 'https://app.example.com',
          'storage-quota': 10240,
          'webspace-id': 'ws-1',
          'php-version': '8.2',
          'last-deployment-date': new Date('2024-01-01').toString(),
        },
        'template-variables': { IONOS_APP_URL: 'https://app.example.com' },
      });
    });

    it('retries when webspace is still IN_CREATION', async () => {
      const creatingDeployment = makeDeployment();
      creatingDeployment.webspace.state = WebspaceState.IN_CREATION;
      const readyDeployment = makeDeployment();

      const getDeployment = sinon
        .stub()
        .onFirstCall()
        .resolves({ data: creatingDeployment })
        .onSecondCall()
        .resolves({ data: readyDeployment });

      const client = makeMockClient({}, { getDeployment });

      await retrieveInfo(client, {
        projectId: 'proj-1',
        branchName: 'main',
        branchId: 'b-1',
        deploymentId: 'dep-1',
      });

      expect((getDeployment as sinon.SinonStub).callCount).to.equal(2);
    });

    it('throws after all retries when webspace never ready', async () => {
      const creatingDeployment = makeDeployment();
      creatingDeployment.webspace.state = WebspaceState.IN_CREATION;

      const client = makeMockClient(
        {},
        {
          getDeployment: sinon.stub().resolves({ data: creatingDeployment }),
        },
      );

      await expect(
        retrieveInfo(client, {
          projectId: 'proj-1',
          branchName: 'main',
          branchId: 'b-1',
          deploymentId: 'dep-1',
        }),
      ).to.be.rejectedWith('The setup of this DeployNow project is not fully completed yet');
    });

    it('throws when deployment API errors', async () => {
      const client = makeMockClient(
        {},
        {
          getDeployment: sinon.stub().rejects(new Error('timeout')),
        },
      );

      await expect(
        retrieveInfo(client, {
          projectId: 'proj-1',
          branchName: 'main',
          branchId: 'b-1',
          deploymentId: 'dep-1',
        }),
      ).to.be.rejectedWith('Failed to fetch information about deployment');
    });
  });
});

describe('dispatchDeployments', () => {
  it('calls triggerDeployments with correct arguments', async () => {
    const triggerDeployments = sinon.stub().resolves();
    const client = makeMockClient({ triggerDeployments }, {});

    await dispatchDeployments(client, { projectId: 'proj-1', branchId: 'b-1', commitId: 'abc123' });

    expect(
      (triggerDeployments as sinon.SinonStub).calledOnceWith('me', 'proj-1', 'b-1', {
        version: 'abc123',
        onlyFailed: false,
      }),
    ).to.equal(true);
  });

  it('throws when triggerDeployments fails', async () => {
    const client = makeMockClient(
      {
        triggerDeployments: sinon.stub().rejects(new Error('server error')),
      },
      {},
    );

    await expect(
      dispatchDeployments(client, { projectId: 'proj-1', branchId: 'b-1', commitId: 'abc123' }),
    ).to.be.rejectedWith('Failed to trigger deployments');
  });
});

describe('handleAction', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  const baseParams = { serviceHost: 'api.example.com', apiKey: 'key-123' };

  it('retrieve-info returns project info', async () => {
    const branch = makeBranchOverview('b-999');
    sandbox.stub(AxiosIonosSpaceBranchApiClient.prototype, 'getBranches').resolves({
      data: { ...PAGE, total: 1, values: [branch] },
    } as any);
    sandbox.stub(AxiosIonosSpaceDeploymentApiClient.prototype, 'getDeployments').resolves({
      data: { ...PAGE, total: 1, values: [] },
    } as any);

    const result = await handleAction({
      ...baseParams,
      action: 'retrieve-info',
      projectId: 'proj-1',
      branchName: 'main',
    });

    expect(result).to.deep.equal({ info: { 'deployment-enabled': true, 'branch-id': 'b-999' } });
  });

  it('update-status maps success to SUCCESS', async () => {
    const updateStub = sandbox.stub(AxiosIonosSpaceDeploymentApiClient.prototype, 'updateDeploymentState').resolves();

    const result = await handleAction({
      ...baseParams,
      action: 'update-status',
      projectId: 'proj-1',
      branchId: 'b-1',
      deploymentId: 'dep-1',
      status: 'success',
      runId: 'run-1',
    });

    expect(result).to.deep.equal({});
    expect(
      updateStub.calledOnceWith('me', 'proj-1', 'b-1', 'dep-1', {
        state: DeploymentState.SUCCESS,
        externalId: 'run-1',
      }),
    ).to.equal(true);
  });

  it('update-status maps failure to FAILED', async () => {
    const updateStub = sandbox.stub(AxiosIonosSpaceDeploymentApiClient.prototype, 'updateDeploymentState').resolves();

    await handleAction({
      ...baseParams,
      action: 'update-status',
      projectId: 'proj-1',
      branchId: 'b-1',
      deploymentId: 'dep-1',
      status: 'failure',
      runId: 'run-1',
    });

    expect(updateStub.firstCall.args[4].state).to.equal(DeploymentState.FAILED);
  });

  it('update-status maps cancelled to FAILED', async () => {
    const updateStub = sandbox.stub(AxiosIonosSpaceDeploymentApiClient.prototype, 'updateDeploymentState').resolves();

    await handleAction({
      ...baseParams,
      action: 'update-status',
      projectId: 'proj-1',
      branchId: 'b-1',
      deploymentId: 'dep-1',
      status: 'cancelled',
      runId: 'run-1',
    });

    expect(updateStub.firstCall.args[4].state).to.equal(DeploymentState.FAILED);
  });

  it('update-status maps in_progress to RUNNING', async () => {
    const updateStub = sandbox.stub(AxiosIonosSpaceDeploymentApiClient.prototype, 'updateDeploymentState').resolves();

    await handleAction({
      ...baseParams,
      action: 'update-status',
      projectId: 'proj-1',
      branchId: 'b-1',
      deploymentId: 'dep-1',
      status: 'in_progress',
      runId: 'run-1',
    });

    expect(updateStub.firstCall.args[4].state).to.equal(DeploymentState.RUNNING);
  });

  it('update-status throws on unknown status', async () => {
    sandbox.stub(AxiosIonosSpaceDeploymentApiClient.prototype, 'updateDeploymentState').resolves();

    await expect(
      handleAction({
        ...baseParams,
        action: 'update-status',
        projectId: 'proj-1',
        branchId: 'b-1',
        deploymentId: 'dep-1',
        status: 'unknown',
        runId: 'run-1',
      }),
    ).to.be.rejectedWith('Could not retrieve deployment state from action status: unknown');
  });

  it('set-deployments-finished calls finishDeployments', async () => {
    const finishStub = sandbox.stub(AxiosIonosSpaceBranchApiClient.prototype, 'finishDeployments').resolves();

    const result = await handleAction({
      ...baseParams,
      action: 'set-deployments-finished',
      projectId: 'proj-1',
      branchId: 'b-1',
      status: 'success',
      runId: 'run-1',
    });

    expect(result).to.deep.equal({});
    expect(finishStub.calledOnceWith('me', 'proj-1', 'b-1')).to.equal(true);
  });

  it('dispatch-deployments calls triggerDeployments', async () => {
    const triggerStub = sandbox.stub(AxiosIonosSpaceBranchApiClient.prototype, 'triggerDeployments').resolves();

    const result = await handleAction({
      ...baseParams,
      action: 'dispatch-deployments',
      projectId: 'proj-1',
      branchId: 'b-1',
      commitId: 'sha-abc',
    });

    expect(result).to.deep.equal({});
    expect(triggerStub.calledOnceWith('me', 'proj-1', 'b-1', { version: 'sha-abc', onlyFailed: false })).to.equal(true);
  });

  it('returns empty object for unsupported action', async () => {
    const result = await handleAction({
      ...baseParams,
      action: 'unsupported-action',
      projectId: 'proj-1',
      branchId: 'b-1',
    } as any);

    expect(result).to.deep.equal({});
  });
});
