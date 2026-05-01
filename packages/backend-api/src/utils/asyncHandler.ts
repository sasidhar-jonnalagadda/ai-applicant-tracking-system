import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Higher-order function to wrap async Express route handlers.
 * Eliminates the need for repetitive try/catch blocks and unsafe Function types.
 * [T-4] Fixed return type from Promise<any> to Promise<void | Response>.
 */
export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void | Response>): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
