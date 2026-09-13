import { Router } from 'express';

/**
 * Express 4 不会自动捕获 async 处理器抛出的异常（会直接击穿进程）。
 * 该工厂包装 Router，使所有 handler 的 rejected promise 进入错误中间件。
 */
export function asyncRouter() {
  const r = Router();
  for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
    const orig = r[method].bind(r);
    r[method] = (path, ...handlers) =>
      orig(path, ...handlers.map((h) => (req, res, next) =>
        Promise.resolve(h(req, res, next)).catch(next)));
  }
  return r;
}
