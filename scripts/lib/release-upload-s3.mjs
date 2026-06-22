import { createHash, createHmac } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

const S3_ALGORITHM = 'AWS4-HMAC-SHA256'
const S3_PAYLOAD_HASH = 'UNSIGNED-PAYLOAD'
const S3_SERVICE = 's3'

const DEFAULT_CONTENT_TYPES = new Map([
  ['.dmg', 'application/x-apple-diskimage'],
  ['.json', 'application/json'],
  ['.sha256', 'text/plain; charset=utf-8']
])

export class ReleaseUploadConfigError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ReleaseUploadConfigError'
    this.code = code
  }
}

export function getReleaseUploadS3Config(env = process.env) {
  const endpointUrl = parseS3EndpointUrl(
    nonEmpty(env.VIDEORC_RELEASE_UPLOAD_S3_ENDPOINT_URL) ??
      nonEmpty(env.VIDEORC_DOWNLOAD_S3_ENDPOINT_URL)
  )

  return {
    accessKeyId: requireEnv(env, [
      'VIDEORC_RELEASE_UPLOAD_S3_ACCESS_KEY_ID',
      'VIDEORC_DOWNLOAD_S3_ACCESS_KEY_ID'
    ]),
    bucket: requireEnv(env, ['VIDEORC_RELEASE_UPLOAD_S3_BUCKET', 'VIDEORC_DOWNLOAD_S3_BUCKET']),
    endpointUrl,
    forcePathStyle:
      envFlag(env.VIDEORC_RELEASE_UPLOAD_S3_FORCE_PATH_STYLE) ||
      envFlag(env.VIDEORC_DOWNLOAD_S3_FORCE_PATH_STYLE) ||
      Boolean(endpointUrl),
    region: requireEnv(env, ['VIDEORC_RELEASE_UPLOAD_S3_REGION', 'VIDEORC_DOWNLOAD_S3_REGION']),
    secretAccessKey: requireEnv(env, [
      'VIDEORC_RELEASE_UPLOAD_S3_SECRET_ACCESS_KEY',
      'VIDEORC_DOWNLOAD_S3_SECRET_ACCESS_KEY'
    ]),
    sessionToken:
      nonEmpty(env.VIDEORC_RELEASE_UPLOAD_S3_SESSION_TOKEN) ??
      nonEmpty(env.VIDEORC_DOWNLOAD_S3_SESSION_TOKEN)
  }
}

export async function buildReleaseUploadPlan({
  manifest,
  manifestPath,
  releaseDir,
  env = process.env
}) {
  const releaseId = requireManifestString(manifest, 'releaseId')
  const filename = requireManifestString(manifest, 'filename')
  const prefix = normalizeObjectPrefix(
    nonEmpty(env.VIDEORC_RELEASE_UPLOAD_PREFIX) ?? `releases/macos/${releaseId}`
  )
  const artifactPath = join(releaseDir, filename)
  const shaPath = join(releaseDir, `${filename}.sha256`)

  const artifacts = [
    {
      contentType: contentTypeFor(filename),
      label: 'dmg',
      objectKey: `${prefix}/${filename}`,
      path: artifactPath
    },
    {
      contentType: contentTypeFor(`${filename}.sha256`),
      label: 'sha256',
      objectKey: `${prefix}/${filename}.sha256`,
      path: shaPath
    },
    {
      contentType: contentTypeFor('release.json'),
      label: 'manifest',
      objectKey: `${prefix}/release.json`,
      path: manifestPath
    }
  ]

  return {
    artifacts: await Promise.all(
      artifacts.map(async (artifact) => ({
        ...artifact,
        sizeBytes: (await stat(artifact.path)).size
      }))
    ),
    prefix,
    releaseId
  }
}

export function buildSignedS3Request({ config, method, objectKey }) {
  const date = new Date()
  const url = buildS3ObjectUrl(config, objectKey)
  const headers = {
    'x-amz-content-sha256': S3_PAYLOAD_HASH,
    'x-amz-date': formatS3Date(date)
  }
  if (config.sessionToken) {
    headers['x-amz-security-token'] = config.sessionToken
  }

  const canonicalHeaderEntries = [['host', url.host], ...Object.entries(headers)].sort(
    ([left], [right]) => left.localeCompare(right)
  )
  const canonicalHeaders = canonicalHeaderEntries
    .map(([key, value]) => `${key}:${value.trim()}\n`)
    .join('')
  const signedHeaders = canonicalHeaderEntries.map(([key]) => key).join(';')

  return {
    headers: {
      Authorization: buildS3AuthorizationHeader({
        canonicalHeaders,
        canonicalQuery: canonicalQuery(url.searchParams),
        config,
        date,
        method,
        pathname: url.pathname,
        signedHeaders
      }),
      'X-Amz-Content-Sha256': S3_PAYLOAD_HASH,
      'X-Amz-Date': formatS3Date(date),
      ...(config.sessionToken ? { 'X-Amz-Security-Token': config.sessionToken } : {})
    },
    url: url.toString()
  }
}

export function buildS3ObjectUrl(config, objectKey) {
  const encodedObjectKey = encodeS3ObjectKey(objectKey)

  if (!config.endpointUrl) {
    return new URL(`https://${config.bucket}.s3.${config.region}.amazonaws.com/${encodedObjectKey}`)
  }

  const url = new URL(config.endpointUrl)
  const basePath = url.pathname.replace(/\/+$/, '')
  if (config.forcePathStyle) {
    url.pathname = `${basePath}/${encodeS3PathSegment(config.bucket)}/${encodedObjectKey}`
  } else {
    url.hostname = `${config.bucket}.${url.hostname}`
    url.pathname = `${basePath}/${encodedObjectKey}`
  }

  return url
}

function buildS3AuthorizationHeader(params) {
  const amzDate = formatS3Date(params.date)
  const dateStamp = formatS3DateStamp(params.date)
  const credentialScope = `${dateStamp}/${params.config.region}/${S3_SERVICE}/aws4_request`
  const canonicalRequest = [
    params.method,
    params.pathname,
    params.canonicalQuery,
    params.canonicalHeaders,
    params.signedHeaders,
    S3_PAYLOAD_HASH
  ].join('\n')
  const stringToSign = [S3_ALGORITHM, amzDate, credentialScope, sha256Hex(canonicalRequest)].join(
    '\n'
  )
  const signature = hmacSha256(getS3SigningKey(params.config, dateStamp), stringToSign, 'hex')

  return `${S3_ALGORITHM} Credential=${params.config.accessKeyId}/${credentialScope}, SignedHeaders=${params.signedHeaders}, Signature=${signature}`
}

function parseS3EndpointUrl(value) {
  if (!value) {
    return null
  }

  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Unsupported S3 endpoint URL protocol.')
    }

    url.pathname = url.pathname.replace(/\/+$/, '')
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    throw new ReleaseUploadConfigError(
      'invalid-endpoint-url',
      'Release upload S3 endpoint URL must be a valid HTTP(S) URL.'
    )
  }
}

function requireEnv(env, names) {
  for (const name of names) {
    const value = nonEmpty(env[name])
    if (value) {
      return value
    }
  }

  throw new ReleaseUploadConfigError(
    `missing-${names
      .at(0)
      ?.toLowerCase()
      .replace(/^videorc_(release_upload_)?s3_/, '')
      .replaceAll('_', '-')}`,
    `Missing required release upload environment variable: ${names.join(' or ')}.`
  )
}

function requireManifestString(manifest, field) {
  const value = manifest?.[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ReleaseUploadConfigError(
      `missing-manifest-${field}`,
      `release.json must include ${field}.`
    )
  }
  return value.trim()
}

function normalizeObjectPrefix(prefix) {
  return prefix
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
}

function contentTypeFor(filename) {
  const name = basename(filename)
  const extension = name.endsWith('.sha256')
    ? '.sha256'
    : name.slice(Math.max(0, name.lastIndexOf('.')))
  return DEFAULT_CONTENT_TYPES.get(extension) ?? 'application/octet-stream'
}

function canonicalQuery(searchParams) {
  return [...searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
    )
    .map(([key, value]) => `${encodeS3PathSegment(key)}=${encodeS3PathSegment(value)}`)
    .join('&')
}

function encodeS3ObjectKey(objectKey) {
  return objectKey.split('/').map(encodeS3PathSegment).join('/')
}

function encodeS3PathSegment(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

function formatS3Date(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function formatS3DateStamp(date) {
  return formatS3Date(date).slice(0, 8)
}

function getS3SigningKey(config, dateStamp) {
  const dateKey = hmacSha256(`AWS4${config.secretAccessKey}`, dateStamp)
  const regionKey = hmacSha256(dateKey, config.region)
  const serviceKey = hmacSha256(regionKey, S3_SERVICE)
  return hmacSha256(serviceKey, 'aws4_request')
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function hmacSha256(key, value, encoding) {
  const digest = createHmac('sha256', key).update(value).digest()
  return encoding === 'hex' ? digest.toString('hex') : digest
}

function envFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '')
}

function nonEmpty(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : null
}
