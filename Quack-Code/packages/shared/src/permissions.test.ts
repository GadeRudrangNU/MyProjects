import { describe, expect, it } from 'vitest';
import { can } from './permissions.js';

describe('can()', () => {
  it('lets only owners delete workspaces and manage members', () => {
    expect(can('owner', 'workspace:delete')).toBe(true);
    expect(can('editor', 'workspace:delete')).toBe(false);
    expect(can('viewer', 'member:manage')).toBe(false);
  });
  it('keeps viewers read-only but able to comment and run code', () => {
    expect(can('viewer', 'file:write')).toBe(false);
    expect(can('viewer', 'file:read')).toBe(true);
    expect(can('viewer', 'comment:create')).toBe(true);
    expect(can('viewer', 'code:run')).toBe(true);
  });
  it('lets editors write files and export', () => {
    expect(can('editor', 'file:write')).toBe(true);
    expect(can('editor', 'export:create')).toBe(true);
  });
  it('denies everything to non-members', () => {
    expect(can(null, 'workspace:read')).toBe(false);
    expect(can(undefined, 'file:read')).toBe(false);
  });
});
