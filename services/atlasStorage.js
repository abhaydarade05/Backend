import { getAtlasStorageConfig } from '../config/atlasStorage.js';

const atlasApiBase = 'https://cloud.mongodb.com/api/atlas/v2';
const atlasAccept = 'application/vnd.atlas.2024-08-05+json';
const cacheDurationMs = 60 * 1000;

let accessTokenCache = null;
let storageCache = null;

async function readJsonResponse(response, serviceName) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${serviceName} returned an invalid response.`);
  }
  if (!response.ok) {
    const code = typeof data.errorCode === 'string' ? ` ${data.errorCode}` : '';
    const detail = typeof data.detail === 'string' ? `: ${data.detail.replace(/[\r\n]/g, ' ').slice(0, 240)}` : '';
    throw new Error(`${serviceName} request failed with status ${response.status}${code}${detail}.`);
  }
  return data;
}

async function getAccessToken(config) {
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now() + 60_000) {
    return accessTokenCache.token;
  }

  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const response = await fetch('https://cloud.mongodb.com/api/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10_000)
  });
  const data = await readJsonResponse(response, 'Atlas authentication');
  if (typeof data.access_token !== 'string' || !Number.isFinite(Number(data.expires_in))) {
    throw new Error('Atlas authentication returned an invalid access token.');
  }

  accessTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in) * 1000
  };
  return accessTokenCache.token;
}

async function atlasRequest(config, pathname, query) {
  const token = await getAccessToken(config);
  const url = new URL(`${atlasApiBase}${pathname}`);
  if (query) url.search = query.toString();

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: atlasAccept
    },
    signal: AbortSignal.timeout(10_000)
  });
  return readJsonResponse(response, 'Atlas monitoring');
}

function getReplicaSetName(connectionString) {
  const query = connectionString?.split('?')[1];
  return query ? new URLSearchParams(query).get('replicaSet') : null;
}

function latestMetric(measurements, metricName) {
  const metric = measurements.find(item => item.name === metricName);
  if (!metric || !Array.isArray(metric.dataPoints)) return null;

  const points = metric.dataPoints
    .filter(point => Number.isFinite(point.value) && point.timestamp)
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
  if (!points.length) return null;

  const unitMultipliers = {
    BYTES: 1,
    KILOBYTES: 1024,
    MEGABYTES: 1024 ** 2,
    GIGABYTES: 1024 ** 3
  };
  const multiplier = unitMultipliers[metric.units];
  if (!multiplier) throw new Error(`Atlas returned an unsupported ${metricName} unit.`);

  return {
    value: points[0].value * multiplier,
    timestamp: points[0].timestamp
  };
}

export async function getAtlasStorage() {
  if (storageCache && storageCache.expiresAt > Date.now()) return storageCache.data;

  const config = getAtlasStorageConfig();
  const [cluster, processResponse] = await Promise.all([
    atlasRequest(
      config,
      `/groups/${encodeURIComponent(config.projectId)}/clusters/${encodeURIComponent(config.clusterName)}`
    ),
    atlasRequest(
    config,
    `/groups/${encodeURIComponent(config.projectId)}/processes`
    )
  ]);
  const replicaSetName = getReplicaSetName(cluster.connectionStrings?.standard);
  if (!replicaSetName) {
    throw new Error('Atlas did not provide a replica set name for this cluster. Sharded cluster storage mapping is not available.');
  }

  const processes = Array.isArray(processResponse) ? processResponse : processResponse.results;
  if (!Array.isArray(processes)) throw new Error('Atlas returned an invalid process list.');

  const clusterProcesses = processes.filter(process =>
    process.replicaSetName?.toLowerCase() === replicaSetName.toLowerCase() &&
    !process.typeName?.toUpperCase().includes('MONGOS')
  );
  if (!clusterProcesses.length) {
    throw new Error('Atlas returned no data-bearing processes for the replica set belonging to this cluster.');
  }

  const query = new URLSearchParams({
    granularity: 'PT1M',
    period: 'PT1H'
  });
  query.append('m', 'LOGICAL_SIZE');

  const nodeMeasurements = await Promise.all(clusterProcesses.map(async process => {
    const processId = process.processId || `${process.hostname}:${process.port}`;
    if (!processId || processId === 'undefined:undefined') {
      throw new Error('Atlas returned a process without an identifier.');
    }

    const response = await atlasRequest(
      config,
      `/groups/${encodeURIComponent(config.projectId)}/processes/${encodeURIComponent(processId)}/measurements`,
      query
    );
    return latestMetric(response.measurements || [], 'LOGICAL_SIZE');
  }));

  const availableMeasurements = nodeMeasurements.filter(Boolean);
  if (!availableMeasurements.length) {
    throw new Error('Atlas did not return current logical data-size metrics for this cluster.');
  }

  // Logical size is replicated across replica-set members, so use the largest
  // current node value instead of summing and counting the same data repeatedly.
  const used = availableMeasurements.reduce((largest, current) =>
    current.value > largest.value ? current : largest
  );
  const capacityBytes = config.storageLimitMb * 1024 ** 2;
  const result = {
    clusterName: config.clusterName,
    capacityBytes,
    availableBytes: Math.max(0, capacityBytes - used.value),
    usedBytes: used.value,
    nodeCount: availableMeasurements.length,
    updatedAt: used.timestamp
  };

  storageCache = { data: result, expiresAt: Date.now() + cacheDurationMs };
  return result;
}
