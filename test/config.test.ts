import { describe, expect, it } from 'vitest';

import {
  BasicFDSCredential,
  FDSEndpointConfiguration,
  GalaxyFDSSigner,
  GalaxyFDSSignerError,
} from '../src/index.js';
import { Common } from '../src/common.js';

const ACCESS_ID = 'AKIDEXAMPLEACCESSID';
const ACCESS_SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY';
const FUTURE = 4102444800000; // 2100-01-01

describe('FDSEndpointConfiguration defaults', () => {
  it('falls back to the built-in base URIs', () => {
    const config = new FDSEndpointConfiguration();
    expect(config.endpoint).toBeUndefined();
    expect(config.regionName).toBeUndefined();
    expect(config.shouldUseVirtualAddressing()).toBe(false);
    expect(config.isHttpsEnabled()).toBe(false);
    expect(config.getBaseUri()).toBe(Common.DEFAULT_FDS_SERVICE_BASE_URI);
    expect(config.getCdnBaseUri()).toBe(Common.DEFAULT_CDN_SERVICE_URI);
  });
});

describe('FDSEndpointConfiguration endpoint parsing', () => {
  it('derives region, HTTPS and the CDN endpoint from a public endpoint', () => {
    const config = new FDSEndpointConfiguration({ endpoint: 'files.fds.api.xiaomi.com' });
    expect(config.endpoint).toBe('files.fds.api.xiaomi.com');
    expect(config.regionName).toBe('files');
    expect(config.isHttpsEnabled()).toBe(true);
    expect(config.shouldUseVirtualAddressing()).toBe(false);
    expect(config.getBaseUri()).toBe('https://files.fds.api.xiaomi.com/');
    expect(config.cdnEndpoint).toBe('cdn.files.fds.api.mi-img.com');
    expect(config.getCdnBaseUri()).toBe('https://cdn.files.fds.api.mi-img.com/');
  });

  it('recognizes the internal endpoint suffix', () => {
    const config = new FDSEndpointConfiguration({ endpoint: 'cnbj1-fds.api.xiaomi.net' });
    expect(config.regionName).toBe('cnbj1');
    expect(config.getBaseUri()).toBe('https://cnbj1-fds.api.xiaomi.net/');
  });

  it('honors enableHttps for non-virtual endpoints', () => {
    const config = new FDSEndpointConfiguration({
      endpoint: 'files.fds.api.xiaomi.com',
      enableHttps: false,
    });
    expect(config.isHttpsEnabled()).toBe(false);
    expect(config.getBaseUri()).toBe('http://files.fds.api.xiaomi.com/');
  });

  it('keeps a port from the endpoint', () => {
    const config = new FDSEndpointConfiguration({ endpoint: 'files.fds.api.xiaomi.com:8080' });
    expect(config.getBaseUri()).toBe('https://files.fds.api.xiaomi.com:8080/');
  });

  it('builds an endpoint from a region name', () => {
    const config = new FDSEndpointConfiguration({ regionName: 'cnbj1' });
    expect(config.endpoint).toBe('cnbj1.fds.api.xiaomi.com');
    expect(config.regionName).toBe('cnbj1');
  });

  it('rejects an unrecognized endpoint suffix', () => {
    expect(() => new FDSEndpointConfiguration({ endpoint: 'my.endpoint.example.com' })).toThrow(
      GalaxyFDSSignerError,
    );
  });
});

describe('FDSEndpointConfiguration virtual-hosted endpoints', () => {
  it('forces HTTPS and derives no CDN endpoint', () => {
    const config = new FDSEndpointConfiguration({ endpoint: 'files.mi-fds.com' });
    expect(config.shouldUseVirtualAddressing()).toBe(true);
    expect(config.isHttpsEnabled()).toBe(true);
    expect(config.regionName).toBe('files');
    expect(config.getBaseUri()).toBe('https://files.mi-fds.com/');
    expect(config.cdnEndpoint).toBeUndefined();
  });

  it('throws when a CDN URI is requested without a CDN endpoint', () => {
    const config = new FDSEndpointConfiguration({ endpoint: 'files.mi-fds.com' });
    expect(() => config.getCdnBaseUri()).toThrow(GalaxyFDSSignerError);
  });

  it('uses an explicit CDN endpoint when given', () => {
    const config = new FDSEndpointConfiguration({
      endpoint: 'files.mi-fds.com',
      cdnEndpoint: 'cdn.example.com',
    });
    expect(config.getCdnBaseUri()).toBe('https://cdn.example.com/');
  });
});

describe('FDSEndpointConfiguration explicit base URIs', () => {
  it('prefers explicit baseUri / cdnBaseUri', () => {
    const config = new FDSEndpointConfiguration({
      endpoint: 'files.fds.api.xiaomi.com',
      baseUri: 'http://custom.internal/',
      cdnBaseUri: 'http://custom-cdn.internal/',
    });
    expect(config.getBaseUri()).toBe('http://custom.internal/');
    expect(config.getCdnBaseUri()).toBe('http://custom-cdn.internal/');
  });
});

describe('GalaxyFDSSigner endpoint options', () => {
  const credential = new BasicFDSCredential(ACCESS_ID, ACCESS_SECRET);

  it('uses the endpoint-derived base URI for pre-signed URIs', () => {
    const client = new GalaxyFDSSigner(credential, { endpoint: 'files.fds.api.xiaomi.com' });
    const uri = client.generatePresignedUri('my-bucket', 'my-object', FUTURE);
    expect(uri.startsWith('https://files.fds.api.xiaomi.com/my-bucket/my-object?')).toBe(true);
  });

  it('still defaults to the built-in base URI without endpoint options', () => {
    const client = new GalaxyFDSSigner(credential);
    const uri = client.generatePresignedUri('my-bucket', 'my-object', FUTURE);
    expect(uri.startsWith(Common.DEFAULT_FDS_SERVICE_BASE_URI)).toBe(true);
  });

  it('exposes the resolved configuration', () => {
    const client = new GalaxyFDSSigner(credential, { endpoint: 'files.fds.api.xiaomi.com' });
    expect(client.getConfig().getBaseUri()).toBe('https://files.fds.api.xiaomi.com/');
  });
});
