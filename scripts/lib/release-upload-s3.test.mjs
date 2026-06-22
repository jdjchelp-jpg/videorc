import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  buildReleaseUploadPlan,
  buildS3ObjectUrl,
  buildSignedS3Request,
  getReleaseUploadS3Config,
  ReleaseUploadConfigError
} from './release-upload-s3.mjs'

const manifest = {
  filename: 'Videorc-0.9.0-mac-arm64.dmg',
  releaseId: '0.9.0-beta.1'
}

const env = {
  VIDEORC_DOWNLOAD_S3_ACCESS_KEY_ID: 'VIDEORCTEST',
  VIDEORC_DOWNLOAD_S3_BUCKET: 'videorc-downloads',
  VIDEORC_DOWNLOAD_S3_ENDPOINT_URL: 'https://r2.example.test',
  VIDEORC_DOWNLOAD_S3_REGION: 'auto',
  VIDEORC_DOWNLOAD_S3_SECRET_ACCESS_KEY: 'download-secret'
}

describe('release S3 upload config', () => {
  it('uses the web download S3 environment names by default', () => {
    assert.deepEqual(getReleaseUploadS3Config(env), {
      accessKeyId: 'VIDEORCTEST',
      bucket: 'videorc-downloads',
      endpointUrl: 'https://r2.example.test/',
      forcePathStyle: true,
      region: 'auto',
      secretAccessKey: 'download-secret',
      sessionToken: null
    })
  })

  it('allows release-upload-specific environment names to override web names', () => {
    assert.deepEqual(
      getReleaseUploadS3Config({
        ...env,
        VIDEORC_RELEASE_UPLOAD_S3_ACCESS_KEY_ID: 'UPLOADKEY',
        VIDEORC_RELEASE_UPLOAD_S3_BUCKET: 'release-bucket',
        VIDEORC_RELEASE_UPLOAD_S3_ENDPOINT_URL: 'https://s3.example.test/base',
        VIDEORC_RELEASE_UPLOAD_S3_FORCE_PATH_STYLE: '0',
        VIDEORC_RELEASE_UPLOAD_S3_REGION: 'us-east-1',
        VIDEORC_RELEASE_UPLOAD_S3_SECRET_ACCESS_KEY: 'upload-secret',
        VIDEORC_RELEASE_UPLOAD_S3_SESSION_TOKEN: 'session-token'
      }),
      {
        accessKeyId: 'UPLOADKEY',
        bucket: 'release-bucket',
        endpointUrl: 'https://s3.example.test/base',
        forcePathStyle: true,
        region: 'us-east-1',
        secretAccessKey: 'upload-secret',
        sessionToken: 'session-token'
      }
    )
  })

  it('fails closed when required S3 credentials are missing', () => {
    assert.throws(
      () => getReleaseUploadS3Config({ VIDEORC_DOWNLOAD_S3_BUCKET: 'bucket' }),
      (error) => error instanceof ReleaseUploadConfigError && error.code === 'missing-access-key-id'
    )
  })

  it('rejects invalid S3 endpoints', () => {
    assert.throws(
      () =>
        getReleaseUploadS3Config({
          ...env,
          VIDEORC_DOWNLOAD_S3_ENDPOINT_URL: 'ftp://r2.example.test'
        }),
      (error) => error instanceof ReleaseUploadConfigError && error.code === 'invalid-endpoint-url'
    )
  })
})

describe('release S3 upload plan', () => {
  it('uploads the DMG, checksum, and release manifest under the release id', async () => {
    const releaseDir = await mkdtemp(join(tmpdir(), 'videorc-release-upload-'))
    await writeFile(join(releaseDir, manifest.filename), 'dmg')
    await writeFile(join(releaseDir, `${manifest.filename}.sha256`), 'sha')
    const manifestPath = join(releaseDir, 'release.json')
    const manifestJson = JSON.stringify(manifest)
    await writeFile(manifestPath, manifestJson)

    const plan = await buildReleaseUploadPlan({
      env: {},
      manifest,
      manifestPath,
      releaseDir
    })

    assert.equal(plan.releaseId, '0.9.0-beta.1')
    assert.equal(plan.prefix, 'releases/macos/0.9.0-beta.1')
    assert.deepEqual(
      plan.artifacts.map((artifact) => ({
        contentType: artifact.contentType,
        label: artifact.label,
        objectKey: artifact.objectKey,
        sizeBytes: artifact.sizeBytes
      })),
      [
        {
          contentType: 'application/x-apple-diskimage',
          label: 'dmg',
          objectKey: 'releases/macos/0.9.0-beta.1/Videorc-0.9.0-mac-arm64.dmg',
          sizeBytes: 3
        },
        {
          contentType: 'text/plain; charset=utf-8',
          label: 'sha256',
          objectKey: 'releases/macos/0.9.0-beta.1/Videorc-0.9.0-mac-arm64.dmg.sha256',
          sizeBytes: 3
        },
        {
          contentType: 'application/json',
          label: 'manifest',
          objectKey: 'releases/macos/0.9.0-beta.1/release.json',
          sizeBytes: Buffer.byteLength(manifestJson)
        }
      ]
    )
  })

  it('allows an explicit upload prefix', async () => {
    const releaseDir = await mkdtemp(join(tmpdir(), 'videorc-release-upload-'))
    await writeFile(join(releaseDir, manifest.filename), 'dmg')
    await writeFile(join(releaseDir, `${manifest.filename}.sha256`), 'sha')
    const manifestPath = join(releaseDir, 'release.json')
    await writeFile(manifestPath, JSON.stringify(manifest))

    const plan = await buildReleaseUploadPlan({
      env: { VIDEORC_RELEASE_UPLOAD_PREFIX: ' macos/beta/latest/ ' },
      manifest,
      manifestPath,
      releaseDir
    })

    assert.equal(plan.prefix, 'macos/beta/latest')
    assert.equal(plan.artifacts.at(0)?.objectKey, 'macos/beta/latest/Videorc-0.9.0-mac-arm64.dmg')
  })
})

describe('release S3 request signing', () => {
  it('builds path-style object URLs for S3-compatible endpoints', () => {
    const config = getReleaseUploadS3Config(env)
    assert.equal(
      buildS3ObjectUrl(config, 'releases/macos/0.9.0-beta.1/release.json').toString(),
      'https://r2.example.test/videorc-downloads/releases/macos/0.9.0-beta.1/release.json'
    )
  })

  it('signs PUT and HEAD requests without exposing the secret access key', () => {
    const config = getReleaseUploadS3Config(env)
    const put = buildSignedS3Request({
      config,
      method: 'PUT',
      objectKey: 'releases/macos/0.9.0-beta.1/release.json'
    })
    const head = buildSignedS3Request({
      config,
      method: 'HEAD',
      objectKey: 'releases/macos/0.9.0-beta.1/release.json'
    })

    assert.equal(put.url.includes('download-secret'), false)
    assert.equal(put.headers.Authorization.includes('download-secret'), false)
    assert.match(put.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=VIDEORCTEST\//)
    assert.equal(head.headers['X-Amz-Content-Sha256'], 'UNSIGNED-PAYLOAD')
  })
})
