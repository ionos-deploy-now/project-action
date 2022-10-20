export type EnabledProject = {
  'deployment-enabled': true;
  'branch-id': string;
};

export type DisabledProject = {
  'deployment-enabled': false;
};

export type DeploymentInfo = {
  'site-url': string;
  'remote-host': string;
  'storage-quota': number;
  'bootstrap-deploy': boolean;
  'webspace-id': string;
};