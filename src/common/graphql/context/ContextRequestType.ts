import { Request } from 'express';
export type ContextCustomRequestType = Request & {
  user?: any;
};
