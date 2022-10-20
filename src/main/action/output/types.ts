export type Info<T> = {
  info: T;
};

export type TemplateVariables<T> = {
  'template-variables': T;
};

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
  'php-version'?: string;
};

export type DeploymentVariables = {
  IONOS_APP_URL: string;
};
