import type { PublicCreateInput, PublicCreateResult } from '@daffa/shared';
import { request } from '../lib/http';

/** POST /api/public/links. The only call the public page makes. */
export function createPublicLink(input: PublicCreateInput): Promise<PublicCreateResult> {
  return request<PublicCreateResult>('/api/public', 'POST', '/links', input);
}
