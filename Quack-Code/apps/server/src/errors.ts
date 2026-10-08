export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const forbidden = (msg = 'You do not have permission to do that') => new HttpError(403, 'forbidden', msg);
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Sign in required');
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'bad_request', msg, details);
export const conflict = (msg: string) => new HttpError(409, 'conflict', msg);
