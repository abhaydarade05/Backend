export function getAtlasStorageConfig(env = process.env) {
  const required = [
    ['clientId', 'ATLAS_SERVICE_ACCOUNT_CLIENT_ID'],
    ['clientSecret', 'ATLAS_SERVICE_ACCOUNT_CLIENT_SECRET'],
    ['projectId', 'ATLAS_PROJECT_ID'],
    ['clusterName', 'ATLAS_CLUSTER_NAME']
  ];
  const values = Object.fromEntries(required.map(([key, envName]) => [key, env[envName]]));
  const missing = required
    .filter(([key]) => !values[key]?.trim())
    .map(([, envName]) => envName);

  if (missing.length) {
    throw new Error(`Atlas storage is not configured. Set ${missing.join(', ')} in Backend/.env.`);
  }

  const storageLimitMb = Number(env.ATLAS_STORAGE_LIMIT_MB ?? 500);
  if (!Number.isFinite(storageLimitMb) || storageLimitMb <= 0) {
    throw new Error('ATLAS_STORAGE_LIMIT_MB must be a positive number.');
  }

  return { ...values, storageLimitMb };
}
